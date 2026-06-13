import { NextRequest, NextResponse } from 'next/server';
import { syncTodayRevenue, syncTodayRevenueAll } from '@/lib/sync';

export const dynamic = 'force-dynamic';

// POST /api/sync/today           → fast near-real-time revenue sync for all visible Shopify stores (parallel)
// POST /api/sync/today?storeId=X → force today's revenue sync for one store (bypasses throttle)
export async function POST(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');

  if (storeId) {
    const r = await syncTodayRevenue(storeId);
    return NextResponse.json({ success: true, ...r });
  }

  const r = await syncTodayRevenueAll();
  return NextResponse.json({ success: true, ...r });
}
