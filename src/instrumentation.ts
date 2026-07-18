export async function register() {
  // Only run on the Node.js server runtime (not edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

    // Overlap guard: never let two full sync passes run at once. Uses the shared
    // cross-entry-point lock in lib/sync so manual /api/cron/sync and dashboard
    // auto-syncs can't stack on top of the 30-min tick either.
    const runFullSync = async (label: string, includeProducts: boolean) => {
      const { syncAllStores, syncFacebookAds, syncAllProducts, acquireSyncLock, releaseSyncLock, activeSyncLock } = await import('@/lib/sync');
      if (!acquireSyncLock(`auto:${label}`)) {
        console.warn(`[auto-sync] ${label} skipped — "${activeSyncLock()}" still in progress`);
        return;
      }
      try {
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

        // Reconcile freshly imported bank transactions (incremental — only
        // touches unlinked rows, sub-second) so Transactions stays current
        // without anyone pressing Scan.
        try {
          const { runTransactionScan } = await import('@/lib/transactions-intel');
          const { getDb } = await import('@/lib/db');
          const scan = runTransactionScan(getDb(), { days: 45 });
          if (scan.classified > 0) bankNote += `, ${scan.classified} txns reconciled`;
        } catch (e) {
          console.error(`[auto-sync] ${label} txn scan error:`, e);
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
        releaseSyncLock();
      }
    };

    // Delay first sync by 10 seconds to let the server fully start
    setTimeout(async () => {
      await runFullSync('Initial sync', false);

      // One-time product sync 2 min after startup (separate from heavy initial sync)
      setTimeout(async () => {
        const { syncAllProducts, acquireSyncLock, releaseSyncLock } = await import('@/lib/sync');
        if (!acquireSyncLock('product-sync')) {
          console.warn('[product-sync] skipped — a sync is already in progress');
          return;
        }
        try {
          console.log('[product-sync] First product sync starting...');
          const result = await syncAllProducts();
          console.log(`[product-sync] Done: ${result.synced} products synced, ${result.errors.length} errors`);
        } catch (e) {
          console.error('[product-sync] Error:', e);
        } finally {
          releaseSyncLock();
        }
      }, 120_000);

      // Then sync everything every 30 minutes (guarded against overlap)
      setInterval(() => { void runFullSync('Scheduled sync', true); }, SYNC_INTERVAL_MS);
    }, 10_000);

    // Chargeback auto-responder — hourly, independent of the sync lock (its DB
    // writes are tiny; a slow full sync must never delay a dispute response).
    let cbRunning = false;
    const cbTick = async () => {
      if (cbRunning) return;
      cbRunning = true;
      try {
        const { runChargebackAutoResponder } = await import('@/lib/chargeback-auto');
        const { getDb } = await import('@/lib/db');
        const r = await runChargebackAutoResponder(getDb(), { limit: 12 });
        if (r.decisions.length > 0) console.log(`[chargeback-auto] ${r.summary}`);
      } catch (e) {
        console.error('[chargeback-auto] tick error:', e);
      } finally {
        cbRunning = false;
      }
    };
    setTimeout(() => { void cbTick(); }, 3 * 60_000); // first pass 3 min after boot
    setInterval(() => { void cbTick(); }, 60 * 60_000); // then hourly

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
