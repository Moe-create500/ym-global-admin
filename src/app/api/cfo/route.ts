import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
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
  const avgPerOrder = withEstimate > 0 ? Math.round(estimatedCents / withEstimate) : 0;
  const projectedCents = estimatedCents + (withoutEstimate * avgPerOrder);

  const fulfillment = {
    billed_cents: store.ss_charges_pending_cents || 0,
    estimated_cents: projectedCents,
    estimated_order_count: ssCharges?.estimated_order_count || 0,
    total_unfulfilled: totalUnfulfilled,
    unfulfilled_with_estimate: withEstimate,
    without_estimate: withoutEstimate,
    avg_per_order_cents: avgPerOrder,
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

  // Pull FB pending balance (unbilled spend) from API
  let fbPendingBalanceCents = 0;
  try {
    const fbProfile: any = db.prepare(
      "SELECT ad_account_id, access_token FROM fb_profiles WHERE store_id = ? AND is_active = 1 LIMIT 1"
    ).get(storeId);
    if (fbProfile?.ad_account_id && fbProfile?.access_token) {
      const fbUrl = `https://graph.facebook.com/v21.0/${fbProfile.ad_account_id}?fields=balance&access_token=${fbProfile.access_token}`;
      const fbRes = await fetch(fbUrl);
      if (fbRes.ok) {
        const fbData = await fbRes.json();
        fbPendingBalanceCents = parseInt(fbData.balance || '0', 10);
      }
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

  // 6. Shopify Balance + Payout (manual input stored on store)
  const shopifyBalance = store.shopify_balance_cents || 0;
  const shopifyPayout = store.shopify_payout_cents || 0;

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

  // 8. Reserves (manual entries)
  const reserveRows: any[] = db.prepare(
    'SELECT * FROM reserves WHERE store_id = ? ORDER BY created_at DESC'
  ).all(storeId);
  const reservesTotal = reserveRows.reduce((s: number, r: any) => s + (r.amount_cents || 0), 0);

  // 9. Manual credit cards (liabilities)
  const manualCCRows: any[] = db.prepare(
    'SELECT * FROM manual_credit_cards WHERE store_id = ? ORDER BY created_at DESC'
  ).all(storeId);
  const manualCCTotal = manualCCRows.reduce((s: number, c: any) => s + (c.amount_owed_cents || 0), 0);

  // Build balance sheet
  const assets = {
    cash_bank_cents: bankTotal,
    cash_shopify_cents: shopifyBalance,
    shopify_payout_cents: shopifyPayout,
    reserves_cents: reservesTotal,
    inventory_cents: inventoryAssetCents,
    loans_receivable_cents: loans.lent_remaining_cents,
    total_cents: bankTotal + shopifyBalance + shopifyPayout + reservesTotal + inventoryAssetCents + loans.lent_remaining_cents,
  };

  const liabilities = {
    fulfillment_owed_cents: fulfillment.balance_cents,
    fulfillment_estimated_cents: fulfillment.estimated_cents,
    ad_spend_pending_cents: adSpend.balance_due_cents,
    fb_pending_balance_cents: fbPendingBalanceCents,
    app_invoices_due_cents: appInvoices.balance_due_cents,
    loans_payable_cents: loans.borrowed_remaining_cents,
    manual_cc_cents: manualCCTotal,
    total_cents: fulfillment.balance_cents + fulfillment.estimated_cents + adSpend.balance_due_cents + fbPendingBalanceCents + appInvoices.balance_due_cents + loans.borrowed_remaining_cents + manualCCTotal,
  };

  const equity = assets.total_cents - liabilities.total_cents;

  return NextResponse.json({
    store: { id: store.id, name: store.name },
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
      reserves: reserveRows.map((r: any) => ({ id: r.id, amount_cents: r.amount_cents, held_at: r.held_at })),
      manualCreditCards: manualCCRows.map((c: any) => ({ id: c.id, card_name: c.card_name, amount_owed_cents: c.amount_owed_cents })),
    },
    snapshots: db.prepare(
      'SELECT id, snapshot_date, assets_cents, liabilities_cents, equity_cents, created_at FROM cfo_snapshots WHERE store_id = ? ORDER BY created_at DESC LIMIT 20'
    ).all(storeId),
  });
}

// PATCH: Update Shopify balance, reserves (manual input)
export async function PATCH(req: NextRequest) {
  const { storeId, shopifyBalanceCents, shopifyPayoutCents, reserve, deleteReserveId, manualCC, deleteManualCCId } = await req.json();
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
  const now = new Date();
  const date = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO cfo_snapshots (id, store_id, snapshot_date, assets_cents, liabilities_cents, equity_cents, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, storeId, date, assets_cents || 0, liabilities_cents || 0, equity_cents || 0, data ? JSON.stringify(data) : null);

  return NextResponse.json({ success: true, id, date });
}
