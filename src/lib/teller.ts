import https from 'https';
import fs from 'fs';
import path from 'path';

const TELLER_API_URL = 'https://api.teller.io';

// Load mTLS certificates
const certPath = path.join(process.cwd(), 'certificates', 'teller-cert.pem');
const keyPath = path.join(process.cwd(), 'certificates', 'teller-key.pem');

let tlsAgent: https.Agent | null = null;

function getAgent(): https.Agent {
  if (!tlsAgent) {
    const cert = fs.readFileSync(certPath);
    const key = fs.readFileSync(keyPath);
    tlsAgent = new https.Agent({ cert, key });
  }
  return tlsAgent;
}

interface TellerRequestOptions {
  method?: string;
  body?: any;
}

function singleFetch<T>(accessToken: string, endpoint: string, options: TellerRequestOptions = {}): Promise<{ data?: T; statusCode?: number; raw?: string }> {
  const url = `${TELLER_API_URL}${endpoint}`;

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      agent: getAgent(),
      headers: {
        'Authorization': `Basic ${Buffer.from(`${accessToken}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, raw: data, data: res.statusCode && res.statusCode >= 200 && res.statusCode < 300 ? JSON.parse(data) : undefined });
      });
    });

    req.on('error', (err) => reject(new Error(`Teller API request failed: ${err.message}`)));

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function tellerFetch<T>(accessToken: string, endpoint: string, options: TellerRequestOptions = {}): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await sleep(3000 * attempt); // backoff: 3s, 6s, 9s, 12s
    const { data, statusCode, raw } = await singleFetch<T>(accessToken, endpoint, options);
    if (data !== undefined) return data;
    if (statusCode === 429 && attempt < 4) continue; // retry on rate limit
    throw new Error(`Teller API ${statusCode}: ${raw}`);
  }
  throw new Error('Teller API: max retries exceeded');
}

export interface TellerAccount {
  id: string;
  enrollment_id: string;
  institution: { id: string; name: string };
  name: string;
  type: string;
  subtype: string;
  currency: string;
  last_four: string;
  status: string;
}

export interface TellerBalance {
  account_id: string;
  available: string;
  ledger: string;
}

export interface TellerTransaction {
  id: string;
  account_id: string;
  date: string;
  description: string;
  details: { category: string; counterparty: { name: string; type: string } | null; processing_status: string };
  amount: string;
  type: string;
  status: string;
  running_balance: string | null;
}

export async function getAccounts(accessToken: string): Promise<TellerAccount[]> {
  return tellerFetch(accessToken, '/accounts');
}

export async function getAccountBalance(accessToken: string, accountId: string): Promise<TellerBalance> {
  return tellerFetch(accessToken, `/accounts/${accountId}/balances`);
}

export async function getAccountTransactions(accessToken: string, accountId: string, count = 100): Promise<TellerTransaction[]> {
  return tellerFetch(accessToken, `/accounts/${accountId}/transactions?count=${count}`);
}

// Paginate through ALL transactions for an account
export async function getAllAccountTransactions(accessToken: string, accountId: string): Promise<TellerTransaction[]> {
  const all: TellerTransaction[] = [];
  let fromId: string | null = null;
  const pageSize = 250;

  for (let i = 0; i < 50; i++) { // safety cap at 50 pages (~12,500 txns)
    if (i > 0) await sleep(1000); // pace between pages
    let url = `/accounts/${accountId}/transactions?count=${pageSize}`;
    if (fromId) url += `&from_id=${fromId}`;

    const page: TellerTransaction[] = await tellerFetch(accessToken, url);
    if (!page || page.length === 0) break;

    all.push(...page);
    if (page.length < pageSize) break; // last page

    fromId = page[page.length - 1].id;
  }

  return all;
}

export async function deleteEnrollment(accessToken: string, enrollmentId: string): Promise<void> {
  await tellerFetch(accessToken, `/enrollments/${enrollmentId}`, { method: 'DELETE' });
}
