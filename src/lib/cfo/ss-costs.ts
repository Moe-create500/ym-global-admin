import type DatabaseType from 'better-sqlite3';
import { merchantKey } from '../subscriptions/normalize';

/** ShipSourced's own costs, as paid from YM's banks and cards: every ledger
 *  row paired to the ShipSourced store is classified into a FULFILMENT LINE
 *  (which part of fulfilment it pays for) and a FULFILMENT CENTRE (California,
 *  China, or shared). Defaults come from merchant rules; a worker can change
 *  either and have it remembered for that merchant. Money movement (card
 *  payments, transfers) is never a cost line. */

export type SsLine =
  | 'product_cogs'        // goods bought for clients / stock (1688, Alibaba, agents)
  | 'carrier_labels'      // postage & labels (USPS, Shippo, GoShip, DHL)
  | 'china_agent'         // payments to China agents / Hualei via XE, Wise, Alipay
  | 'packaging_supplies'  // boxes, mailers, tape, warehouse consumables
  | 'warehouse_lease'     // rent / lease
  | 'labor'               // contractors, VAs, warehouse staff
  | 'software_3pl'        // ShipHero, Shippo plan, Retell, Workspace, DocuSign
  | 'equipment'           // scales, printers, cables, computers
  | 'card_fees'           // interest, late fees, cash-equivalent fees, annual fees
  | 'marketplace_purchase'// eBay / Amazon purchases — usually equipment or stock, needs a look
  | 'other'
  | 'movement';           // not a cost: card payments, own transfers

export type SsCenter = 'CA' | 'CN' | 'shared';

export interface SsClass { line: SsLine; center: SsCenter; source: 'rule' | 'default' | 'manual'; needsReview: boolean; ruleKey: string | null }

export const SS_LINE_LABEL: Record<SsLine, string> = {
  product_cogs: 'Product / COGS', carrier_labels: 'Carrier & labels', china_agent: 'China agent payments', packaging_supplies: 'Packaging & supplies',
  warehouse_lease: 'Warehouse lease', labor: 'Labor', software_3pl: 'Software (3PL tools)', equipment: 'Equipment', card_fees: 'Card fees & interest',
  marketplace_purchase: 'Marketplace purchase', other: 'Other', movement: 'Money movement (not a cost)',
};
export const SS_CENTER_LABEL: Record<SsCenter, string> = { CA: 'California', CN: 'China', shared: 'Shared' };

/** Built-in defaults by merchant key (see subscriptions/normalize.ts). Order matters: first match wins. */
const DEFAULTS: [RegExp, SsLine, SsCenter][] = [
  [/ONLINE PAYMENT|ACH PMT|PAYMENT TO CRD|EPAYMENT|AMERICAN EXPRESS DES|CREDIT CRD|ONLINE BANKING TRANSFER|ONLINE TRANSFER|MOBILE TRANSFER|ACH TRANSFER TO|TRANSFER TO (CHK|SAV)|TRANSFER YM GLOBAL|ZELLE PAYMENT TO SHIPSOURCED|ZELLE PAYMENT FROM/i, 'movement', 'shared'],
  [/1688|ALIBABA|ALIPAY|TAOBAO|PINDUODUO/i, 'product_cogs', 'CN'],
  [/XE MONEY|WISE US|WISE INC|PAYONEER|HUALEI|INTELINK|WIRE TYPE:INTL/i, 'china_agent', 'CN'],
  [/USPS|SHIPPO|GOSHIP|BORDERBUDDY|DHL|FEDEX|\bUPS\b|USHIP|STAMPS\.COM|PIRATE ?SHIP/i, 'carrier_labels', 'CA'],
  [/GRAINGER|ULINE|VISTAPRINT|PACKAGING|BOXES|MAILERS|HOME DEPOT|LOWES|COSTCO|WALMART|SAMS CLUB|AMAZON MKTP|AMZN MKTP|AMAZON MARK/i, 'packaging_supplies', 'CA'],
  [/ESCOR|LEASE|RENT\b|ROYAL STAR/i, 'warehouse_lease', 'CA'],
  [/ZELLE|PARJINDER|PAYROLL|GUSTO|ADP|UPWORK|FIVERR|ONLINEJOBS/i, 'labor', 'CA'],
  [/SHIPHERO|RETELLAI|RETELL|WORKSPACE|GOOGLE\b|DOCUSIGN|SHIPSTATION|EASYPOST|AFTERSHIP|NOTION|SLACK|ZOOM|QUICKBOOKS|INTUIT|CALENDLY|HIGHLEVEL|KLAVIYO|CANVA|OPENAI|ANTHROPIC|CLAUDE|SUPABASE|VERCEL|CLOUDFLARE|GODADDY/i, 'software_3pl', 'shared'],
  [/CABLE MART|LOGITECH|BEST BUY|APPLE\.COM|NEWEGG|B&H|DYMO|ZEBRA|ROLLO|BROTHER|HP\b|DELL/i, 'equipment', 'CA'],
  [/INTEREST CHARGE|LATE FEE|FINANCE CHARGE|CASH EQUIVALENT|ANNUAL CARD FEE|MEMBERSHIP FEE|CASH ADVANCE|MONTHLY FEE|WIRE FEE/i, 'card_fees', 'shared'],
  [/EBAY O\*|EBAY\b/i, 'marketplace_purchase', 'CA'],
];

export function ensureSsCostSchema(db: DatabaseType.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ss_cost_classes (txn_id TEXT PRIMARY KEY, line TEXT NOT NULL, center TEXT NOT NULL, actor TEXT, note TEXT, updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS ss_cost_rules (merchant_key TEXT PRIMARY KEY, line TEXT NOT NULL, center TEXT NOT NULL, actor TEXT, updated_at TEXT DEFAULT (datetime('now')));
  `);
}

export function defaultClass(description: string | null | undefined): { line: SsLine; center: SsCenter } | null {
  const d = String(description || '');
  for (const [rx, line, center] of DEFAULTS) if (rx.test(d)) return { line, center };
  return null;
}

export function classifyRow(db: DatabaseType.Database, txnId: string, description: string | null): SsClass {
  ensureSsCostSchema(db);
  const manual: any = db.prepare('SELECT line, center FROM ss_cost_classes WHERE txn_id = ?').get(txnId);
  if (manual) return { line: manual.line, center: manual.center, source: 'manual', needsReview: false, ruleKey: null };
  const key = merchantKey(description)?.key || null;
  if (key) {
    const rule: any = db.prepare('SELECT line, center FROM ss_cost_rules WHERE merchant_key = ?').get(key);
    if (rule) return { line: rule.line, center: rule.center, source: 'rule', needsReview: false, ruleKey: key };
  }
  const d = defaultClass(description);
  if (d) return { ...d, source: 'default', needsReview: d.line === 'marketplace_purchase' || d.line === 'other', ruleKey: key };
  return { line: 'other', center: 'shared', source: 'default', needsReview: true, ruleKey: key };
}

/** Worker sets a row's line/centre; with `remember`, every charge from the same merchant follows. */
export function setRowClass(db: DatabaseType.Database, txnId: string, line: SsLine, center: SsCenter, actor: string | null, remember: boolean, description: string | null) {
  ensureSsCostSchema(db);
  db.prepare(`INSERT INTO ss_cost_classes (txn_id, line, center, actor) VALUES (?, ?, ?, ?)
    ON CONFLICT(txn_id) DO UPDATE SET line = excluded.line, center = excluded.center, actor = excluded.actor, updated_at = datetime('now')`).run(txnId, line, center, actor);
  const key = remember ? merchantKey(description)?.key : null;
  if (key) db.prepare(`INSERT INTO ss_cost_rules (merchant_key, line, center, actor) VALUES (?, ?, ?, ?)
    ON CONFLICT(merchant_key) DO UPDATE SET line = excluded.line, center = excluded.center, actor = excluded.actor, updated_at = datetime('now')`).run(key, line, center, actor);
  return { ok: true, ruleKey: key || null };
}

export interface SsLedgerCost { line: SsLine; center: SsCenter; cents: number; count: number; needsReview: number }

/** ShipSourced's ledger costs in a period, by line × centre. Movement rows are excluded. */
export function ledgerCosts(db: DatabaseType.Database, ssStoreId: string, from: string, to: string): { cells: SsLedgerCost[]; total: number; needsReviewCents: number; rows: number } {
  ensureSsCostSchema(db);
  const rows: any[] = db.prepare(`
    SELECT t.id, t.description, t.amount_cents FROM bank_transactions t
    JOIN classification_results r ON r.txn_id = t.id
    WHERE COALESCE(t.custom_store_id, r.store_id) = ? AND t.amount_cents < 0 AND t.date BETWEEN ? AND ?
      AND COALESCE(r.category,'') NOT IN ('Credit Card Payment','Transfer Out','Transfer In','Shopify Payout','Fraud Reversal')`).all(ssStoreId, from, to);
  const cells = new Map<string, SsLedgerCost>();
  let total = 0, needsReviewCents = 0, n = 0;
  for (const r of rows) {
    const c = classifyRow(db, r.id, r.description);
    if (c.line === 'movement') continue;
    const k = `${c.line}|${c.center}`;
    const cell = cells.get(k) || { line: c.line, center: c.center, cents: 0, count: 0, needsReview: 0 };
    cell.cents += -r.amount_cents; cell.count++; if (c.needsReview) { cell.needsReview++; needsReviewCents += -r.amount_cents; }
    cells.set(k, cell); total += -r.amount_cents; n++;
  }
  return { cells: [...cells.values()].sort((a, b) => b.cents - a.cents), total, needsReviewCents, rows: n };
}
