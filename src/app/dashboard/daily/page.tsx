'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import StoreSelector from '@/components/StoreSelector';

interface Store {
  id: string;
  name: string;
}

interface DailyRow {
  id: string;
  store_id: string;
  store_name: string;
  date: string;
  revenue_cents: number;
  cogs_cents: number;
  shipping_cost_cents: number;
  pick_pack_cents: number;
  packaging_cents: number;
  ad_spend_cents: number;
  shopify_fees_cents: number;
  other_costs_cents: number;
  net_profit_cents: number;
  margin_pct: number;
  order_count: number;
  is_confirmed: number;
}

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function todayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function DailyClearingContent() {
  const searchParams = useSearchParams();
  const storeFilter = searchParams.get('storeId') || '';

  const [date, setDate] = useState(todayStr());
  const [stores, setStores] = useState<Store[]>([]);
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, { adSpend: string; shopifyFees: string; otherCosts: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => setStores(d.stores || []));
  }, []);

  useEffect(() => {
    loadDay();
  }, [date]);

  async function loadDay() {
    setLoading(true);
    const res = await fetch(`/api/pnl/daily?date=${date}`);
    const data = await res.json();
    setRows(data.rows || []);
    // Pre-fill edits from current values
    const newEdits: typeof edits = {};
    for (const row of data.rows || []) {
      newEdits[row.store_id] = {
        adSpend: String((row.ad_spend_cents || 0) / 100),
        shopifyFees: String((row.shopify_fees_cents || 0) / 100),
        otherCosts: String((row.other_costs_cents || 0) / 100),
      };
    }
    setEdits(newEdits);
    setLoading(false);
  }

  async function handleSave(storeId: string, confirm = false) {
    setSaving(storeId);
    const edit = edits[storeId] || { adSpend: '0', shopifyFees: '0', otherCosts: '0' };
    await fetch('/api/pnl/daily', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId,
        date,
        adSpendCents: Math.round(parseFloat(edit.adSpend || '0') * 100),
        shopifyFeesCents: Math.round(parseFloat(edit.shopifyFees || '0') * 100),
        otherCostsCents: Math.round(parseFloat(edit.otherCosts || '0') * 100),
        confirm,
      }),
    });
    await loadDay();
    setSaving(null);
  }

  function updateEdit(storeId: string, field: string, value: string) {
    setEdits(prev => ({
      ...prev,
      [storeId]: { ...(prev[storeId] || { adSpend: '0', shopifyFees: '0', otherCosts: '0' }), [field]: value },
    }));
  }

  // Get all stores, merge with existing rows, filter by selection
  const filteredStores = storeFilter ? stores.filter(s => s.id === storeFilter) : stores;
  const storeRows = filteredStores.map(store => {
    const row = rows.find(r => r.store_id === store.id);
    return { store, row };
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Daily Clearing</h1>
            <p className="text-sm text-slate-400 mt-1">Review and confirm daily numbers</p>
          </div>
          <StoreSelector />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const d = new Date(date);
              d.setDate(d.getDate() - 1);
              setDate(d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }));
            }}
            className="px-3 py-1.5 text-sm text-slate-400 hover:text-white border border-slate-700 rounded-lg"
          >
            ←
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => {
              const d = new Date(date);
              d.setDate(d.getDate() + 1);
              setDate(d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }));
            }}
            className="px-3 py-1.5 text-sm text-slate-400 hover:text-white border border-slate-700 rounded-lg"
          >
            →
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" />
        </div>
      ) : (
        <div className="space-y-4">
          {storeRows.map(({ store, row }) => {
            const edit = edits[store.id] || { adSpend: '0', shopifyFees: '0', otherCosts: '0' };
            const confirmed = row?.is_confirmed === 1;

            return (
              <div key={store.id} className={`bg-slate-900 border rounded-xl p-5 ${confirmed ? 'border-emerald-800' : 'border-slate-800'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-white">{store.name}</h3>
                    {confirmed && (
                      <span className="text-[10px] bg-emerald-900/30 text-emerald-400 px-2 py-0.5 rounded-full">Confirmed</span>
                    )}
                  </div>
                  {row && (
                    <div className="text-right">
                      <p className="text-xs text-slate-500">Net Profit</p>
                      <p className={`text-lg font-bold ${(row.net_profit_cents || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {cents(row.net_profit_cents || 0)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Synced data (read-only) */}
                {row && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-4">
                    {[
                      { label: 'Revenue', value: row.revenue_cents },
                      { label: 'Fulfillment', value: row.cogs_cents },
                      { label: 'Orders', value: null, display: String(row.order_count || 0) },
                      { label: 'Margin', value: null, display: `${(row.margin_pct || 0).toFixed(1)}%` },
                    ].map((item) => (
                      <div key={item.label}>
                        <p className="text-[10px] text-slate-500 uppercase mb-0.5">{item.label}</p>
                        <p className="text-sm text-slate-300 font-medium">{item.display || cents(item.value || 0)}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Editable fields */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase mb-1">Ad Spend ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={edit.adSpend}
                      onChange={(e) => updateEdit(store.id, 'adSpend', e.target.value)}
                      disabled={confirmed}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase mb-1">Shopify Fees ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={edit.shopifyFees}
                      onChange={(e) => updateEdit(store.id, 'shopifyFees', e.target.value)}
                      disabled={confirmed}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase mb-1">Other Costs ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={edit.otherCosts}
                      onChange={(e) => updateEdit(store.id, 'otherCosts', e.target.value)}
                      disabled={confirmed}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
                    />
                  </div>
                </div>

                {/* Actions */}
                {!confirmed && (
                  <div className="flex gap-2 mt-4 justify-end">
                    <button
                      onClick={() => handleSave(store.id)}
                      disabled={saving === store.id}
                      className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white border border-slate-700 rounded-lg disabled:opacity-50"
                    >
                      {saving === store.id ? 'Saving...' : 'Save Draft'}
                    </button>
                    <button
                      onClick={() => handleSave(store.id, true)}
                      disabled={saving === store.id}
                      className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
                    >
                      Confirm & Lock
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {storeRows.length === 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-slate-400">No stores configured. Add stores first.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DailyClearingPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" /></div>}>
      <DailyClearingContent />
    </Suspense>
  );
}
