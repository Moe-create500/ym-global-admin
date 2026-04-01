'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Store {
  id: string;
  name: string;
  shipsourced_client_id: string | null;
  last_synced_at: string | null;
  mtd_revenue: number | null;
  mtd_profit: number | null;
  mtd_orders: number | null;
}

interface Totals {
  revenue_cents: number;
  cogs_cents: number;
  shipping_cents: number;
  ad_spend_cents: number;
  shopify_fees_cents: number;
  other_costs_cents: number;
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

function syncStatus(lastSynced: string | null): { color: string; label: string } {
  if (!lastSynced) return { color: 'bg-slate-600', label: 'Not synced' };
  const d = new Date(lastSynced + 'Z');
  const diffMs = Date.now() - d.getTime();
  const hours = diffMs / 3600000;
  if (hours < 1) return { color: 'bg-emerald-500', label: 'Synced' };
  if (hours < 6) return { color: 'bg-yellow-500', label: 'Stale' };
  return { color: 'bg-red-500', label: 'Outdated' };
}

export default function AmazonDashboard() {
  const [stores, setStores] = useState<Store[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'daily' | 'monthly' | 'yearly'>('monthly');

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

  useEffect(() => { loadData(); }, [range]);

  async function loadData() {
    setLoading(true);
    const from = getRangeFrom(range);
    const storesRange = range === 'daily' ? 'daily' : range === 'yearly' ? 'yearly' : 'monthly';

    const [storesRes, pnlRes] = await Promise.all([
      fetch(`/api/stores?range=${storesRange}&platform=amazon`),
      fetch(`/api/pnl?period=daily&from=${from}&platform=amazon`),
    ]);
    const storesData = await storesRes.json();
    const pnlData = await pnlRes.json();
    setStores(storesData.stores || []);
    setTotals(pnlData.totals || null);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-400" />
      </div>
    );
  }

  const kpis = [
    { label: 'Revenue', value: cents(totals?.revenue_cents || 0), color: 'text-white' },
    { label: 'Total Costs', value: cents((totals?.cogs_cents || 0) + (totals?.ad_spend_cents || 0) + (totals?.shopify_fees_cents || 0) + (totals?.other_costs_cents || 0)), color: 'text-orange-400' },
    { label: 'Net Profit', value: cents(totals?.net_profit_cents || 0), color: (totals?.net_profit_cents || 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Margin', value: pct(totals?.margin_pct || 0), color: (totals?.margin_pct || 0) >= 20 ? 'text-emerald-400' : (totals?.margin_pct || 0) >= 10 ? 'text-yellow-400' : 'text-red-400' },
    { label: 'Orders', value: (totals?.order_count || 0).toLocaleString(), color: 'text-orange-400' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Amazon Dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">All Amazon stores</p>
        </div>
        <div className="flex bg-slate-800 rounded-lg p-0.5">
          {(['daily', 'monthly', 'yearly'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                range === r ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {r === 'daily' ? 'Today' : r === 'monthly' ? 'MTD' : 'YTD'}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{kpi.label}</p>
            <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Store Cards */}
      <h2 className="text-lg font-semibold text-white mb-4">Amazon Stores</h2>
      {stores.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400 text-sm">No Amazon stores yet.</p>
          <p className="text-slate-500 text-xs mt-1">Amazon stores are created from the main admin dashboard.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stores.map((store) => {
            const status = syncStatus(store.last_synced_at);
            return (
              <Link key={store.id} href={`/amazon/stores/${store.id}`}
                className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-orange-800/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-white">{store.name}</h3>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${status.color}`} />
                    <span className="text-[10px] text-slate-500">{status.label}</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Revenue</p>
                    <p className="text-sm font-bold text-white">{cents(store.mtd_revenue || 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Profit</p>
                    <p className={`text-sm font-bold ${(store.mtd_profit || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {cents(store.mtd_profit || 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Orders</p>
                    <p className="text-sm font-bold text-orange-400">{store.mtd_orders || 0}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
