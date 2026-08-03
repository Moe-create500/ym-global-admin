'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';

const fmt = (cents: number) => '$' + (Math.abs(cents || 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
const dayLabel = (dateStr: string) => new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
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

function StatementEditor({ card, onSaved }: { card: any; onSaved: () => void }) {
  const [bal, setBal] = useState(card.stmtBalanceCents != null ? String(card.stmtBalanceCents / 100) : '');
  const [due, setDue] = useState(card.dueDate || '');
  const [minPay, setMinPay] = useState(card.minPaymentCents != null ? String(card.minPaymentCents / 100) : '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    await fetch('/api/transactions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'statement', accountId: card.id,
        statementBalanceCents: bal ? Math.round(parseFloat(bal) * 100) : null,
        dueDate: due || null,
        minPaymentCents: minPay ? Math.round(parseFloat(minPay) * 100) : null,
      }),
    });
    setSaving(false);
    onSaved();
  };
  return (
    <div className="flex flex-wrap items-end gap-3 text-[11px]">
      <span className="text-slate-400 font-medium">Statement for ··{card.last4}:</span>
      <label className="text-slate-500">balance $<input type="number" step="0.01" value={bal} onChange={e => setBal(e.target.value)} className="ml-1 w-24 bg-slate-900 border border-slate-600 rounded px-1.5 py-1 text-white" /></label>
      <label className="text-slate-500">due <input type="date" value={due} onChange={e => setDue(e.target.value)} className="ml-1 bg-slate-900 border border-slate-600 rounded px-1.5 py-1 text-white" /></label>
      <label className="text-slate-500">min $<input type="number" step="0.01" value={minPay} onChange={e => setMinPay(e.target.value)} placeholder="opt" className="ml-1 w-20 bg-slate-900 border border-slate-600 rounded px-1.5 py-1 text-white" /></label>
      <button onClick={save} disabled={saving} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded font-semibold">{saving ? 'saving…' : 'save'}</button>
      <span className="text-slate-600">from the card&apos;s latest statement — drives the PAY amount and due-date urgency</span>
    </div>
  );
}

function ClassChip({ cls }: { cls: string | null }) {
  const c = cls || 'other';
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${CLASS_COLORS[c] || CLASS_COLORS.other}`}>{CLASS_LABELS[c] || c}</span>;
}

export default function TransactionsPage() {
  const [tab, setTab] = useState<'cards' | 'payplan' | 'truth' | 'ledger' | 'payments'>('payplan');
  const [truth, setTruth] = useState<any>(null);
  const [truthDays, setTruthDays] = useState(90);
  const [payPlan, setPayPlan] = useState<any>(null);
  const [payPlanLoading, setPayPlanLoading] = useState(false);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [bankSync, setBankSync] = useState<'syncing' | 'fresh' | 'error' | ''>('');
  const [bankSyncNote, setBankSyncNote] = useState('');
  const [whyCard, setWhyCard] = useState<string | null>(null);
  const [prLabel, setPrLabel] = useState(''); const [prAmount, setPrAmount] = useState('');
  const [prDue, setPrDue] = useState(''); const [prRecur, setPrRecur] = useState('once');
  const payrollAction = async (body: any) => {
    await fetch('/api/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    loadPayPlan();
  };
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
  // One-off billing: select rows → bill to a store's books (P&L other costs)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [billStore, setBillStore] = useState('');
  const [billing, setBilling] = useState(false);
  const [billMsg, setBillMsg] = useState('');
  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const billSelected = async () => {
    if (!billStore || selected.size === 0) return;
    setBilling(true); setBillMsg('');
    const r = await fetch('/api/transactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'bill_to_store', txnIds: [...selected], storeId: billStore }),
    });
    const d = await r.json();
    setBilling(false);
    if (d.error) { setBillMsg(`✗ ${d.error}`); return; }
    setBillMsg(`✓ billed ${d.billed} txn${d.billed === 1 ? '' : 's'} ($${(d.totalCents / 100).toFixed(2)}) to ${d.store}${d.skipped ? ` · ${d.skipped} already billed, skipped` : ''}`);
    setSelected(new Set());
    loadLedger();
  };

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
  const [health, setHealth] = useState<any>(null);
  const loadPayPlan = useCallback(() => {
    setPayPlanLoading(true);
    fetch('/api/transactions?view=payplan', { cache: 'no-store' }).then(r => r.json()).then(setPayPlan).finally(() => setPayPlanLoading(false));
    fetch('/api/transactions?view=health', { cache: 'no-store' }).then(r => r.json()).then(setHealth).catch(() => {});
  }, []);

  useEffect(() => { loadSummary(); loadCards(); }, [loadSummary, loadCards]);

  // Real balances every time: opening the page pulls fresh Teller data
  // (server-side throttled to 5 min), then reloads whatever is on screen.
  useEffect(() => {
    let cancelled = false;
    setBankSync('syncing');
    setBankSyncNote('syncing balances…');
    fetch('/api/transactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync-banks' }),
    })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.error) { setBankSync('error'); setBankSyncNote(`balance sync failed: ${d.error}`); return; }
        setBankSync('fresh');
        if (d.skipped) setBankSyncNote(`balances fresh (synced ${Math.max(1, Math.round((d.ageSeconds || 0) / 60))}m ago)`);
        else {
          setBankSyncNote(`balances live · ${d.accounts} accounts synced${d.errors?.length ? ` · ${d.errors.length} bank errors` : ''}`);
          // fresh data landed — reload everything currently visible
          loadSummary(); loadCards(); loadPayPlan();
        }
      })
      .catch(() => { if (!cancelled) { setBankSync('error'); setBankSyncNote('balance sync failed'); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (tab === 'ledger') loadLedger(); }, [tab, loadLedger]);
  useEffect(() => { if (tab === 'payments') loadPayments(); }, [tab, loadPayments]);
  useEffect(() => { if (tab === 'truth') loadTruth(); }, [tab, loadTruth]);
  useEffect(() => { if (tab === 'payplan') loadPayPlan(); }, [tab, loadPayPlan]);

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
          {bankSyncNote && (
            <span className={`text-xs flex items-center gap-1.5 ${bankSync === 'error' ? 'text-red-400' : bankSync === 'syncing' ? 'text-blue-300' : 'text-emerald-400'}`}>
              {bankSync === 'syncing' && <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />}
              {bankSync === 'fresh' && '🏦'} {bankSyncNote}
            </span>
          )}
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
        {([['payplan', '⚡ Operations'], ['cards', 'Card Intelligence'], ['truth', 'Source of Truth'], ['ledger', 'Ledger'], ['payments', 'Payments']] as const).map(([k, label]) => (
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

      {tab === 'payplan' && (
        <div>
          {payPlanLoading && <p className="text-sm text-slate-500 animate-pulse py-6">Loading operations…</p>}
          {payPlan && !payPlanLoading && (() => {
            const p = payPlan.position;
            const sVerdict: Record<string, { t: string; c: string }> = {
              covers: { t: 'PAY ALL', c: 'text-emerald-400' },
              partial: { t: 'PAY PART', c: 'text-amber-400' },
              ads_eat_it: { t: 'ADS FIRST', c: 'text-orange-400' },
              no_cashflow: { t: 'NO FLOW', c: 'text-red-400' },
              no_feed: { t: 'NO FEED', c: 'text-slate-500' },
            };
            const cAction = (c: any) => {
              const fundStr = (c.funding || []).map((f: any) => `${f.source} ${fmt2(f.cents)}`).join(' + ');
              if (c.verdict === 'no_statement') return { t: 'ENTER STATEMENT →', c: 'text-slate-500', tip: 'no statement balance/due date entered — amount due unknown' };
              if (c.verdict === 'pay_full') return { t: `PAY ${fmt2(c.payNowCents)}`, c: c.daysToDue != null && c.daysToDue <= 3 ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold', tip: `funded by: ${fundStr}` };
              if (c.verdict === 'pay_partial') return { t: `PAY ${fmt2(c.payNowCents)} · SHORT ${fmt2(c.shortCents)}`, c: c.minCovered === false ? 'text-red-400 font-bold' : 'text-amber-400 font-bold', tip: `funded by: ${fundStr}${c.minCovered === false ? ' — DOES NOT COVER MIN PAYMENT' : ''}` };
              return { t: 'NOT FUNDED', c: 'text-red-400', tip: 'no owner-store cashflow and no company cash left' };
            };
            const thCls = 'text-left text-[9px] uppercase tracking-wider text-slate-600 px-3 py-1.5 font-semibold';
            const thR = thCls + ' text-right';
            const td = 'px-3 py-[7px] tabular-nums';
            return (
              <>
                {/* ── STATUS BAR ── */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 mb-3 text-[12px] tabular-nums">
                  <span className="text-slate-500">CASH <span className="text-white font-bold">{fmt2(p.cash_available_cents)}</span></span>
                  <span className="text-slate-500">SAFE TODAY <span className="text-emerald-400 font-bold">{fmt2(p.safe_to_pay_today_cents)}</span></span>
                  <span className="text-slate-500">LANDING 7D <span className="text-emerald-300 font-bold">{fmt2(p.incoming_7d_cents)}</span></span>
                  <span className="text-slate-500">AD BURN <span className="text-orange-400 font-bold">{fmt2(p.ad_burn_daily_cents)}/d</span></span>
                  <span className="text-slate-500">DEBT <span className="text-white font-bold">{fmt2(payPlan.company.debtTotalCents)}</span></span>
                  <span className="text-slate-500">FB UNBILLED <span className="text-blue-300 font-bold">{fmt2(p.fb_unbilled_cents)}</span></span>
                  {payPlan.campaignsToday?.cents > 0 && (
                    <span className="text-slate-500">ADS TODAY <span className="text-orange-300 font-bold">{fmt2(payPlan.campaignsToday.cents)}</span> <span className="text-slate-600">({payPlan.campaignsToday.n} campaigns)</span></span>
                  )}
                  {payPlan.payroll?.due7Cents > 0 && (
                    <span className="text-slate-500">PAYROLL 7D <span className="text-rose-300 font-bold">{fmt2(payPlan.payroll.due7Cents)}</span></span>
                  )}
                  <span className="ml-auto text-slate-600">{payPlan.generatedAt}</span>
                </div>

                {/* ── SYSTEM SCORE — the burn-down to 10/10 ── */}
                {health && (
                  <div className={`border rounded-lg px-4 py-2.5 mb-3 ${health.score >= 9 ? 'bg-emerald-950/20 border-emerald-800/50' : 'bg-slate-900 border-amber-800/40'}`}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <span className="text-sm font-bold tabular-nums">
                        <span className={health.score >= 9 ? 'text-emerald-400' : health.score >= 6 ? 'text-amber-400' : 'text-red-400'}>{health.score.toFixed(1)}</span>
                        <span className="text-slate-600">/10</span>
                      </span>
                      <div className="w-36 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full ${health.score >= 9 ? 'bg-emerald-500' : health.score >= 6 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${health.score * 10}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-500 tabular-nums">
                        ${Math.round(health.components.dollarAttribution.attributedCents / 100).toLocaleString()} of ${Math.round(health.components.dollarAttribution.totalCents / 100).toLocaleString()} card spend traced ({health.components.dollarAttribution.score}%)
                        · feeds {health.components.cardFeeds.score}% · statements {health.components.statements.entered}/{health.components.statements.total}
                        · payments confirmed {health.components.paymentsConfirmed.score}%
                      </span>
                      {health.blockers.map((b: any, i: number) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 cursor-help" title={`${b.detail}\n→ ${b.action}`}>
                          {b.owner}: {b.label} <span className="font-bold">+{b.pts.toFixed(1)}</span>
                        </span>
                      ))}
                      {health.blockers.length === 0 && <span className="text-[10px] text-emerald-400">all feeds live — full precision</span>}
                    </div>
                  </div>
                )}

                {/* ── CARDS TABLE ── */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden mb-3">
                  <table className="w-full text-[12px]">
                    <thead><tr className="border-b border-slate-800">
                      <th className={thCls}>CARD</th>
                      <th className={thR}>STMT BAL</th>
                      <th className={thR}>DUE</th>
                      <th className={thR}>LIVE BAL</th>
                      <th className={thR}>FB INC</th>
                      <th className={thR}>UTIL</th>
                      <th className={thCls}>OWED BY</th>
                      <th className={thR}>PAY (FUNDED BY)</th>
                    </tr></thead>
                    <tbody>
                      {payPlan.cards.map((c: any) => {
                        const a = cAction(c);
                        const owners = c.owners.filter((o: any) => o.store !== '(unattributed)').map((o: any) => o.store).join(', ');
                        const editing = openCard === c.id;
                        return (
                          <Fragment key={c.id}>
                            <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                              <td className={`${td} text-slate-200 whitespace-nowrap`}>
                                <button onClick={() => setWhyCard(whyCard === c.id ? null : c.id)} className="hover:text-blue-300 text-left" title="click: why does this card owe money">
                                  {c.declining && <span className="text-red-400 mr-1">⛔</span>}{c.name.replace('American Express ', 'Amex ').replace('Bank of America ', 'BofA ').slice(0, 30)} <span className="text-slate-600">·{c.last4} {whyCard === c.id ? '▾' : '▸'}</span>
                                </button>
                              </td>
                              <td className={`${td} text-right`}>
                                <button onClick={() => setOpenCard(editing ? null : c.id)} className={c.stmtBalanceCents != null ? 'text-white font-medium hover:text-blue-300' : 'text-slate-500 hover:text-blue-300 underline decoration-dotted'}>
                                  {c.stmtBalanceCents != null ? fmt2(c.stmtBalanceCents) : 'set'}
                                </button>
                              </td>
                              <td className={`${td} text-right whitespace-nowrap ${c.daysToDue == null ? 'text-slate-600' : c.daysToDue <= 3 ? 'text-red-400 font-bold' : c.daysToDue <= 7 ? 'text-amber-400' : 'text-slate-300'}`}>
                                {c.dueDate ? `${dayLabel(c.dueDate).replace(/^\w+, /, '')} (${c.daysToDue}d)` : '—'}
                              </td>
                              <td className={`${td} text-right text-slate-300`}>{fmt2(c.postedCents)}</td>
                              <td className={`${td} text-right ${c.fbOwedCents > 0 ? 'text-blue-300' : 'text-slate-700'}`}>{c.fbOwedCents > 0 ? fmt2(c.fbOwedCents) : '—'}</td>
                              <td className={`${td} text-right ${(c.utilization || 0) >= 100 ? 'text-red-400 font-bold' : (c.utilization || 0) >= 70 ? 'text-amber-400' : 'text-slate-400'}`}>{c.utilization != null ? `${c.utilization}%` : '—'}</td>
                              <td className={`${td} text-slate-400 max-w-[130px] truncate`} title={owners}>{owners || <span className="text-slate-600">untraced</span>}</td>
                              <td className={`${td} text-right whitespace-nowrap ${a.c}`} title={a.tip}>
                                {a.t}
                                {c.funding?.length > 0 && c.payNowCents > 0 && (
                                  <span className="block text-[10px] font-normal text-slate-500">← {(c.funding || []).map((f: any) => `${f.source} ${fmt2(f.cents)}`).join(' + ')}</span>
                                )}
                              </td>
                            </tr>
                            {editing && (
                              <tr className="bg-slate-800/40">
                                <td colSpan={8} className="px-3 py-2">
                                  <StatementEditor card={c} onSaved={() => { setOpenCard(null); loadPayPlan(); }} />
                                </td>
                              </tr>
                            )}
                            {whyCard === c.id && c.why && (
                              <tr className="bg-slate-800/30">
                                <td colSpan={8} className="px-4 py-2.5">
                                  <div className="grid md:grid-cols-3 gap-x-8 gap-y-2 text-[11px]">
                                    <div>
                                      <p className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Traced card debt · by store</p>
                                      {c.why.tracedStores.length ? c.why.tracedStores.map((o: any) => (
                                        <p key={o.store} className="flex justify-between text-slate-300"><span>{o.store}</span><span className="tabular-nums text-white">{fmt2(o.owesCents)}</span></p>
                                      )) : <p className="text-slate-600">none traced</p>}
                                      {c.why.untracedCents > 0 && <p className="flex justify-between text-slate-500"><span>untraced</span><span className="tabular-nums">{fmt2(c.why.untracedCents)}</span></p>}
                                    </div>
                                    <div>
                                      <p className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">FB unbilled → will hit this card</p>
                                      {c.why.fbAccounts.length ? c.why.fbAccounts.map((f: any) => (
                                        <p key={f.name} className="flex justify-between text-slate-300"><span>{f.declining ? '⛔ ' : ''}{f.name} · {f.store}</span><span className="tabular-nums text-blue-300">{fmt2(f.owedCents)}</span></p>
                                      )) : <p className="text-slate-600">no FB account funds from this card</p>}
                                    </div>
                                    <div>
                                      <p className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Shopify app billing · last 30d</p>
                                      {c.why.shopifyMonthly.length ? c.why.shopifyMonthly.map((s: any) => (
                                        <p key={s.store} className="flex justify-between text-slate-300"><span>{s.store}</span><span className="tabular-nums text-emerald-300">{fmt2(s.cents)}/mo</span></p>
                                      )) : <p className="text-slate-600">no Shopify billing on this card</p>}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* ── STORES TABLE ── */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden mb-3">
                  <table className="w-full text-[12px]">
                    <thead><tr className="border-b border-slate-800">
                      <th className={thCls}>STORE</th>
                      <th className={thR}>OWES</th>
                      <th className={thCls}>ON CARDS</th>
                      <th className={thR}>LANDING 7D</th>
                      <th className={thR}>ITS ADS 7D</th>
                      <th className={thR}>FREE</th>
                      <th className={thR}>CAN PAY</th>
                      <th className={thR}>STATUS</th>
                    </tr></thead>
                    <tbody>
                      {payPlan.storePlans.map((s: any) => {
                        const v = sVerdict[s.verdict] || sVerdict.no_feed;
                        const free = Math.max(0, s.committedCents - s.burn7Cents);
                        return (
                          <tr key={s.store} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                            <td className={`${td} text-white font-medium`}>{s.store}</td>
                            <td className={`${td} text-right text-white`}>{fmt2(s.owedTotal)}</td>
                            <td className={`${td} text-slate-400`}>{s.owed.map((o: any) => `·${o.last4}`).join(' ')}</td>
                            <td className={`${td} text-right text-emerald-300`}>{s.hasFeed ? fmt2(s.committedCents) : '—'}</td>
                            <td className={`${td} text-right text-orange-400`}>{fmt2(s.burn7Cents)}</td>
                            <td className={`${td} text-right ${free > 0 ? 'text-emerald-400 font-medium' : 'text-slate-600'}`}>{fmt2(free)}</td>
                            <td className={`${td} text-right font-bold ${s.canPayCents > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>{s.canPayCents > 0 ? fmt2(s.canPayCents) : '—'}</td>
                            <td className={`${td} text-right font-bold ${v.c}`}>{v.t}</td>
                          </tr>
                        );
                      })}
                      {/* Company row — untraced debt against shared cash */}
                      <tr className="bg-slate-800/20">
                        <td className={`${td} text-slate-400 font-medium`}>COMPANY <span className="text-slate-600 font-normal">(untraced — link FB cards)</span></td>
                        <td className={`${td} text-right text-slate-300`}>{fmt2(payPlan.company.untracedCents)}</td>
                        <td className={`${td} text-slate-600`}>all</td>
                        <td className={`${td} text-right text-slate-600`}>—</td>
                        <td className={`${td} text-right text-slate-600`}>—</td>
                        <td className={`${td} text-right text-emerald-400`}>{fmt2(payPlan.company.safeTodayCents)}</td>
                        <td className={`${td} text-right font-bold text-emerald-400`}>{fmt2(Math.min(payPlan.company.safeTodayCents, payPlan.company.untracedCents))}</td>
                        <td className={`${td} text-right font-bold text-amber-400`}>SHARED CASH</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* ── PAYROLL ── */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden mb-3">
                  <table className="w-full text-[12px]">
                    <thead><tr className="border-b border-slate-800">
                      <th className={thCls}>PAYROLL</th>
                      <th className={thR}>AMOUNT</th>
                      <th className={thR}>DUE</th>
                      <th className={thCls}>RECURS</th>
                      <th className={thR}></th>
                    </tr></thead>
                    <tbody>
                      {(payPlan.payroll?.items || []).map((pr: any) => {
                        const days = Math.round((new Date(pr.due_date + 'T12:00:00Z').getTime() - new Date(payPlan.generatedAt + 'T12:00:00Z').getTime()) / 86400000);
                        return (
                          <tr key={pr.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                            <td className={`${td} text-slate-200`}>{pr.label}{pr.store_name ? <span className="text-slate-500"> · {pr.store_name}</span> : ''}</td>
                            <td className={`${td} text-right text-white font-medium`}>{fmt2(pr.amount_cents)}</td>
                            <td className={`${td} text-right whitespace-nowrap ${days <= 3 ? 'text-red-400 font-bold' : days <= 7 ? 'text-amber-400' : 'text-slate-300'}`}>{dayLabel(pr.due_date)} ({days}d)</td>
                            <td className={`${td} text-slate-500`}>{pr.recurrence === 'once' ? '—' : pr.recurrence}</td>
                            <td className={`${td} text-right whitespace-nowrap`}>
                              <button onClick={() => payrollAction({ action: 'payroll_update', id: pr.id, op: 'paid' })} className="text-emerald-400 hover:text-emerald-300 mr-3">✓ paid</button>
                              <button onClick={() => payrollAction({ action: 'payroll_update', id: pr.id, op: 'delete' })} className="text-red-500/60 hover:text-red-400">✕</button>
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="bg-slate-800/20">
                        <td className={td}>
                          <input value={prLabel} onChange={e => setPrLabel(e.target.value)} placeholder="add payroll — who/what"
                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-[11px]" />
                        </td>
                        <td className={`${td} text-right`}>
                          <input type="number" step="0.01" value={prAmount} onChange={e => setPrAmount(e.target.value)} placeholder="$"
                            className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-[11px] text-right" />
                        </td>
                        <td className={`${td} text-right`}>
                          <input type="date" value={prDue} onChange={e => setPrDue(e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-[11px]" />
                        </td>
                        <td className={td}>
                          <select value={prRecur} onChange={e => setPrRecur(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-white text-[11px]">
                            <option value="once">once</option><option value="weekly">weekly</option>
                            <option value="biweekly">biweekly</option><option value="monthly">monthly</option>
                          </select>
                        </td>
                        <td className={`${td} text-right`}>
                          <button onClick={() => { if (prLabel && prAmount && prDue) { payrollAction({ action: 'payroll_add', label: prLabel, amountCents: Math.round(parseFloat(prAmount) * 100), dueDate: prDue, recurrence: prRecur }); setPrLabel(''); setPrAmount(''); setPrDue(''); } }}
                            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-semibold text-[11px]">add</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="text-[10px] text-slate-600">
                  Payroll due within 7d is paid BEFORE cards — it comes off the safe envelope first. CAN PAY = store&apos;s committed landings − 7d of its own ad burn. Click a card name for WHY it owes (traced stores · FB unbilled · Shopify billing). Full drill-down: Card Intelligence · Source of Truth · Ledger.
                </p>
              </>
            );
          })()}
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
          {(selected.size > 0 || billMsg) && (
            <div className="flex flex-wrap items-center gap-2 mb-3 bg-slate-900 border border-blue-800/50 rounded-lg px-3 py-2">
              {selected.size > 0 && (
                <>
                  <span className="text-xs text-slate-300 font-medium">{selected.size} selected</span>
                  <select value={billStore} onChange={e => setBillStore(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white">
                    <option value="">bill to store…</option>
                    {(summary?.stores || []).map((s: any) => <option key={s.id} value={s.id}>{s.id === billStore ? '→ ' : ''}{s.name}</option>)}
                  </select>
                  <button onClick={billSelected} disabled={!billStore || billing}
                    className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg">
                    {billing ? 'billing…' : '💸 Mark paid by this store (books it into P&L)'}
                  </button>
                  <button onClick={() => setSelected(new Set())} className="text-xs text-slate-500 hover:text-white">clear</button>
                </>
              )}
              {billMsg && <span className={`text-xs ${billMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{billMsg}</span>}
            </div>
          )}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-500 border-b border-slate-800">
                <th className="px-2 py-2 w-7"></th>
                <th className="px-3 py-2">Date</th><th className="px-3 py-2">Account</th><th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Type</th><th className="px-3 py-2">Store</th><th className="px-3 py-2 text-right">Amount</th>
              </tr></thead>
              <tbody>
                {ledger.rows.map(r => (
                  <tr key={r.id} className={`border-b border-slate-800/50 hover:bg-slate-800/30 ${selected.has(r.id) ? 'bg-blue-950/20' : ''}`}>
                    <td className="px-2 py-1.5">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} className="accent-blue-500" />
                    </td>
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
                            ? <span className="text-slate-200">{r.store_name}{r.confidence === 'manual' && <span className="text-slate-500"> ✎</span>}
                                {r.billed_store_at && <span className="ml-1 px-1 py-0.5 bg-emerald-500/15 text-emerald-400 rounded text-[9px] font-semibold" title={`booked into ${r.store_name}'s P&L ${String(r.billed_store_at).slice(0, 10)}`}>✓ billed</span>}
                              </span>
                            : <span className="text-slate-600 hover:text-slate-400">+ assign</span>}
                        </button>
                      )}
                    </td>
                    <td className={`px-3 py-1.5 text-right whitespace-nowrap font-medium ${r.class === 'shopify_payout' || r.class === 'card_payment' ? 'text-emerald-400' : 'text-slate-200'}`}>{fmt2(r.amount_cents)}</td>
                  </tr>
                ))}
                {!ledger.rows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No transactions match — try Scan now first</td></tr>}
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
