'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

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

const brandConfig: Record<string, { slug: string; description: string; color: string; icon: string }> = {
  'Zenchoice': {
    slug: 'zenchoice',
    description: 'Wellness & lifestyle brand',
    color: 'from-emerald-500 to-teal-600',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
  },
  'YMO - AMAZON': {
    slug: 'ymo',
    description: 'Multi-channel brand',
    color: 'from-blue-500 to-indigo-600',
    icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  },
  'Zen Essential': {
    slug: 'zen-essential',
    description: 'Essential oils & aromatherapy',
    color: 'from-amber-500 to-orange-600',
    icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
  },
};

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

function getPacificToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

const BRAND_NAMES = ['Zenchoice', 'YMO - AMAZON', 'Zen Essential'];

export default function OtherDashboard() {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'daily' | 'monthly' | 'yearly' | 'custom'>('daily');
  const [customDate, setCustomDate] = useState(getPacificToday());
  const [dateLabel, setDateLabel] = useState('Today');

  function fetchData(queryStr: string, label: string) {
    setLoading(true);
    setDateLabel(label);
    fetch(`/api/stores?${queryStr}`)
      .then(r => r.json())
      .then(data => {
        const filtered = (data.stores || []).filter((s: Store) => BRAND_NAMES.includes(s.name));
        setStores(filtered);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchData('range=daily', 'Today');
  }, []);

  function handlePreset(preset: 'daily' | 'monthly' | 'yearly') {
    setMode(preset);
    const labels = { daily: 'Today', monthly: 'Month to Date', yearly: 'Year to Date' };
    fetchData(`range=${preset}`, labels[preset]);
  }

  function handleCustomDate(date: string) {
    setCustomDate(date);
    setMode('custom');
    const today = getPacificToday();
    const label = date === today ? 'Today' : date;
    fetchData(`date=${date}`, label);
  }

  const totalRevenue = stores.reduce((s, st) => s + (st.mtd_revenue || 0), 0);
  const totalProfit = stores.reduce((s, st) => s + (st.mtd_profit || 0), 0);
  const totalOrders = stores.reduce((s, st) => s + (st.mtd_orders || 0), 0);

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Other Brands</h1>
          <p className="text-slate-400 text-sm mt-1">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
            {([['daily', 'Today'], ['monthly', 'MTD'], ['yearly', 'YTD']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => handlePreset(key as 'daily' | 'monthly' | 'yearly')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  mode === key ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={customDate}
            max={getPacificToday()}
            onChange={e => handleCustomDate(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500"
          />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">Revenue</p>
          <p className="text-xl font-bold text-white">{loading ? '...' : cents(totalRevenue)}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">Profit</p>
          <p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {loading ? '...' : cents(totalProfit)}
          </p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">Orders</p>
          <p className="text-xl font-bold text-white">{loading ? '...' : totalOrders.toLocaleString()}</p>
        </div>
      </div>

      {/* Brand cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-3 text-center py-12 text-slate-500">Loading...</div>
        ) : (
          BRAND_NAMES.map(name => {
            const config = brandConfig[name];
            const store = stores.find(s => s.name === name);
            return (
              <Link
                key={name}
                href={`/other/${config.slug}`}
                className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-slate-700 transition-colors group"
              >
                <div className="flex items-center gap-4 mb-5">
                  <div className={`w-12 h-12 bg-gradient-to-br ${config.color} rounded-xl flex items-center justify-center`}>
                    <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={config.icon} />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-white group-hover:text-violet-400 transition-colors">
                      {name === 'YMO - AMAZON' ? 'YMo' : name}
                    </h2>
                    <p className="text-xs text-slate-500">{config.description}</p>
                  </div>
                </div>

                {store ? (
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Revenue</span>
                      <span className="text-white font-medium">{cents(store.mtd_revenue || 0)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Profit</span>
                      <span className={`font-medium ${(store.mtd_profit || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {cents(store.mtd_profit || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Orders</span>
                      <span className="text-white font-medium">{(store.mtd_orders || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Platform</span>
                      <span className="text-slate-400 capitalize">{store.platform}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Last sync</span>
                      <span className="text-slate-400">{timeAgo(store.last_synced_at)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">No store data found</p>
                )}

                <div className="flex items-center text-sm text-slate-500 group-hover:text-slate-400 transition-colors mt-4 pt-4 border-t border-slate-800">
                  <span>View details</span>
                  <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
