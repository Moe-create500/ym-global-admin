'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import StoreSelector from '@/components/StoreSelector';

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr + 'Z');
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface CFOData {
  store: { id: string; name: string };
  assets: {
    cash_bank_cents: number;
    cash_shopify_cents: number;
    shopify_payout_cents: number;
    inventory_cents: number;
    loans_receivable_cents: number;
    total_cents: number;
  };
  liabilities: {
    fulfillment_owed_cents: number;
    ad_spend_pending_cents: number;
    fb_pending_balance_cents: number;
    app_invoices_due_cents: number;
    loans_payable_cents: number;
    total_cents: number;
  };
  equity_cents: number;
  details: {
    fulfillment: { billed_cents: number; estimated_cents: number; estimated_order_count: number; paid_cents: number; total_owed_cents: number; balance_cents: number };
    adSpend: { total_invoiced_cents: number; total_paid_cents: number; balance_due_cents: number; fb_pending_balance_cents: number; platforms?: Record<string, { charged: number; paid: number; balance: number }> };
    appInvoices: { total_charged_cents: number; total_paid_cents: number; balance_due_cents: number; last_invoice: { bill_number: string; date: string; total_cents: number; source: string } | null };
    inventory: { asset_value_cents: number; cost_basis_cents: number };
    loans: { borrowed_total_cents: number; borrowed_remaining_cents: number; lent_total_cents: number; lent_remaining_cents: number };
    bankAccounts: { id: string; institution_name: string; account_name: string; last_four: string; balance_available_cents: number; balance_ledger_cents: number; balance_updated_at: string | null }[];
    shopify_balance_cents: number;
    shopify_payout_cents: number;
  };
}

function CFOContent() {
  const searchParams = useSearchParams();
  const storeId = searchParams.get('storeId') || '';

  const [data, setData] = useState<CFOData | null>(null);
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [editingShopify, setEditingShopify] = useState(false);
  const [shopifyInput, setShopifyInput] = useState('');
  const [savingShopify, setSavingShopify] = useState(false);
  const [editingPayout, setEditingPayout] = useState(false);
  const [payoutInput, setPayoutInput] = useState('');
  const [savingPayout, setSavingPayout] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [snapshotSaved, setSnapshotSaved] = useState('');
  const [snapshots, setSnapshots] = useState<{ id: string; snapshot_date: string; assets_cents: number; liabilities_cents: number; equity_cents: number; created_at: string }[]>([]);

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => setStores(d.stores || []));
  }, []);

  useEffect(() => {
    if (storeId) loadData();
    else { setData(null); setLoading(false); }
  }, [storeId]);

  async function loadData() {
    setLoading(true);
    const res = await fetch(`/api/cfo?storeId=${storeId}`);
    const d = await res.json();
    setData(d);
    setShopifyInput(d.details?.shopify_balance_cents ? String(d.details.shopify_balance_cents / 100) : '');
    setPayoutInput(d.details?.shopify_payout_cents ? String(d.details.shopify_payout_cents / 100) : '');
    setSnapshots(d.snapshots || []);
    setLoading(false);
  }

  async function saveShopifyBalance() {
    setSavingShopify(true);
    await fetch('/api/cfo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, shopifyBalanceCents: Math.round(parseFloat(shopifyInput || '0') * 100) }),
    });
    setEditingShopify(false);
    setSavingShopify(false);
    loadData();
  }

  async function saveShopifyPayout() {
    setSavingPayout(true);
    await fetch('/api/cfo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, shopifyPayoutCents: Math.round(parseFloat(payoutInput || '0') * 100) }),
    });
    setEditingPayout(false);
    setSavingPayout(false);
    loadData();
  }

  async function saveSnapshot() {
    if (!data) return;
    setSavingSnapshot(true);
    setSnapshotSaved('');
    const res = await fetch('/api/cfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId,
        assets_cents: data.assets.total_cents,
        liabilities_cents: data.liabilities.total_cents,
        equity_cents: data.equity_cents,
        data: { assets: data.assets, liabilities: data.liabilities, details: data.details },
      }),
    });
    const result = await res.json();
    setSavingSnapshot(false);
    if (result.success) {
      setSnapshotSaved(result.date);
      loadData();
    }
  }

  const selectedStore = stores.find(s => s.id === storeId);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">CFO Dashboard</h1>
            <p className="text-sm text-slate-400 mt-1">
              {selectedStore ? `${selectedStore.name} — Balance Sheet` : 'Select a store'}
            </p>
          </div>
          <StoreSelector />
        </div>
        {data && (
          <div className="flex items-center gap-3">
            {snapshotSaved && (
              <span className="text-xs text-emerald-400">Saved {snapshotSaved}</span>
            )}
            <button
              onClick={saveSnapshot}
              disabled={savingSnapshot}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              {savingSnapshot ? 'Saving...' : 'Save Snapshot'}
            </button>
          </div>
        )}
      </div>

      {!storeId ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
          <p className="text-slate-400">Select a store to view the balance sheet</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" />
        </div>
      ) : data ? (
        <>
          {/* Top-Level Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-slate-900 border border-emerald-900/50 rounded-xl p-5">
              <p className="text-xs text-emerald-500 uppercase tracking-wider mb-2">Total Assets</p>
              <p className="text-2xl font-bold text-emerald-400">{cents(data.assets.total_cents)}</p>
            </div>
            <div className="bg-slate-900 border border-red-900/50 rounded-xl p-5">
              <p className="text-xs text-red-500 uppercase tracking-wider mb-2">Total Liabilities</p>
              <p className="text-2xl font-bold text-red-400">{cents(data.liabilities.total_cents)}</p>
            </div>
            <div className={`bg-slate-900 border rounded-xl p-5 ${data.equity_cents >= 0 ? 'border-blue-900/50' : 'border-orange-900/50'}`}>
              <p className="text-xs text-blue-500 uppercase tracking-wider mb-2">Net Equity</p>
              <p className={`text-2xl font-bold ${data.equity_cents >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>{cents(data.equity_cents)}</p>
            </div>
          </div>

          {/* ASSETS SECTION */}
          <div className="mb-8">
            <h2 className="text-lg font-bold text-emerald-400 mb-4 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500" />
              Assets
            </h2>
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="text-left px-5 py-3">Account</th>
                    <th className="text-left px-5 py-3">Details</th>
                    <th className="text-right px-5 py-3">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Bank Accounts */}
                  {data.details.bankAccounts.map(acc => (
                    <tr key={acc.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-white font-medium">{acc.institution_name}</td>
                      <td className="px-5 py-3 text-slate-400 text-xs">
                        {acc.account_name} ****{acc.last_four}
                        <span className="text-slate-600 ml-2">Updated {timeAgo(acc.balance_updated_at)}</span>
                      </td>
                      <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(acc.balance_available_cents)}</td>
                    </tr>
                  ))}
                  {data.details.bankAccounts.length === 0 && (
                    <tr className="border-b border-slate-800/50">
                      <td className="px-5 py-3 text-white font-medium">Bank Accounts</td>
                      <td className="px-5 py-3 text-slate-500 text-xs">No bank accounts connected</td>
                      <td className="px-5 py-3 text-right text-slate-500">$0.00</td>
                    </tr>
                  )}

                  {/* Shopify Balance */}
                  <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-medium">Shopify Balance</td>
                    <td className="px-5 py-3">
                      {editingShopify ? (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 text-xs">$</span>
                          <input type="number" step="0.01" value={shopifyInput}
                            onChange={e => setShopifyInput(e.target.value)}
                            className="w-32 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                          <button onClick={saveShopifyBalance} disabled={savingShopify}
                            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] rounded">Save</button>
                          <button onClick={() => setEditingShopify(false)} className="text-[10px] text-slate-500">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setEditingShopify(true)} className="text-xs text-blue-400 hover:text-blue-300">
                          Manual Input — Click to update
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(data.assets.cash_shopify_cents)}</td>
                  </tr>

                  {/* Shopify Payout */}
                  <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-medium">Shopify Payout</td>
                    <td className="px-5 py-3">
                      {editingPayout ? (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 text-xs">$</span>
                          <input type="number" step="0.01" value={payoutInput}
                            onChange={e => setPayoutInput(e.target.value)}
                            className="w-32 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                          <button onClick={saveShopifyPayout} disabled={savingPayout}
                            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] rounded">Save</button>
                          <button onClick={() => setEditingPayout(false)} className="text-[10px] text-slate-500">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setEditingPayout(true)} className="text-xs text-blue-400 hover:text-blue-300">
                          Manual Input — Click to update
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(data.assets.shopify_payout_cents)}</td>
                  </tr>

                  {/* Inventory */}
                  <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-medium">Inventory</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      Unsold inventory at cost (cost basis: {cents(data.details.inventory.cost_basis_cents)})
                    </td>
                    <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(data.assets.inventory_cents)}</td>
                  </tr>

                  {/* Loans Receivable */}
                  {data.assets.loans_receivable_cents > 0 && (
                    <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-white font-medium">Loans Receivable</td>
                      <td className="px-5 py-3 text-slate-400 text-xs">
                        Money lent out (total: {cents(data.details.loans.lent_total_cents)})
                      </td>
                      <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(data.assets.loans_receivable_cents)}</td>
                    </tr>
                  )}

                  {/* Total */}
                  <tr className="bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-bold" colSpan={2}>Total Assets</td>
                    <td className="px-5 py-3 text-right text-emerald-400 font-bold text-base">{cents(data.assets.total_cents)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* LIABILITIES SECTION */}
          <div className="mb-8">
            <h2 className="text-lg font-bold text-red-400 mb-4 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500" />
              Liabilities
            </h2>
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="text-left px-5 py-3">Account</th>
                    <th className="text-left px-5 py-3">Details</th>
                    <th className="text-right px-5 py-3">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Fulfillment / COGS */}
                  <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-medium">Fulfillment (ShipSourced)</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      Balance: {cents(data.details.fulfillment.balance_cents)} · Est ({data.details.fulfillment.estimated_order_count} unfulfilled): {cents(data.details.fulfillment.estimated_cents)}
                    </td>
                    <td className="px-5 py-3 text-right text-red-400 font-medium">{cents(data.liabilities.fulfillment_owed_cents)}</td>
                  </tr>

                  {/* Ad Invoices Balance Due - Per Platform */}
                  {data.details.adSpend.platforms && Object.entries(data.details.adSpend.platforms).map(([platform, info]: [string, any]) => (
                    <tr key={platform} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-white font-medium flex items-center gap-2">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          platform === 'facebook' ? 'bg-blue-900/50 text-blue-400' : 'bg-green-900/50 text-green-400'
                        }`}>{platform === 'facebook' ? 'FB' : 'Google'}</span>
                        Ad Invoices
                      </td>
                      <td className="px-5 py-3 text-slate-400 text-xs">
                        Charged: {cents(info.charged)} — Paid: {cents(info.paid)}
                      </td>
                      <td className="px-5 py-3 text-right text-red-400 font-medium">{cents(Math.max(0, info.balance))}</td>
                    </tr>
                  ))}
                  {(!data.details.adSpend.platforms || Object.keys(data.details.adSpend.platforms).length === 0) && (
                  <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-medium">Ad Invoices (Balance Due)</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      Invoiced: {cents(data.details.adSpend.total_invoiced_cents)} - Paid: {cents(data.details.adSpend.total_paid_cents)}
                    </td>
                    <td className="px-5 py-3 text-right text-red-400 font-medium">{cents(data.liabilities.ad_spend_pending_cents)}</td>
                  </tr>
                  )}

                  {/* FB Pending (Unbilled) */}
                  {data.liabilities.fb_pending_balance_cents > 0 && (
                    <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-white font-medium">FB Pending (Unbilled)</td>
                      <td className="px-5 py-3 text-slate-400 text-xs">
                        Spend not yet charged to card — live from Facebook API
                      </td>
                      <td className="px-5 py-3 text-right text-orange-400 font-medium">{cents(data.liabilities.fb_pending_balance_cents)}</td>
                    </tr>
                  )}

                  {/* App Invoices */}
                  <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-medium">App Invoices (Balance Due)</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      Charged: {cents(data.details.appInvoices.total_charged_cents)} - Paid: {cents(data.details.appInvoices.total_paid_cents)}
                      {data.details.appInvoices.last_invoice && (
                        <span className="ml-2 text-slate-600">
                          Last: #{data.details.appInvoices.last_invoice.bill_number} on {data.details.appInvoices.last_invoice.date} ({cents(data.details.appInvoices.last_invoice.total_cents)})
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-red-400 font-medium">{cents(data.liabilities.app_invoices_due_cents)}</td>
                  </tr>

                  {/* Loans Payable */}
                  {data.liabilities.loans_payable_cents > 0 && (
                    <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-white font-medium">Loans Payable</td>
                      <td className="px-5 py-3 text-slate-400 text-xs">
                        Borrowed: {cents(data.details.loans.borrowed_total_cents)} — Remaining
                      </td>
                      <td className="px-5 py-3 text-right text-red-400 font-medium">{cents(data.liabilities.loans_payable_cents)}</td>
                    </tr>
                  )}

                  {/* Total */}
                  <tr className="bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-bold" colSpan={2}>Total Liabilities</td>
                    <td className="px-5 py-3 text-right text-red-400 font-bold text-base">{cents(data.liabilities.total_cents)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* EQUITY */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Net Equity (Assets - Liabilities)</h2>
                <p className="text-xs text-slate-400 mt-1">
                  {cents(data.assets.total_cents)} - {cents(data.liabilities.total_cents)}
                </p>
              </div>
              <p className={`text-3xl font-bold ${data.equity_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {cents(data.equity_cents)}
              </p>
            </div>
          </div>

          {/* SNAPSHOT HISTORY */}
          {snapshots.length > 0 && (
            <div className="mt-8 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-white">Saved Snapshots</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                      <th className="text-left px-5 py-3">Date</th>
                      <th className="text-right px-5 py-3">Assets</th>
                      <th className="text-right px-5 py-3">Liabilities</th>
                      <th className="text-right px-5 py-3">Equity</th>
                      <th className="text-right px-5 py-3">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((snap, i) => {
                      const prev = snapshots[i + 1];
                      const change = prev ? snap.equity_cents - prev.equity_cents : 0;
                      return (
                        <tr key={snap.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="px-5 py-3 text-slate-300">{snap.snapshot_date}
                            <span className="text-[10px] text-slate-600 ml-2">{snap.created_at?.slice(11, 16)}</span>
                          </td>
                          <td className="px-5 py-3 text-right text-emerald-400">{cents(snap.assets_cents)}</td>
                          <td className="px-5 py-3 text-right text-red-400">{cents(snap.liabilities_cents)}</td>
                          <td className={`px-5 py-3 text-right font-medium ${snap.equity_cents >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>{cents(snap.equity_cents)}</td>
                          <td className="px-5 py-3 text-right">
                            {prev ? (
                              <span className={`text-xs ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {change >= 0 ? '+' : ''}{cents(change)}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-600">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

export default function CFOPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    }>
      <CFOContent />
    </Suspense>
  );
}
