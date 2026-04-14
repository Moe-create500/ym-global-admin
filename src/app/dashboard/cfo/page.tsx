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
    reserves_cents: number;
    inventory_cents: number;
    loans_receivable_cents: number;
    total_cents: number;
  };
  liabilities: {
    fulfillment_owed_cents: number;
    fulfillment_estimated_cents: number;
    ad_spend_pending_cents: number;
    fb_pending_balance_cents: number;
    app_invoices_due_cents: number;
    loans_payable_cents: number;
    manual_cc_cents: number;
    total_cents: number;
  };
  equity_cents: number;
  details: {
    fulfillment: { billed_cents: number; estimated_cents: number; estimated_order_count: number; total_unfulfilled: number; unfulfilled_with_estimate: number; paid_cents: number; total_owed_cents: number; balance_cents: number };
    adSpend: { total_invoiced_cents: number; total_paid_cents: number; balance_due_cents: number; fb_pending_balance_cents: number; platforms?: Record<string, { charged: number; paid: number; balance: number }> };
    appInvoices: { total_charged_cents: number; total_paid_cents: number; balance_due_cents: number; last_invoice: { bill_number: string; date: string; total_cents: number; source: string } | null };
    inventory: { asset_value_cents: number; cost_basis_cents: number };
    loans: { borrowed_total_cents: number; borrowed_remaining_cents: number; lent_total_cents: number; lent_remaining_cents: number };
    bankAccounts: { id: string; institution_name: string; account_name: string; last_four: string; balance_available_cents: number; balance_ledger_cents: number; balance_updated_at: string | null }[];
    shopify_balance_cents: number;
    shopify_payout_cents: number;
    reserves: { id: string; amount_cents: number; held_at: string }[];
    manualCreditCards: { id: string; card_name: string; amount_owed_cents: number }[];
  };
}

interface OverviewStore {
  store_id: string;
  store_name: string;
  has_snapshot: boolean;
  snapshot_date: string | null;
  assets_cents: number;
  liabilities_cents: number;
  equity_cents: number;
  created_at: string | null;
  equity_change_cents: number | null;
}

interface OverviewTotals {
  total_assets_cents: number;
  total_liabilities_cents: number;
  total_equity_cents: number;
  store_count: number;
}

function CFOContent() {
  const searchParams = useSearchParams();
  const storeId = searchParams.get('storeId') || '';

  const [tab, setTab] = useState<'overview' | 'store'>(storeId ? 'store' : 'overview');
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
  const [addingReserve, setAddingReserve] = useState(false);
  const [reserveAmountInput, setReserveAmountInput] = useState('');
  const [reserveHeldAtInput, setReserveHeldAtInput] = useState('');
  const [editingReserveId, setEditingReserveId] = useState<string | null>(null);
  const [savingReserve, setSavingReserve] = useState(false);
  const [addingCC, setAddingCC] = useState(false);
  const [ccNameInput, setCcNameInput] = useState('');
  const [ccAmountInput, setCcAmountInput] = useState('');
  const [editingCCId, setEditingCCId] = useState<string | null>(null);
  const [savingCC, setSavingCC] = useState(false);

  // Overview state
  const [overviewStores, setOverviewStores] = useState<OverviewStore[]>([]);
  const [overviewTotals, setOverviewTotals] = useState<OverviewTotals | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => setStores(d.stores || []));
  }, []);

  useEffect(() => {
    if (storeId) { setTab('store'); }
  }, [storeId]);

  useEffect(() => {
    if (tab === 'overview') loadOverview();
    else if (storeId) loadData();
    else { setData(null); setLoading(false); }
  }, [tab, storeId]);

  async function loadOverview() {
    setOverviewLoading(true);
    const res = await fetch('/api/cfo/overview');
    const d = await res.json();
    setOverviewStores(d.stores || []);
    setOverviewTotals(d.totals || null);
    setOverviewLoading(false);
  }

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

  async function saveReserve(existingId?: string) {
    setSavingReserve(true);
    await fetch('/api/cfo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId,
        reserve: {
          id: existingId || undefined,
          amount_cents: Math.round(parseFloat(reserveAmountInput || '0') * 100),
          held_at: reserveHeldAtInput.trim(),
        },
      }),
    });
    setAddingReserve(false);
    setEditingReserveId(null);
    setReserveAmountInput('');
    setReserveHeldAtInput('');
    setSavingReserve(false);
    loadData();
  }

  async function deleteReserve(id: string) {
    await fetch('/api/cfo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, deleteReserveId: id }),
    });
    loadData();
  }

  async function saveManualCC(existingId?: string) {
    setSavingCC(true);
    await fetch('/api/cfo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId,
        manualCC: {
          id: existingId || undefined,
          card_name: ccNameInput.trim(),
          amount_owed_cents: Math.round(parseFloat(ccAmountInput || '0') * 100),
        },
      }),
    });
    setAddingCC(false);
    setEditingCCId(null);
    setCcNameInput('');
    setCcAmountInput('');
    setSavingCC(false);
    loadData();
  }

  async function deleteManualCC(id: string) {
    await fetch('/api/cfo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, deleteManualCCId: id }),
    });
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
              {tab === 'overview' ? 'All Stores Overview' : selectedStore ? `${selectedStore.name} — Balance Sheet` : 'Select a store'}
            </p>
          </div>
          {tab === 'store' && <StoreSelector />}
        </div>
        {tab === 'store' && data && (
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

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-900 border border-slate-800 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('overview')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'overview' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          OVERVIEW CFO&apos;S
        </button>
        <button
          onClick={() => setTab('store')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'store' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          Store Detail
        </button>
      </div>

      {/* OVERVIEW TAB */}
      {tab === 'overview' ? (
        overviewLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" />
          </div>
        ) : (
          <>
            {/* Overview KPIs */}
            {overviewTotals && overviewTotals.store_count > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Stores with Snapshots</p>
                  <p className="text-2xl font-bold text-white">{overviewTotals.store_count}</p>
                </div>
                <div className="bg-slate-900 border border-emerald-900/50 rounded-xl p-5">
                  <p className="text-xs text-emerald-500 uppercase tracking-wider mb-2">Total Assets</p>
                  <p className="text-2xl font-bold text-emerald-400">{cents(overviewTotals.total_assets_cents)}</p>
                </div>
                <div className="bg-slate-900 border border-red-900/50 rounded-xl p-5">
                  <p className="text-xs text-red-500 uppercase tracking-wider mb-2">Total Liabilities</p>
                  <p className="text-2xl font-bold text-red-400">{cents(overviewTotals.total_liabilities_cents)}</p>
                </div>
                <div className={`bg-slate-900 border rounded-xl p-5 ${overviewTotals.total_equity_cents >= 0 ? 'border-blue-900/50' : 'border-orange-900/50'}`}>
                  <p className="text-xs text-blue-500 uppercase tracking-wider mb-2">Combined Equity</p>
                  <p className={`text-2xl font-bold ${overviewTotals.total_equity_cents >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
                    {cents(overviewTotals.total_equity_cents)}
                  </p>
                </div>
              </div>
            )}

            {/* All Stores Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-white">All Stores — Most Recent Snapshot</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                      <th className="text-left px-5 py-3">Store</th>
                      <th className="text-left px-5 py-3">Snapshot Date</th>
                      <th className="text-right px-5 py-3">Assets</th>
                      <th className="text-right px-5 py-3">Liabilities</th>
                      <th className="text-right px-5 py-3">Equity</th>
                      <th className="text-right px-5 py-3">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewStores.filter(s => s.has_snapshot).map(s => (
                      <tr key={s.store_id} className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer"
                        onClick={() => {
                          const url = new URL(window.location.href);
                          url.searchParams.set('storeId', s.store_id);
                          window.history.pushState({}, '', url.toString());
                          setTab('store');
                          window.dispatchEvent(new PopStateEvent('popstate'));
                          window.location.href = `/dashboard/cfo?storeId=${s.store_id}`;
                        }}
                      >
                        <td className="px-5 py-3 text-white font-medium">{s.store_name}</td>
                        <td className="px-5 py-3 text-slate-400 text-xs">
                          {s.snapshot_date}
                          {s.created_at && <span className="text-slate-600 ml-2">{s.created_at.slice(11, 16)}</span>}
                        </td>
                        <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(s.assets_cents)}</td>
                        <td className="px-5 py-3 text-right text-red-400 font-medium">{cents(s.liabilities_cents)}</td>
                        <td className={`px-5 py-3 text-right font-bold ${s.equity_cents >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
                          {cents(s.equity_cents)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {s.equity_change_cents !== null ? (
                            <span className={`text-xs font-medium ${s.equity_change_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {s.equity_change_cents >= 0 ? '+' : ''}{cents(s.equity_change_cents)}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {overviewStores.filter(s => !s.has_snapshot).length > 0 && (
                      <>
                        <tr>
                          <td colSpan={6} className="px-5 py-2 text-[10px] text-slate-600 uppercase tracking-wider bg-slate-800/20">No Snapshot Yet</td>
                        </tr>
                        {overviewStores.filter(s => !s.has_snapshot).map(s => (
                          <tr key={s.store_id} className="border-b border-slate-800/50">
                            <td className="px-5 py-3 text-slate-500">{s.store_name}</td>
                            <td className="px-5 py-3 text-slate-600 text-xs">—</td>
                            <td className="px-5 py-3 text-right text-slate-600">—</td>
                            <td className="px-5 py-3 text-right text-slate-600">—</td>
                            <td className="px-5 py-3 text-right text-slate-600">—</td>
                            <td className="px-5 py-3 text-right text-slate-600">—</td>
                          </tr>
                        ))}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      ) : !storeId ? (
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
                      <td className={`px-5 py-3 text-right font-medium ${acc.balance_available_cents < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{cents(acc.balance_available_cents)}</td>
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

                  {/* Reserves */}
                  {(data.details.reserves || []).map(r => (
                    editingReserveId === r.id ? (
                      <tr key={r.id} className="border-b border-slate-800/50 bg-slate-800/20">
                        <td className="px-5 py-3 text-white font-medium">Reserve</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <input type="text" placeholder="Held at (e.g. PayPal)" value={reserveHeldAtInput}
                              onChange={e => setReserveHeldAtInput(e.target.value)}
                              className="w-40 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                            <span className="text-slate-400 text-xs">$</span>
                            <input type="number" step="0.01" placeholder="Amount" value={reserveAmountInput}
                              onChange={e => setReserveAmountInput(e.target.value)}
                              className="w-28 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                            <button onClick={() => saveReserve(r.id)} disabled={savingReserve}
                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] rounded">Save</button>
                            <button onClick={() => { setEditingReserveId(null); setReserveAmountInput(''); setReserveHeldAtInput(''); }}
                              className="text-[10px] text-slate-500">Cancel</button>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(r.amount_cents)}</td>
                      </tr>
                    ) : (
                      <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                        <td className="px-5 py-3 text-white font-medium">Reserve</td>
                        <td className="px-5 py-3 text-slate-400 text-xs flex items-center gap-2">
                          Held at: <span className="text-white font-medium">{r.held_at}</span>
                          <button onClick={() => { setEditingReserveId(r.id); setReserveAmountInput(String(r.amount_cents / 100)); setReserveHeldAtInput(r.held_at); }}
                            className="text-blue-400 hover:text-blue-300 ml-2">Edit</button>
                          <button onClick={() => deleteReserve(r.id)}
                            className="text-red-400 hover:text-red-300">Del</button>
                        </td>
                        <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(r.amount_cents)}</td>
                      </tr>
                    )
                  ))}
                  {/* Add Reserve */}
                  {addingReserve ? (
                    <tr className="border-b border-slate-800/50 bg-slate-800/20">
                      <td className="px-5 py-3 text-white font-medium">New Reserve</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <input type="text" placeholder="Held at (e.g. PayPal)" value={reserveHeldAtInput}
                            onChange={e => setReserveHeldAtInput(e.target.value)}
                            className="w-40 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                          <span className="text-slate-400 text-xs">$</span>
                          <input type="number" step="0.01" placeholder="Amount" value={reserveAmountInput}
                            onChange={e => setReserveAmountInput(e.target.value)}
                            className="w-28 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                          <button onClick={() => saveReserve()} disabled={savingReserve}
                            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] rounded">Save</button>
                          <button onClick={() => { setAddingReserve(false); setReserveAmountInput(''); setReserveHeldAtInput(''); }}
                            className="text-[10px] text-slate-500">Cancel</button>
                        </div>
                      </td>
                      <td className="px-5 py-3" />
                    </tr>
                  ) : (
                    <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3" colSpan={2}>
                        <button onClick={() => setAddingReserve(true)} className="text-xs text-blue-400 hover:text-blue-300">
                          + Add Reserve
                        </button>
                      </td>
                      <td className="px-5 py-3" />
                    </tr>
                  )}

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
                  {/* Current Unpaid Fulfillment Bill */}
                  <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-medium">Current Unpaid Fulfillment Bill</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      ShipSourced balance owed
                    </td>
                    <td className="px-5 py-3 text-right text-red-400 font-medium">{cents(data.details.fulfillment.balance_cents)}</td>
                  </tr>
                  {/* Unfulfilled Orders Estimated Bill */}
                  <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-medium">Unfulfilled Orders Est. Fulfillment Bill</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      {data.details.fulfillment.total_unfulfilled || data.details.fulfillment.estimated_order_count} unfulfilled orders
                      {data.details.fulfillment.total_unfulfilled > 0 && (
                        <span className="ml-2 text-slate-500">
                          ({Math.round((data.details.fulfillment.unfulfilled_with_estimate / data.details.fulfillment.total_unfulfilled) * 100)}% have estimated cost)
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-orange-400 font-medium">{cents(data.details.fulfillment.estimated_cents)}</td>
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

                  {/* Manual Credit Cards */}
                  {(data.details.manualCreditCards || []).map(cc => (
                    editingCCId === cc.id ? (
                    <tr key={cc.id} className="border-b border-slate-800/50">
                      <td className="px-5 py-3 text-white font-medium">Credit Card</td>
                      <td className="px-5 py-3">
                        <div className="flex gap-2 items-center">
                          <input type="text" placeholder="Card name (e.g. Amex Gold 1006)" value={ccNameInput}
                            onChange={e => setCcNameInput(e.target.value)}
                            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white w-48 focus:outline-none focus:border-red-500" />
                          <input type="number" step="0.01" placeholder="Amount owed" value={ccAmountInput}
                            onChange={e => setCcAmountInput(e.target.value)}
                            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white w-28 focus:outline-none focus:border-red-500" />
                          <button onClick={() => saveManualCC(cc.id)} disabled={savingCC}
                            className="text-xs text-emerald-400 hover:text-emerald-300">Save</button>
                          <button onClick={() => { setEditingCCId(null); setCcNameInput(''); setCcAmountInput(''); }}
                            className="text-xs text-slate-500 hover:text-slate-400">Cancel</button>
                        </div>
                      </td>
                      <td className="px-5 py-3" />
                    </tr>
                    ) : (
                    <tr key={cc.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-white font-medium">Credit Card</td>
                      <td className="px-5 py-3 text-slate-400 text-xs">
                        {cc.card_name}
                        <button onClick={() => { setEditingCCId(cc.id); setCcNameInput(cc.card_name); setCcAmountInput(String(cc.amount_owed_cents / 100)); }}
                          className="ml-2 text-blue-400 hover:text-blue-300">Edit</button>
                        <button onClick={() => deleteManualCC(cc.id)}
                          className="ml-2 text-red-400 hover:text-red-300">Delete</button>
                      </td>
                      <td className="px-5 py-3 text-right text-red-400 font-medium">{cents(cc.amount_owed_cents)}</td>
                    </tr>
                    )
                  ))}
                  {/* Add Credit Card */}
                  {addingCC ? (
                    <tr className="border-b border-slate-800/50">
                      <td className="px-5 py-3 text-white font-medium">New Credit Card</td>
                      <td className="px-5 py-3">
                        <div className="flex gap-2 items-center">
                          <input type="text" placeholder="Card name (e.g. Amex Gold 1006)" value={ccNameInput}
                            onChange={e => setCcNameInput(e.target.value)}
                            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white w-48 focus:outline-none focus:border-red-500" />
                          <input type="number" step="0.01" placeholder="Amount owed" value={ccAmountInput}
                            onChange={e => setCcAmountInput(e.target.value)}
                            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white w-28 focus:outline-none focus:border-red-500" />
                          <button onClick={() => saveManualCC()} disabled={savingCC}
                            className="text-xs text-emerald-400 hover:text-emerald-300">Save</button>
                          <button onClick={() => { setAddingCC(false); setCcNameInput(''); setCcAmountInput(''); }}
                            className="text-xs text-slate-500 hover:text-slate-400">Cancel</button>
                        </div>
                      </td>
                      <td className="px-5 py-3" />
                    </tr>
                  ) : (
                    <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3" colSpan={2}>
                        <button onClick={() => setAddingCC(true)} className="text-xs text-blue-400 hover:text-blue-300">
                          + Add Credit Card</button>
                      </td>
                      <td className="px-5 py-3" />
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
