'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import StoreSelector from '@/components/StoreSelector';

interface Store {
  id: string;
  name: string;
}

interface AdRow {
  id: string;
  store_id: string;
  store_name: string;
  date: string;
  platform: string;
  campaign_id: string | null;
  campaign_name: string | null;
  spend_cents: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchase_value_cents: number;
  roas: number;
  source: string;
}

interface PlatformSummary {
  platform: string;
  total_spend_cents: number;
  total_impressions: number;
  total_clicks: number;
  entries: number;
}

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function AdsContent() {
  const searchParams = useSearchParams();
  const storeFilter = searchParams.get('storeId') || '';

  const [stores, setStores] = useState<Store[]>([]);
  const [rows, setRows] = useState<AdRow[]>([]);
  const [summary, setSummary] = useState<PlatformSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    storeId: '', date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }),
    platform: 'facebook', campaignName: '', spend: '', impressions: '', clicks: '', roas: '',
  });

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => setStores(d.stores || []));
  }, []);

  useEffect(() => {
    loadAds();
  }, [storeFilter]);

  async function loadAds() {
    setLoading(true);
    const params = new URLSearchParams();
    if (storeFilter) params.set('storeId', storeFilter);
    const res = await fetch(`/api/ads?${params}`);
    const data = await res.json();
    setRows(data.rows || []);
    setSummary(data.summary || []);
    setLoading(false);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/ads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: form.storeId,
        date: form.date,
        platform: form.platform,
        campaignName: form.campaignName || undefined,
        spendCents: Math.round(parseFloat(form.spend || '0') * 100),
        impressions: parseInt(form.impressions || '0'),
        clicks: parseInt(form.clicks || '0'),
        roas: parseFloat(form.roas || '0'),
      }),
    });
    setShowAdd(false);
    setSaving(false);
    setForm({ ...form, campaignName: '', spend: '', impressions: '', clicks: '', roas: '' });
    loadAds();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Ad Spend</h1>
            <p className="text-sm text-slate-400 mt-1">Track advertising spend across platforms</p>
          </div>
          <StoreSelector />
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
        >
          {showAdd ? 'Cancel' : '+ Add Entry'}
        </button>
      </div>

      {/* Platform Summary */}
      {summary.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {summary.map((s) => (
            <div key={s.platform} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1 capitalize">{s.platform}</p>
              <p className="text-xl font-bold text-white">{cents(s.total_spend_cents || 0)}</p>
              <div className="flex gap-4 mt-2 text-[10px] text-slate-500">
                <span>{(s.total_impressions || 0).toLocaleString()} impr</span>
                <span>{(s.total_clicks || 0).toLocaleString()} clicks</span>
                <span>{s.entries} entries</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-white mb-4">Manual Ad Spend Entry</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Store *</label>
              <select
                required
                value={form.storeId}
                onChange={(e) => setForm({ ...form, storeId: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Select store</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Date *</label>
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Platform *</label>
              <select
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="facebook">Facebook</option>
                <option value="google">Google</option>
                <option value="tiktok">TikTok</option>
                <option value="snapchat">Snapchat</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Campaign Name</label>
              <input
                type="text"
                value={form.campaignName}
                onChange={(e) => setForm({ ...form, campaignName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Spend ($) *</label>
              <input
                type="number"
                step="0.01"
                required
                value={form.spend}
                onChange={(e) => setForm({ ...form, spend: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Impressions</label>
              <input
                type="number"
                value={form.impressions}
                onChange={(e) => setForm({ ...form, impressions: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Clicks</label>
              <input
                type="number"
                value={form.clicks}
                onChange={(e) => setForm({ ...form, clicks: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">ROAS</label>
              <input
                type="number"
                step="0.01"
                value={form.roas}
                onChange={(e) => setForm({ ...form, roas: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
            >
              {saving ? 'Saving...' : 'Add Entry'}
            </button>
          </div>
        </form>
      )}

      {/* Entries Table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400">No ad spend entries yet</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-left px-4 py-3">Store</th>
                  <th className="text-left px-4 py-3">Platform</th>
                  <th className="text-left px-4 py-3">Campaign</th>
                  <th className="text-right px-4 py-3">Spend</th>
                  <th className="text-right px-4 py-3">Impressions</th>
                  <th className="text-right px-4 py-3">Clicks</th>
                  <th className="text-right px-4 py-3">Purchases</th>
                  <th className="text-right px-4 py-3">Revenue</th>
                  <th className="text-right px-4 py-3">ROAS</th>
                  <th className="text-center px-4 py-3">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-4 py-3 text-slate-300">{row.date}</td>
                    <td className="px-4 py-3 text-slate-300">{row.store_name}</td>
                    <td className="px-4 py-3 text-slate-300 capitalize">{row.platform}</td>
                    <td className="px-4 py-3 text-slate-400">{row.campaign_name || '—'}</td>
                    <td className="px-4 py-3 text-right text-white font-medium">{cents(row.spend_cents || 0)}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{(row.impressions || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{(row.clicks || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{row.purchases || 0}</td>
                    <td className="px-4 py-3 text-right text-emerald-400">{row.purchase_value_cents ? cents(row.purchase_value_cents) : '—'}</td>
                    <td className={`px-4 py-3 text-right font-medium ${row.roas >= 2 ? 'text-emerald-400' : row.roas > 0 ? 'text-yellow-400' : 'text-slate-400'}`}>{row.roas ? `${row.roas}x` : '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${row.source === 'api' ? 'bg-blue-900/30 text-blue-400' : 'bg-slate-800 text-slate-400'}`}>
                        {row.source}
                      </span>
                    </td>
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

export default function AdsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" /></div>}>
      <AdsContent />
    </Suspense>
  );
}
