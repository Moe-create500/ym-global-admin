'use client';

import { useEffect, useState, useCallback } from 'react';
import { readGlobalStore, writeGlobalStore, onGlobalStoreChange } from '@/components/GlobalStore';

const cents = (n: number | null) => n == null ? '—' : '$' + (n / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });

const STATUS: Record<string, { label: string; chip: string; row?: string }> = {
  out: { label: 'OUT OF STOCK', chip: 'bg-red-500/15 text-red-400', row: 'bg-red-950/10' },
  critical: { label: 'CRITICAL', chip: 'bg-rose-500/15 text-rose-400', row: 'bg-rose-950/10' },
  reorder: { label: 'REORDER NOW', chip: 'bg-amber-500/15 text-amber-400' },
  ok: { label: 'OK', chip: 'bg-emerald-500/15 text-emerald-400' },
  overstocked: { label: 'OVERSTOCKED', chip: 'bg-blue-500/15 text-blue-400' },
  dead: { label: 'NO SALES 30d', chip: 'bg-slate-500/15 text-slate-400' },
};

export default function InventoryFlowPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeFilter, setStoreFilter] = useState('');

  // Follow the centralized store pin (and contribute to it)
  useEffect(() => {
    setStoreFilter(readGlobalStore());
    return onGlobalStoreChange(setStoreFilter);
  }, []);
  const [savingSettings, setSavingSettings] = useState('');
  const [settingsDraft, setSettingsDraft] = useState<Record<string, { lead: string; cover: string }>>({});

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/inventory-flow${storeFilter ? `?storeId=${storeFilter}` : ''}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setData(d.stores || []))
      .finally(() => setLoading(false));
  }, [storeFilter]);

  useEffect(() => { load(); }, [load]);

  const saveSettings = async (storeId: string) => {
    const d = settingsDraft[storeId];
    if (!d) return;
    setSavingSettings(storeId);
    await fetch('/api/inventory-flow', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, leadDays: Number(d.lead), coverDays: Number(d.cover) }),
    });
    setSavingSettings('');
    load();
  };

  const visible = data.filter(s => s.skus.length > 0 || s.feedError);
  const grand = {
    units: data.reduce((s, x) => s + x.totals.unitsToBuy, 0),
    cost: data.reduce((s, x) => s + x.totals.buyCostCents, 0),
    out: data.reduce((s, x) => s + x.totals.outCount, 0),
    critical: data.reduce((s, x) => s + x.totals.criticalCount, 0),
  };

  return (
    <div className="p-6 max-w-[1400px]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white">Inventory Flow</h1>
          <p className="text-sm text-slate-400 mt-1">What to buy to stay in stock — live warehouse stock × your real sales velocity</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={storeFilter} onChange={e => { setStoreFilter(e.target.value); writeGlobalStore(e.target.value); }}
            className="bg-slate-900 border border-slate-700 text-white text-xs rounded-lg px-3 py-2">
            <option value="">All stores</option>
            {data.map(s => <option key={s.storeId} value={s.storeId}>{s.storeName}</option>)}
          </select>
          <button onClick={load} className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg">↻ Refresh</button>
        </div>
      </div>

      {!loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <div className="bg-slate-900 border border-red-900/40 rounded-xl p-3">
            <p className="text-[10px] text-red-400 uppercase tracking-wider">Out of stock</p>
            <p className="text-xl font-bold text-white">{grand.out}</p>
            <p className="text-[10px] text-slate-500">selling SKUs at zero</p>
          </div>
          <div className="bg-slate-900 border border-rose-900/40 rounded-xl p-3">
            <p className="text-[10px] text-rose-400 uppercase tracking-wider">Critical</p>
            <p className="text-xl font-bold text-white">{grand.critical}</p>
            <p className="text-[10px] text-slate-500">will run out before a reorder arrives</p>
          </div>
          <div className="bg-slate-900 border border-amber-900/40 rounded-xl p-3">
            <p className="text-[10px] text-amber-400 uppercase tracking-wider">Units to buy</p>
            <p className="text-xl font-bold text-white">{grand.units.toLocaleString()}</p>
            <p className="text-[10px] text-slate-500">across all stores</p>
          </div>
          <div className="bg-slate-900 border border-emerald-900/40 rounded-xl p-3">
            <p className="text-[10px] text-emerald-400 uppercase tracking-wider">Est. purchase cost</p>
            <p className="text-xl font-bold text-white">{cents(grand.cost)}</p>
            <p className="text-[10px] text-slate-500">where unit cost is known</p>
          </div>
        </div>
      )}

      {loading && <p className="text-sm text-slate-500 animate-pulse">Pulling live stock + demand from ShipSourced…</p>}

      {!loading && visible.map(store => (
        <div key={store.storeId} className="mb-6 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-white">{store.storeName}</h2>
              {store.totals.skusToBuy > 0 && (
                <span className="text-[11px] text-amber-400">buy {store.totals.unitsToBuy.toLocaleString()} units{store.totals.buyCostCents > 0 ? ` · ~${cents(store.totals.buyCostCents)}` : ''}</span>
              )}
              {store.feedError && <span className="text-[11px] text-red-400">⚠ feed: {store.feedError}</span>}
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-slate-500">Lead time</span>
              <input type="number" min={1} className="w-14 bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-white text-[11px]"
                value={settingsDraft[store.storeId]?.lead ?? String(store.leadDays)}
                onChange={e => setSettingsDraft(p => ({ ...p, [store.storeId]: { lead: e.target.value, cover: p[store.storeId]?.cover ?? String(store.coverDays) } }))} />
              <span className="text-slate-500">d · Cover</span>
              <input type="number" min={7} className="w-14 bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-white text-[11px]"
                value={settingsDraft[store.storeId]?.cover ?? String(store.coverDays)}
                onChange={e => setSettingsDraft(p => ({ ...p, [store.storeId]: { cover: e.target.value, lead: p[store.storeId]?.lead ?? String(store.leadDays) } }))} />
              <span className="text-slate-500">d</span>
              {settingsDraft[store.storeId] && (
                <button onClick={() => saveSettings(store.storeId)} disabled={savingSettings === store.storeId}
                  className="px-2 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded text-[10px] font-semibold">
                  {savingSettings === store.storeId ? 'saving…' : 'save'}
                </button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-slate-500 uppercase border-b border-slate-800">
                  <th className="text-left px-4 py-2">Product</th>
                  <th className="text-left px-2 py-2">Status</th>
                  <th className="text-right px-2 py-2">Stock</th>
                  <th className="text-right px-2 py-2">Inbound</th>
                  <th className="text-right px-2 py-2">7d / 30d sold</th>
                  <th className="text-right px-2 py-2">Per day</th>
                  <th className="text-right px-2 py-2">Days left</th>
                  <th className="text-right px-2 py-2 text-amber-400">BUY</th>
                  <th className="text-right px-4 py-2">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {store.skus.map((r: any) => {
                  const st = STATUS[r.status] || STATUS.ok;
                  return (
                    <tr key={r.sku} className={`border-b border-slate-800/50 hover:bg-slate-800/30 ${st.row || ''}`}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {r.imageUrl && <img src={r.imageUrl} alt="" className="w-7 h-7 rounded object-cover flex-shrink-0" />}
                          <div className="min-w-0">
                            <p className="text-slate-200 truncate max-w-[280px]" title={r.name}>{r.name}</p>
                            <p className="text-[10px] text-slate-600 font-mono">{r.sku}{r.homeWarehouse ? ` · ${r.homeWarehouse}` : ''}{r.packSize > 1 ? ` · pack of ${r.packSize}` : ''}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${st.chip}`}>{st.label}</span></td>
                      <td className={`px-2 py-2 text-right font-mono ${r.stock <= 0 ? 'text-red-400 font-bold' : 'text-slate-200'}`}>{r.stock.toLocaleString()}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-400">{r.inbound > 0 ? `+${r.inbound.toLocaleString()}` : '—'}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-400">{r.units7} / {r.units30}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-300">{r.velocityPerDay}</td>
                      <td className={`px-2 py-2 text-right font-mono font-bold ${r.daysLeft == null ? 'text-slate-600' : r.daysLeft < r.leadDays ? 'text-red-400' : r.daysLeft < r.leadDays + 14 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {r.daysLeft == null ? '—' : `${r.daysLeft}d`}
                      </td>
                      <td className={`px-2 py-2 text-right font-mono font-bold ${r.buyQty > 0 ? 'text-amber-300 text-sm' : 'text-slate-600'}`}>
                        {r.buyQty > 0 ? r.buyQty.toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-slate-400">{r.buyQty > 0 ? cents(r.buyCostCents) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {!loading && visible.length === 0 && (
        <p className="text-sm text-slate-500 py-10 text-center">No stores with ShipSourced inventory data.</p>
      )}

      <p className="text-[10px] text-slate-600 mt-2">
        BUY = velocity × (lead time + cover days) − stock − inbound, rounded to pack size. Velocity = 60% last-7d rate + 40% last-30d rate (bundles counted as their warehouse components). China-warehouse (CN) SKUs may show stock 0 when they&apos;re procured per order — for those, BUY reflects pure demand over the window.
      </p>
    </div>
  );
}
