import { NextRequest, NextResponse } from 'next/server';
import { syncStore, syncAllStores } from '@/lib/sync';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');

  if (storeId) {
    // Sync single store
    const result = await syncStore(storeId);
    return NextResponse.json({
      success: !result.error,
      synced: result.synced,
      storeName: result.storeName,
      error: result.error,
    });
  }

  // Sync all connected stores
  const { results, logId } = await syncAllStores();
  const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
  const errors = results.filter(r => r.error).map(r => `${r.storeName}: ${r.error}`);

  return NextResponse.json({
    success: true,
    synced: totalSynced,
    storesProcessed: results.length,
    errors: errors.length > 0 ? errors : undefined,
    logId,
  });
}
