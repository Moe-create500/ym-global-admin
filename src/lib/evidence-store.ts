import crypto from 'crypto';
import type Database from 'better-sqlite3';

// Shared evidence storage: dedup + supersede + insert. Used by BOTH the CSV upload
// route and the Shopify API sync, so normalized rows from either source flow through
// identical dedup/supersede logic (immutable identity key; re-uploads refresh mutable
// status/payout_date in place; occurrence ordinal keeps legit twins).

export function rowKey(r: any): string {
  return [
    r.ts_utc || r.date || '',
    r.amount_cents ?? '', r.fee_cents ?? '', r.net_cents ?? '',
    (r.reference || '').trim(), (r.type || '').trim(),
  ].join('|');
}

function summarize(rows: any[]) {
  let min: string | null = null, max: string | null = null, sumA = 0, sumN = 0;
  for (const r of rows) {
    const key = r.ts_utc || r.date;
    if (key) { if (!min || key < min) min = key; if (!max || key > max) max = key; }
    if (r.amount_cents != null) sumA += r.amount_cents;
    if (r.net_cents != null) sumN += r.net_cents;
  }
  return { min_ts: min, max_ts: max, sum_amount_cents: sumA, sum_net_cents: sumN };
}

export interface StoreEvidenceResult {
  id: string | null;
  imported: number;
  updated: number;
  duplicates: number;
  min_ts: string | null;
  max_ts: string | null;
  warnings: string[];
}

/** Dedup against every prior upload for the store, supersede changed rows in place,
 *  insert only genuinely new rows as a fresh evidence record. */
export function storeEvidenceRows(db: Database.Database, opts: {
  storeId: string; kind: string; rows: any[]; headers?: string[];
  filename?: string; reconId?: string | null; extraWarnings?: string[];
}): StoreEvidenceResult {
  const { storeId, kind, rows, headers = [], filename, reconId = null, extraWarnings = [] } = opts;

  const priorUploads: any[] = db.prepare(
    'SELECT id, rows_json FROM cfo_evidence WHERE store_id = ? ORDER BY created_at ASC'
  ).all(storeId).map((u: any) => {
    let r: any[] = [];
    try { r = JSON.parse(u.rows_json) || []; } catch { /* corrupt → empty */ }
    return { id: u.id, rows: r, dirty: false };
  });

  const slots = new Map<string, { u: number; i: number }[]>();
  priorUploads.forEach((u, ui) => u.rows.forEach((r: any, ri: number) => {
    const k = rowKey(r);
    if (!slots.has(k)) slots.set(k, []);
    slots.get(k)!.push({ u: ui, i: ri });
  }));

  const newRows: any[] = [];
  let updated = 0, duplicates = 0;
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = rowKey(r);
    const ord = seen.get(k) || 0;
    seen.set(k, ord + 1);
    const list = slots.get(k);
    if (list && ord < list.length) {
      const slot = list[ord];
      const prior = priorUploads[slot.u];
      if (JSON.stringify(prior.rows[slot.i]) !== JSON.stringify(r)) {
        prior.rows[slot.i] = r; prior.dirty = true; updated++;
      } else duplicates++;
    } else newRows.push(r);
  }
  for (const u of priorUploads) {
    if (u.dirty) db.prepare('UPDATE cfo_evidence SET rows_json = ? WHERE id = ?').run(JSON.stringify(u.rows), u.id);
  }

  const warnings = [...extraWarnings];
  if (duplicates > 0 || updated > 0) {
    warnings.push(`${newRows.length} new; ${updated} refreshed; ${duplicates} unchanged.`);
  }

  let id: string | null = null;
  const stats = summarize(newRows);
  if (newRows.length > 0) {
    id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO cfo_evidence (id, store_id, reconciliation_id, kind, filename, headers_json, rows_json, row_count, min_ts, max_ts, sum_amount_cents, sum_net_cents, note, warnings)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, storeId, reconId, kind, filename || null,
      JSON.stringify(headers), JSON.stringify(newRows), newRows.length,
      stats.min_ts, stats.max_ts, stats.sum_amount_cents, stats.sum_net_cents,
      null, warnings.length ? JSON.stringify(warnings) : null
    );
  }

  return { id, imported: newRows.length, updated, duplicates, min_ts: stats.min_ts, max_ts: stats.max_ts, warnings };
}
