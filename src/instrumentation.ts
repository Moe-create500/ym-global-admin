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

      // Product sync runs 2 min after startup (separate from heavy initial sync)
      setTimeout(async () => {
        try {
          const { syncAllProducts } = await import('@/lib/sync');
          console.log('[product-sync] First product sync starting...');
          const result = await syncAllProducts();
          console.log(`[product-sync] Done: ${result.synced} products synced, ${result.errors.length} errors`);
        } catch (e) {
          console.error('[product-sync] Error:', e);
        }
      }, 120_000);

      // Then sync everything every 30 minutes
      setInterval(async () => {
        try {
          const { syncAllStores, syncFacebookAds, syncAllProducts } = await import('@/lib/sync');
          console.log('[auto-sync] Scheduled sync starting...');
          const storeResult = await syncAllStores();
          const fbResult = await syncFacebookAds();
          const productResult = await syncAllProducts();
          const totalSynced = storeResult.results.reduce((s, r) => s + r.synced, 0);
          console.log(`[auto-sync] Done: ${totalSynced} store records, ${fbResult.synced} ad records, ${productResult.synced} products`);
        } catch (e) {
          console.error('[auto-sync] Scheduled sync error:', e);
        }
      }, SYNC_INTERVAL_MS);
    }, 10_000);
  }
}
