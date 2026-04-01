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

async function tellerFetch<T>(accessToken: string, endpoint: string, options: TellerRequestOptions = {}): Promise<T> {
  const url = `${TELLER_API_URL}${endpoint}`;

  // Use Node's https module for mTLS
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
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error(`Teller API: invalid JSON response`)); }
        } else {
          reject(new Error(`Teller API ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Teller API request failed: ${err.message}`)));

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
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

export async function deleteEnrollment(accessToken: string, enrollmentId: string): Promise<void> {
  await tellerFetch(accessToken, `/enrollments/${enrollmentId}`, { method: 'DELETE' });
}
