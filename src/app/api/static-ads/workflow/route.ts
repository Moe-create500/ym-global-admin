import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  ensureWorkflowTables, rowToWorkflow, getWorkflow,
  createLaunchWorkflow, advanceWorkflow, approveGate, retryWorkflow, cancelWorkflow,
} from '@/lib/launch-workflow';
import { ensureScheduleTable, createSchedule, computeNextRun } from '@/lib/launch-scheduler';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Engine lives in lib/launch-workflow (shared with the background scheduler);
// this route is the browser-facing surface.

// GET ?storeId= → list | ?id= → one | ?profileId=&pages=1 | ?profileId=&campaigns=1
//     ?landing=1&storeId=&productId= | ?schedules=1&storeId=
export async function GET(req: NextRequest) {
  const db = getDb();
  ensureWorkflowTables(db);
  const id = req.nextUrl.searchParams.get('id');
  const storeId = req.nextUrl.searchParams.get('storeId');
  const profileId = req.nextUrl.searchParams.get('profileId');

  if (req.nextUrl.searchParams.get('schedules')) {
    ensureScheduleTable(db);
    // All stores by default — schedules are a global view, not per selected store
    const rows: any[] = storeId
      ? db.prepare('SELECT w.*, s.name AS store_name FROM workflow_schedules w JOIN stores s ON s.id = w.store_id WHERE w.store_id = ? ORDER BY w.created_at DESC').all(storeId)
      : db.prepare('SELECT w.*, s.name AS store_name FROM workflow_schedules w JOIN stores s ON s.id = w.store_id ORDER BY w.created_at DESC').all();
    return NextResponse.json({
      schedules: rows.map(r => {
        let config: any = {};
        try { config = JSON.parse(r.config_json || '{}'); } catch {}
        return {
          id: r.id, storeId: r.store_id, storeName: r.store_name, productId: r.product_id, name: r.name,
          cadence: r.cadence, timeOfDay: r.time_of_day, dayOfWeek: r.day_of_week,
          autoLive: !!r.auto_live, isActive: !!r.is_active,
          lastRunAt: r.last_run_at, lastResult: r.last_result, nextRunAt: r.next_run_at,
          config,
        };
      }),
    });
  }

  // Landing-page URLs: saved lander (per store+product) first, then the
  // centralized product-link resolver (lib/product-link)
  if (req.nextUrl.searchParams.get('landing') && storeId) {
    const prodId = req.nextUrl.searchParams.get('productId');
    if (!prodId) return NextResponse.json({ error: 'productId required' }, { status: 400 });
    const saved: any = db.prepare('SELECT url, source FROM product_landing_pages WHERE store_id = ? AND product_id = ?').get(storeId, prodId);
    try {
      const { resolveProductLink } = await import('@/lib/product-link');
      const link = await resolveProductLink(db, storeId, prodId);

      // Saved lander outranks everything — it's what actually ran before
      const urls: { label: string; url: string }[] = [];
      if (saved?.url) urls.push({ label: `⭐ Saved lander (${saved.source})`, url: saved.url });
      if (link.customLandingPageUrl && link.customLandingPageUrl !== saved?.url) urls.push({ label: `Custom landing page — ${link.productTitle}`, url: link.customLandingPageUrl });
      if (link.standardProductUrl && link.standardProductUrl !== saved?.url) {
        urls.push({ label: `${link.validated || link.customLandingPageUrl ? '✓' : '⚠'} Product page — ${link.productTitle}${link.productStatus && link.productStatus !== 'active' ? ` (${link.productStatus})` : ''}`, url: link.standardProductUrl });
      }
      if (link.homepageUrl) urls.push({ label: 'Store homepage (manual choice — not recommended for product ads)', url: link.homepageUrl });

      if (saved?.url) {
        link.recommendedAdvertisingUrl = saved.url;
        link.validated = true;
        link.selectionReason = `Saved lander for this product (${saved.source}) — used on previous runs.`;
      } else if (link.validated && link.recommendedAdvertisingUrl) {
        // First successful resolution becomes the saved lander
        db.prepare(`INSERT INTO product_landing_pages (store_id, product_id, url, source, updated_at) VALUES (?, ?, ?, 'resolved', datetime('now'))
          ON CONFLICT(store_id, product_id) DO UPDATE SET url = excluded.url, source = 'resolved', updated_at = datetime('now')`)
          .run(storeId, prodId, link.recommendedAdvertisingUrl);
      }

      return NextResponse.json({ urls, resolved: link });
    } catch (e: any) {
      // Resolver down (Shopify creds missing etc.) — the saved lander still serves
      if (saved?.url) {
        return NextResponse.json({
          urls: [{ label: `⭐ Saved lander (${saved.source})`, url: saved.url }],
          resolved: { validated: true, selectionReason: `Saved lander for this product (${saved.source}). Live Shopify lookup unavailable: ${String(e?.message || e).slice(0, 120)}`, warnings: [], recommendedAdvertisingUrl: saved.url },
        });
      }
      return NextResponse.json({ error: `Product link resolution failed: ${String(e?.message || e).slice(0, 200)}` }, { status: 502 });
    }
  }

  if (profileId && req.nextUrl.searchParams.get('campaigns')) {
    const profile: any = db.prepare('SELECT access_token, ad_account_id FROM fb_profiles WHERE id = ? AND is_active = 1').get(profileId);
    if (!profile?.access_token || !profile?.ad_account_id) return NextResponse.json({ error: 'Profile missing token or ad account' }, { status: 400 });
    try {
      const { getCampaigns } = await import('@/lib/facebook');
      const campaigns = (await getCampaigns(profile.ad_account_id, profile.access_token))
        .filter(c => c.status !== 'DELETED' && c.status !== 'ARCHIVED');
      return NextResponse.json({ campaigns });
    } catch (e: any) {
      return NextResponse.json({ error: `Failed to fetch campaigns: ${e.message}` }, { status: 502 });
    }
  }

  if (profileId && req.nextUrl.searchParams.get('pages')) {
    const profile: any = db.prepare('SELECT access_token, fb_page_id, fb_page_name FROM fb_profiles WHERE id = ? AND is_active = 1').get(profileId);
    if (!profile?.access_token) return NextResponse.json({ error: 'Profile has no access token' }, { status: 400 });
    try {
      const { getPages } = await import('@/lib/facebook');
      const pages = await getPages(profile.access_token);
      return NextResponse.json({ pages, savedPageId: profile.fb_page_id || null });
    } catch (e: any) {
      return NextResponse.json({ error: `Failed to fetch pages: ${e.message}` }, { status: 502 });
    }
  }

  if (id) {
    const wf = getWorkflow(db, id);
    if (!wf) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ workflow: wf });
  }

  if (storeId) {
    const rows: any[] = db.prepare('SELECT * FROM ad_workflows WHERE store_id = ? ORDER BY created_at DESC LIMIT 20').all(storeId);
    const profiles: any[] = db.prepare(
      'SELECT id, profile_name, ad_account_id, ad_account_name, fb_page_id, fb_page_name, pixel_id FROM fb_profiles WHERE store_id = ? AND is_active = 1'
    ).all(storeId);
    const store: any = db.prepare('SELECT shopify_domain FROM stores WHERE id = ?').get(storeId);
    return NextResponse.json({ workflows: rows.map(rowToWorkflow), profiles, shopifyDomain: store?.shopify_domain || null });
  }

  return NextResponse.json({ error: 'id or storeId required' }, { status: 400 });
}

// POST {action:'create'|'advance'|'approve'|'retry'|'cancel'
//        |'schedule_create'|'schedule_toggle'|'schedule_delete'|'schedule_run_now', ...}
export async function POST(req: NextRequest) {
  const db = getDb();
  ensureWorkflowTables(db);
  const body = await req.json().catch(() => ({}));

  try {
    if (body.action === 'create') {
      const wf = createLaunchWorkflow(db, body.storeId, body.productId, body.config);
      return NextResponse.json({ workflow: wf });
    }
    if (body.action === 'advance') {
      return NextResponse.json({ workflow: await advanceWorkflow(db, body.id) });
    }
    if (body.action === 'approve') {
      return NextResponse.json({ workflow: approveGate(db, body.id, body.stepKey) });
    }
    if (body.action === 'retry') {
      return NextResponse.json({ workflow: retryWorkflow(db, body.id) });
    }
    if (body.action === 'cancel') {
      return NextResponse.json({ workflow: cancelWorkflow(db, body.id) });
    }

    if (body.action === 'schedule_create') {
      const s = createSchedule(db, {
        storeId: body.storeId, productId: body.productId, name: body.name,
        config: body.config, cadence: body.cadence, timeOfDay: body.timeOfDay,
        dayOfWeek: body.dayOfWeek, autoLive: !!body.autoLive,
      });
      return NextResponse.json({ schedule: s });
    }
    if (body.action === 'schedule_update') {
      ensureScheduleTable(db);
      const s: any = db.prepare('SELECT * FROM workflow_schedules WHERE id = ?').get(body.id);
      if (!s) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });

      const cadence = ['daily', 'weekly'].includes(body.cadence) ? body.cadence : s.cadence;
      const timeOfDay = /^\d{2}:\d{2}$/.test(body.timeOfDay || '') ? body.timeOfDay : s.time_of_day;
      const dayOfWeek = cadence === 'weekly' ? (Number.isInteger(body.dayOfWeek) ? body.dayOfWeek : (s.day_of_week ?? 1)) : null;
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : s.name;
      const autoLive = typeof body.autoLive === 'boolean' ? (body.autoLive ? 1 : 0) : s.auto_live;

      // Merge config edits over the stored config — all launch aspects editable
      let config: any = {};
      try { config = JSON.parse(s.config_json || '{}'); } catch {}
      if (body.config && typeof body.config === 'object') config = { ...config, ...body.config };

      // Timing changed → recompute the next firing
      const timingChanged = cadence !== s.cadence || timeOfDay !== s.time_of_day || dayOfWeek !== s.day_of_week;
      const nextRun = timingChanged ? computeNextRun(cadence, timeOfDay, dayOfWeek) : s.next_run_at;

      db.prepare(`UPDATE workflow_schedules SET name = ?, cadence = ?, time_of_day = ?, day_of_week = ?, auto_live = ?, config_json = ?, next_run_at = ? WHERE id = ?`)
        .run(name, cadence, timeOfDay, dayOfWeek, autoLive, JSON.stringify(config), nextRun, body.id);
      return NextResponse.json({ success: true });
    }

    if (body.action === 'schedule_toggle') {
      ensureScheduleTable(db);
      const s: any = db.prepare('SELECT * FROM workflow_schedules WHERE id = ?').get(body.id);
      if (!s) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });
      const active = s.is_active ? 0 : 1;
      // Re-arm next_run_at on re-activation so it doesn't instantly fire a backlog
      const nextRun = active ? computeNextRun(s.cadence, s.time_of_day, s.day_of_week) : s.next_run_at;
      db.prepare('UPDATE workflow_schedules SET is_active = ?, next_run_at = ? WHERE id = ?').run(active, nextRun, body.id);
      return NextResponse.json({ success: true, isActive: !!active });
    }
    if (body.action === 'schedule_delete') {
      ensureScheduleTable(db);
      db.prepare('DELETE FROM workflow_schedules WHERE id = ?').run(body.id);
      return NextResponse.json({ success: true });
    }
    if (body.action === 'schedule_run_now') {
      ensureScheduleTable(db);
      // Make it due now; the 5-min background tick picks it up
      db.prepare('UPDATE workflow_schedules SET next_run_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), body.id);
      return NextResponse.json({ success: true, note: 'Queued — the background runner fires within 5 minutes' });
    }
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 400 });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
