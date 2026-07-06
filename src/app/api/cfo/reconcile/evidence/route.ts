import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { ensureEvidenceTable } from '@/lib/ai-reconcile';
import { parseEvidenceCsv } from '@/lib/evidence-parse';

export const dynamic = 'force-dynamic';

const MAX_CSV_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Row fingerprinting for duplicate detection across uploads.
 * Key = normalized timestamp/date + all money fields + reference + type; an occurrence
 * ordinal is appended so two LEGITIMATELY identical rows in one export (e.g. two $100
 * payouts on the same day) both survive, while re-uploading the same file — or an
 * overlapping date range — dedupes exactly.
 */
function rowKey(r: any): string {
  return [
    r.ts_utc || r.date || '',
    r.amount_cents ?? '', r.fee_cents ?? '', r.net_cents ?? '',
    (r.reference || '').trim(), (r.type || '').trim(), (r.payout_status || '').trim(),
  ].join('|');
}

function fingerprints(rows: any[]): string[] {
  const seen = new Map<string, number>();
  return rows.map(r => {
    const k = rowKey(r);
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    return crypto.createHash('sha1').update(`${k}#${n}`).digest('hex');
  });
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

  // Dedup against EVERY prior upload for this store+kind (any scope): only rows whose
  // fingerprint has never been stored are inserted, so overlapping exports never double count.
  const existingFps = new Set<string>();
  const priorUploads: any[] = db.prepare('SELECT rows_json FROM cfo_evidence WHERE store_id = ? AND kind = ?').all(storeId, finalKind);
  for (const prior of priorUploads) {
    try { fingerprints(JSON.parse(prior.rows_json) || []).forEach(f => existingFps.add(f)); } catch { /* skip corrupt */ }
  }
  const fps = fingerprints(parsed.rows);
  const newRows = parsed.rows.filter((_, i) => !existingFps.has(fps[i]));
  const duplicates = parsed.rows.length - newRows.length;

  if (newRows.length === 0) {
    return NextResponse.json({
      success: true, imported: 0, duplicates,
      kind: finalKind, message: `All ${duplicates} rows already uploaded — nothing new.`,
      warnings: parsed.warnings,
    });
  }

  const stats = summarize(newRows);
  const warnings = [...parsed.warnings];
  if (duplicates > 0) warnings.push(`${duplicates} duplicate rows skipped (already uploaded earlier); ${newRows.length} new rows stored.`);

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO cfo_evidence (id, store_id, reconciliation_id, kind, filename, headers_json, rows_json, row_count, min_ts, max_ts, sum_amount_cents, sum_net_cents, note, warnings)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, storeId, reconId, finalKind, filename || null,
    JSON.stringify(parsed.headers), JSON.stringify(newRows), newRows.length,
    stats.min_ts, stats.max_ts, stats.sum_amount_cents, stats.sum_net_cents,
    note || null, warnings.length ? JSON.stringify(warnings) : null
  );

  return NextResponse.json({
    success: true,
    id,
    reconciliation_id: reconId,
    kind: finalKind,
    kind_guess: parsed.kind_guess,
    imported: newRows.length,
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
