/**
 * Stripe Billing — customer management, card-on-file, invoicing.
 *
 * Supports:
 *   - Create Stripe customer for a tenant
 *   - Generate Checkout Session for card setup
 *   - Create invoice from usage_logs
 *   - Get billing summary
 */

const STRIPE_SECRET = () => process.env.STRIPE_SECRET_KEY || '';
const STRIPE_API = 'https://api.stripe.com/v1';

async function stripeRequest(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: Record<string, string>,
): Promise<any> {
  const key = STRIPE_SECRET();
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${key}`,
  };

  let fetchBody: string | undefined;
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    fetchBody = new URLSearchParams(body).toString();
  }

  const res = await fetch(`${STRIPE_API}${endpoint}`, { method, headers, body: fetchBody });
  const data = await res.json();
  if (data.error) {
    throw new Error(`Stripe error: ${data.error.message}`);
  }
  return data;
}

/**
 * Create a Stripe customer for a tenant.
 */
export async function createCustomer(tenantName: string, email?: string): Promise<{ customerId: string }> {
  const params: Record<string, string> = { name: tenantName };
  if (email) params.email = email;
  const customer = await stripeRequest('/customers', 'POST', params);
  return { customerId: customer.id };
}

/**
 * Create a Checkout Session for adding a card on file.
 * Returns the session URL — redirect the client there.
 */
export async function createSetupSession(
  customerId: string,
  successUrl: string,
  cancelUrl: string,
): Promise<{ sessionUrl: string; sessionId: string }> {
  const session = await stripeRequest('/checkout/sessions', 'POST', {
    'customer': customerId,
    'mode': 'setup',
    'payment_method_types[0]': 'card',
    'success_url': successUrl,
    'cancel_url': cancelUrl,
  });
  return { sessionUrl: session.url, sessionId: session.id };
}

/**
 * Get customer's default payment method status.
 */
export async function getPaymentStatus(customerId: string): Promise<{
  hasPaymentMethod: boolean;
  last4?: string;
  brand?: string;
  expMonth?: number;
  expYear?: number;
}> {
  const customer = await stripeRequest(`/customers/${customerId}`);
  const defaultPm = customer.invoice_settings?.default_payment_method;
  if (!defaultPm) {
    // Check if any payment methods exist
    const pms = await stripeRequest(`/customers/${customerId}/payment_methods?type=card`);
    if (pms.data?.length > 0) {
      const card = pms.data[0].card;
      return { hasPaymentMethod: true, last4: card.last4, brand: card.brand, expMonth: card.exp_month, expYear: card.exp_year };
    }
    return { hasPaymentMethod: false };
  }
  const pm = await stripeRequest(`/payment_methods/${defaultPm}`);
  const card = pm.card;
  return { hasPaymentMethod: true, last4: card?.last4, brand: card?.brand, expMonth: card?.exp_month, expYear: card?.exp_year };
}

/**
 * Create an invoice for a tenant from usage_logs.
 * Aggregates unbilled usage and creates a Stripe invoice with line items.
 */
export async function createInvoiceFromUsage(
  customerId: string,
  tenantId: string,
  periodStart: string, // ISO date
  periodEnd: string,   // ISO date
): Promise<{ invoiceId: string; totalCents: number; lineItems: number }> {
  const { getDb } = await import('@/lib/db');
  const db = getDb();

  // Aggregate usage by provider
  const usage: any[] = db.prepare(`
    SELECT provider, operation_type,
      SUM(units) as total_units,
      SUM(raw_cost_usd) as total_raw,
      SUM(marked_up_cost_usd) as total_billed,
      COUNT(*) as count
    FROM usage_logs
    WHERE tenant_id = ? AND created_at >= ? AND created_at < ?
    GROUP BY provider, operation_type
  `).all(tenantId, periodStart, periodEnd);

  if (usage.length === 0) {
    throw new Error('No usage found for this period');
  }

  // Create invoice items on Stripe
  let totalCents = 0;
  for (const row of usage) {
    const amountCents = Math.round(row.total_billed * 100);
    if (amountCents <= 0) continue;
    totalCents += amountCents;
    await stripeRequest('/invoiceitems', 'POST', {
      'customer': customerId,
      'amount': String(amountCents),
      'currency': 'usd',
      'description': `${row.provider} — ${row.operation_type} (${row.count} calls, ${row.total_units.toFixed(1)} units)`,
    });
  }

  // Create and finalize invoice
  const invoice = await stripeRequest('/invoices', 'POST', {
    'customer': customerId,
    'auto_advance': 'true', // auto-finalize
    'collection_method': 'charge_automatically',
  });

  return { invoiceId: invoice.id, totalCents, lineItems: usage.length };
}

/**
 * Get billing summary for a tenant.
 */
export async function getBillingSummary(tenantId: string): Promise<{
  currentPeriodRaw: number;
  currentPeriodBilled: number;
  currentPeriodMargin: number;
  byProvider: { provider: string; raw: number; billed: number; count: number }[];
  byStore: { storeId: string; storeName: string; raw: number; billed: number }[];
}> {
  const { getDb } = await import('@/lib/db');
  const db = getDb();

  // Current month
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const byProvider: any[] = db.prepare(`
    SELECT provider, SUM(raw_cost_usd) as raw, SUM(marked_up_cost_usd) as billed, COUNT(*) as count
    FROM usage_logs WHERE tenant_id = ? AND created_at >= ?
    GROUP BY provider
  `).all(tenantId, monthStart);

  const byStore: any[] = db.prepare(`
    SELECT u.store_id, s.name as store_name, SUM(u.raw_cost_usd) as raw, SUM(u.marked_up_cost_usd) as billed
    FROM usage_logs u
    LEFT JOIN stores s ON s.id = u.store_id
    WHERE u.tenant_id = ? AND u.created_at >= ?
    GROUP BY u.store_id
  `).all(tenantId, monthStart);

  const totalRaw = byProvider.reduce((s, r) => s + r.raw, 0);
  const totalBilled = byProvider.reduce((s, r) => s + r.billed, 0);

  return {
    currentPeriodRaw: Math.round(totalRaw * 100) / 100,
    currentPeriodBilled: Math.round(totalBilled * 100) / 100,
    currentPeriodMargin: Math.round((totalBilled - totalRaw) * 100) / 100,
    byProvider,
    byStore,
  };
}
