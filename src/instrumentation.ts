export async function register() {
  // Only run on the Node.js server runtime (not edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

    // Overlap guard: never let two full sync passes run at once. On a small box a slow
    // sync that outruns the 30-min interval would otherwise stack, piling up memory until
    // the process OOM-crashes. A skipped tick just waits for the next 30-min window.
    let syncing = false;

    const runFullSync = async (label: string, includeProducts: boolean) => {
      if (syncing) {
        console.warn(`[auto-sync] ${label} skipped — previous run still in progress`);
        return;
      }
      syncing = true;
      try {
        const { syncAllStores, syncFacebookAds, syncAllProducts } = await import('@/lib/sync');
        console.log(`[auto-sync] ${label} starting...`);
        const storeResult = await syncAllStores();
        const fbResult = await syncFacebookAds();
        let productSynced = 0;
        if (includeProducts) {
          const pr = await syncAllProducts();
          productSynced = pr.synced;
        }
        // Bank balances + transactions (Teller) — without this the Banking page
        // only updates when someone clicks Sync
        let bankNote = 'banks skipped';
        try {
          const { syncBankAccounts } = await import('@/lib/bank-sync');
          const bankResult = await syncBankAccounts();
          bankNote = `${bankResult.accounts_synced} banks, ${bankResult.transactions_imported} bank txns`;
          if (bankResult.errors.length > 0) {
            console.error(`[auto-sync] ${label}: ${bankResult.errors.length} bank errors; first: ${bankResult.errors.slice(0, 3).join(' | ').slice(0, 400)}`);
          }
        } catch (e) {
          console.error(`[auto-sync] ${label} bank sync error:`, e);
        }

        // Fulfillment-status refresh vs ShipSourced — keeps the CFO unfulfilled
        // estimate honest (order sync only inserts, never updates statuses)
        let statusNote = 'statuses skipped';
        try {
          const { refreshAllOrderStatuses } = await import('@/lib/order-status-refresh');
          const { getDb } = await import('@/lib/db');
          const sr = await refreshAllOrderStatuses(getDb());
          statusNote = `${sr.fulfilled + sr.cancelled + sr.reopened} order statuses corrected`;
          if (sr.errors.length > 0) {
            console.error(`[auto-sync] ${label}: ${sr.errors.length} status-refresh errors; first: ${sr.errors.slice(0, 3).join(' | ').slice(0, 400)}`);
          }
        } catch (e) {
          console.error(`[auto-sync] ${label} status refresh error:`, e);
        }

        const totalSynced = storeResult.results.reduce((s, r) => s + r.synced, 0);
        console.log(`[auto-sync] ${label} done: ${totalSynced} store records, ${fbResult.synced} ad records, ${productSynced} products, ${bankNote}, ${statusNote}`);
        // Surface FB sync failures — a checkpointed/expired token otherwise fails
        // silently as "0 ad records" while ad spend quietly goes stale.
        if (fbResult.errors.length > 0) {
          console.error(`[auto-sync] ${label}: ${fbResult.errors.length} FB profile errors; first: ${fbResult.errors.slice(0, 3).join(' | ').slice(0, 500)}`);
        }
      } catch (e) {
        console.error(`[auto-sync] ${label} error:`, e);
      } finally {
        syncing = false;
      }
    };

    // Delay first sync by 10 seconds to let the server fully start
    setTimeout(async () => {
      await runFullSync('Initial sync', false);

      // One-time product sync 2 min after startup (separate from heavy initial sync)
      setTimeout(async () => {
        if (syncing) {
          console.warn('[product-sync] skipped — a sync is already in progress');
          return;
        }
        syncing = true;
        try {
          const { syncAllProducts } = await import('@/lib/sync');
          console.log('[product-sync] First product sync starting...');
          const result = await syncAllProducts();
          console.log(`[product-sync] Done: ${result.synced} products synced, ${result.errors.length} errors`);
        } catch (e) {
          console.error('[product-sync] Error:', e);
        } finally {
          syncing = false;
        }
      }, 120_000);

      // Then sync everything every 30 minutes (guarded against overlap)
      setInterval(() => { void runFullSync('Scheduled sync', true); }, SYNC_INTERVAL_MS);
    }, 10_000);

    // Launch schedules ("daily at 12:00 PST" etc.) — checked every 5 minutes,
    // separate from the heavy sync so a slow sync never delays a launch
    let schedRunning = false;
    setInterval(async () => {
      if (schedRunning) return;
      schedRunning = true;
      try {
        const { runDueSchedules } = await import('@/lib/launch-scheduler');
        const { getDb } = await import('@/lib/db');
        const r = await runDueSchedules(getDb());
        if (r.ran > 0 || r.errors.length > 0) {
          console.log(`[launch-schedule] tick: ${r.ran} ran${r.errors.length ? `, errors: ${r.errors.join(' | ').slice(0, 300)}` : ''}`);
        }
      } catch (e) {
        console.error('[launch-schedule] tick error:', e);
      } finally {
        schedRunning = false;
      }
    }, 5 * 60_000);
  }
}
