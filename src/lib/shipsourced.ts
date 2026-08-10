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
  asOf: string;
}

/** A/R, client credits, and the carrier position from ShipSourced's books. */
export function getFinanceSummary(): Promise<SSFinanceSummary> {
  return apiFetch<SSFinanceSummary>('/api/integration/finance');
}
