'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const STORE_NAME = 'YMO - AMAZON';

interface Store {
  id: string;
  name: string;
  platform: string;
  shipsourced_client_id: string | null;
  last_synced_at: string | null;
  mtd_revenue: number | null;
  mtd_profit: number | null;
  mtd_orders: number | null;
}

interface PnlRow {
  period: string;
  revenue_cents: number;
  cogs_cents: number;
  shipping_cents: number;
  ad_spend_cents: number;
  net_profit_cents: number;
  order_count: number;
  margin_pct: number;
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

export default function YMoPage() {
  const [store, setStore] = useState<Store | null>(null);
  const [pnl, setPnl] = useState<PnlRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stores?range=monthly')
      .then(r => r.json())
      .then(data => {
        const found = (data.stores || []).find((s: Store) => s.name === STORE_NAME);
        setStore(found || null);
        if (found) {
          fetch(`/api/pnl/daily?store=${found.id}&range=monthly`)
            .then(r => r.json())
            .then(d => setPnl(d.rows || []))
            .catch(() => {});
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-slate-500 py-12 text-center">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">YMo</h1>
          <p className="text-slate-400 text-sm mt-1">Multi-channel brand (Amazon)</p>
        </div>
        {store && (
          <Link
            href={`/dashboard/stores/${store.id}`}
            className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-500 transition-colors"
          >
            Full Store View
          </Link>
        )}
      </div>

      {store ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 mb-1">MTD Revenue</p>
              <p className="text-xl font-bold text-white">{cents(store.mtd_revenue || 0)}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 mb-1">MTD Profit</p>
              <p className={`text-xl font-bold ${(store.mtd_profit || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {cents(store.mtd_profit || 0)}
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 mb-1">MTD Orders</p>
              <p className="text-xl font-bold text-white">{(store.mtd_orders || 0).toLocaleString()}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 mb-1">Platform</p>
              <p className="text-xl font-bold text-white capitalize">{store.platform}</p>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-8">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Store Details</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-slate-500">Store ID</span>
                <p className="text-slate-300 font-mono text-xs mt-0.5">{store.id}</p>
              </div>
              <div>
                <span className="text-slate-500">ShipSourced Client</span>
                <p className="text-slate-300 text-xs mt-0.5">{store.shipsourced_client_id || 'Not linked'}</p>
              </div>
              <div>
                <span className="text-slate-500">Last Sync</span>
                <p className="text-slate-300 mt-0.5">{timeAgo(store.last_synced_at)}</p>
              </div>
              <div>
                <span className="text-slate-500">Platform</span>
                <p className="text-slate-300 mt-0.5 capitalize">{store.platform}</p>
              </div>
            </div>
          </div>

          {pnl.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800">
                <h3 className="text-sm font-semibold text-slate-300">Daily P&L (This Month)</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500 text-xs border-b border-slate-800">
                      <th className="text-left px-4 py-3">Date</th>
                      <th className="text-right px-4 py-3">Revenue</th>
                      <th className="text-right px-4 py-3">COGS</th>
                      <th className="text-right px-4 py-3">Shipping</th>
                      <th className="text-right px-4 py-3">Ad Spend</th>
                      <th className="text-right px-4 py-3">Profit</th>
                      <th className="text-right px-4 py-3">Orders</th>
                      <th className="text-right px-4 py-3">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pnl.map(row => (
                      <tr key={row.period} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                        <td className="px-4 py-2.5 text-slate-300">{row.period}</td>
                        <td className="px-4 py-2.5 text-right text-white">{cents(row.revenue_cents)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-400">{cents(row.cogs_cents)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-400">{cents(row.shipping_cents)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-400">{cents(row.ad_spend_cents)}</td>
                        <td className={`px-4 py-2.5 text-right font-medium ${row.net_profit_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {cents(row.net_profit_cents)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-300">{row.order_count}</td>
                        <td className={`px-4 py-2.5 text-right ${row.margin_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {row.margin_pct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-500">Store not found in the system.</p>
        </div>
      )}
    </div>
  );
}
