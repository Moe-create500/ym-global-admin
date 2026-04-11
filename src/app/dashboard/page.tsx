'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import StoreSelector from '@/components/StoreSelector';

interface Store {
  id: string;
  name: string;
  shopify_domain: string | null;
  shipsourced_client_id: string | null;
  last_synced_at: string | null;
  auto_sync: number;
  mtd_revenue: number | null;
  mtd_profit: number | null;
  mtd_orders: number | null;
  platform: string;
  fb_connected: number;
  chargeflow_connected: number;
  invoices_verified: number;
}

interface Alert {
  id: string;
  store_id: string;
  store_name: string;
  note: string;
  category: string;
}

interface Totals {
  revenue_cents: number;
  cogs_cents: number;
  shipping_cents: number;
  pick_pack_cents: number;
  packaging_cents: number;
  ad_spend_cents: number;
  shopify_fees_cents: number;
  other_costs_cents: number;
  net_profit_cents: number;
  order_count: number;
  margin_pct: number;
}

interface PnlRow {
  period: string;
  revenue_cents: number;
  net_profit_cents: number;
  order_count: number;
  margin_pct: number;
}

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr + 'Z');
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function syncStatus(lastSynced: string | null): { color: string; label: string } {
  if (!lastSynced) return { color: 'bg-slate-600', label: 'Not synced' };
  const d = new Date(lastSynced + 'Z');
  const diffMs = Date.now() - d.getTime();
  const hours = diffMs / 3600000;
  if (hours < 1) return { color: 'bg-emerald-500', label: 'Synced' };
  if (hours < 6) return { color: 'bg-yellow-500', label: 'Stale' };
  return { color: 'bg-red-500', label: 'Outdated' };
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const storeId = searchParams.get('storeId') || '';

  const [stores, setStores] = useState<Store[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [rows, setRows] = useState<PnlRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoSynced, setAutoSynced] = useState(false);
  const [range, setRange] = useState<'daily' | 'monthly' | 'yearly'>('daily');
  const [platformFilter, setPlatformFilter] = useState<'all' | 'shopify' | 'amazon' | 'ebay'>('all');

  function getRangeFrom(r: string): string {
    const now = new Date();
    const pacific = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const pad = (n: number) => String(n).padStart(2, '0');
    const y = pacific.getFullYear();
    const m = pad(pacific.getMonth() + 1);
    const d = pad(pacific.getDate());
    if (r === 'daily') return `${y}-${m}-${d}`;
    if (r === 'yearly') return `${y}-01-01`;
    return `${y}-${m}-01`;
  }

  const rangeLabel = range === 'daily' ? 'Today' : range === 'monthly' ? 'MTD' : 'YTD';

  useEffect(() => {
    loadData();
    // Auto-sync stale stores on load (once)
    if (!autoSynced) {
      fetch('/api/sync/auto', { method: 'POST' })
        .then(r => r.json())
        .then(data => {
          if (data.synced) {
            setSyncResult(`Auto-synced ${data.recordsSynced} records from ${data.staleStores} store(s)`);
            loadData();
          }
          setAutoSynced(true);
        })
        .catch(() => setAutoSynced(true));
    }
  }, [storeId, range]);

  async function loadData() {
    setLoading(true);
    const from = getRangeFrom(range);
    const pnlParams = new URLSearchParams({ period: 'daily', from });
    if (storeId) pnlParams.set('storeId', storeId);

    const storesRange = range === 'daily' ? 'daily' : range === 'yearly' ? 'yearly' : 'monthly';

    const [storesRes, pnlRes] = await Promise.all([
      fetch(`/api/stores?range=${storesRange}`),
      fetch(`/api/pnl?${pnlParams}`),
    ]);
    const storesData = await storesRes.json();
    const pnlData = await pnlRes.json();
    setStores(storesData.stores || []);
    setAlerts(storesData.alerts || []);
    setTotals(pnlData.totals || null);
    setRows((pnlData.rows || []).slice(0, 30));
    setLoading(false);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    const url = storeId ? `/api/sync/shipsourced?storeId=${storeId}` : '/api/sync/shipsourced';
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();
    if (data.success || data.synced > 0) {
      setSyncResult(`Synced ${data.synced} records${data.storesProcessed ? ` from ${data.storesProcessed} stores` : ''}`);
      loadData();
    } else {
      setSyncResult(data.message || data.error || 'Sync completed');
    }
    setSyncing(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }

  const visibleStores = stores.filter(s => !(s as any).dashboard_hidden);
  const displayStores = storeId ? stores.filter(s => s.id === storeId) : visibleStores;

  const kpis = [
    { label: 'Revenue', value: cents(totals?.revenue_cents || 0), color: 'text-white' },
    { label: 'Total Costs', value: cents((totals?.cogs_cents || 0) + (totals?.ad_spend_cents || 0) + (totals?.shopify_fees_cents || 0) + (totals?.other_costs_cents || 0)), color: 'text-orange-400' },
    { label: 'Net Profit', value: cents(totals?.net_profit_cents || 0), color: (totals?.net_profit_cents || 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Margin', value: pct(totals?.margin_pct || 0), color: (totals?.margin_pct || 0) >= 20 ? 'text-emerald-400' : (totals?.margin_pct || 0) >= 10 ? 'text-yellow-400' : 'text-red-400' },
    { label: 'Orders', value: (totals?.order_count || 0).toLocaleString(), color: 'text-blue-400' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="text-sm text-slate-400 mt-1">
              {storeId ? displayStores[0]?.name || 'Store' : 'All stores'}
            </p>
          </div>
          <StoreSelector />
        </div>
        <div className="flex items-center gap-3">
        <div className="flex bg-slate-800 rounded-lg p-0.5">
          {(['daily', 'monthly', 'yearly'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                range === r
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {r === 'daily' ? 'Today' : r === 'monthly' ? 'MTD' : 'YTD'}
            </button>
          ))}
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          {syncing ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          Sync Now
        </button>
        </div>
      </div>

      {syncResult && (
        <div className="mb-4 px-4 py-3 bg-blue-900/30 border border-blue-800 rounded-lg text-sm text-blue-300">
          {syncResult}
        </div>
      )}

      {/* Action Required Alerts — only show alerts not tied to a specific store */}
      {alerts.filter(a => !stores.find(s => s.id === a.store_id)).length > 0 && (
        <div className="mb-6 space-y-2">
          {alerts.filter(a => !stores.find(s => s.id === a.store_id)).map((alert) => (
            <div key={alert.id} className="flex items-start gap-3 px-4 py-3 bg-amber-900/20 border border-amber-800/50 rounded-lg">
              <span className="text-amber-400 mt-0.5 text-sm">!</span>
              <div className="flex-1">
                <span className="text-sm font-medium text-amber-300">{alert.store_name}:</span>
                <span className="text-sm text-amber-200/80 ml-1.5">{alert.note}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{kpi.label}</p>
            <p className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Cost Breakdown */}
      {totals && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-8">
          <h2 className="text-sm font-semibold text-white mb-4">Cost Breakdown</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[
              { label: 'Fulfillment', value: totals.cogs_cents },
              { label: 'Ad Spend', value: totals.ad_spend_cents },
              { label: 'Platform Fees', value: totals.shopify_fees_cents },
              { label: 'Other Costs', value: totals.other_costs_cents },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-xs text-slate-500 mb-0.5">{item.label}</p>
                <p className="text-sm font-semibold text-slate-300">{cents(item.value || 0)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-Store Summary */}
      {!storeId && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-white">Stores ({rangeLabel})</h2>
              <div className="flex bg-slate-800 rounded-lg p-0.5">
                {(['all', 'shopify', 'amazon', 'ebay'] as const).map((p) => {
                  const count = p === 'all' ? visibleStores.length : visibleStores.filter(s => s.platform === p).length;
                  if (p !== 'all' && count === 0) return null;
                  const labels: Record<string, string> = { all: 'All', shopify: 'Shopify', amazon: 'Amazon', ebay: 'eBay' };
                  return (
                    <button
                      key={p}
                      onClick={() => setPlatformFilter(p)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                        platformFilter === p
                          ? p === 'amazon' ? 'bg-orange-600 text-white'
                          : p === 'ebay' ? 'bg-yellow-600 text-white'
                          : 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {labels[p]} ({count})
                    </button>
                  );
                })}
              </div>
            </div>
            <Link href="/dashboard/stores" className="text-xs text-blue-400 hover:text-blue-300">
              View All →
            </Link>
          </div>
          {visibleStores.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-slate-400 mb-3">No stores configured yet</p>
              <Link href="/dashboard/stores" className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
                Add Store
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleStores.filter(s => platformFilter === 'all' || s.platform === platformFilter).map((store) => {
                const margin = (store.mtd_revenue || 0) > 0
                  ? ((store.mtd_profit || 0) / (store.mtd_revenue || 1)) * 100
                  : 0;
                const sync = syncStatus(store.last_synced_at);
                return (
                  <Link
                    key={store.id}
                    href={`/dashboard/stores/${store.id}`}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-white">{store.name}</h3>
                        {store.platform !== 'shopify' && (
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                            store.platform === 'amazon' ? 'bg-orange-900/50 text-orange-400' : 'bg-yellow-900/50 text-yellow-400'
                          }`}>
                            {store.platform}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {store.shipsourced_client_id && (
                          <div className="flex items-center gap-1.5">
                            <div className={`w-2 h-2 rounded-full ${sync.color}`} />
                            <span className="text-[10px] text-slate-500">{timeAgo(store.last_synced_at)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase">Revenue</p>
                        <p className="text-sm font-semibold text-white">{cents(store.mtd_revenue || 0)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase">Profit</p>
                        <p className={`text-sm font-semibold ${(store.mtd_profit || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {cents(store.mtd_profit || 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase">Margin</p>
                        <p className={`text-sm font-semibold ${margin >= 20 ? 'text-emerald-400' : margin >= 10 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {pct(margin)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 text-[10px] text-slate-500">
                      {(store.mtd_orders || 0).toLocaleString()} orders {range === 'daily' ? 'today' : range === 'monthly' ? 'this month' : 'this year'}
                    </div>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded ${
                        store.fb_connected ? 'bg-emerald-900/40 text-emerald-400' : 'bg-slate-800 text-slate-500'
                      }`}>
                        {store.fb_connected ? '✓' : '✗'} FB
                      </span>
                      <span className={`inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded ${
                        store.chargeflow_connected ? 'bg-emerald-900/40 text-emerald-400' : 'bg-slate-800 text-slate-500'
                      }`}>
                        {store.chargeflow_connected ? '✓' : '✗'} Chargeflow
                      </span>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          fetch('/api/stores', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ storeId: store.id, invoices_verified: !store.invoices_verified }),
                          }).then(() => loadData());
                        }}
                        className={`inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded transition-colors ${
                          store.invoices_verified ? 'bg-emerald-900/40 text-emerald-400' : 'bg-slate-800 text-slate-500 hover:bg-slate-700'
                        }`}
                      >
                        {store.invoices_verified ? '✓' : '✗'} Invoices
                      </button>
                    </div>
                    {alerts.filter(a => a.store_id === store.id).map((alert) => (
                      <div key={alert.id} className="mt-2 px-2 py-1.5 bg-amber-900/20 border border-amber-800/40 rounded text-[10px] text-amber-300/80 leading-tight">
                        {alert.note}
                      </div>
                    ))}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Recent Daily P&L */}
      {rows.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-white">Last 30 Days</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                  <th className="text-left px-5 py-3">Date</th>
                  <th className="text-right px-5 py-3">Revenue</th>
                  <th className="text-right px-5 py-3">Profit</th>
                  <th className="text-right px-5 py-3">Margin</th>
                  <th className="text-right px-5 py-3">Orders</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.period} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-slate-300">{row.period}</td>
                    <td className="px-5 py-3 text-right text-white font-medium">{cents(row.revenue_cents || 0)}</td>
                    <td className={`px-5 py-3 text-right font-medium ${(row.net_profit_cents || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {cents(row.net_profit_cents || 0)}
                    </td>
                    <td className={`px-5 py-3 text-right ${(row.margin_pct || 0) >= 20 ? 'text-emerald-400' : (row.margin_pct || 0) >= 10 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {pct(row.margin_pct || 0)}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-400">{(row.order_count || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
