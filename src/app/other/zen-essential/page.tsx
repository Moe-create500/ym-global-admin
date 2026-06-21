'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

const STORE_NAME = 'Zen Essential';

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

interface LineItem { name: string; sku: string | null; qty: number; priceCents: number }
interface OrderRow {
  id: string; order_number: string | null; order_name: string | null; order_date: string;
  revenue_cents: number; refund_cents: number; cogs_cents: number; fulfillment_cents: number;
  ss_charge_is_estimate: number; fee_cents: number; net_cents: number; margin_pct: number;
  items: LineItem[]; fulfillment_status: string | null;
}
interface Totals {
  revenue_cents: number; refund_cents: number; cogs_cents: number; fulfillment_cents: number;
  fee_cents: number; total_cost_cents: number; net_profit_cents: number; margin_pct: number; order_count: number;
}
interface Breakdown {
  cogs_available: boolean; totals: Totals; orders: OrderRow[];
  page: number; totalPages: number; total: number;
}

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function pct(v: number): string { return `${v.toFixed(1)}%`; }
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
function pacificToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}
type Range = 'mtd' | 'ytd' | 'all';
function rangeFrom(r: Range): string | null {
  const t = pacificToday();
  if (r === 'mtd') return t.slice(0, 7) + '-01';
  if (r === 'ytd') return t.slice(0, 4) + '-01-01';
  return null;
}

export default function ZenEssentialPage() {
  const [store, setStore] = useState<Store | null>(null);
  const [bd, setBd] = useState<Breakdown | null>(null);
  const [range, setRange] = useState<Range>('mtd');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [bdLoading, setBdLoading] = useState(false);

  // Resolve the store once.
  useEffect(() => {
    fetch('/api/stores?range=monthly')
      .then(r => r.json())
      .then(data => setStore((data.stores || []).find((s: Store) => s.name === STORE_NAME) || null))
      .finally(() => setLoading(false));
  }, []);

  const loadBreakdown = useCallback((storeId: string, r: Range, p: number) => {
    setBdLoading(true);
    const params = new URLSearchParams({ storeId, page: String(p), limit: '100' });
    const from = rangeFrom(r);
    if (from) params.set('from', from);
    fetch(`/api/orders/breakdown?${params}`)
      .then(res => res.json())
      .then(d => { if (!d.error) setBd(d); })
      .catch(() => {})
      .finally(() => setBdLoading(false));
  }, []);

  useEffect(() => { if (store) loadBreakdown(store.id, range, page); }, [store, range, page, loadBreakdown]);
  // Reset to page 1 when range changes.
  useEffect(() => { setPage(1); }, [range]);

  if (loading) return <div className="text-slate-500 py-12 text-center">Loading...</div>;

  const t = bd?.totals;
  const summary = t ? [
    { label: 'Revenue', value: cents(t.revenue_cents), cls: 'text-white' },
    { label: 'Product COGS', value: cents(t.cogs_cents), cls: 'text-slate-300' },
    { label: 'Fulfillment', value: cents(t.fulfillment_cents), cls: 'text-slate-300' },
    { label: store?.platform === 'amazon' ? 'Amazon Fees' : 'Platform Fees', value: cents(t.fee_cents), cls: 'text-slate-300' },
    { label: 'Total Cost', value: cents(t.total_cost_cents), cls: 'text-orange-400' },
    { label: 'Net Profit', value: cents(t.net_profit_cents), cls: t.net_profit_cents >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Margin', value: pct(t.margin_pct), cls: t.margin_pct >= 20 ? 'text-emerald-400' : t.margin_pct >= 0 ? 'text-yellow-400' : 'text-red-400' },
  ] : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Zen Essential</h1>
          <p className="text-slate-400 text-sm mt-1">Essential oils &amp; aromatherapy (Amazon)</p>
        </div>
        {store && (
          <Link href={`/dashboard/stores/${store.id}`} className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-500 transition-colors">
            Full Store View
          </Link>
        )}
      </div>

      {!store ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-500">Store not found in the system.</p>
        </div>
      ) : (
        <>
          {/* MTD KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 mb-1">MTD Revenue</p>
              <p className="text-xl font-bold text-white">{cents(store.mtd_revenue || 0)}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 mb-1">MTD Profit</p>
              <p className={`text-xl font-bold ${(store.mtd_profit || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{cents(store.mtd_profit || 0)}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 mb-1">MTD Orders</p>
              <p className="text-xl font-bold text-white">{(store.mtd_orders || 0).toLocaleString()}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 mb-1">Last Sync</p>
              <p className="text-xl font-bold text-white">{timeAgo(store.last_synced_at)}</p>
            </div>
          </div>

          {/* Range toggle */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Cost &amp; Margin Breakdown</h2>
            <div className="flex bg-slate-800 rounded-lg p-0.5">
              {(['mtd', 'ytd', 'all'] as Range[]).map(r => (
                <button key={r} onClick={() => setRange(r)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${range === r ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                  {r === 'mtd' ? 'This Month' : r === 'ytd' ? 'This Year' : 'All Time'}
                </button>
              ))}
            </div>
          </div>

          {/* COGS warning */}
          {bd && !bd.cogs_available && (
            <div className="mb-4 px-4 py-3 bg-amber-900/20 border border-amber-800/50 rounded-lg text-sm text-amber-300">
              ⚠ <span className="font-medium">Product costs not set for this store.</span> COGS shows $0, so Net Profit &amp; Margin
              below <span className="font-medium">exclude product cost</span> (true margin is lower). Add unit costs to the products to see real margin.
            </div>
          )}

          {/* Summary panel */}
          {t && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
                {summary.map(s => (
                  <div key={s.label}>
                    <p className="text-xs text-slate-500 mb-1">{s.label}</p>
                    <p className={`text-base font-bold ${s.cls}`}>{s.value}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-3">
                {t.order_count.toLocaleString()} orders · {range === 'mtd' ? 'this month' : range === 'ytd' ? 'this year' : 'all time'}
                {t.refund_cents > 0 && <> · {cents(t.refund_cents)} refunded</>}
                {store.platform === 'amazon' && ' · Amazon PPC ad spend not tracked here'}
              </p>
            </div>
          )}

          {/* Per-order breakdown */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-300">Per-Order Breakdown</h3>
              {bd && bd.total > 0 && <span className="text-xs text-slate-500">{bd.total.toLocaleString()} orders</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs border-b border-slate-800">
                    <th className="text-left px-4 py-3">Date</th>
                    <th className="text-left px-4 py-3">Order</th>
                    <th className="text-left px-4 py-3">Items</th>
                    <th className="text-right px-4 py-3">Revenue</th>
                    <th className="text-right px-4 py-3">COGS</th>
                    <th className="text-right px-4 py-3">Fulfillment</th>
                    <th className="text-right px-4 py-3">Fee</th>
                    <th className="text-right px-4 py-3">Net</th>
                    <th className="text-right px-4 py-3">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {bdLoading && (!bd || bd.orders.length === 0) ? (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
                  ) : bd && bd.orders.length > 0 ? bd.orders.map(o => (
                    <tr key={o.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 align-top">
                      <td className="px-4 py-2.5 text-slate-300 whitespace-nowrap">{o.order_date}</td>
                      <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{o.order_name || o.order_number || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-400 max-w-[260px]">
                        {o.items.map((it, i) => (
                          <div key={i} className="truncate text-xs">{it.qty}× {it.sku || it.name || 'item'}</div>
                        ))}
                      </td>
                      <td className="px-4 py-2.5 text-right text-white whitespace-nowrap">{cents(o.revenue_cents)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-400 whitespace-nowrap">{o.cogs_cents > 0 ? cents(o.cogs_cents) : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-slate-400 whitespace-nowrap">
                        {o.fulfillment_cents > 0 ? cents(o.fulfillment_cents) : '—'}
                        {o.ss_charge_is_estimate ? <span className="text-[9px] text-amber-500 ml-1">est</span> : null}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-400 whitespace-nowrap">{cents(o.fee_cents)}</td>
                      <td className={`px-4 py-2.5 text-right font-medium whitespace-nowrap ${o.net_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{cents(o.net_cents)}</td>
                      <td className={`px-4 py-2.5 text-right whitespace-nowrap ${o.margin_pct >= 20 ? 'text-emerald-400' : o.margin_pct >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>{pct(o.margin_pct)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">No orders in this range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {bd && bd.totalPages > 1 && (
              <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-500">Page {bd.page} of {bd.totalPages}</span>
                <div className="flex gap-2">
                  <button disabled={page <= 1 || bdLoading} onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="px-3 py-1.5 bg-slate-800 rounded-md text-slate-300 disabled:opacity-40 hover:bg-slate-700">Prev</button>
                  <button disabled={page >= bd.totalPages || bdLoading} onClick={() => setPage(p => p + 1)}
                    className="px-3 py-1.5 bg-slate-800 rounded-md text-slate-300 disabled:opacity-40 hover:bg-slate-700">Next</button>
                </div>
              </div>
            )}
          </div>

          {/* Store details */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mt-6">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Store Details</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-slate-500">Store ID</span><p className="text-slate-300 font-mono text-xs mt-0.5">{store.id}</p></div>
              <div><span className="text-slate-500">ShipSourced Client</span><p className="text-slate-300 text-xs mt-0.5">{store.shipsourced_client_id || 'Not linked'}</p></div>
              <div><span className="text-slate-500">Last Sync</span><p className="text-slate-300 mt-0.5">{timeAgo(store.last_synced_at)}</p></div>
              <div><span className="text-slate-500">Platform</span><p className="text-slate-300 mt-0.5 capitalize">{store.platform}</p></div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
