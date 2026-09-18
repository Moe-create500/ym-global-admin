import type DatabaseType from 'better-sqlite3';

/** A Shopify bill number belongs to exactly one shop.
 *
 *  Shopify bill numbers are issued per shop: the prefix identifies the billing
 *  account ("6KAGJZ0C-0767"), the suffix is that shop's own sequence. So the
 *  same bill number can never legitimately belong to two stores.
 *
 *  It happened anyway. The invoice importer de-duplicated on
 *  (store_id, bill_number), so uploading one shop's Chargeflow export under
 *  the wrong store simply created a second copy. By 2026-09-18, 658 bill
 *  numbers sat under more than one store — 1,751 rows worth $74,682, of which
 *  roughly $50k is phantom app cost inflating the wrong stores' P&L.
 *
 *  Two things here: the guard that stops the next one, and the report that
 *  finds the ones already in. */

export interface Conflict { billNumber: string; storeId: string; storeName: string | null; totalCents: number; date: string }

/** Which of these bill numbers already belong to a DIFFERENT store. */
export function findCrossStoreConflicts(db: DatabaseType.Database, storeId: string, billNumbers: string[]): Conflict[] {
  const wanted = billNumbers.filter(Boolean);
  if (!wanted.length) return [];
  const out: Conflict[] = [];
  const CHUNK = 400;
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const slice = wanted.slice(i, i + CHUNK);
    const rows: any[] = db.prepare(`
      SELECT i.bill_number, i.store_id, s.name AS store_name, i.total_cents, i.date
      FROM shopify_invoices i LEFT JOIN stores s ON s.id = i.store_id
      WHERE i.store_id != ? AND i.bill_number IN (${slice.map(() => '?').join(',')})`).all(storeId, ...slice);
    for (const r of rows) out.push({ billNumber: r.bill_number, storeId: r.store_id, storeName: r.store_name, totalCents: r.total_cents, date: r.date });
  }
  return out;
}

export interface ConflictSummary {
  conflicts: number;                       // bill numbers that belong elsewhere
  centsElsewhere: number;
  byStore: { storeId: string; storeName: string | null; bills: number; cents: number }[];
  examples: string[];
  message: string;
}

export function summariseConflicts(conflicts: Conflict[], targetStoreName: string): ConflictSummary | null {
  if (!conflicts.length) return null;
  const byStore = new Map<string, { storeId: string; storeName: string | null; bills: number; cents: number }>();
  for (const c of conflicts) {
    const g = byStore.get(c.storeId) || { storeId: c.storeId, storeName: c.storeName, bills: 0, cents: 0 };
    g.bills++; g.cents += c.totalCents; byStore.set(c.storeId, g);
  }
  const list = [...byStore.values()].sort((a, b) => b.cents - a.cents);
  const who = list.map(s => `${s.storeName || s.storeId} (${s.bills})`).join(', ');
  return {
    conflicts: conflicts.length,
    centsElsewhere: conflicts.reduce((s, c) => s + c.totalCents, 0),
    byStore: list,
    examples: conflicts.slice(0, 5).map(c => c.billNumber),
    message: `${conflicts.length} of these bills already belong to ${who}. A Shopify bill number is issued per shop, so this file is that shop's billing, not ${targetStoreName}'s — importing it here would count the same cost twice. Pick the right store, or re-send with force to import anyway.`,
  };
}

export interface DuplicateGroup { billNumber: string; stores: { storeId: string; storeName: string | null; rowId: string; createdAt: string | null; totalCents: number }[] }

/** Bill numbers already sitting under more than one store, newest first. */
export function findExistingDuplicates(db: DatabaseType.Database, opts: { limit?: number } = {}): { groups: DuplicateGroup[]; totalBills: number; totalRows: number; phantomCents: number } {
  const dupes: any[] = db.prepare(`
    SELECT bill_number FROM shopify_invoices
    WHERE bill_number IS NOT NULL AND bill_number != ''
    GROUP BY bill_number HAVING COUNT(DISTINCT store_id) > 1`).all();
  const totalBills = dupes.length;
  if (!totalBills) return { groups: [], totalBills: 0, totalRows: 0, phantomCents: 0 };

  // Phantom cost = every copy beyond the first for each bill number.
  const tally: any = db.prepare(`
    SELECT COUNT(*) rows, COALESCE(SUM(total_cents), 0) cents FROM shopify_invoices
    WHERE bill_number IN (SELECT bill_number FROM shopify_invoices WHERE bill_number IS NOT NULL AND bill_number != ''
                          GROUP BY bill_number HAVING COUNT(DISTINCT store_id) > 1)`).get();
  const firsts: any = db.prepare(`
    SELECT COALESCE(SUM(c), 0) cents FROM (
      SELECT MAX(total_cents) c FROM shopify_invoices
      WHERE bill_number IN (SELECT bill_number FROM shopify_invoices WHERE bill_number IS NOT NULL AND bill_number != ''
                            GROUP BY bill_number HAVING COUNT(DISTINCT store_id) > 1)
      GROUP BY bill_number)`).get();

  const limit = opts.limit ?? 50;
  const groups: DuplicateGroup[] = [];
  for (const d of dupes.slice(0, limit)) {
    const rows: any[] = db.prepare(`
      SELECT i.id, i.store_id, s.name AS store_name, i.created_at, i.total_cents
      FROM shopify_invoices i LEFT JOIN stores s ON s.id = i.store_id
      WHERE i.bill_number = ? ORDER BY i.created_at`).all(d.bill_number);
    groups.push({ billNumber: d.bill_number, stores: rows.map(r => ({ storeId: r.store_id, storeName: r.store_name, rowId: r.id, createdAt: r.created_at, totalCents: r.total_cents })) });
  }
  return { groups, totalBills, totalRows: tally.rows, phantomCents: tally.cents - firsts.cents };
}

export interface SeriesOwner {
  prefix: string;
  owner: { storeId: string; storeName: string | null; rows: number; distinctDays: number } | null;
  copies: { storeId: string; storeName: string | null; rows: number; distinctDays: number; cents: number }[];
  basis: string;
}

/** Who owns each bill series, by how the rows arrived.
 *
 *  A shop's own billing trickles in: a few bills added every time the export is
 *  uploaded, across many days. Someone else's export dumped into the wrong
 *  store arrives as one bulk load on a single day. So the store that received
 *  the series across MANY days owns it, and single-day bulk loads of the same
 *  series are copies. Where no store has a multi-day history the owner is
 *  genuinely unknown and is reported as such — never guessed. */
export function inferSeriesOwners(db: DatabaseType.Database, opts: { minDays?: number } = {}): SeriesOwner[] {
  const minDays = opts.minDays ?? 3;
  const rows: any[] = db.prepare(`
    SELECT SUBSTR(i.bill_number, 1, INSTR(i.bill_number, '-') - 1) AS prefix,
           i.store_id, s.name AS store_name,
           COUNT(*) AS rows, COUNT(DISTINCT SUBSTR(i.created_at, 1, 10)) AS days,
           COALESCE(SUM(i.total_cents), 0) AS cents
    FROM shopify_invoices i LEFT JOIN stores s ON s.id = i.store_id
    WHERE i.bill_number LIKE '%-%'
    GROUP BY prefix, i.store_id`).all();

  const byPrefix = new Map<string, any[]>();
  for (const r of rows) { const l = byPrefix.get(r.prefix); if (l) l.push(r); else byPrefix.set(r.prefix, [r]); }

  const out: SeriesOwner[] = [];
  for (const [prefix, list] of byPrefix) {
    if (list.length < 2) continue;                     // only one store has it — nothing to resolve
    const multiDay = list.filter(r => r.days >= minDays).sort((a, b) => b.days - a.days);
    // One store with an ongoing history and the rest single-day loads = settled.
    const owner = multiDay.length === 1 ? multiDay[0] : null;
    out.push({
      prefix,
      owner: owner ? { storeId: owner.store_id, storeName: owner.store_name, rows: owner.rows, distinctDays: owner.days } : null,
      copies: list.filter(r => r !== owner).map(r => ({ storeId: r.store_id, storeName: r.store_name, rows: r.rows, distinctDays: r.days, cents: r.cents })),
      basis: owner
        ? `${owner.store_name} received this series on ${owner.days} separate days (its own billing, uploaded as it accrues); the others arrived as a single bulk load`
        : multiDay.length > 1
          ? `${multiDay.length} stores have a multi-day history for this series — needs a human`
          : 'every store received it in one bulk load — no evidence of ownership',
    });
  }
  return out.sort((a, b) => b.copies.reduce((s, c) => s + c.cents, 0) - a.copies.reduce((s, c) => s + c.cents, 0));
}
