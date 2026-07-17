import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession, getAccessibleStoreIds } from '@/lib/auth-tenant';
import { getDwsScans } from '@/lib/shipsourced';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dws?storeId=...&since=...&cursor=...&limit=...
 *
 * Pulls DWS scan data (actual weight/dims/photo from the China warehouse
 * scale) for one store, live from ShipSourced. The store's primary
 * shipsourced_client_id AND any extra billing client ids are queried, so
 * shipments billed under a secondary client still show up.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  // Same session/scoping pattern as /api/stores
  const session = getSession(req);
  const role = session?.role || 'admin';
  const employeeId = session?.employeeId || 'legacy';
  const accessibleIds = getAccessibleStoreIds(employeeId, role);
  if (Array.isArray(accessibleIds) && !accessibleIds.includes(storeId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();
  const store = db.prepare(
    'SELECT id, name, shipsourced_client_id, shipsourced_extra_client_ids FROM stores WHERE id = ?'
  ).get(storeId) as any;
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

  const clientIds: string[] = [];
  if (store.shipsourced_client_id) clientIds.push(store.shipsourced_client_id);
  try {
    const extras = JSON.parse(store.shipsourced_extra_client_ids || '[]');
    if (Array.isArray(extras)) for (const id of extras) if (id && !clientIds.includes(id)) clientIds.push(id);
  } catch { /* extra ids optional */ }
  if (clientIds.length === 0) {
    return NextResponse.json({ error: 'Store has no ShipSourced client linked' }, { status: 400 });
  }

  const since = searchParams.get('since') || undefined;
  const cursor = searchParams.get('cursor') || undefined;
  const limit = Math.min(Number(searchParams.get('limit')) || 500, 2000);

  try {
    const pages = await Promise.all(
      clientIds.map((cid) =>
        getDwsScans(cid, { since, cursor, limit }).then((p) => p.scans.map((s) => ({ ...s, clientId: cid })))
      )
    );
    const scans = pages.flat().sort((a, b) => (a.dwsScannedAt < b.dwsScannedAt ? -1 : 1));
    // nextCursor only meaningful per single client; with merged clients, callers
    // page by passing the last dwsScannedAt back as cursor (works for all).
    const nextCursor = scans.length >= limit ? scans[scans.length - 1].dwsScannedAt : null;
    return NextResponse.json({ store: { id: store.id, name: store.name }, scans, count: scans.length, nextCursor });
  } catch (err) {
    console.error('[api/dws]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'ShipSourced fetch failed' }, { status: 502 });
  }
}
