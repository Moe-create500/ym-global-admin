import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { ensureEvidenceTable } from '@/lib/ai-reconcile';
import { parseEvidenceCsv } from '@/lib/evidence-parse';

export const dynamic = 'force-dynamic';

const MAX_CSV_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Row identity for dedup/supersede across uploads.
 * Identity = the IMMUTABLE facts of a money event: timestamp/date + type + amounts +
 * reference. payout_status and payout_date are deliberately EXCLUDED — Shopify mutates
 * them (pending → scheduled → paid; estimated dates slide), and keying on them would
 * store the same charge twice on every re-upload, doubling cashflow totals.
 * Re-uploads SUPERSEDE matching stored rows (fresher status/payout_date wins).
 * An occurrence ordinal distinguishes legitimately identical rows in one export
 * (two $100 payouts on the same day); the prior-side ordinal counter is shared across
 * ALL stored uploads in insertion order so split-across-files twins stay correct.
 */
function rowKey(r: any): string {
  return [
    r.ts_utc || r.date || '',
    r.amount_cents ?? '', r.fee_cents ?? '', r.net_cents ?? '',
    (r.reference || '').trim(), (r.type || '').trim(),
  ].join('|');
}

/** Recompute range + sums over a subset of rows (after dedup filtering). */
function summarize(rows: any[]): { min_ts: string | null; max_ts: string | null; sum_amount_cents: number; sum_net_cents: number } {
  let min: string | null = null, max: string | null = null, sumA = 0, sumN = 0;
  for (const r of rows) {
    const key = r.ts_utc || r.date;
    if (key) {
      if (!min || key < min) min = key;
      if (!max || key > max) max = key;
    }
    if (r.amount_cents != null) sumA += r.amount_cents;
    if (r.net_cents != null) sumN += r.net_cents;
  }
  return { min_ts: min, max_ts: max, sum_amount_cents: sumA, sum_net_cents: sumN };
}

// GET /api/cfo/reconcile/evidence?storeId=...&reconciliationId=...
// Lists uploads (metadata only — rows stay server-side for the AI).
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  const reconciliationId = req.nextUrl.searchParams.get('reconciliationId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();
  ensureEvidenceTable(db);

  let reconId = reconciliationId;
  if (!reconId) {
    const latest: any = db.prepare(
      'SELECT id FROM cfo_reconciliations WHERE store_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(storeId);
    reconId = latest?.id || null;
  }

  const rows = db.prepare(
    `SELECT id, reconciliation_id, kind, filename, row_count, min_ts, max_ts, sum_amount_cents, sum_net_cents, note, warnings, created_at
     FROM cfo_evidence WHERE store_id = ? AND (reconciliation_id = ? OR reconciliation_id IS NULL)
     ORDER BY created_at DESC`
  ).all(storeId, reconId);

  return NextResponse.json({ evidence: rows, reconciliation_id: reconId });
}

// POST /api/cfo/reconcile/evidence
// { storeId, reconciliationId?, kind?, filename, csvText, note? }
// Parses + normalizes the CSV (exact-second UTC timestamps, integer cents) and stores it
// attached to the reconciliation so the AI investigator uses it as ground-truth cash evidence.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { storeId, reconciliationId, kind, filename, csvText, note, scope } = body || {};
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  if (!csvText || typeof csvText !== 'string') return NextResponse.json({ error: 'csvText required' }, { status: 400 });
  if (Buffer.byteLength(csvText, 'utf8') > MAX_CSV_BYTES) {
    return NextResponse.json({ error: 'CSV too large (8 MB max) — export a narrower date range' }, { status: 413 });
  }

  const db = getDb();
  ensureEvidenceTable(db);

  // scope 'store' (Bulk Upload): evidence belongs to the store, not one reconciliation —
  // it feeds EVERY window whose dates overlap. Otherwise attach to the given/latest recon.
  let reconId: string | null = null;
  if (scope !== 'store') {
    reconId = reconciliationId || null;
    if (!reconId) {
      const latest: any = db.prepare(
        'SELECT id FROM cfo_reconciliations WHERE store_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(storeId);
      if (!latest) return NextResponse.json({ error: 'No reconciliation found for store' }, { status: 404 });
      reconId = latest.id;
    }
  }

  const parsed = parseEvidenceCsv(csvText);
  if (parsed.row_count === 0) {
    return NextResponse.json({ error: `No data rows parsed. ${parsed.warnings.join(' ')}` }, { status: 400 });
  }

  // The parser's structural guess beats the drop zone the user happened to click
  // (e.g. a payouts export dropped on the "payments" zone still gets payout semantics).
  const finalKind = parsed.kind_guess !== 'unknown' ? parsed.kind_guess : (kind || 'unknown');

  // ── Cross-store guard: the same export uploaded to the WRONG store must be rejected,
  // not silently duplicated across stores (rows carry store-unique refs/timestamps, so
  // heavy overlap with another store's data means it's that store's file).
  const incomingKeys = new Set(parsed.rows.map(rowKey));
  if (parsed.rows.length >= 20) {
    const otherUploads: any[] = db.prepare(
      `SELECT e.store_id, s.name AS store_name, e.rows_json FROM cfo_evidence e JOIN stores s ON s.id = e.store_id WHERE e.store_id != ?`
    ).all(storeId);
    const overlapByStore = new Map<string, number>();
    for (const other of otherUploads) {
      try {
        let hits = 0;
        for (const r of JSON.parse(other.rows_json) || []) if (incomingKeys.has(rowKey(r))) hits++;
        overlapByStore.set(other.store_name, (overlapByStore.get(other.store_name) || 0) + hits);
      } catch { /* skip corrupt */ }
    }
    for (const [otherStore, hits] of overlapByStore) {
      if (hits / parsed.rows.length >= 0.6) {
        return NextResponse.json({
          error: `This file looks like it belongs to ${otherStore} — ${Math.round((hits / parsed.rows.length) * 100)}% of its rows are already uploaded there. In Shopify, make sure you're logged into the right store before exporting.`,
        }, { status: 409 });
      }
    }
  }

  // ── Dedup + supersede against every prior upload for this store (ALL kinds — kind is
  // metadata, not identity). Matching rows are REFRESHED in place (status/payout_date
  // updates win); only genuinely new rows are stored as a new upload.
  const priorUploads: any[] = db.prepare(
    'SELECT id, rows_json FROM cfo_evidence WHERE store_id = ? ORDER BY created_at ASC'
  ).all(storeId).map((u: any) => {
    let rows: any[] = [];
    try { rows = JSON.parse(u.rows_json) || []; } catch { /* corrupt → treat as empty */ }
    return { id: u.id, rows, dirty: false };
  });
  // occupancy: identity key → ordered slots across all prior uploads (shared ordinal space)
  const slots = new Map<string, { u: number; i: number }[]>();
  priorUploads.forEach((u, ui) => u.rows.forEach((r: any, ri: number) => {
    const k = rowKey(r);
    if (!slots.has(k)) slots.set(k, []);
    slots.get(k)!.push({ u: ui, i: ri });
  }));

  const newRows: any[] = [];
  let updated = 0, duplicates = 0;
  const seenIncoming = new Map<string, number>();
  for (const r of parsed.rows) {
    const k = rowKey(r);
    const ord = seenIncoming.get(k) || 0;
    seenIncoming.set(k, ord + 1);
    const slotList = slots.get(k);
    if (slotList && ord < slotList.length) {
      const slot = slotList[ord];
      const prior = priorUploads[slot.u];
      if (JSON.stringify(prior.rows[slot.i]) !== JSON.stringify(r)) {
        prior.rows[slot.i] = r; // supersede: fresher status / payout_date wins
        prior.dirty = true;
        updated++;
      } else {
        duplicates++;
      }
    } else {
      newRows.push(r);
    }
  }
  for (const u of priorUploads) {
    if (u.dirty) db.prepare('UPDATE cfo_evidence SET rows_json = ? WHERE id = ?').run(JSON.stringify(u.rows), u.id);
  }

  const warnings = [...parsed.warnings];
  if (duplicates > 0 || updated > 0) {
    warnings.push(`${newRows.length} new rows stored; ${updated} existing rows refreshed (status/date changes); ${duplicates} unchanged duplicates skipped.`);
  }

  let id: string | null = null;
  let stats = summarize(newRows);
  if (newRows.length > 0) {
    id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO cfo_evidence (id, store_id, reconciliation_id, kind, filename, headers_json, rows_json, row_count, min_ts, max_ts, sum_amount_cents, sum_net_cents, note, warnings)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, storeId, reconId, finalKind, filename || null,
      JSON.stringify(parsed.headers), JSON.stringify(newRows), newRows.length,
      stats.min_ts, stats.max_ts, stats.sum_amount_cents, stats.sum_net_cents,
      note || null, warnings.length ? JSON.stringify(warnings) : null
    );
  }

  return NextResponse.json({
    success: true,
    id,
    reconciliation_id: reconId,
    kind: finalKind,
    kind_guess: parsed.kind_guess,
    imported: newRows.length,
    updated,
    duplicates,
    row_count: newRows.length,
    min_ts: stats.min_ts,
    max_ts: stats.max_ts,
    sum_amount_cents: stats.sum_amount_cents,
    sum_net_cents: stats.sum_net_cents,
    warnings,
  });
}

// DELETE /api/cfo/reconcile/evidence?id=...
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const db = getDb();
  ensureEvidenceTable(db);
  db.prepare('DELETE FROM cfo_evidence WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
