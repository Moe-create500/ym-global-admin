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

export async function getClientOrdersList(clientId: string, page = 1, limit = 200): Promise<SSOrderListResponse> {
  const params = new URLSearchParams({
    storeId: clientId,
    page: String(page),
    limit: String(limit),
  });
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

/**
 * Fetch only new orders from ShipSourced.
 * Stops paginating once all orders on a page are already known.
 */
export async function getNewClientOrders(clientId: string, knownOrderNumbers: Set<string>): Promise<SSOrder[]> {
  const newOrders: SSOrder[] = [];
  let page = 1;
  while (true) {
    const data = await getClientOrdersList(clientId, page, 100);
    if (!data.orders || data.orders.length === 0) break;

    let allKnown = true;
    for (const order of data.orders) {
      const rawExtId = order.externalOrderId || '';
      const hashIdx = rawExtId.lastIndexOf('#');
      const orderNumber = hashIdx >= 0 ? rawExtId.slice(hashIdx + 1) : rawExtId.replace(/^(SHIPHERO-|SH-)?/, '').trim();
      if (!knownOrderNumbers.has(orderNumber)) {
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
