import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isApiAuthorized } from '@/lib/auth';
import { getSession } from '@/lib/auth-tenant';
import { listSubscriptions, assignStore, setReview, type ReviewStatus } from '@/lib/subscriptions/service';

export const dynamic = 'force-dynamic';

/** GET /api/subscriptions — every detected recurring charge, the summary
 *  and the savings view, straight from bank_transactions. Filters are
 *  applied server-side so the numbers in the header match the table. */
export async function GET(req: NextRequest) {
  if (!isApiAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const { subs, summary, savings, hidden } = listSubscriptions(db);
  const store = sp.get('store') || '';
  const account = sp.get('account') || '';
  const filter = sp.get('filter') || 'all';
  const q = (sp.get('q') || '').toLowerCase();
  let rows = subs;
  if (store) rows = rows.filter(s => s.attribution.storeId === store);
  if (account) rows = rows.filter(s => s.accountId === account);
  if (q) rows = rows.filter(s => [s.name, s.merchantKey, s.accountLabel, s.storeName || '', ...s.descriptions].join(' ').toLowerCase().includes(q));
  const F: Record<string, (s: typeof subs[number]) => boolean> = {
    all: () => true,
    active: s => s.status === 'active' || s.status === 'possibly_active',
    new: s => s.flags.includes('new'),
    price_increased: s => s.flags.includes('price_increase'),
    possible_duplicate: s => s.flags.includes('possible_duplicate'),
    needs_attribution: s => s.attribution.needsAttribution && s.status !== 'cancelled',
    needs_review: s => s.status === 'needs_review' || s.review?.status === 'review_for_cancellation',
    cancelled: s => s.status === 'cancelled',
  };
  rows = rows.filter(F[filter] || F.all);
  const stores = db.prepare('SELECT id, name FROM stores WHERE is_active = 1 ORDER BY name').all();
  const accounts = db.prepare(`SELECT id, institution_name || ' ··' || last_four AS label FROM bank_accounts WHERE status = 'active' ORDER BY institution_name, last_four`).all();
  return NextResponse.json({ subscriptions: rows, total: subs.length, summary, savings, hiddenCount: hidden.length, stores, accounts, filter, store, account, q });
}

/** POST { action: 'assign', id, storeId|null, note } | { action: 'review', id, status|null, note } */
export async function POST(req: NextRequest) {
  if (!isApiAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getDb();
  const session = getSession(req);
  const actor = session?.employeeId || 'admin';
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (body.action === 'assign') {
    if (body.storeId && !db.prepare('SELECT id FROM stores WHERE id = ?').get(body.storeId)) return NextResponse.json({ error: 'store not found' }, { status: 404 });
    const r = await assignStore(db, body.id, body.storeId || null, actor, body.note);
    return NextResponse.json(r, { status: r.ok ? 200 : 404 });
  }
  if (body.action === 'review') {
    const ok: (ReviewStatus | null)[] = ['keep', 'review_for_cancellation', 'not_subscription', 'cancelled', null];
    if (!ok.includes(body.status ?? null)) return NextResponse.json({ error: 'bad status' }, { status: 400 });
    return NextResponse.json(setReview(db, body.id, body.status ?? null, body.note || null, actor));
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
