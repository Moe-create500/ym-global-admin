/**
 * Billing API
 *
 * GET  /api/billing?tenantId=xxx           → billing summary (current month)
 * GET  /api/billing?tenantId=xxx&admin=1   → admin view with raw cost + margin
 * POST /api/billing { action: 'setup-card', tenantId } → create Stripe setup session
 * POST /api/billing { action: 'create-invoice', tenantId, periodStart, periodEnd } → create invoice
 * POST /api/billing { action: 'create-customer', tenantId, tenantName, email } → create Stripe customer
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth-tenant';
import { getBillingSummary, createCustomer, createSetupSession, createInvoiceFromUsage, getPaymentStatus } from '@/lib/stripe-billing';

export const dynamic = 'force-dynamic';

function jsonSuccess(data: any) { return NextResponse.json({ success: true, ...data }); }
function jsonError(msg: string, status = 400) { return NextResponse.json({ success: false, error: msg }, { status }); }

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return jsonError('Unauthorized', 401);

  const tenantId = req.nextUrl.searchParams.get('tenantId');
  const isAdmin = session.role === 'admin' || session.role === 'data_corrector';
  const showAdmin = req.nextUrl.searchParams.get('admin') === '1' && isAdmin;

  if (!tenantId) {
    // Return all tenants for admin, or the user's tenant
    const db = getDb();
    if (isAdmin) {
      const tenants: any[] = db.prepare(`
        SELECT t.*, COUNT(s.id) as store_count
        FROM tenants t
        LEFT JOIN stores s ON s.tenant_id = t.id
        GROUP BY t.id
        ORDER BY t.name
      `).all();
      return jsonSuccess({ tenants });
    }
    // Non-admin: find their tenant
    const access: any = db.prepare(`
      SELECT s.tenant_id FROM employee_store_access esa
      JOIN stores s ON s.id = esa.store_id
      WHERE esa.employee_id = ? AND s.tenant_id IS NOT NULL
      LIMIT 1
    `).get(session.employeeId);
    if (!access?.tenant_id) return jsonSuccess({ tenants: [] });
    const tenant: any = db.prepare('SELECT * FROM tenants WHERE id = ?').get(access.tenant_id);
    return jsonSuccess({ tenants: tenant ? [tenant] : [] });
  }

  // Get billing summary for a specific tenant
  try {
    const summary = await getBillingSummary(tenantId);

    // Get payment status if Stripe customer exists
    const db = getDb();
    const tenant: any = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    let paymentStatus = null;
    if (tenant?.stripe_customer_id) {
      try { paymentStatus = await getPaymentStatus(tenant.stripe_customer_id); } catch {}
    }

    return jsonSuccess({
      summary: showAdmin ? summary : {
        currentPeriodBilled: summary.currentPeriodBilled,
        byProvider: summary.byProvider.map(p => ({ provider: p.provider, billed: p.billed, count: p.count })),
        byStore: summary.byStore.map(s => ({ storeName: s.storeName, billed: s.billed })),
      },
      tenant: {
        id: tenant?.id,
        name: tenant?.name,
        hasStripeCustomer: !!tenant?.stripe_customer_id,
        marginPercentage: isAdmin ? tenant?.margin_percentage : undefined,
      },
      paymentStatus,
      isAdmin,
    });
  } catch (e: any) {
    return jsonError(`Billing error: ${e.message}`, 500);
  }
}

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return jsonError('Unauthorized', 401);

  let body: any;
  try { body = await req.json(); } catch { return jsonError('Invalid JSON'); }

  const { action, tenantId } = body;
  const isAdmin = session.role === 'admin' || session.role === 'data_corrector';

  if (action === 'create-customer') {
    if (!isAdmin) return jsonError('Admin only', 403);
    const { tenantName, email } = body;
    if (!tenantId || !tenantName) return jsonError('tenantId and tenantName required');
    try {
      const { customerId } = await createCustomer(tenantName, email);
      const db = getDb();
      db.prepare('UPDATE tenants SET stripe_customer_id = ? WHERE id = ?').run(customerId, tenantId);
      return jsonSuccess({ customerId });
    } catch (e: any) {
      return jsonError(`Stripe error: ${e.message}`, 500);
    }
  }

  if (action === 'setup-card') {
    if (!tenantId) return jsonError('tenantId required');
    const db = getDb();
    const tenant: any = db.prepare('SELECT stripe_customer_id FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant?.stripe_customer_id) return jsonError('No Stripe customer — create one first');
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ymglobalventures.com';
      const { sessionUrl, sessionId } = await createSetupSession(
        tenant.stripe_customer_id,
        `${baseUrl}/dashboard/creatives?billing=success`,
        `${baseUrl}/dashboard/creatives?billing=cancelled`,
      );
      return jsonSuccess({ sessionUrl, sessionId });
    } catch (e: any) {
      return jsonError(`Stripe error: ${e.message}`, 500);
    }
  }

  if (action === 'create-invoice') {
    if (!isAdmin) return jsonError('Admin only', 403);
    const { periodStart, periodEnd } = body;
    if (!tenantId || !periodStart || !periodEnd) return jsonError('tenantId, periodStart, periodEnd required');
    const db = getDb();
    const tenant: any = db.prepare('SELECT stripe_customer_id FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant?.stripe_customer_id) return jsonError('No Stripe customer');
    try {
      const result = await createInvoiceFromUsage(tenant.stripe_customer_id, tenantId, periodStart, periodEnd);
      return jsonSuccess(result);
    } catch (e: any) {
      return jsonError(`Invoice error: ${e.message}`, 500);
    }
  }

  return jsonError('Unknown action');
}
