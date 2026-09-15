'use client';
import { useEffect, useState } from 'react';
import { money } from './FigureCell';

/** Monthly P&L for one store from the existing /api/pnl aggregation of
 *  daily_pnl — the same numbers the store page shows, laid out as a
 *  statement. It says plainly what is and isn't in it. */

interface Row { period: string; revenue_cents: number; refunds_cents: number; cogs_cents: number; shipping_cents: number; pick_pack_cents: number; packaging_cents: number; fulfillment_est_cents: number; ad_spend_cents: number; shopify_fees_cents: number; app_costs_cents: number; chargeback_cents: number; other_costs_cents: number; net_profit_cents: number; order_count: number }

export function PnlTab({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!storeId) return;
    const to = new Date(); const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1));
    fetch(`/api/pnl?storeId=${storeId}&period=monthly&from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status)).then(j => setRows((j.data || j.rows || j.periods || []).slice().reverse())).catch(e => setErr(String(e)));
  }, [storeId]);
  const lines: { label: string; key: keyof Row; neg?: boolean; sub?: boolean }[] = [
    { label: 'Revenue', key: 'revenue_cents' },
    { label: 'Refunds', key: 'refunds_cents', neg: true },
    { label: 'COGS', key: 'cogs_cents', neg: true },
    { label: 'Shipping', key: 'shipping_cents', neg: true },
    { label: 'Pick & pack', key: 'pick_pack_cents', neg: true },
    { label: 'Packaging', key: 'packaging_cents', neg: true },
    { label: 'Ad spend', key: 'ad_spend_cents', neg: true },
    { label: 'Shopify fees', key: 'shopify_fees_cents', neg: true },
    { label: 'App bills', key: 'app_costs_cents', neg: true },
    { label: 'Chargebacks', key: 'chargeback_cents', neg: true },
    { label: 'Other', key: 'other_costs_cents', neg: true },
    { label: 'Net profit', key: 'net_profit_cents' },
    { label: 'Fulfilment still estimated (not in net)', key: 'fulfillment_est_cents', sub: true },
    { label: 'Orders', key: 'order_count', sub: true },
  ];
  return (
    <div className="rounded-xl bg-slate-900/60 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-800/60 flex items-baseline justify-between gap-4">
        <h2 className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider">P&amp;L — last 12 months</h2>
        <p className="text-[11px] text-slate-500">Performance for each month · from the order, ShipSourced, ads and invoice syncs (daily_pnl)</p>
      </div>
      {err && <p className="px-5 py-3 text-red-300 text-[12px]">Could not load P&amp;L ({err})</p>}
      <div className="overflow-x-auto">
        <table className="min-w-full text-[12px]">
          <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
            <th className="text-left px-4 py-2 sticky left-0 bg-slate-900/95">Line</th>
            {rows.map(r => <th key={r.period} className="text-right px-3 py-2 whitespace-nowrap">{r.period}</th>)}
          </tr></thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.key} className={`border-b border-slate-800/40 ${l.key === 'net_profit_cents' ? 'bg-slate-800/30 font-semibold' : ''} ${l.sub ? 'text-slate-500' : 'text-slate-200'}`}>
                <td className="px-4 py-1.5 sticky left-0 bg-slate-900/95 whitespace-nowrap">{l.label}</td>
                {rows.map(r => {
                  const v = Number(r[l.key] || 0);
                  return <td key={r.period} className={`px-3 py-1.5 text-right tabular-nums ${l.key === 'net_profit_cents' ? (v < 0 ? 'text-red-300' : 'text-emerald-300') : ''}`}>{l.key === 'order_count' ? v : (l.neg && v ? '−' : '') + money(Math.abs(v))}</td>;
                })}
              </tr>
            ))}
            {!rows.length && !err && <tr><td className="px-4 py-3 text-slate-500" colSpan={2}>No P&amp;L rows in the last 12 months.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="px-5 py-3 text-[11px] text-slate-500 border-t border-slate-800/60">
        Not in this P&amp;L today: subscriptions and software, payroll and contractors, rent and utilities, card interest and fees, inventory purchases as cash. Those live only in the bank ledger until the reporting mapping (Phase 2) posts them here. Net profit uses Meta&apos;s reported ad spend, not the card charge.
      </p>
    </div>
  );
}
