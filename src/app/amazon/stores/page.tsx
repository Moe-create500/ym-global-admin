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

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
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

export default function AmazonStoresPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'daily' | 'monthly' | 'yearly'>('monthly');

  useEffect(() => { loadStores(); }, [range]);

  async function loadStores() {
    setLoading(true);
    const storesRange = range === 'daily' ? 'daily' : range === 'yearly' ? 'yearly' : 'monthly';
    const res = await fetch(`/api/stores?range=${storesRange}&platform=amazon`);
    const data = await res.json();
    setStores(data.stores || []);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-400" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Amazon Stores</h1>
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

      {stores.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400 text-sm">No Amazon stores configured.</p>
          <p className="text-slate-500 text-xs mt-1">Amazon stores are added from the main admin dashboard.</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                <th className="text-left px-5 py-3">Store</th>
                <th className="text-right px-5 py-3">Revenue</th>
                <th className="text-right px-5 py-3">Profit</th>
                <th className="text-right px-5 py-3">Orders</th>
                <th className="text-center px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => {
                const status = syncStatus(store.last_synced_at);
                return (
                  <tr key={store.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3">
                      <Link href={`/amazon/stores/${store.id}`} className="text-orange-400 font-medium hover:text-orange-300">
                        {store.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-right text-white font-medium">{cents(store.mtd_revenue || 0)}</td>
                    <td className={`px-5 py-3 text-right font-medium ${(store.mtd_profit || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {cents(store.mtd_profit || 0)}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-400">{store.mtd_orders || 0}</td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${status.color}`} />
                        <span className="text-[10px] text-slate-500">{status.label}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
