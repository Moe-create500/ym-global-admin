export async function register() {
  // Only run on the Node.js server runtime (not edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

    // Delay first sync by 10 seconds to let the server fully start
    setTimeout(async () => {
      try {
        const { syncAllStores, syncFacebookAds } = await import('@/lib/sync');
        console.log('[auto-sync] Initial sync starting...');
        await syncAllStores();
        await syncFacebookAds();
        console.log('[auto-sync] Initial sync complete');
      } catch (e) {
        console.error('[auto-sync] Initial sync error:', e);
      }

      // Then sync every 30 minutes
      setInterval(async () => {
        try {
          const { syncAllStores, syncFacebookAds } = await import('@/lib/sync');
          console.log('[auto-sync] Scheduled sync starting...');
          const storeResult = await syncAllStores();
          const fbResult = await syncFacebookAds();
          const totalSynced = storeResult.results.reduce((s, r) => s + r.synced, 0);
          console.log(`[auto-sync] Done: ${totalSynced} store records, ${fbResult.synced} ad records`);
        } catch (e) {
          console.error('[auto-sync] Scheduled sync error:', e);
        }
      }, SYNC_INTERVAL_MS);
    }, 10_000);
  }
}
