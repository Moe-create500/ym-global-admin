'use client';
import { useEffect, useState } from 'react';

/**
 * ShipSourced accounting, read straight from its feeds: who owes what and how
 * fast they pay, what we owe carriers and China, recurring revenue, stock at
 * cost, dispute exposure, and money that will not come back. Every figure is
 * ShipSourced's own record; nothing here is estimated on the YM side.
 */
const $ = (c: number | null | undefined) => c == null ? '—' : `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n = (v: number | null | undefined, d = 0) => v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d });
const ago = (iso: string | null) => { if (!iso) return 'never'; const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000); return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`; };

function useFeed<T = any>(feed: string, query = '') {
  const [d, setD] = useState<T | null>(null); const [err, setErr] = useState('');
  useEffect(() => { setD(null); setErr(''); fetch(`/api/cfo/v2/ss-accounting?feed=${feed}${query}`).then(async r => { const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`); return j; }).then(setD).catch(e => setErr(String(e.message || e))); }, [feed, query]);
  return { d, err };
}
const Card = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' | 'good' | 'warn' }) => (
  <div className={`rounded-xl border p-4 ${tone === 'bad' ? 'border-red-300 bg-red-50' : tone === 'warn' ? 'border-amber-300 bg-amber-50' : tone === 'good' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-700 bg-white'}`}>
    <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
    <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    {sub ? <div className="text-xs text-slate-400">{sub}</div> : null}
  </div>
);
const Feed = ({ title, err, children }: { title: string; err: string; children: React.ReactNode }) => (
  <section className="space-y-3">
    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h3>
    {err ? <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">Feed unavailable: {err}</div> : children}
  </section>
);
const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => <th className={`px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
const Td = ({ children, right, cls = '' }: { children: React.ReactNode; right?: boolean; cls?: string }) => <td className={`px-3 py-2 tabular-nums ${right ? 'text-right' : ''} ${cls}`}>{children}</td>;

export function AccountingTab() {
  const ar = useFeed('receivables'); const pay = useFeed('payments'); const pl = useFeed('payables'); const sub = useFeed('subscriptions'); const inv = useFeed('inventory-value'); const cb = useFeed('chargebacks'); const wo = useFeed('write-offs');
  const [showAll, setShowAll] = useState(false);
  const t = ar.d?.totals;
  return (
    <div className="space-y-8 text-sm text-slate-50">
      <Feed title="Receivables — who owes us and how fast they pay" err={ar.err}>
        {t && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Card label="Open A/R" value={$(t.openCents)} sub={`${t.clientsOwing} clients owing`} />
              <Card label="Over 90 days" value={$(t.aging.d90plusCents)} sub={`61–90: ${$(t.aging.d61_90Cents)}`} tone={t.aging.d90plusCents > 0 ? 'bad' : 'good'} />
              <Card label="Avg days to pay" value={t.avgDaysToPay == null ? '—' : `${t.avgDaysToPay} d`} sub={`per charge, last ${ar.d.windowDays} days (FIFO)`} tone={t.avgDaysToPay != null && t.avgDaysToPay > 30 ? 'warn' : 'good'} />
              <Card label="Over $1,000" value={n(t.over1000)} sub="clients above the cap" tone={t.over1000 ? 'warn' : 'good'} />
              <Card label="Inactive still owing" value={$(t.inactiveOwingCents)} sub="write-off candidates" tone={t.inactiveOwingCents > 0 ? 'bad' : 'good'} />
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-700">
              <table className="w-full">
                <thead className="bg-slate-950"><tr><Th>Client</Th><Th right>Open</Th><Th right>Current</Th><Th right>31–60</Th><Th right>61–90</Th><Th right>90+</Th><Th right>Avg pay</Th><Th right>DSO</Th><Th>Last payment</Th><Th>Stored bal.</Th></tr></thead>
                <tbody>
                  {(showAll ? ar.d.clients : ar.d.clients.filter((c: any) => c.openCents > 0)).slice(0, showAll ? 500 : 40).map((c: any) => (
                    <tr key={c.clientId} className="border-t border-slate-800">
                      <Td><span className={c.isActive ? '' : 'text-slate-500 line-through'}>{c.company}</span>{!c.hasCard && c.openCents > 0 ? <span className="ml-1 text-[10px] text-amber-700">no card</span> : null}</Td>
                      <Td right cls={c.openCents > 100000 ? 'font-semibold text-red-600' : ''}>{$(c.openCents)}</Td>
                      <Td right>{$(c.aging.currentCents)}</Td><Td right>{$(c.aging.d31_60Cents)}</Td><Td right>{$(c.aging.d61_90Cents)}</Td><Td right cls={c.aging.d90plusCents ? 'text-red-600' : 'text-slate-500'}>{$(c.aging.d90plusCents)}</Td>
                      <Td right>{c.avgDaysToPay == null ? <span className="text-slate-500">—</span> : `${c.avgDaysToPay} d`}</Td>
                      <Td right>{c.dso == null ? <span className="text-slate-500">—</span> : n(c.dso)}</Td>
                      <Td cls={!c.lastPaymentAt && c.openCents > 0 ? 'text-amber-700' : 'text-slate-200'}>{ago(c.lastPaymentAt)}</Td>
                      <Td cls={Math.abs(c.storedBalanceCents - c.openCents) > 100 ? 'text-amber-700' : 'text-slate-500'} >{$(c.storedBalanceCents)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <button onClick={() => setShowAll(v => !v)} className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800">{showAll ? 'Owing only' : 'Show every client'}</button>
              <span>Open = charges − payments allocated oldest-first. "Stored bal." is ShipSourced's running balance; amber when the two disagree by more than $1.</span>
            </div>
          </>
        )}
      </Feed>

      <div className="grid gap-8 lg:grid-cols-2">
        <Feed title="Payments received — last 90 days" err={pay.err}>
          {pay.d && (<>
            <div className="grid grid-cols-2 gap-3"><Card label="Collected" value={$(pay.d.totals.succeededCents)} sub={`${pay.d.totals.count} payments`} tone="good" /><Card label="Voided" value={$(pay.d.totals.voidedCents)} /></div>
            <div className="flex flex-wrap gap-2 text-xs">{Object.entries(pay.d.totals.byKind).map(([k, v]: any) => <span key={k} className="rounded-full border border-slate-700 px-2 py-0.5">{k.replace('_', '/')}: {v.count} · {$(v.cents)}</span>)}</div>
            <div className="max-h-64 overflow-auto rounded-xl border border-slate-700"><table className="w-full"><thead className="bg-slate-950"><tr><Th>Date</Th><Th>Client</Th><Th>How</Th><Th right>Amount</Th></tr></thead><tbody>
              {pay.d.payments.slice(0, 60).map((p: any) => <tr key={p.id} className="border-t border-slate-800"><Td>{String(p.at).slice(0, 10)}</Td><Td>{p.company}</Td><Td cls="text-slate-300">{p.kind.replace('_', '/')}{p.reference ? ` · ${p.reference.slice(0, 30)}` : ''}</Td><Td right cls={p.status !== 'SUCCEEDED' ? 'line-through text-slate-500' : ''}>{$(p.amountCents)}</Td></tr>)}
            </tbody></table></div>
          </>)}
        </Feed>
        <Feed title="Payables — carriers and China" err={pl.err}>
          {pl.d && (<>
            <div className="grid grid-cols-2 gap-3">
              <Card label={pl.d.carrierBalanceCents < 0 ? 'Prepaid with carriers (asset)' : 'Owed to carriers'} value={$(Math.abs(pl.d.carrierBalanceCents))} sub="invoices + manager fees − credits − payments" tone={pl.d.carrierBalanceCents > 0 ? 'warn' : 'good'} />
              <Card label="China POs open" value={$(pl.d.chinaPurchaseOrders.openCents)} sub="PO total + freight − payments recorded" tone="warn" />
            </div>
            <div className="rounded-xl border border-slate-700"><table className="w-full"><thead className="bg-slate-950"><tr><Th>Carrier</Th><Th right>Invoiced</Th><Th right>Mgr fees</Th><Th right>Credits</Th><Th right>Paid</Th><Th right>Balance</Th><Th>Last paid</Th></tr></thead><tbody>
              {pl.d.carriers.map((c: any) => <tr key={c.carrierType} className="border-t border-slate-800"><Td>{c.carrierType} <span className="text-slate-500">({c.invoices} inv.)</span></Td><Td right>{$(c.invoicedCents)}</Td><Td right>{$(c.managerFeeCents)}</Td><Td right>−{$(c.creditsCents)}</Td><Td right>{$(c.paidCents)}</Td><Td right cls={c.balanceCents > 0 ? 'text-amber-700' : 'text-emerald-700'}>{$(c.balanceCents)}</Td><Td cls="text-slate-300">{ago(c.lastPaymentAt)}</Td></tr>)}
            </tbody></table></div>
            <div className="text-xs text-slate-400">China POs by status: {pl.d.chinaPurchaseOrders.byStatus.map((r: any) => `${r.status} ${r.orders} = ${$(r.totalCents)} (paid ${$(r.paidCents)})`).join(' · ')}. PO payments recorded in ShipSourced may lag the bank; reconcile against the ledger before treating "open" as owed.</div>
          </>)}
        </Feed>
        <Feed title="Recurring revenue" err={sub.err}>
          {sub.d && (<>
            <div className="grid grid-cols-3 gap-3"><Card label="MRR" value={$(sub.d.totals.mrrCents)} sub={`${sub.d.totals.subscribers} subscribers`} tone="good" /><Card label="In trial" value={n(sub.d.totals.inTrial)} /><Card label={`Charged in ${sub.d.month}`} value={$(sub.d.totals.chargedThisMonthCents)} tone={sub.d.totals.chargedThisMonthCents < sub.d.totals.mrrCents ? 'warn' : 'good'} /></div>
            <div className="rounded-xl border border-slate-700"><table className="w-full"><thead className="bg-slate-950"><tr><Th>Client</Th><Th right>Email</Th><Th right>Ads</Th><Th right>Software</Th><Th right>Storage</Th><Th right>MRR</Th><Th>This month</Th></tr></thead><tbody>
              {sub.d.clients.map((c: any) => <tr key={c.clientId} className="border-t border-slate-800"><Td>{c.company}{c.emailAssistant.inTrial ? <span className="ml-1 text-[10px] text-emerald-700">trial</span> : null}{c.storageWaived ? <span className="ml-1 text-[10px] text-slate-500">storage waived</span> : null}</Td><Td right>{$(c.mrr.emailCents)}</Td><Td right>{$(c.mrr.adCents)}</Td><Td right>{$(c.mrr.softwareCents)}</Td><Td right>{$(c.mrr.storageCents)}</Td><Td right cls="font-semibold">{$(c.mrr.totalCents)}</Td><Td cls="text-slate-300">{Object.entries(c.chargedThisMonth).map(([k, v]: any) => `${k} ${$(v)}`).join(', ') || '—'}</Td></tr>)}
            </tbody></table></div>
          </>)}
        </Feed>
        <Feed title="Inventory at cost" err={inv.err}>
          {inv.d && (<>
            <div className="grid grid-cols-3 gap-3"><Card label="Stock value" value={$(inv.d.totals.valueCents)} sub={`${n(inv.d.totals.units)} units, ${n(inv.d.totals.skus)} SKUs`} /><Card label="Units without a cost" value={n(inv.d.totals.unknownCostUnits)} sub="counted, not valued" tone={inv.d.totals.unknownCostUnits ? 'warn' : 'good'} /><Card label="By warehouse" value={inv.d.byWarehouse.map((w: any) => `${w.key.split(':')[0]} ${$(w.valueCents)}`).join(' · ')} /></div>
            <div className="max-h-64 overflow-auto rounded-xl border border-slate-700"><table className="w-full"><thead className="bg-slate-950"><tr><Th>Client</Th><Th right>Units</Th><Th right>Value</Th><Th right>No cost</Th><Th right>SKUs</Th></tr></thead><tbody>
              {[...inv.d.byClient].sort((a: any, b: any) => b.valueCents - a.valueCents).map((c: any) => <tr key={c.key} className="border-t border-slate-800"><Td>{c.key}</Td><Td right>{n(c.units)}</Td><Td right>{$(c.valueCents)}</Td><Td right cls={c.unknownCostUnits ? 'text-amber-700' : 'text-slate-500'}>{n(c.unknownCostUnits)}</Td><Td right>{n(c.skus)}</Td></tr>)}
            </tbody></table></div>
          </>)}
        </Feed>
        <Feed title="Chargebacks" err={cb.err}>
          {cb.d && (<>
            <div className="grid grid-cols-3 gap-3"><Card label="Open exposure" value={$(cb.d.totals.openCents)} sub={`${cb.d.totals.open} disputes`} tone={cb.d.totals.open ? 'warn' : 'good'} /><Card label="Lost" value={$(cb.d.totals.lostCents)} tone="bad" /><Card label="Won" value={$(cb.d.totals.wonCents)} tone="good" /></div>
            <div className="rounded-xl border border-slate-700"><table className="w-full"><thead className="bg-slate-950"><tr><Th>Client</Th><Th right>Open</Th><Th right>Exposure</Th><Th right>Won</Th><Th right>Lost</Th><Th right>Win rate</Th></tr></thead><tbody>
              {cb.d.clients.map((c: any) => <tr key={c.clientId} className="border-t border-slate-800"><Td>{c.company}</Td><Td right>{c.open}</Td><Td right>{$(c.openCents)}</Td><Td right>{c.won}</Td><Td right>{c.lost}</Td><Td right>{c.winRate == null ? '—' : `${c.winRate}%`}</Td></tr>)}
            </tbody></table></div>
          </>)}
        </Feed>
        <Feed title="Write-offs and at-risk money" err={wo.err}>
          {wo.d && (<>
            <div className="grid grid-cols-3 gap-3"><Card label="At risk" value={$(wo.d.totals.atRiskCents)} sub={`${wo.d.atRisk.length} clients`} tone={wo.d.totals.atRiskCents ? 'bad' : 'good'} /><Card label="Inactive, still owing" value={$(wo.d.totals.inactiveOwingCents)} tone="bad" /><Card label="Voided charges" value={$(wo.d.totals.voidedChargesCents)} sub={`${wo.d.totals.voidedCharges} rows`} /></div>
            <div className="max-h-64 overflow-auto rounded-xl border border-slate-700"><table className="w-full"><thead className="bg-slate-950"><tr><Th>Client</Th><Th right>Open</Th><Th right>90+</Th><Th>Last payment</Th><Th>Why</Th></tr></thead><tbody>
              {wo.d.atRisk.map((c: any) => <tr key={c.clientId} className="border-t border-slate-800"><Td><span className={c.isActive ? '' : 'text-slate-500 line-through'}>{c.company}</span></Td><Td right>{$(c.openCents)}</Td><Td right cls="text-red-600">{$(c.over90Cents)}</Td><Td cls="text-slate-300">{ago(c.lastPaymentAt)}</Td><Td cls="text-slate-300">{c.reason}</Td></tr>)}
            </tbody></table></div>
          </>)}
        </Feed>
      </div>
    </div>
  );
}
