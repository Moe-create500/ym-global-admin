/**
 * Evidence CSV parser/normalizer for the CFO reconciliation AI investigator.
 * ==========================================================================
 * Users submit raw exports (Shopify Payments transactions/payouts CSV, Shopify Balance
 * or other bank statement CSV) as ground-truth cash records. This module parses any CSV
 * tolerantly, keeps EVERY original column, and adds normalized fields the AI can rely on:
 *   - ts_utc: exact timestamp normalized to UTC 'YYYY-MM-DD HH:MM:SS' (same format as
 *     sqlite datetime('now') used by cfo_snapshots.created_at) — to the SECOND when the
 *     export carries one; date-only rows get ts_utc = null and keep just date.
 *   - amount_cents / fee_cents / net_cents: integer cents parsed from money columns.
 * Nothing is discarded: unrecognized columns ride along in `raw`.
 */

export interface NormalizedRow {
  ts_utc: string | null;   // exact UTC timestamp to the second, when the export has one
  date: string | null;     // YYYY-MM-DD (from ts or from a date-only column)
  amount_cents: number | null;
  fee_cents: number | null;
  net_cents: number | null;
  type: string | null;     // charge/refund/payout/adjustment/etc when present
  reference: string | null; // order #, payout id, transaction id, description
  payout_status: string | null;
  payout_date: string | null;
  raw: Record<string, string>; // every original column, untouched
}

export interface ParsedEvidence {
  kind_guess: 'shopify_payments' | 'shopify_payouts' | 'bank_statement' | 'unknown';
  headers: string[];
  rows: NormalizedRow[];
  row_count: number;
  min_ts: string | null;   // earliest ts_utc or date seen
  max_ts: string | null;
  sum_amount_cents: number;
  sum_net_cents: number;
  warnings: string[];
}

/** RFC-4180-ish CSV parse: quoted fields, embedded commas/newlines/escaped quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

/** "$1,234.56" | "(123.45)" | "-123.45" | "123" → integer cents (null if not money-like). */
export function parseMoneyCents(s: string | undefined | null): number | null {
  if (s == null) return null;
  let t = String(s).trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  t = t.replace(/[$€£\s]/g, '').replace(/,/g, '');
  if (t.startsWith('-')) { neg = !neg ? true : neg; t = t.slice(1); }
  else if (t.startsWith('+')) t = t.slice(1);
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const cents = Math.round(parseFloat(t) * 100);
  if (!isFinite(cents)) return null;
  return neg ? -cents : cents;
}

function pad(n: number): string { return n < 10 ? '0' + n : String(n); }

/**
 * Normalize a timestamp string to UTC 'YYYY-MM-DD HH:MM:SS'.
 * Handles: '2026-07-03 18:04:32 -0400' (Shopify), ISO 'Z'/offset forms,
 * '2026-07-03 18:04:32' (assumed UTC), 'MM/DD/YYYY HH:MM[:SS]' (assumed UTC).
 * Date-only strings return { ts: null, date }.
 */
export function normalizeTs(s: string | undefined | null): { ts: string | null; date: string | null } {
  if (s == null) return { ts: null, date: null };
  const t = String(s).trim();
  if (!t) return { ts: null, date: null };

  // date-only
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { ts: null, date: `${m[1]}-${m[2]}-${m[3]}` };
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return { ts: null, date: `${m[3]}-${pad(+m[1])}-${pad(+m[2])}` };

  // full timestamp with optional offset: 2026-07-03 18:04:32 -0400 | -04:00 | Z
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    const [, Y, Mo, D, H, Mi] = m;
    const S = m[6] || '00';
    const off = m[7];
    let ms = Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +S);
    if (off && off !== 'Z') {
      const om = off.match(/([+-])(\d{2}):?(\d{2})/)!;
      const offMin = (+om[2] * 60 + +om[3]) * (om[1] === '-' ? -1 : 1);
      ms -= offMin * 60_000; // local = UTC + offset → UTC = local − offset
    }
    const d = new Date(ms);
    const ts = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    return { ts, date: ts.slice(0, 10) };
  }

  // MM/DD/YYYY HH:MM[:SS] — assume UTC
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const ts = `${m[3]}-${pad(+m[1])}-${pad(+m[2])} ${pad(+m[4])}:${m[5]}:${m[6] || '00'}`;
    return { ts, date: ts.slice(0, 10) };
  }

  // last resort: Date.parse
  const p = Date.parse(t);
  if (!isNaN(p)) {
    const d = new Date(p);
    const ts = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    return { ts, date: ts.slice(0, 10) };
  }
  return { ts: null, date: null };
}

function findHeader(headers: string[], ...candidates: string[]): number {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const c of candidates) {
    const i = lower.indexOf(c);
    if (i !== -1) return i;
  }
  // loose contains-match as fallback
  for (const c of candidates) {
    const i = lower.findIndex(h => h.includes(c));
    if (i !== -1) return i;
  }
  return -1;
}

/** Parse + normalize a submitted evidence CSV. Never throws on messy data — collects warnings. */
export function parseEvidenceCsv(csvText: string): ParsedEvidence {
  const warnings: string[] = [];
  const grid = parseCsv(csvText);
  if (grid.length < 2) {
    return { kind_guess: 'unknown', headers: grid[0] || [], rows: [], row_count: 0, min_ts: null, max_ts: null, sum_amount_cents: 0, sum_net_cents: 0, warnings: ['CSV has no data rows'] };
  }
  const headers = grid[0].map(h => h.trim());
  const lower = headers.map(h => h.toLowerCase());

  // classify the export
  let kind: ParsedEvidence['kind_guess'] = 'unknown';
  if (lower.includes('transaction date') && (lower.includes('fee') || lower.includes('net'))) kind = 'shopify_payments';
  else if (lower.includes('payout date') && lower.includes('total') === false && lower.includes('transaction date') === false && lower.some(h => h === 'amount')) kind = 'shopify_payouts';
  else if (lower.some(h => h.includes('description') || h.includes('memo')) && lower.some(h => h === 'amount' || h.includes('amount'))) kind = 'bank_statement';

  const iTs = findHeader(headers, 'transaction date', 'date', 'posted date', 'created at', 'created_at', 'datetime');
  const iAmount = findHeader(headers, 'amount', 'gross', 'debit');
  const iFee = findHeader(headers, 'fee', 'fees');
  const iNet = findHeader(headers, 'net', 'net amount');
  const iType = findHeader(headers, 'type', 'transaction type', 'category');
  const iRef = findHeader(headers, 'order', 'order name', 'description', 'memo', 'reference', 'transaction id', 'checkout');
  const iPayoutStatus = findHeader(headers, 'payout status', 'status');
  const iPayoutDate = findHeader(headers, 'payout date');

  if (iTs === -1) warnings.push('No date/timestamp column recognized — rows kept with ts_utc=null.');
  if (iAmount === -1) warnings.push('No amount column recognized — rows kept with amount_cents=null.');

  const rows: NormalizedRow[] = [];
  let minTs: string | null = null;
  let maxTs: string | null = null;
  let sumAmount = 0;
  let sumNet = 0;

  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    if (cells.every(c => !c || !c.trim())) continue;
    const raw: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) raw[headers[c] || `col_${c}`] = cells[c] ?? '';

    const { ts, date } = normalizeTs(iTs !== -1 ? cells[iTs] : null);
    const amount = parseMoneyCents(iAmount !== -1 ? cells[iAmount] : null);
    const fee = parseMoneyCents(iFee !== -1 ? cells[iFee] : null);
    const net = parseMoneyCents(iNet !== -1 ? cells[iNet] : null);
    const payoutDate = iPayoutDate !== -1 ? (normalizeTs(cells[iPayoutDate]).date || cells[iPayoutDate]?.trim() || null) : null;

    if (amount != null) sumAmount += amount;
    if (net != null) sumNet += net;
    const key = ts || date;
    if (key) {
      if (!minTs || key < minTs) minTs = key;
      if (!maxTs || key > maxTs) maxTs = key;
    }

    rows.push({
      ts_utc: ts,
      date,
      amount_cents: amount,
      fee_cents: fee,
      net_cents: net,
      type: iType !== -1 ? (cells[iType]?.trim() || null) : null,
      reference: iRef !== -1 ? (cells[iRef]?.trim() || null) : null,
      payout_status: iPayoutStatus !== -1 ? (cells[iPayoutStatus]?.trim() || null) : null,
      payout_date: payoutDate,
      raw,
    });
  }

  return { kind_guess: kind, headers, rows, row_count: rows.length, min_ts: minTs, max_ts: maxTs, sum_amount_cents: sumAmount, sum_net_cents: sumNet, warnings };
}
