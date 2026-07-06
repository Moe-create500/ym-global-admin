import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { ensureEvidenceTable } from '@/lib/ai-reconcile';
import { parseEvidenceCsv } from '@/lib/evidence-parse';

export const dynamic = 'force-dynamic';

const MAX_CSV_BYTES = 8 * 1024 * 1024; // 8 MB

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
  const { storeId, reconciliationId, kind, filename, csvText, note } = body || {};
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  if (!csvText || typeof csvText !== 'string') return NextResponse.json({ error: 'csvText required' }, { status: 400 });
  if (Buffer.byteLength(csvText, 'utf8') > MAX_CSV_BYTES) {
    return NextResponse.json({ error: 'CSV too large (8 MB max) — export a narrower date range' }, { status: 413 });
  }

  const db = getDb();
  ensureEvidenceTable(db);

  let reconId = reconciliationId;
  if (!reconId) {
    const latest: any = db.prepare(
      'SELECT id FROM cfo_reconciliations WHERE store_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(storeId);
    if (!latest) return NextResponse.json({ error: 'No reconciliation found for store' }, { status: 404 });
    reconId = latest.id;
  }

  const parsed = parseEvidenceCsv(csvText);
  if (parsed.row_count === 0) {
    return NextResponse.json({ error: `No data rows parsed. ${parsed.warnings.join(' ')}` }, { status: 400 });
  }

  const finalKind = kind || parsed.kind_guess;
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO cfo_evidence (id, store_id, reconciliation_id, kind, filename, headers_json, rows_json, row_count, min_ts, max_ts, sum_amount_cents, sum_net_cents, note, warnings)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, storeId, reconId, finalKind, filename || null,
    JSON.stringify(parsed.headers), JSON.stringify(parsed.rows), parsed.row_count,
    parsed.min_ts, parsed.max_ts, parsed.sum_amount_cents, parsed.sum_net_cents,
    note || null, parsed.warnings.length ? JSON.stringify(parsed.warnings) : null
  );

  return NextResponse.json({
    success: true,
    id,
    reconciliation_id: reconId,
    kind: finalKind,
    kind_guess: parsed.kind_guess,
    row_count: parsed.row_count,
    min_ts: parsed.min_ts,
    max_ts: parsed.max_ts,
    sum_amount_cents: parsed.sum_amount_cents,
    sum_net_cents: parsed.sum_net_cents,
    warnings: parsed.warnings,
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
