'use client';

import { useState, useEffect, useCallback } from 'react';

const fmt = (cents: number) => '$' + (Math.abs(cents || 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmt2 = (cents: number) => '$' + (Math.abs(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CLASS_LABELS: Record<string, string> = {
  fb_ads: 'Facebook Ads', google_ads: 'Google Ads', shopify_app: 'Shopify / Apps',
  shopify_payout: 'Shopify Payout', card_payment: 'Card Payment', card_payment_sent: 'Payment Sent',
  transfer: 'Transfer', interest_fee: 'Interest / Fees', supplier: 'Supplier',
  software: 'Software', personal: 'Personal / Other Spend', other: 'Other',
};
const CLASS_COLORS: Record<string, string> = {
  fb_ads: 'bg-blue-500/15 text-blue-400', google_ads: 'bg-amber-500/15 text-amber-400',
  shopify_app: 'bg-emerald-500/15 text-emerald-400', shopify_payout: 'bg-green-500/15 text-green-400',
  card_payment: 'bg-cyan-500/15 text-cyan-400', card_payment_sent: 'bg-cyan-500/15 text-cyan-300',
  transfer: 'bg-slate-500/15 text-slate-400', interest_fee: 'bg-red-500/15 text-red-400',
  supplier: 'bg-purple-500/15 text-purple-400', software: 'bg-indigo-500/15 text-indigo-400',
  personal: 'bg-pink-500/15 text-pink-400', other: 'bg-slate-600/20 text-slate-500',
};

function ClassChip({ cls }: { cls: string | null }) {
  const c = cls || 'other';
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${CLASS_COLORS[c] || CLASS_COLORS.other}`}>{CLASS_LABELS[c] || c}</span>;
}

export default function TransactionsPage() {
  const [tab, setTab] = useState<'cards' | 'truth' | 'ledger' | 'payments'>('cards');
  const [truth, setTruth] = useState<any>(null);
  const [truthDays, setTruthDays] = useState(90);
  const [summary, setSummary] = useState<any>(null);
  const [cards, setCards] = useState<any[]>([]);
  const [clarity, setClarity] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [ledger, setLedger] = useState<{ rows: any[]; total: number }>({ rows: [], total: 0 });
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const [cardDays, setCardDays] = useState(30);
  // ledger filters
  const [fAccount, setFAccount] = useState('');
  const [fStore, setFStore] = useState('');
  const [fClass, setFClass] = useState('');
  const [fQ, setFQ] = useState('');
  const [fUnattr, setFUnattr] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);

  const loadSummary = useCallback(() => fetch('/api/transactions?view=summary').then(r => r.json()).then(setSummary), []);
  const loadCards = useCallback(() => fetch(`/api/transactions?view=cards&days=${cardDays}`).then(r => r.json()).then(d => { setCards(d.cards || []); setClarity(d.clarity || null); }), [cardDays]);
  const loadPayments = useCallback(() => fetch('/api/transactions?view=payments&days=90').then(r => r.json()).then(d => setPayments(d.payments || [])), []);
  const loadLedger = useCallback(() => {
    const p = new URLSearchParams({ view: 'ledger', days: '90' });
    if (fAccount) p.set('accountId', fAccount);
    if (fStore) p.set('storeId', fStore);
    if (fClass) p.set('class', fClass);
    if (fQ) p.set('q', fQ);
    if (fUnattr) p.set('unattributed', '1');
    return fetch(`/api/transactions?${p}`).then(r => r.json()).then(d => setLedger({ rows: d.rows || [], total: d.total || 0 }));
  }, [fAccount, fStore, fClass, fQ, fUnattr]);

  const loadTruth = useCallback(() => fetch(`/api/transactions?view=truth&days=${truthDays}`).then(r => r.json()).then(setTruth), [truthDays]);

  useEffect(() => { loadSummary(); loadCards(); }, [loadSummary, loadCards]);
  useEffect(() => { if (tab === 'ledger') loadLedger(); }, [tab, loadLedger]);
  useEffect(() => { if (tab === 'payments') loadPayments(); }, [tab, loadPayments]);
  useEffect(() => { if (tab === 'truth') loadTruth(); }, [tab, loadTruth]);

  const runScan = async () => {
    setScanning(true); setScanMsg('');
    try {
      const r = await fetch('/api/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'scan', days: 365, force: true }) });
      const d = await r.json();
      if (d.success) {
        setScanMsg(`Scanned ${d.stats.scanned} · attributed ${d.stats.storeAttributed} · invoices ${d.stats.invoiceMatched} · payment pairs ${d.stats.paymentsPaired}`);
        loadSummary(); loadCards(); if (tab === 'ledger') loadLedger(); if (tab === 'payments') loadPayments();
      } else setScanMsg(d.error || 'Scan failed');
    } catch (e: any) { setScanMsg(String(e?.message || e)); }
    setScanning(false);
  };

  const assignStore = async (txnId: string, storeId: string) => {
    await fetch('/api/transactions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txnId, storeId: storeId || null }) });
    setAssigning(null); loadLedger();
  };

  return (
    <div className="p-6 max-w-[1500px]">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white">Transactions</h1>
          <p className="text-sm text-slate-400 mt-0.5">Bank ↔ cards ↔ invoices reconciliation — who spent what, who paid what</p>
        </div>
        <div className="flex items-center gap-3">
          {scanMsg && <span className="text-xs text-slate-400">{scanMsg}</span>}
          <button onClick={runScan} disabled={scanning}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            {scanning ? 'Scanning…' : 'Scan now'}
          </button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Total card debt</p>
            <p className="text-xl font-bold text-white mt-1">{fmt(summary.totalCardDebtCents)}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Card charges · 30d</p>
            <p className="text-xl font-bold text-amber-400 mt-1">{fmt((summary.chargesByClass30d || []).reduce((s: number, r: any) => s + r.cents, 0))}</p>
            <p className="text-[11px] text-slate-500 mt-1 truncate">
              {(summary.chargesByClass30d || []).slice(0, 3).map((r: any) => `${CLASS_LABELS[r.class] || r.class} ${fmt(r.cents)}`).join(' · ')}
            </p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Cards paid down · 30d</p>
            <p className="text-xl font-bold text-emerald-400 mt-1">{fmt(summary.cardPaid30dCents)}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Coverage · 90d</p>
            <p className="text-xl font-bold text-white mt-1">
              {summary.coverage?.total ? Math.round(100 * (summary.coverage.attributed || 0) / summary.coverage.total) : 0}%
              <span className="text-sm font-normal text-slate-500"> attributed</span>
            </p>
            <p className="text-[11px] text-slate-500 mt-1">{summary.coverage?.linked || 0}/{summary.coverage?.total || 0} classified{summary.lastScanAt ? ` · last scan ${String(summary.lastScanAt).slice(0, 16)}` : ''}</p>
          </div>
        </div>
      )}

      <div className="flex gap-1 mb-4 border-b border-slate-800">
        {([['cards', 'Card Intelligence'], ['truth', 'Source of Truth'], ['ledger', 'Ledger'], ['payments', 'Payments']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === k ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'cards' && (
        <div>
          {clarity && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Cash available to clean</p>
                <p className="text-lg font-bold text-emerald-400 mt-0.5">{fmt(clarity.cashAvailableCents)}</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Owed to Facebook (unbilled)</p>
                <p className="text-lg font-bold text-blue-400 mt-0.5">{fmt(clarity.totalFbOwedCents)}</p>
                <p className="text-[11px] text-slate-500">will hit the funding cards soon</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Payments in flight</p>
                <p className="text-lg font-bold text-cyan-400 mt-0.5">{fmt(clarity.inFlightCents)}</p>
                <p className="text-[11px] text-slate-500">left the bank, not landed on a card yet</p>
              </div>
              <div className={`rounded-xl p-3 border ${clarity.unmappedFbCents > 0 ? 'bg-amber-500/5 border-amber-700/40' : 'bg-slate-900 border-slate-800'}`}>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">FB owed on unlinked cards</p>
                <p className={`text-lg font-bold mt-0.5 ${clarity.unmappedFbCents > 0 ? 'text-amber-400' : 'text-slate-500'}`}>{fmt(clarity.unmappedFbCents)}</p>
                {clarity.unmappedFbCents > 0 && (
                  <p className="text-[11px] text-amber-500/80 truncate" title={clarity.unmappedFb.map((p: any) => `${p.name} (${p.store}) ${fmt(p.owedCents)}${p.card_last4 ? ` → ··${p.card_last4}` : ' → no card on FB'}`).join(' · ')}>
                    {clarity.unmappedFb.slice(0, 2).map((p: any) => `${p.name} ${fmt(p.owedCents)}${p.card_last4 ? ` → ··${p.card_last4} not linked` : ''}`).join(' · ')}
                  </p>
                )}
              </div>
            </div>
          )}
          {clarity && clarity.inFlight?.length > 0 && (
            <div className="bg-cyan-500/5 border border-cyan-800/40 rounded-xl px-4 py-2.5 mb-4">
              <p className="text-[11px] uppercase tracking-wide text-cyan-500 mb-1">In-flight — sent but not landed on any card</p>
              {clarity.inFlight.slice(0, 5).map((p: any) => (
                <p key={p.id} className="text-xs text-slate-300">{p.date} · {fmt2(p.cents)} from {p.from_account} ··{p.from_last4} <span className="text-slate-500">— {String(p.description || '').slice(0, 60)}</span></p>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-slate-500">Window:</span>
            {[30, 60, 90].map(d => (
              <button key={d} onClick={() => setCardDays(d)}
                className={`px-2.5 py-1 rounded text-xs ${cardDays === d ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>{d}d</button>
            ))}
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            {cards.map(c => {
              const charges = (c.drivers || []).reduce((s: number, r: any) => s + r.cents, 0);
              const paid = (c.payments || []).reduce((s: number, r: any) => s + r.cents, 0);
              const cl = clarity?.perCard?.[c.id];
              return (
                <div key={c.id} className={`bg-slate-900 border rounded-xl p-4 ${cl?.declining ? 'border-red-700/60' : 'border-slate-800'}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{c.institution_name} · {c.account_name} <span className="text-slate-500">··{c.last_four}</span>
                        {cl?.declining && <span className="ml-2 px-1.5 py-0.5 bg-red-500/15 text-red-400 rounded text-[10px] font-semibold">DECLINING ON FB</span>}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">as of {c.bank_data_as_of || '—'}{cl?.utilizationPct != null ? ` · ${cl.utilizationPct}% utilized` : ''}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-white">{fmt(c.balance_ledger_cents)}</p>
                      {c.credit_limit_cents > 0 && <p className="text-[11px] text-slate-500">avail {fmt(c.credit_limit_cents)}</p>}
                    </div>
                  </div>
                  {cl && (
                    <div className="mt-3 bg-slate-800/50 border border-slate-700/60 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] uppercase tracking-wide text-slate-500">To clear this card</span>
                        <span className="text-base font-bold text-white">{fmt2(cl.toClearCents)}</span>
                      </div>
                      <div className="mt-1 space-y-0.5 text-[11px] text-slate-400">
                        <div className="flex justify-between"><span>Posted balance</span><span>{fmt2(cl.postedCents)}</span></div>
                        {cl.pendingHoldsCents > 0 && <div className="flex justify-between text-amber-400/90"><span>+ pending holds ({cl.pendingHoldsN})</span><span>{fmt2(cl.pendingHoldsCents)}</span></div>}
                        {cl.fbOwedCents > 0 && <div className="flex justify-between text-blue-400/90"><span>+ FB unbilled incoming</span><span>{fmt2(cl.fbOwedCents)}</span></div>}
                        {cl.paymentsLandingCents > 0 && <div className="flex justify-between text-emerald-400/90"><span>− payment landing</span><span>{fmt2(cl.paymentsLandingCents)}</span></div>}
                      </div>
                      {cl.fbProfiles?.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {cl.fbProfiles.map((p: any) => (
                            <span key={p.name} className={`px-1.5 py-0.5 rounded text-[10px] ${p.declining ? 'bg-red-500/15 text-red-400' : 'bg-blue-500/10 text-blue-300'}`}>
                              FB {p.name} · {p.store} owes {fmt(p.owedCents)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex gap-4 mt-3 text-xs">
                    <span className="text-amber-400">+{fmt(charges)} charged · {cardDays}d</span>
                    <span className="text-emerald-400">−{fmt(paid)} paid</span>
                  </div>
                  <div className="mt-3 space-y-1">
                    {(c.drivers || []).slice(0, 5).map((r: any) => (
                      <div key={r.class} className="flex items-center justify-between text-xs">
                        <ClassChip cls={r.class} />
                        <div className="flex-1 mx-2 h-1.5 bg-slate-800 rounded overflow-hidden">
                          <div className="h-full bg-blue-500/60" style={{ width: `${charges ? Math.round(100 * r.cents / charges) : 0}%` }} />
                        </div>
                        <span className="text-slate-300 w-16 text-right">{fmt(r.cents)}</span>
                      </div>
                    ))}
                  </div>
                  {(c.byStore || []).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(c.byStore || []).map((s: any) => (
                        <span key={s.store} className="px-2 py-0.5 bg-slate-800 rounded text-[11px] text-slate-300">{s.store} {fmt(s.cents)}</span>
                      ))}
                    </div>
                  )}
                  {(c.payments || []).length > 0 && (
                    <div className="mt-3 border-t border-slate-800 pt-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Payments received</p>
                      {(c.payments || []).slice(0, 4).map((pmt: any) => (
                        <div key={pmt.id} className="flex justify-between text-xs text-slate-400">
                          <span>{pmt.date} {pmt.from_account ? `← ${pmt.from_account} ··${pmt.from_last4}` : '← source unknown'}</span>
                          <span className="text-emerald-400">{fmt2(pmt.cents)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'truth' && truth && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-slate-500">Window:</span>
            {[30, 60, 90, 180].map(dd => (
              <button key={dd} onClick={() => setTruthDays(dd)}
                className={`px-2.5 py-1 rounded text-xs ${truthDays === dd ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>{dd}d</button>
            ))}
          </div>

          {/* Ad spend lifecycle — accrued → billed → on card → settled */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-white">Ad Spend Truth — paid vs not, per store · {truth.windowDays}d</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Accrued (what FB delivered) → Billed (FB invoiced) → on a card unpaid → Settled. Gap = accrued − billed − FB unbilled: should be ≈ $0; anything else is a data or config problem.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-slate-500 border-b border-slate-800">
                  <th className="px-3 py-2">Store</th>
                  <th className="px-3 py-2 text-right">Accrued</th>
                  <th className="px-3 py-2 text-right">Billed by FB</th>
                  <th className="px-3 py-2 text-right">FB unbilled (owed)</th>
                  <th className="px-3 py-2 text-right">Riding unpaid on cards</th>
                  <th className="px-3 py-2 text-right">Settled ✓</th>
                  <th className="px-3 py-2 text-right">Billed, not in banking</th>
                  <th className="px-3 py-2 text-right">Gap</th>
                </tr></thead>
                <tbody>
                  {truth.adTruth.map((r: any) => (
                    <tr key={r.store} className="border-b border-slate-800/50">
                      <td className="px-3 py-1.5 text-slate-200 font-medium">{r.store}</td>
                      <td className="px-3 py-1.5 text-right text-slate-200">{fmt2(r.accruedCents)}</td>
                      <td className="px-3 py-1.5 text-right text-slate-300">{fmt2(r.billedCents)}</td>
                      <td className="px-3 py-1.5 text-right text-blue-400">{r.unbilledCents ? fmt2(r.unbilledCents) : '—'}</td>
                      <td className="px-3 py-1.5 text-right text-amber-400">{r.ridingUnpaidCents ? fmt2(r.ridingUnpaidCents) : '—'}</td>
                      <td className="px-3 py-1.5 text-right text-emerald-400">{r.settledCents ? fmt2(r.settledCents) : '—'}</td>
                      <td className="px-3 py-1.5 text-right">{r.billedNotSeenCents > 100 ? <span className="text-amber-500">{fmt2(r.billedNotSeenCents)} ⚠</span> : <span className="text-slate-600">—</span>}</td>
                      <td className="px-3 py-1.5 text-right">
                        {Math.abs(r.gapCents) <= Math.max(2000, r.accruedCents * 0.03)
                          ? <span className="text-emerald-500">✓ ties</span>
                          : <span className="text-red-400">{r.gapCents > 0 ? '+' : '−'}{fmt2(Math.abs(r.gapCents))}</span>}
                      </td>
                    </tr>
                  ))}
                  {!truth.adTruth.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">No ad spend in window</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Card balance composition — what each total is held of */}
          <h3 className="text-sm font-semibold text-white mb-2">What each card balance is made of</h3>
          <p className="text-[11px] text-slate-500 mb-3">Charges newest-first until they add up to the posted balance — the exact unpaid charges behind each total. &quot;Unexplained&quot; = balance the transaction history can&apos;t account for (pre-history debt, interest capitalization).</p>
          <div className="grid lg:grid-cols-2 gap-4">
            {truth.composition.filter((c: any) => c.postedCents > 0).map((c: any) => (
              <div key={c.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <p className="text-sm font-semibold text-white">{c.institution} · {c.name} <span className="text-slate-500">··{c.last4}</span></p>
                  <p className="text-base font-bold text-white">{fmt2(c.postedCents)}</p>
                </div>
                <p className="text-[11px] text-slate-500 mb-2">{c.explainedPct}% explained by charges since {c.oldestUnpaidDate || '—'}</p>
                <div className="space-y-1">
                  {c.groups.slice(0, 8).map((g: any) => (
                    <div key={`${g.class}|${g.store}`} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5"><ClassChip cls={g.class} /><span className="text-slate-400">{g.store}</span><span className="text-slate-600">×{g.n}</span></span>
                      <span className="text-slate-200 font-medium">{fmt2(g.cents)}</span>
                    </div>
                  ))}
                  {c.groups.length > 8 && <p className="text-[11px] text-slate-500">+ {c.groups.length - 8} more groups</p>}
                  {c.unexplainedCents > 0 && (
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800">
                      <span className="text-red-400/90">Unexplained (pre-history / interest)</span>
                      <span className="text-red-400 font-medium">{fmt2(c.unexplainedCents)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'ledger' && summary && (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select value={fAccount} onChange={e => setFAccount(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white">
              <option value="">All accounts</option>
              {(summary.accounts || []).map((a: any) => <option key={a.id} value={a.id}>{a.account_type === 'credit' ? '💳' : '🏦'} {a.institution_name} {a.account_name} ··{a.last_four}</option>)}
            </select>
            <select value={fStore} onChange={e => setFStore(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white">
              <option value="">All stores</option>
              {(summary.stores || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={fClass} onChange={e => setFClass(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white">
              <option value="">All types</option>
              {Object.entries(CLASS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input value={fQ} onChange={e => setFQ(e.target.value)} placeholder="Search description…"
              className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white w-44" />
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <input type="checkbox" checked={fUnattr} onChange={e => setFUnattr(e.target.checked)} /> unattributed only
            </label>
            <span className="text-xs text-slate-500 ml-auto">{ledger.total.toLocaleString()} transactions</span>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-500 border-b border-slate-800">
                <th className="px-3 py-2">Date</th><th className="px-3 py-2">Account</th><th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Type</th><th className="px-3 py-2">Store</th><th className="px-3 py-2 text-right">Amount</th>
              </tr></thead>
              <tbody>
                {ledger.rows.map(r => (
                  <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{r.date}</td>
                    <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{r.account_type === 'credit' ? '💳' : '🏦'} ··{r.last_four}</td>
                    <td className="px-3 py-1.5 text-slate-300 max-w-[360px] truncate" title={r.description}>{r.description}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <ClassChip cls={r.class} />
                      {r.match_score != null && (() => {
                        let ev: any = {};
                        try { ev = JSON.parse(r.match_evidence || '{}'); } catch {}
                        const pct = Math.round(r.match_score * 100);
                        const tip = `invoice ${ev.invoiceDate || '?'} → posted ${ev.txnDate || '?'} (+${ev.lagDays ?? '?'}d) · card ${ev.card || '?'} · ${ev.candidates || 1} candidate${(ev.candidates || 1) > 1 ? 's' : ''}${ev.review ? ` · runner-up ${Math.round((ev.runnerUpScore || 0) * 100)}% — too close to call` : ''}`;
                        return ev.review
                          ? <span title={tip} className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-400 cursor-help">review?</span>
                          : <span title={tip} className={`ml-1 px-1.5 py-0.5 rounded text-[10px] cursor-help ${pct >= 70 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'}`}>{pct}%</span>;
                      })()}
                    </td>
                    <td className="px-3 py-1.5">
                      {assigning === r.id ? (
                        <select autoFocus defaultValue={r.store_id || ''} onChange={e => assignStore(r.id, e.target.value)} onBlur={() => setAssigning(null)}
                          className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-[11px] text-white">
                          <option value="">— none —</option>
                          {(summary.stores || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      ) : (
                        <button onClick={() => setAssigning(r.id)} className="text-left">
                          {r.store_name
                            ? <span className="text-slate-200">{r.store_name}{r.confidence === 'manual' && <span className="text-slate-500"> ✎</span>}</span>
                            : <span className="text-slate-600 hover:text-slate-400">+ assign</span>}
                        </button>
                      )}
                    </td>
                    <td className={`px-3 py-1.5 text-right whitespace-nowrap font-medium ${r.class === 'shopify_payout' || r.class === 'card_payment' ? 'text-emerald-400' : 'text-slate-200'}`}>{fmt2(r.amount_cents)}</td>
                  </tr>
                ))}
                {!ledger.rows.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No transactions match — try Scan now first</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'payments' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500 border-b border-slate-800">
              <th className="px-3 py-2">Date</th><th className="px-3 py-2">Card</th><th className="px-3 py-2">Paid from</th><th className="px-3 py-2 text-right">Amount</th>
            </tr></thead>
            <tbody>
              {payments.map(pmt => (
                <tr key={pmt.id} className="border-b border-slate-800/50">
                  <td className="px-3 py-1.5 text-slate-400">{pmt.date}</td>
                  <td className="px-3 py-1.5 text-slate-200">{pmt.card_institution} {pmt.card_name} ··{pmt.card_last4}</td>
                  <td className="px-3 py-1.5">{pmt.from_account ? <span className="text-slate-300">{pmt.from_account} ··{pmt.from_last4}</span> : <span className="text-amber-500/80">unmatched — source unknown</span>}</td>
                  <td className="px-3 py-1.5 text-right text-emerald-400 font-medium">{fmt2(pmt.cents)}</td>
                </tr>
              ))}
              {!payments.length && <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-500">No card payments in window — run a scan</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
