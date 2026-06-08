const API_VERSION = '2024-01';

async function shopifyGet(domain: string, token: string, path: string): Promise<Response> {
  const url = path.startsWith('http') ? path : `https://${domain}/admin/api/${API_VERSION}/${path}`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': token },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API ${res.status}: ${text.substring(0, 200)}`);
  }
  return res;
}

async function fetchAllPages(domain: string, token: string, initialPath: string): Promise<any[]> {
  const results: any[] = [];
  let url: string | null = initialPath;

  while (url) {
    const res = await shopifyGet(domain, token, url);
    const data = await res.json();
    const key = Object.keys(data).find(k => Array.isArray(data[k]));
    if (key) results.push(...data[key]);

    // Cursor pagination via Link header
    const link = res.headers.get('link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;

    // Respect rate limits
    const callLimit = res.headers.get('x-shopify-shop-api-call-limit');
    if (callLimit) {
      const [used, max] = callLimit.split('/').map(Number);
      if (used >= max - 2) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  return results;
}

export interface DailySales {
  revenueCents: number;
  orderCount: number;
  refundCents: number;
  netSalesCents: number;
}

/**
 * Fetch daily sales from Shopify Orders API.
 * Returns net sales per day = new order revenue - refunds processed that day.
 * This matches Shopify's "Total sales" dashboard metric.
 */
export async function getShopifyDailySales(
  domain: string,
  token: string,
  from: string,
  to: string
): Promise<Record<string, DailySales>> {
  // Fetch orders created in the date range (includes their refunds)
  const orders = await fetchAllPages(domain, token,
    `orders.json?created_at_min=${from}T00:00:00&created_at_max=${to}T23:59:59&status=any&limit=250`
  );

  // For short sync windows (<=30 days), also fetch recently-updated orders
  // to catch refunds processed within our range for orders created before it
  const daySpan = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
  if (daySpan <= 30) {
    const updatedOrders = await fetchAllPages(domain, token,
      `orders.json?updated_at_min=${from}T00:00:00&updated_at_max=${to}T23:59:59&status=any&limit=250`
    );
    const existingIds = new Set(orders.map(o => o.id));
    for (const o of updatedOrders) {
      if (!existingIds.has(o.id)) orders.push(o);
    }
  }

  const daily: Record<string, DailySales> = {};

  const ensure = (date: string) => {
    if (!daily[date]) daily[date] = { revenueCents: 0, orderCount: 0, refundCents: 0, netSalesCents: 0 };
  };

  for (const order of orders) {
    // Shopify returns timestamps with store timezone offset, e.g. "2026-03-15T14:30:00-07:00"
    // The date portion is in the store's local time
    const createdDate = order.created_at.substring(0, 10);

    // Count revenue for orders created within our range
    if (createdDate >= from && createdDate <= to) {
      ensure(createdDate);
      daily[createdDate].revenueCents += Math.round(parseFloat(order.total_price || '0') * 100);
      daily[createdDate].orderCount++;
    }

    // Count refunds by their processing date (this is how Shopify calculates "Total sales")
    if (order.refunds) {
      for (const refund of order.refunds) {
        const refundDate = refund.created_at.substring(0, 10);
        if (refundDate >= from && refundDate <= to) {
          ensure(refundDate);
          if (refund.transactions) {
            for (const txn of refund.transactions) {
              if (txn.kind === 'refund' && txn.status === 'success') {
                daily[refundDate].refundCents += Math.round(parseFloat(txn.amount || '0') * 100);
              }
            }
          } else if (refund.refund_line_items) {
            // Fallback: sum from refund line items
            for (const item of refund.refund_line_items) {
              daily[refundDate].refundCents += Math.round(parseFloat(item.subtotal || '0') * 100);
              daily[refundDate].refundCents += Math.round(parseFloat(item.total_tax || '0') * 100);
            }
          }
        }
      }
    }
  }

  // Calculate net sales (matches Shopify "Total sales" = revenue - refunds)
  for (const date of Object.keys(daily)) {
    daily[date].netSalesCents = daily[date].revenueCents - daily[date].refundCents;
  }

  return daily;
}
