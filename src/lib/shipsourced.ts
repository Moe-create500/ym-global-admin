import crypto from 'crypto';

const BASE_URL = process.env.SHIPSOURCED_API_URL || 'https://shipsourcedcenter.com';
const API_TOKEN = process.env.SHIPSOURCED_API_TOKEN || '';
const SS_JWT_SECRET = process.env.SHIPSOURCED_JWT_SECRET || '';

/** Sign a cookie value the same way ShipSourced does (HMAC-SHA256 base64url) */
function signClientCookie(clientId: string): string {
  const sig = crypto.createHmac('sha256', SS_JWT_SECRET).update(clientId).digest('base64url');
  return `${clientId}.${sig}`;
}

async function apiFetch<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { 'x-internal-key': API_TOKEN },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`ShipSourced API error ${res.status}: ${await res.text().catch(() => 'Unknown')}`);
  }
  return res.json();
}

export interface SSClient {
  id: string;
  companyName: string;
  email: string;
  isActive: boolean;
}

/** Billing Duty flags (BillingFlag rows) summarised by rule × client. Served
 *  by ShipSourced's /api/integration/billing-flags once that PR is live; until
 *  then the call fails and the CFO shows the feed as unavailable — never as
 *  zero tickets. */
export interface SSBillingFlagsResponse {
  asOf: string;
  flags: { ruleKey: string; severity: string; status: string; count: number; amountCents: number | null; clientId: string | null; company: string | null; suppressed?: boolean }[];
}
export async function getBillingFlags(): Promise<SSBillingFlagsResponse> {
  return apiFetch<SSBillingFlagsResponse>('/api/integration/billing-flags');
}

/** A client's OPEN orders with ShipSourced's own cost knowledge — see
 *  ShipSourced /api/integration/open-orders. Product cost is exact per line;
 *  `recent` is the client's last-60-day billed economics per order. */
export interface SSOpenOrdersResponse {
  asOf: string;
  client: { id: string; name: string; productCostExempt: boolean; usProductCostExempt: boolean };
  openCount: number;
  byStatus: Record<string, number>;
  openOrders: { id: string; status: string; createdAt: string | null; orderDate: string | null; totalPrice: number | null; warehouse: string | null;
    lineItems: { sku: string | null; name: string | null; quantity: number; unitCostCents: number; homeWarehouse: string | null; costCents: number; costKnown: boolean; clientOwned: boolean }[];
    productCostCents: number; productCostComplete: boolean }[];
  recent: { days: number; charges: number; avgTotalCents: number; avgLabelCents: number; avgProductCents: number; avgPickPackCents: number; avgChinaFeeCents: number; avgManagerCents: number };
}
/** ShipSourced P&L inputs by fulfilment centre for a period — see ShipSourced /api/integration/pnl. */
export interface SSPnlRegion {
  region: string; charges: number; noWarehouse: number; productCostMissing: number;
  revenue: { shipping: number; product: number; chinaFee: number; managerFee: number; pickPack: number; service: Record<string, number>; packaging: number; total: number };
  direct: { labelCost: number; productCost: number; serviceCost: number; packagingCost: number; total: number };
}
export interface SSPnlResponse {
  asOf: string; period: { from: string; to: string }; note: string; regions: SSPnlRegion[];
  carrierInvoices: { carrierType: string; lane: string; invoices: number; usdCents: number; managerFeeCents: number; creditsCents: number }[];
}
export async function getSsPnl(from: string, to: string): Promise<SSPnlResponse> {
  return apiFetch<SSPnlResponse>(`/api/integration/pnl?from=${from}&to=${to}`);
}

export async function getOpenOrders(clientId: string): Promise<SSOpenOrdersResponse> {
  return apiFetch<SSOpenOrdersResponse>(`/api/integration/open-orders?clientId=${encodeURIComponent(clientId)}`);
}

export interface SSBillingDay {
  date: string;
  totalShipping: number;
  totalPickPack: number;
  totalPackaging: number;
  totalCharge: number;
  labelCount: number;
  charges: any[];
}

export interface SSBillingResponse {
  client: any;
  stats: any;
  days: SSBillingDay[];
  recentPayments: any[];
}

export interface SSOrdersDailyRevenue {
  day: string;
  orderCount: number;
  revenue: number;
  shipping: number;
  usCogsCents: number;
  chinaCogsCents: number;
  chargesCents: number;
}

export interface SSOrdersResponse {
  total: number;
  pnl: {
    revenueCents: number;
    usCogsCents: number;
    chinaCogsCents: number;
    totalCogsCents: number;
    chargesCents: number;
  };
  dailyRevenue: SSOrdersDailyRevenue[];
}

export async function listClients(): Promise<{ clients: SSClient[] }> {
  return apiFetch('/api/admin/clients');
}

export async function getClientBilling(clientId: string): Promise<SSBillingResponse> {
  return apiFetch(`/api/admin/clients/${clientId}/billing`);
}

export async function getClientOrders(clientId: string, from?: string): Promise<SSOrdersResponse> {
  // Use admin endpoint (no cookie auth needed) — /api/admin/clients/[id]/orders
  const tzOffset = 420; // Pacific Time (UTC-7 PDT)
  const params = new URLSearchParams({ tzOffset: String(tzOffset) });
  if (from) params.set('from', from);
  const res = await fetch(`${BASE_URL}/api/admin/clients/${clientId}/orders?${params}`, {
    headers: { 'x-internal-key': API_TOKEN },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`ShipSourced orders API error ${res.status}`);
  }
  return res.json();
}

export interface SSBillingCharge {
  markup: number;
  totalCharge: number;
  labelCost: number;
  pickPackFee: number | null;
  unitCount: number | null;
  status: string;
}

export interface SSOrder {
  id: string;
  externalOrderId: string;
  buyerName: string;
  totalPrice: number | null;
  status: string;
  source: string | null;
  lineItems: string | null;
  orderDate: string | null;
  createdAt: string;
  country: string;
  shipments: any[];
  billingCharges?: SSBillingCharge[];
  client?: { id: string; companyName: string } | null;
}

export interface SSBillingProfileRate {
  sku: string;
  pickFee: number;
  packFee: number;
  shippingFee: number;
  extraUnitPickFee: number;
  extraUnitPackFee: number;
  extraUnitStepQty: number;
}

export interface SSClientBillingResponse {
  clientId: string;
  clientName: string;
  us: { pricingType: string | null; rates: SSBillingProfileRate[]; settings: any } | null;
  china: { pricingType: string | null; rates: SSBillingProfileRate[]; settings: any } | null;
  clientSkus: any[];
}

export interface SSOrderListResponse {
  orders: SSOrder[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function getClientOrdersList(clientId: string, page = 1, limit = 200, status?: string, search?: string): Promise<SSOrderListResponse> {
  const params = new URLSearchParams({
    storeId: clientId,
    page: String(page),
    limit: String(limit),
  });
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  return apiFetch(`/api/orders/list?${params}`);
}

export async function getAllClientOrdersList(clientId: string): Promise<SSOrder[]> {
  const all: SSOrder[] = [];
  let page = 1;
  while (true) {
    const data = await getClientOrdersList(clientId, page, 200);
    all.push(...(data.orders || []));
    if (all.length >= data.total || data.orders.length === 0) break;
    page++;
  }
  return all;
}

/** Normalize an SS externalOrderId ('SHIPHERO-#2793', '#1042') to the bare number. */
export function normalizeSSOrderNumber(externalOrderId: string): string {
  const raw = externalOrderId || '';
  const hashIdx = raw.lastIndexOf('#');
  const n = hashIdx >= 0 ? raw.slice(hashIdx + 1) : raw;
  return n.replace(/^(SHIPHERO-|SH-)?/, '').trim();
}

/** Pacific-date (YYYY-MM-DD) of an SS order — matches how orders.order_date is stored. */
export function ssOrderDatePacific(order: { orderDate?: string | null; createdAt?: string | null }): string {
  const raw = order.orderDate || order.createdAt || '';
  if (!raw) return '';
  try {
    return new Date(raw).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  } catch { return ''; }
}

/** Identity key for an order. Number alone is NOT unique — store migrations restart
 *  numbering (Purebite's SHIPHERO-#2793 from July collides with csv order 2793 from
 *  January), so number+date is the identity. */
export function ssOrderKey(orderNumber: string, orderDate: string): string {
  return `${orderNumber}|${orderDate}`;
}

/**
 * Fetch only new orders from ShipSourced.
 * `knownKeys` entries are ssOrderKey(number, pacificDate) composites.
 * Stops paginating once all orders on a page are already known.
 */
export async function getNewClientOrders(clientId: string, knownKeys: Set<string>): Promise<SSOrder[]> {
  const newOrders: SSOrder[] = [];
  // Hard caps: if local order keys never match the API's, the allKnown early-exit
  // never fires and this pages the client's ENTIRE history into memory — on a 2GB
  // box that OOM-crashes the app.
  const MAX_PAGES = 30;
  const MAX_NEW = 3000;
  let page = 1;
  while (page <= MAX_PAGES && newOrders.length < MAX_NEW) {
    const data = await getClientOrdersList(clientId, page, 100);
    if (!data.orders || data.orders.length === 0) break;

    let allKnown = true;
    for (const order of data.orders) {
      const orderNumber = normalizeSSOrderNumber(order.externalOrderId || '');
      const key = ssOrderKey(orderNumber, ssOrderDatePacific(order));
      if (!knownKeys.has(key)) {
        newOrders.push(order);
        allKnown = false;
      }
    }
    // If every order on this page was already known, stop
    if (allKnown) break;
    if (data.orders.length < 100) break;
    page++;
  }
  return newOrders;
}

export async function getClientBillingConfig(clientId: string): Promise<SSClientBillingResponse> {
  return apiFetch(`/api/admin/client-billing?clientId=${clientId}`);
}

export interface SSClientProduct {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  price: number;
  compareAtPrice: number | null;
  weightOz: number;
  imageUrl: string | null;
  images: string | null; // JSON array of image URLs
  variants: string | null; // JSON array
  productType: string | null;
  vendor: string | null;
  tags: string | null;
  inventoryQty: number;
  externalProductId: string;
  clientStore?: { id: string; storeName: string; platform: string };
}

export interface SSProductsResponse {
  storeProducts: SSClientProduct[];
  storeProductsTotal: number;
  stores: { id: string; storeName: string; platform: string }[];
}

export async function getClientProducts(clientId: string, page = 1): Promise<SSProductsResponse> {
  const signedCookie = SS_JWT_SECRET ? signClientCookie(clientId) : clientId;
  const res = await fetch(`${BASE_URL}/api/client/products?source=store&page=${page}&limit=100`, {
    headers: { 'Cookie': `se_client=${signedCookie}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`ShipSourced products API error ${res.status}`);
  }
  return res.json();
}

export async function getAllClientProducts(clientId: string): Promise<SSClientProduct[]> {
  const all: SSClientProduct[] = [];
  let page = 1;
  while (true) {
    const data = await getClientProducts(clientId, page);
    all.push(...(data.storeProducts || []));
    if (all.length >= data.storeProductsTotal || data.storeProducts.length === 0) break;
    page++;
  }
  return all;
}

// ── DWS scans (actual weight/dims from the China warehouse scale station) ──

export interface SSDwsScan {
  shipmentId: string;
  orderId: string;
  externalOrderId: string | null;
  source: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  dwsWeightOz: number | null;
  dwsLengthIn: number | null;
  dwsWidthIn: number | null;
  dwsHeightIn: number | null;
  dwsPhotoUrl: string | null;
  dwsScannedAt: string;
  dwsMachine: string | null;
  declaredWeightOz: number | null;
  labelCost: number | null;
}

export interface SSDwsResponse {
  scans: SSDwsScan[];
  count: number;
  nextCursor: string | null;
}

/** One page of DWS scans for a ShipSourced client (cursor-paginated, ascending). */
export function getDwsScans(clientId: string, opts?: { since?: string; cursor?: string; limit?: number }): Promise<SSDwsResponse> {
  const p = new URLSearchParams({ clientId });
  if (opts?.since) p.set('since', opts.since);
  if (opts?.cursor) p.set('cursor', opts.cursor);
  if (opts?.limit) p.set('limit', String(opts.limit));
  return apiFetch<SSDwsResponse>(`/api/integration/dws?${p.toString()}`);
}

/** All DWS scans since a date for a client (follows pagination). */
export async function getAllDwsScans(clientId: string, since?: string): Promise<SSDwsScan[]> {
  const all: SSDwsScan[] = [];
  let cursor: string | undefined;
  while (true) {
    const page = await getDwsScans(clientId, { since, cursor, limit: 1000 });
    all.push(...page.scans);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return all;
}

// ── Inventory + demand feed (for the Inventory Flow tab) ────────────────────

export interface SSInventoryProduct {
  sku: string;
  name: string;
  imageUrl: string | null;
  stockQty: number | null;   // null = sku unknown to the warehouse
  homeWarehouse: string | null;
  unitCostCents: number;
  packSize: number;
  isActive: boolean;
  units7: number;
  units30: number;
  units180: number;
  inboundUnits: number;
}

/** Stock + demand velocity + inbound PO units for one ShipSourced client. */
export function getClientInventory(clientId: string): Promise<{ products: SSInventoryProduct[] }> {
  return apiFetch<{ products: SSInventoryProduct[] }>(`/api/integration/inventory?clientId=${clientId}`);
}

// ── 3PL finance summary (for the ShipSourced store's CFO sheet) ─────────────

export interface SSFinanceSummary {
  arClients: { clientId: string; company: string; owedCents: number }[];
  arTotalCents: number;
  clientCreditsCents: number;
  carrier: { carrierType: string; invoicedCents: number; paidCents: number; balanceCents: number }[];
  carrierOwedCents: number;
  carrierPrepaidCents: number;
  stripeBalanceCents?: number;
  stripeBalance?: { availableCents: number; pendingCents: number } | null;
  asOf: string;
}

/** A/R, client credits, and the carrier position from ShipSourced's books. */
export function getFinanceSummary(): Promise<SSFinanceSummary> {
  return apiFetch<SSFinanceSummary>('/api/integration/finance');
}

// ── Printed but not yet invoiced ────────────────────────────────────────────
// `/api/integration/finance` only knows what a carrier has already billed:
// invoices minus payments. A label printed today is a real cost the carrier
// has not yet put on paper, so it appears nowhere — and the China carrier
// invoices us weeks in arrears, which left the CFO sheet showing $1,285.99
// owed while ~$4.6k of printed China labels sat uncounted.
//
// ShipSourced already measures this for its own "SHIPPED, NOT BILLED YET"
// tile. Read that, per lane, instead of re-deriving the math here.

export interface SSCarrierUninvoiced {
  carrierType: string;
  totalCents: number;
  shipments: number;
  byClient: { client: string; clientId: string; estCost: number }[];
}

/** Printed labels on one lane that no carrier invoice line has matched yet. */
async function carrierUninvoicedLane(carrierType: string): Promise<SSCarrierUninvoiced> {
  const r = await apiFetch<{ totalEst: number; totalShipments: number; byClient: any[] }>(
    `/api/admin/carrier-invoices/uninvoiced?carrierType=${encodeURIComponent(carrierType)}`
  );
  return {
    carrierType,
    totalCents: Math.round((Number(r.totalEst) || 0) * 100),
    shipments: Number(r.totalShipments) || 0,
    byClient: (r.byClient || []).map(c => ({ client: c.client, clientId: c.clientId, estCost: Number(c.estCost) || 0 })),
  };
}

/** Printed-not-invoiced cost for the lanes a carrier actually bills us for.
 *
 *  Only lanes that issue invoices accrue: the China lane (Hualei/Intelink)
 *  bills monthly in arrears, so a printed label is money we still owe. USPS,
 *  UPS and DHL eCommerce labels are bought from a prepaid balance at print
 *  time — already paid, never owed — so they are deliberately NOT counted.
 *  Passing the lanes from `/api/integration/finance` keeps that self-
 *  maintaining: if a lane ever starts sending invoices it starts accruing. */
export async function getCarrierUninvoiced(lanes: string[]): Promise<SSCarrierUninvoiced[]> {
  const wanted = [...new Set(lanes.filter(Boolean))];
  const out = await Promise.all(wanted.map(l => carrierUninvoicedLane(l).catch(() => null)));
  return out.filter(Boolean) as SSCarrierUninvoiced[];
}

// ── Accounting feeds (ShipSourced /api/integration/accounting and friends) ──
// Every feed: server-to-server, read-only, amounts in cents, timestamps ISO.
export type SSAccountingFeed = 'receivables' | 'payments' | 'payables' | 'subscriptions' | 'inventory-value' | 'chargebacks' | 'write-offs';
export interface SSReceivablesResponse {
  asOf: string; windowDays: number; method: string;
  totals: { openCents: number; clientsOwing: number; creditCents: number; aging: Record<'currentCents' | 'd31_60Cents' | 'd61_90Cents' | 'd90plusCents', number>; avgDaysToPay: number | null; over1000: number; inactiveOwingCents: number };
  clients: { clientId: string; company: string; email: string | null; isActive: boolean; hasCard: boolean; markupOnly: boolean; openCents: number; storedBalanceCents: number; chargedCents: number; paidCents: number; creditCents: number;
    aging: Record<'currentCents' | 'd31_60Cents' | 'd61_90Cents' | 'd90plusCents', number>; avgDaysToPay: number | null; medianDaysToPay: number | null; paidChargesInWindow: number; dso: number | null;
    oldestOpenAt: string | null; lastPaymentAt: string | null; lastChargeAt: string | null; charges: number }[];
}
export async function getSsAccounting<T = any>(feed: SSAccountingFeed, query: Record<string, string> = {}): Promise<T> {
  const q = new URLSearchParams(query).toString();
  return apiFetch<T>(`/api/integration/${feed}${q ? `?${q}` : ''}`);
}

