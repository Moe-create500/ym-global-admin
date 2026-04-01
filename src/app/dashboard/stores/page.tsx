'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Store {
  id: string;
  name: string;
  shopify_domain: string | null;
  shipsourced_client_id: string | null;
  shipsourced_client_name: string | null;
  shopify_monthly_plan_cents: number;
  last_synced_at: string | null;
  auto_sync: number;
  mtd_revenue: number | null;
  mtd_profit: number | null;
  mtd_orders: number | null;
}

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr + 'Z');
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function syncDot(lastSynced: string | null): string {
  if (!lastSynced) return 'bg-slate-600';
  const hours = (Date.now() - new Date(lastSynced + 'Z').getTime()) / 3600000;
  if (hours < 1) return 'bg-emerald-500';
  if (hours < 6) return 'bg-yellow-500';
  return 'bg-red-500';
}

export default function StoresPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', shopifyDomain: '', shipsourcedClientId: '', shopifyMonthlyPlanCents: '' });
  const [saving, setSaving] = useState(false);
  const [syncingStore, setSyncingStore] = useState<string | null>(null);
  const [range, setRange] = useState<'daily' | 'monthly' | 'yearly'>('daily');

  useEffect(() => { loadStores(); }, [range]);

  async function loadStores() {
    setLoading(true);
    const res = await fetch(`/api/stores?range=${range}`);
    const data = await res.json();
    setStores(data.stores || []);
    setLoading(false);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        shopifyDomain: form.shopifyDomain || undefined,
        shipsourcedClientId: form.shipsourcedClientId || undefined,
        shopifyMonthlyPlanCents: form.shopifyMonthlyPlanCents ? parseInt(form.shopifyMonthlyPlanCents) * 100 : 0,
      }),
    });
    setForm({ name: '', shopifyDomain: '', shipsourcedClientId: '', shopifyMonthlyPlanCents: '' });
    setShowAdd(false);
    setSaving(false);
    loadStores();
  }

  async function handleSyncStore(storeId: string) {
    setSyncingStore(storeId);
    await fetch(`/api/sync/shipsourced?storeId=${storeId}`, { method: 'POST' });
    setSyncingStore(null);
    loadStores();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Stores</h1>
          <p className="text-sm text-slate-400 mt-1">{stores.length} active store{stores.length !== 1 ? 's' : ''}</p>
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
            onClick={() => setShowAdd(!showAdd)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {showAdd ? 'Cancel' : '+ Add Store'}
          </button>
        </div>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-white mb-4">New Store</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Store Name *</label>
              <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="e.g. My Shopify Store" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Shopify Domain</label>
              <input type="text" value={form.shopifyDomain} onChange={(e) => setForm({ ...form, shopifyDomain: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="mystore.myshopify.com" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">ShipSourced Client ID</label>
              <input type="text" value={form.shipsourcedClientId} onChange={(e) => setForm({ ...form, shipsourcedClientId: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="Client ID from ShipSourced" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Shopify Monthly Plan ($)</label>
              <input type="number" value={form.shopifyMonthlyPlanCents} onChange={(e) => setForm({ ...form, shopifyMonthlyPlanCents: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="79" />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {saving ? 'Saving...' : 'Create Store'}
            </button>
          </div>
        </form>
      )}

      {stores.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
          <p className="text-slate-400 mb-2">No stores yet</p>
          <p className="text-xs text-slate-500">Click "Add Store" to get started</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                <th className="text-left px-5 py-3">Store</th>
                <th className="text-right px-5 py-3">{range === 'daily' ? 'Today' : range === 'monthly' ? 'MTD' : 'YTD'} Revenue</th>
                <th className="text-right px-5 py-3">{range === 'daily' ? 'Today' : range === 'monthly' ? 'MTD' : 'YTD'} Profit</th>
                <th className="text-right px-5 py-3">{range === 'daily' ? 'Today' : range === 'monthly' ? 'MTD' : 'YTD'} Orders</th>
                <th className="text-center px-5 py-3">Sync Status</th>
                <th className="text-right px-5 py-3">Shopify Plan</th>
                <th className="text-center px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => (
                <tr key={store.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="px-5 py-3">
                    <Link href={`/dashboard/stores/${store.id}`} className="text-blue-400 hover:text-blue-300 font-medium">
                      {store.name}
                    </Link>
                    {store.shopify_domain && (
                      <p className="text-[10px] text-slate-500 mt-0.5">{store.shopify_domain}</p>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right text-white font-medium">{cents(store.mtd_revenue || 0)}</td>
                  <td className={`px-5 py-3 text-right font-medium ${(store.mtd_profit || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {cents(store.mtd_profit || 0)}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-400">{(store.mtd_orders || 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-center">
                    {store.shipsourced_client_id ? (
                      <div className="flex items-center justify-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${syncDot(store.last_synced_at)}`} />
                        <span className="text-[10px] text-slate-400">{timeAgo(store.last_synced_at)}</span>
                      </div>
                    ) : (
                      <span className="text-[10px] bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full">Not linked</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-400">
                    {store.shopify_monthly_plan_cents ? cents(store.shopify_monthly_plan_cents) : '—'}
                  </td>
                  <td className="px-5 py-3 text-center">
                    {store.shipsourced_client_id && (
                      <button
                        onClick={() => handleSyncStore(store.id)}
                        disabled={syncingStore === store.id}
                        className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
                      >
                        {syncingStore === store.id ? 'Syncing...' : 'Sync'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
