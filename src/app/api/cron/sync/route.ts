import { NextRequest, NextResponse } from 'next/server';
import { syncAllStores, syncFacebookAds } from '@/lib/sync';

export const dynamic = 'force-dynamic';

const CRON_SECRET = process.env.CRON_SECRET || '';

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');

  if (CRON_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { results, logId } = await syncAllStores();
  const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
  const errors = results.filter(r => r.error);

  // Also sync Facebook ad spend for all active profiles
  const fbResult = await syncFacebookAds();

  return NextResponse.json({
    success: true,
    synced: totalSynced,
    fbAdsSynced: fbResult.synced,
    fbInvoicesImported: fbResult.invoicesImported,
    stores: results.length,
    errors: errors.length > 0 ? errors : undefined,
    fbErrors: fbResult.errors.length > 0 ? fbResult.errors : undefined,
    logId,
  });
}
