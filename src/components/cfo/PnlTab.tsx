'use client';
import { useEffect, useState } from 'react';
import { money } from './FigureCell';

/** Monthly P&L for one store from the existing /api/pnl aggregation of
 *  daily_pnl — the same numbers the store page shows, laid out as a
 *  statement. It says plainly what is and isn't in it. */

interface Row { period: string; revenue_cents: number; refunds_cents: number; cogs_cents: number; shipping_cents: number; pick_pack_cents: number; packaging_cents: number; fulfillment_est_cents: number; ad_spend_cents: number; shopify_fees_cents: number; app_costs_cents: number; chargeback_cents: number; other_costs_cents: number; net_profit_cents: number; order_count: number }

export function PnlTab({ storeId, isShipSourced }: { storeId: string; isShipSourced?: boolean }) {
  return isShipSourced ? <ShipSourcedPnl /> : <StorePnl storeId={storeId} />;
}

function StorePnl({ storeId }: { storeId: string }) {
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


/** ShipSourced P&L by fulfilment centre. Revenue + direct costs come from
 *  ShipSourced billing per warehouse; operating costs are YM's ledger rows
 *  paired to ShipSourced, classified by line × centre on the Position tab. */
function ShipSourcedPnl() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [period, setPeriod] = useState(() => { const t = new Date(); return { from: `${t.toISOString().slice(0, 7)}-01`, to: t.toISOString().slice(0, 10) }; });
  useEffect(() => {
    setD(null); setErr('');
    fetch(`/api/cfo/v2/ss-pnl?from=${period.from}&to=${period.to}`).then(r => r.ok ? r.json() : Promise.reject(r.status)).then(setD).catch(e => setErr(String(e)));
  }, [period.from, period.to]);
  const m = (v: number | null | undefined) => v == null ? <span className="text-slate-500" title="ShipSourced feed unavailable — unknown, not zero">—</span> : <span className={v < 0 ? 'text-red-300' : ''}>{money(v)}</span>;
  const row = (label: string, pick: (c: any) => number | null | undefined, cls = '') => (
    <tr key={label} className={`border-b border-slate-800/40 ${cls}`}>
      <td className="px-4 py-1.5 text-slate-300">{label}</td>
      {(d?.centers || []).map((c: any) => <td key={c.center} className="px-3 py-1.5 text-right tabular-nums text-slate-100">{m(pick(c))}</td>)}
      <td className="px-3 py-1.5 text-right tabular-nums text-slate-100">{d ? m(pick({ ...d.combined, center: 'all', opexDirectCents: d.ledger.totalCents - d.shared.totalCents, opexSharedCents: d.shared.totalCents, revenueLines: {}, directLines: {}, opexLines: [], carrierInvoiceCents: (d.centers || []).reduce((s: number, c: any) => s + (c.carrierInvoiceCents || 0), 0) })) : ''}</td>
    </tr>
  );
  const lineVal = (c: any, line: string) => { const l = (c.opexLines || []).find((x: any) => x.line === line); return l ? l.directCents + l.sharedCents : 0; };
  const opexLine = (line: string) => (c: any) => c.center === 'all' ? (d.centers as any[]).reduce((s, x) => s + lineVal(x, line), 0) : lineVal(c, line);
  const lines = d ? [...new Set((d.centers || []).flatMap((c: any) => c.opexLines.map((l: any) => l.line)))] as string[] : [];
  const label = (line: string) => (d.centers.flatMap((c: any) => c.opexLines).find((l: any) => l.line === line) || {}).label || line;
  return (
    <div className="rounded-xl bg-slate-900/60 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-800/60 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider">ShipSourced P&amp;L by fulfilment centre</h2>
          <p className="text-[11px] text-slate-500">Revenue &amp; direct costs from ShipSourced billing per warehouse · operating costs from card/bank charges classified on the Position tab · {d ? (d.source.shipsourced === 'live' ? <span className="text-emerald-300">● ShipSourced live</span> : <span className="text-amber-300">ShipSourced feed unavailable{d.source.reason ? `: ${d.source.reason}` : ''} — revenue/direct unknown</span>) : '…'}</p>
        </div>
        <span className="flex gap-1 text-[12px]"><input type="date" value={period.from} onChange={e => setPeriod(p => ({ ...p, from: e.target.value }))} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100" /><input type="date" value={period.to} onChange={e => setPeriod(p => ({ ...p, to: e.target.value }))} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100" /></span>
      </div>
      {err && <p className="px-5 py-3 text-red-300 text-[12px]">Could not load ({err})</p>}
      {!d && !err && <p className="px-5 py-6 text-slate-500 text-[13px]">Loading…</p>}
      {d && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-[12.5px]">
            <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800/60"><th className="text-left px-4 py-2">{d.period.from} → {d.period.to}</th><th className="text-right px-3 py-2">California</th><th className="text-right px-3 py-2">China</th><th className="text-right px-3 py-2">Combined</th></tr></thead>
            <tbody>
              {row('Billed revenue', c => c.revenueCents, 'font-medium')}
              {row('  shipping charges (label + markup + product pass-through)', c => c.revenueCents == null ? null : c.center === 'all' ? (d.centers as any[]).reduce((s, x) => s + (x.revenueLines?.shipping || 0), 0) : c.revenueLines?.shipping)}
              {row('  China fulfilment fee', c => c.revenueCents == null ? null : c.center === 'all' ? (d.centers as any[]).reduce((s, x) => s + (x.revenueLines?.chinaFee || 0), 0) : c.revenueLines?.chinaFee)}
              {row('  pick / pack / service', c => c.revenueCents == null ? null : (c.center === 'all' ? (d.centers as any[]).reduce((s, x) => s + Object.entries(x.revenueLines || {}).filter(([k]) => k.startsWith('service:') || k === 'pickPack').reduce((t, [, v]: any) => t + v, 0), 0) : Object.entries(c.revenueLines || {}).filter(([k]) => k.startsWith('service:') || k === 'pickPack').reduce((s, [, v]: any) => s + v, 0)))}
              {row('  packaging', c => c.revenueCents == null ? null : c.center === 'all' ? (d.centers as any[]).reduce((s, x) => s + (x.revenueLines?.packaging || 0), 0) : c.revenueLines?.packaging)}
              {row('Direct costs (ShipSourced-recorded)', c => c.directCents == null ? null : -c.directCents, 'font-medium')}
              {row('  label cost', c => c.directCents == null ? null : c.center === 'all' ? -(d.centers as any[]).reduce((s, x) => s + (x.directLines?.labelCost || 0), 0) : -c.directLines.labelCost)}
              {row('  product cost', c => c.directCents == null ? null : c.center === 'all' ? -(d.centers as any[]).reduce((s, x) => s + (x.directLines?.productCost || 0), 0) : -c.directLines.productCost)}
              {row('  service + packaging cost', c => c.directCents == null ? null : c.center === 'all' ? -(d.centers as any[]).reduce((s, x) => s + (x.directLines?.serviceCost || 0) + (x.directLines?.packagingCost || 0), 0) : -(c.directLines.serviceCost + c.directLines.packagingCost))}
              {row('Gross profit', c => c.grossCents, 'font-semibold bg-slate-800/30')}
              {lines.map(l => row(`  ${label(l)}`, opexLine(l)))}
              {row('Operating costs (ledger, incl. shared allocation)', c => -c.opexCents, 'font-medium')}
              {row('Net', c => c.netCents, 'font-semibold bg-slate-800/30')}
              {row('memo: settled carrier invoices this period', c => c.carrierInvoiceCents == null ? null : -c.carrierInvoiceCents, 'text-slate-500')}
            </tbody>
          </table>
          <div className="px-5 py-3 text-[11px] text-slate-500 border-t border-slate-800/60 space-y-1">
            <p>Shared costs {money(d.shared.totalCents)} allocated {d.shared.basis} → California {money(d.shared.allocation.CA)}, China {money(d.shared.allocation.CN)}. Ledger total {money(d.ledger.totalCents)} over {d.ledger.rows} charges; {money(d.ledger.needsReviewCents)} still needs a fulfilment line (amber on the Position tab).</p>
            {d.unknownRegion && <p>{d.unknownRegion.charges} billed charges could not be placed in a warehouse (revenue {money(d.unknownRegion.revenueCents)}) — counted in Combined only.</p>}
            {d.centers.some((c: any) => c.noWarehouse > 0) && <p>{d.centers.map((c: any) => `${c.center}: ${c.noWarehouse} charges inferred from the carrier name`).join(' · ')}.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
