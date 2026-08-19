import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { reconcileSnapshot } from '@/lib/cfo-reconcile';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  const db = getDb();

  if (!storeId) {
    return NextResponse.json({ error: 'storeId required' }, { status: 400 });
  }

  const store: any = db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId);
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

  // 1. Estimated COGS — from SS charges (billed + estimated - paid)
  // Only count estimated charges for unfulfilled/partial orders (matching store page)
  const ssCharges: any = db.prepare(`
    SELECT
      SUM(CASE WHEN ss_charge_is_estimate = 0 THEN ss_charge_cents ELSE 0 END) as charged_cents,
      SUM(CASE WHEN ss_charge_is_estimate = 1 AND fulfillment_status IN ('unfulfilled', 'partial') THEN ss_charge_cents ELSE 0 END) as estimated_cents,
      COUNT(CASE WHEN ss_charge_is_estimate = 1 AND fulfillment_status IN ('unfulfilled', 'partial') THEN 1 END) as estimated_order_count,
      SUM(ss_charge_cents) as total_cents
    FROM orders WHERE store_id = ? AND ss_charge_cents > 0
  `).get(storeId);

  const unfulfilledCounts: any = db.prepare(`
    SELECT
      COUNT(*) as total_unfulfilled,
      COUNT(CASE WHEN ss_charge_cents > 0 THEN 1 END) as with_estimate
    FROM orders WHERE store_id = ? AND fulfillment_status IN ('unfulfilled', 'partial')
  `).get(storeId);

  const ssPaid: any = db.prepare(
    'SELECT COALESCE(SUM(amount_cents), 0) as total FROM ss_payments WHERE store_id = ?'
  ).get(storeId);

  const totalUnfulfilled = unfulfilledCounts?.total_unfulfilled || 0;
  const withEstimate = unfulfilledCounts?.with_estimate || 0;
  const withoutEstimate = totalUnfulfilled - withEstimate;
  const estimatedCents = ssCharges?.estimated_cents || 0;
  let avgPerOrder = withEstimate > 0 ? Math.round(estimatedCents / withEstimate) : 0;
  let avgSource = 'current estimates';
  if (avgPerOrder <= 0 && withoutEstimate > 0) {
    // No unfulfilled order carries an estimate yet — use the real historical average:
    // actual billed ShipSourced charges per order, most recent 60 days (falls back to
    // all-time if the store has no recent billed orders).
    const hist: any = db.prepare(
      `SELECT COALESCE(AVG(ss_charge_cents),0) AS avg, COUNT(*) AS n FROM orders
       WHERE store_id = ? AND ss_charge_cents > 0 AND ss_charge_is_estimate = 0
         AND created_at >= datetime('now', '-60 days')`
    ).get(storeId);
    if (hist?.n > 0) { avgPerOrder = Math.round(hist.avg); avgSource = `billed history 60d (${hist.n} orders)`; }
    else {
      const all: any = db.prepare(
        `SELECT COALESCE(AVG(ss_charge_cents),0) AS avg, COUNT(*) AS n FROM orders WHERE store_id = ? AND ss_charge_cents > 0 AND ss_charge_is_estimate = 0`
      ).get(storeId);
      if (all?.n > 0) { avgPerOrder = Math.round(all.avg); avgSource = `billed history all-time (${all.n} orders)`; }
    }
  }
  const projectedCents = estimatedCents + (withoutEstimate * avgPerOrder);

  const fulfillment = {
    billed_cents: store.ss_charges_pending_cents || 0,
    estimated_cents: projectedCents,
    estimated_order_count: ssCharges?.estimated_order_count || 0,
    total_unfulfilled: totalUnfulfilled,
    unfulfilled_with_estimate: withEstimate,
    without_estimate: withoutEstimate,
    avg_per_order_cents: avgPerOrder,
    avg_source: avgSource,
    paid_cents: ssPaid?.total || 0,
    total_owed_cents: (store.ss_net_owed_cents || 0),
    balance_cents: store.ss_net_owed_cents || 0,
  };

  // 2. Ad Spend Debt — from card payments (charged - paid per card)
  const adCharges: any[] = db.prepare(`
    SELECT
      CASE WHEN card_last4 IS NOT NULL AND card_last4 != ''
        THEN payment_method || ' - ' || card_last4 ELSE payment_method END as card,
      SUM(total_cents) as charged_cents
    FROM shopify_invoices
    WHERE store_id = ? AND source = 'chargeflow' AND payment_method IS NOT NULL
      AND NOT (payment_method LIKE '%shopify%' OR payment_method LIKE '%Shopify%')
    GROUP BY card
  `).all(storeId);

  // Ad payments from ad_payments table
  const adPaymentCards: any[] = db.prepare(`
    SELECT card_last4, SUM(amount_cents) as paid FROM ad_payments WHERE store_id = ? GROUP BY card_last4
  `).all(storeId);

  const adSpendTotal: any = db.prepare(`
    SELECT COALESCE(SUM(spend_cents), 0) as total FROM ad_spend WHERE store_id = ?
  `).get(storeId);

  const adPaymentsTotal: any = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) as total FROM ad_payments WHERE store_id = ?
  `).get(storeId);

  // Ad invoices balance due = total charged on ad invoices - total card payments made
  const adInvoiceCharged: any = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) as total FROM ad_payments WHERE store_id = ?
  `).get(storeId);

  const adCardPaid: any = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) as total FROM card_payments_log WHERE store_id = ? AND category = 'ad'
  `).get(storeId);

  // Pull FB pending balance (unbilled spend) from API — sum across ALL active ad accounts
  let fbPendingBalanceCents = 0;
  try {
    const fbProfiles: any[] = db.prepare(
      "SELECT ad_account_id, access_token FROM fb_profiles WHERE store_id = ? AND is_active = 1 AND ad_account_id IS NOT NULL AND access_token IS NOT NULL"
    ).all(storeId);
    for (const fbProfile of fbProfiles) {
      try {
        const fbUrl = `https://graph.facebook.com/v21.0/${fbProfile.ad_account_id}?fields=balance&access_token=${fbProfile.access_token}`;
        const fbRes = await fetch(fbUrl);
        if (fbRes.ok) {
          const fbData = await fbRes.json();
          fbPendingBalanceCents += parseInt(fbData.balance || '0', 10);
        }
      } catch {}
    }
  } catch {}

  // Per-platform ad invoice breakdown
  const adChargedByPlatform: any[] = db.prepare(
    "SELECT platform, COALESCE(SUM(amount_cents), 0) as total FROM ad_payments WHERE store_id = ? GROUP BY platform"
  ).all(storeId);
  const adPaidByPlatform: any[] = db.prepare(
    "SELECT platform, COALESCE(SUM(amount_cents), 0) as total FROM card_payments_log WHERE store_id = ? AND category = 'ad' GROUP BY platform"
  ).all(storeId);

  const platformBreakdown: Record<string, { charged: number; paid: number; balance: number }> = {};
  for (const r of adChargedByPlatform) {
    platformBreakdown[r.platform] = { charged: r.total, paid: 0, balance: r.total };
  }
  for (const r of adPaidByPlatform) {
    if (!platformBreakdown[r.platform]) platformBreakdown[r.platform] = { charged: 0, paid: 0, balance: 0 };
    platformBreakdown[r.platform].paid = r.total;
    platformBreakdown[r.platform].balance = platformBreakdown[r.platform].charged - r.total;
  }

  const adSpend = {
    total_invoiced_cents: adInvoiceCharged?.total || 0,
    total_paid_cents: adCardPaid?.total || 0,
    balance_due_cents: Math.max(0, (adInvoiceCharged?.total || 0) - (adCardPaid?.total || 0)),
    fb_pending_balance_cents: fbPendingBalanceCents,
    platforms: platformBreakdown,
  };

  // 3. Inventory Asset
  const invPurchases: any[] = db.prepare(
    'SELECT * FROM inventory_purchases WHERE store_id = ?'
  ).all(storeId);

  const orders: any[] = db.prepare(
    "SELECT line_items FROM orders WHERE store_id = ? AND line_items IS NOT NULL AND financial_status != 'voided'"
  ).all(storeId);

  const soldMap: Record<string, number> = {};
  for (const order of orders) {
    try {
      const items = JSON.parse(order.line_items);
      for (const item of items) {
        if (item.sku) soldMap[item.sku] = (soldMap[item.sku] || 0) + (item.qty || 1);
      }
    } catch {}
  }

  // Roll up variant SKUs: "SKU-N" means N units of base "SKU"
  const variantSoldMap: Record<string, number> = {};
  for (const [sku, qty] of Object.entries(soldMap)) {
    const match = sku.match(/^(.+)-(\d+)$/);
    if (match) {
      const baseSku = match[1];
      const multiplier = parseInt(match[2]);
      if (multiplier > 0 && multiplier <= 100) {
        variantSoldMap[baseSku] = (variantSoldMap[baseSku] || 0) + qty * multiplier;
      }
    }
  }

  let inventoryAssetCents = 0;
  let inventoryCostBasis = 0;
  const productMap: Record<string, { purchased: number; cost: number }> = {};
  for (const p of invPurchases) {
    const key = p.sku || p.product_name;
    if (!productMap[key]) productMap[key] = { purchased: 0, cost: 0 };
    productMap[key].purchased += p.qty_purchased;
    productMap[key].cost += p.total_cost_cents;
  }
  for (const [key, data] of Object.entries(productMap)) {
    const avgCost = data.purchased > 0 ? Math.round(data.cost / data.purchased) : 0;
    const sold = (soldMap[key] || 0) + (variantSoldMap[key] || 0);
    const remaining = Math.max(0, data.purchased - sold);
    inventoryAssetCents += remaining * avgCost;
    inventoryCostBasis += data.cost;
  }

  const inventory = {
    asset_value_cents: inventoryAssetCents,
    cost_basis_cents: inventoryCostBasis,
  };

  // 4. App Invoices / Shopify Billing Debt
  // App invoices: match the App Invoices page calculation
  // Exclude Chargeflow-via-Shopify, only count invoices with payment method set
  const appInvoiceCharged: any = db.prepare(`
    SELECT COALESCE(SUM(total_cents), 0) as total
    FROM shopify_invoices
    WHERE store_id = ? AND payment_method IS NOT NULL AND payment_method != ''
      AND NOT (source = 'chargeflow' AND (payment_method LIKE '%shopify%' OR payment_method LIKE '%Shopify%'))
  `).get(storeId);

  const cardPayments: any = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) as total FROM card_payments_log WHERE store_id = ? AND category = 'app'
  `).get(storeId);

  const lastInvoice: any = db.prepare(
    'SELECT bill_number, date, total_cents, source FROM shopify_invoices WHERE store_id = ? ORDER BY date DESC LIMIT 1'
  ).get(storeId);

  const appInvoices = {
    total_charged_cents: appInvoiceCharged?.total || 0,
    total_paid_cents: cardPayments?.total || 0,
    balance_due_cents: Math.max(0, (appInvoiceCharged?.total || 0) - (cardPayments?.total || 0)),
    last_invoice: lastInvoice ? { bill_number: lastInvoice.bill_number, date: lastInvoice.date, total_cents: lastInvoice.total_cents, source: lastInvoice.source } : null,
  };

  // 5. Loans
  const loanData: any[] = db.prepare(`
    SELECT l.*, (SELECT COALESCE(SUM(amount_cents), 0) FROM loan_payments WHERE loan_id = l.id) as total_paid_cents
    FROM loans l WHERE l.store_id = ?
  `).all(storeId);

  const borrowed = loanData.filter(l => l.type !== 'lent');
  const lent = loanData.filter(l => l.type === 'lent');

  const loans = {
    borrowed_total_cents: borrowed.reduce((s, l) => s + l.amount_cents, 0),
    borrowed_remaining_cents: borrowed.reduce((s, l) => s + l.remaining_cents, 0),
    lent_total_cents: lent.reduce((s, l) => s + l.amount_cents, 0),
    lent_remaining_cents: lent.reduce((s, l) => s + l.remaining_cents, 0),
  };

  // 6. Shopify Balance + Payout — LIVE from the Shopify API when the store is connected
  // (credential vault + client_credentials token); falls back to the hand-typed values.
  //   Shopify balance  = pending payout balance + scheduled payouts (money still at Shopify)
  //   Payout in transit = paid payouts whose landing day hasn't passed
  let shopifyBalance = store.shopify_balance_cents || 0;
  let shopifyPayout = store.shopify_payout_cents || 0;
  let liveShopify: any = null;
  let liveReserves: number | null = null;
  try {
    const { getCreds, getLiveShopifyFigures, anchorGuardWarnings } = await import('@/lib/shopify-sync');
    if (getCreds(db, storeId)) {
      const fig = await getLiveShopifyFigures(db, storeId, Date.now());
      shopifyBalance = fig.pending_balance_cents + fig.scheduled_cents;
      shopifyPayout = fig.paid_unlanded_cents;
      liveReserves = fig.reserves_cents;
      liveShopify = { source: 'shopify_api', ...fig, guard_warnings: anchorGuardWarnings(db, storeId, Date.now()) };
    }
  } catch (e: any) {
    liveShopify = { source: 'manual_fallback', error: (e?.message || String(e)).slice(0, 150) };
  }

  // 7. Bank Accounts
  const bankAccounts: any[] = db.prepare(
    "SELECT * FROM bank_accounts WHERE store_id = ? AND status = 'active' AND COALESCE(cfo_hidden, 0) = 0"
  ).all(storeId);

  const bankTotal = bankAccounts.reduce((s: number, a: any) => {
    if (a.account_type === 'credit') {
      // Use credit_limit - available to include pending charges
      const creditLimit = a.credit_limit_cents || (a.balance_available_cents + a.balance_ledger_cents) || 0;
      const totalOwed = creditLimit - (a.balance_available_cents || 0);
      return s - totalOwed;
    }
    return s + (a.balance_available_cents || 0);
  }, 0);

  // 8. Reserves — live event-sum from the API sync when connected, else manual entries
  const reserveRows: any[] = db.prepare(
    'SELECT * FROM reserves WHERE store_id = ? ORDER BY created_at DESC'
  ).all(storeId);
  const reservesTotal = liveReserves != null ? liveReserves : reserveRows.reduce((s: number, r: any) => s + (r.amount_cents || 0), 0);

  // 9. Manual credit cards (liabilities)
  const manualCCRows: any[] = db.prepare(
    'SELECT * FROM manual_credit_cards WHERE store_id = ? ORDER BY created_at DESC'
  ).all(storeId);
  const manualCCTotal = manualCCRows.reduce((s: number, c: any) => s + (c.amount_owed_cents || 0), 0);

  // Payments INITIATED but not yet debited from any bank — the money is
  // committed even though the balance still shows it. Counting it as free
  // cash overstates the position (the exact mis-accounting that kept showing
  // up as reconciliation residuals). Source: this store's logged card
  // payments (last 21 days) with no matching bank debit yet.
  let paymentsInFlightCents = 0;
  let paymentsInFlightRows: any[] = [];
  try {
    const { reconcileLoggedPayments } = await import('@/lib/transactions-intel');
    const recon = reconcileLoggedPayments(db, 21);
    const recent: any[] = db.prepare(`
      SELECT id, date, amount_cents, card_last4 FROM card_payments_log
      WHERE store_id = ? AND date != 'N/A' AND date >= date('now', '-21 days')
    `).all(storeId);
    paymentsInFlightRows = recent
      .filter(p => ['too_recent', 'not_taken'].includes((recon as any)[p.id]?.status))
      .map(p => ({ date: p.date, amount_cents: p.amount_cents, card_last4: p.card_last4, status: (recon as any)[p.id].status }));
    paymentsInFlightCents = paymentsInFlightRows.reduce((s, p) => s + p.amount_cents, 0);
  } catch { /* best-effort — the sheet must still render */ }

  // ── 3PL mode (ShipSourced store): banks & cards stay identical, but the
  // business lines come from ShipSourced's own books — A/R from client
  // billing, the carrier deposit/owed position, client credit balances.
  let ssFinance: any = null;
  if (store.name === 'ShipSourced') {
    try {
      const { getFinanceSummary } = await import('@/lib/shipsourced');
      ssFinance = await getFinanceSummary();
    } catch (e) {
      console.error('[cfo] 3PL finance feed failed:', (e as any)?.message);
    }
  }

  // Build balance sheet.
  // 3PL mode (ShipSourced): no Shopify money lines — payments come in via
  // Stripe, so the pending-payout asset is the Stripe balance instead. The
  // "carrier prepaid deposit" line was removed entirely (Moe 2026-08-19:
  // nobody prepays carriers — a paid>invoiced gap is unapplied invoices, not
  // an asset).
  const is3pl = !!ssFinance;
  const stripePayoutCents = ssFinance?.stripeBalanceCents || 0;
  const assets = {
    cash_bank_cents: bankTotal,
    cash_shopify_cents: is3pl ? 0 : shopifyBalance,
    shopify_payout_cents: is3pl ? 0 : shopifyPayout,
    stripe_payout_cents: stripePayoutCents,
    reserves_cents: reservesTotal,
    inventory_cents: inventoryAssetCents,
    loans_receivable_cents: loans.lent_remaining_cents,
    ar_clients_cents: ssFinance?.arTotalCents || 0,
    total_cents: bankTotal + (is3pl ? 0 : shopifyBalance + shopifyPayout) + stripePayoutCents + reservesTotal + inventoryAssetCents + loans.lent_remaining_cents
      + (ssFinance?.arTotalCents || 0),
  };

  const liabilities = {
    fulfillment_owed_cents: fulfillment.balance_cents,
    fulfillment_estimated_cents: fulfillment.estimated_cents,
    ad_spend_pending_cents: adSpend.balance_due_cents,
    fb_pending_balance_cents: fbPendingBalanceCents,
    app_invoices_due_cents: appInvoices.balance_due_cents,
    loans_payable_cents: loans.borrowed_remaining_cents,
    manual_cc_cents: manualCCTotal,
    payments_in_flight_cents: paymentsInFlightCents,
    carrier_owed_cents: ssFinance?.carrierOwedCents || 0,
    client_credits_cents: ssFinance?.clientCreditsCents || 0,
    total_cents: fulfillment.balance_cents + fulfillment.estimated_cents + adSpend.balance_due_cents + fbPendingBalanceCents + appInvoices.balance_due_cents + loans.borrowed_remaining_cents + manualCCTotal + paymentsInFlightCents
      + (ssFinance?.carrierOwedCents || 0) + (ssFinance?.clientCreditsCents || 0),
  };

  const equity = assets.total_cents - liabilities.total_cents;

  // Parse CFO overrides
  let cfoOverrides: Record<string, string> = {};
  if (store.cfo_overrides) {
    try { cfoOverrides = JSON.parse(store.cfo_overrides); } catch {}
  }

  return NextResponse.json({
    store: { id: store.id, name: store.name },
    cfo_overrides: cfoOverrides,
    assets,
    liabilities,
    equity_cents: equity,
    details: {
      fulfillment,
      adSpend,
      inventory,
      appInvoices,
      loans,
      bankAccounts: bankAccounts.map((a: any) => {
        if (a.account_type === 'credit') {
          const creditLimit = a.credit_limit_cents || ((a.balance_available_cents || 0) + (a.balance_ledger_cents || 0));
          const totalOwed = creditLimit - (a.balance_available_cents || 0);
          return {
            id: a.id, institution_name: a.institution_name, account_name: a.account_name,
            last_four: a.last_four, account_type: a.account_type,
            balance_available_cents: -totalOwed,
            balance_ledger_cents: a.balance_ledger_cents, balance_updated_at: a.balance_updated_at,
          };
        }
        return {
          id: a.id, institution_name: a.institution_name, account_name: a.account_name,
          last_four: a.last_four, account_type: a.account_type,
          balance_available_cents: a.balance_available_cents,
          balance_ledger_cents: a.balance_ledger_cents, balance_updated_at: a.balance_updated_at,
        };
      }),
      shopify_balance_cents: shopifyBalance,
      shopify_payout_cents: shopifyPayout,
      shopify_live: liveShopify,
      reserves: reserveRows.map((r: any) => ({ id: r.id, amount_cents: r.amount_cents, held_at: r.held_at })),
      manualCreditCards: manualCCRows.map((c: any) => ({ id: c.id, card_name: c.card_name, amount_owed_cents: c.amount_owed_cents })),
      paymentsInFlight: paymentsInFlightRows,
      ssFinance,
    },
    snapshots: db.prepare(
      'SELECT id, snapshot_date, assets_cents, liabilities_cents, equity_cents, created_at, COALESCE(excluded, 0) AS excluded FROM cfo_snapshots WHERE store_id = ? ORDER BY created_at DESC LIMIT 20'
    ).all(storeId),
  });
}

// PATCH: Update Shopify balance, reserves (manual input)
export async function PATCH(req: NextRequest) {
  const { storeId, shopifyBalanceCents, shopifyPayoutCents, reserve, deleteReserveId, manualCC, deleteManualCCId, cfoOverride } = await req.json();
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();
  try { db.exec('ALTER TABLE stores ADD COLUMN shopify_balance_cents INTEGER DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE stores ADD COLUMN shopify_payout_cents INTEGER DEFAULT 0'); } catch {}

  if (shopifyBalanceCents !== undefined) {
    db.prepare('UPDATE stores SET shopify_balance_cents = ? WHERE id = ?').run(shopifyBalanceCents, storeId);
  }
  if (shopifyPayoutCents !== undefined) {
    db.prepare('UPDATE stores SET shopify_payout_cents = ? WHERE id = ?').run(shopifyPayoutCents, storeId);
  }

  // Add or update a reserve
  if (reserve) {
    if (reserve.id) {
      db.prepare('UPDATE reserves SET amount_cents = ?, held_at = ? WHERE id = ? AND store_id = ?')
        .run(reserve.amount_cents, reserve.held_at, reserve.id, storeId);
    } else {
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO reserves (id, store_id, amount_cents, held_at) VALUES (?, ?, ?, ?)')
        .run(id, storeId, reserve.amount_cents, reserve.held_at);
    }
  }

  // Delete a reserve
  if (deleteReserveId) {
    db.prepare('DELETE FROM reserves WHERE id = ? AND store_id = ?').run(deleteReserveId, storeId);
  }

  // Add or update a manual credit card
  if (manualCC) {
    if (manualCC.id) {
      db.prepare('UPDATE manual_credit_cards SET card_name = ?, amount_owed_cents = ? WHERE id = ? AND store_id = ?')
        .run(manualCC.card_name, manualCC.amount_owed_cents, manualCC.id, storeId);
    } else {
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO manual_credit_cards (id, store_id, card_name, amount_owed_cents) VALUES (?, ?, ?, ?)')
        .run(id, storeId, manualCC.card_name, manualCC.amount_owed_cents);
    }
  }

  // Update CFO detail overrides
  if (cfoOverride) {
    const store: any = db.prepare('SELECT cfo_overrides FROM stores WHERE id = ?').get(storeId);
    let existing: Record<string, string> = {};
    if (store?.cfo_overrides) { try { existing = JSON.parse(store.cfo_overrides); } catch {} }
    if (cfoOverride.value === '' || cfoOverride.value === null) {
      delete existing[cfoOverride.key];
    } else {
      existing[cfoOverride.key] = cfoOverride.value;
    }
    db.prepare('UPDATE stores SET cfo_overrides = ? WHERE id = ?').run(JSON.stringify(existing), storeId);
  }

  // Delete a manual credit card
  if (deleteManualCCId) {
    db.prepare('DELETE FROM manual_credit_cards WHERE id = ? AND store_id = ?').run(deleteManualCCId, storeId);
  }

  return NextResponse.json({ success: true });
}

// POST: Save a snapshot of current state
export async function POST(req: NextRequest) {
  const { storeId, assets_cents, liabilities_cents, equity_cents, data } = await req.json();
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();

  // FRESHNESS GATE: a snapshot is a reconciliation input — both Shopify (payments) and
  // ShipSourced (orders/fulfillment charges) must be current at the same moment, or the
  // snapshot bakes in phantom drift. Shopify auto-syncs inline here if stale.
  try {
    const { ensureFreshForReconcile } = await import('@/lib/shopify-sync');
    const fresh = await ensureFreshForReconcile(db, storeId, Date.now());
    if (!fresh.ok) {
      return NextResponse.json({ error: `Snapshot refused — ${fresh.message}` }, { status: 409 });
    }
  } catch { /* gate must never hard-crash snapshots for unconnected stores */ }

  const now = new Date();
  const date = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO cfo_snapshots (id, store_id, snapshot_date, assets_cents, liabilities_cents, equity_cents, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, storeId, date, assets_cents || 0, liabilities_cents || 0, equity_cents || 0, data ? JSON.stringify(data) : null);

  // Auto-reconcile this snapshot against the prior one so the CFO can immediately see
  // whether the new (more accurate) balances tie out to the P&L, and why if they don't.
  let reconciliation = null;
  try {
    reconciliation = reconcileSnapshot(db, storeId, id);
  } catch (err) {
    console.error('[cfo] reconciliation failed:', (err as any)?.message);
  }

  return NextResponse.json({ success: true, id, date, reconciliation });
}
