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

function StatementEditor({ card, onSaved, compact }: { card: any; onSaved: () => void; compact?: boolean }) {
  const [bal, setBal] = useState(card.stmtBalanceCents != null ? String(card.stmtBalanceCents / 100) : '');
  const [stmtDate, setStmtDate] = useState(card.stmtDate || '');
  const [due, setDue] = useState(card.dueDate || '');
  const [minPay, setMinPay] = useState(card.minPaymentCents != null ? String(card.minPaymentCents / 100) : '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    setSaving(true);
    await fetch('/api/transactions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'statement', accountId: card.id,
        statementBalanceCents: bal ? Math.round(parseFloat(bal) * 100) : null,
        statementDate: stmtDate || null,
        dueDate: due || null,
        minPaymentCents: minPay ? Math.round(parseFloat(minPay) * 100) : null,
      }),
    });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
    onSaved();
  };
  const inp = 'bg-slate-950 border border-slate-700 focus:border-blue-500 rounded px-1.5 py-1 text-white outline-none';
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px]">
      {!compact && <span className="text-slate-400 font-medium">Statement for ··{card.last4}:</span>}
      <label className="text-slate-500">stmt bal $<input type="number" step="0.01" value={bal} onChange={e => setBal(e.target.value)} className={`ml-1 w-24 ${inp}`} /></label>
      <label className="text-slate-500">stmt date <input type="date" value={stmtDate} onChange={e => setStmtDate(e.target.value)} className={`ml-1 ${inp}`} /></label>
      <label className="text-slate-500">due date <input type="date" value={due} onChange={e => setDue(e.target.value)} className={`ml-1 ${inp}`} /></label>
      <label className="text-slate-500">min $<input type="number" step="0.01" value={minPay} onChange={e => setMinPay(e.target.value)} placeholder="opt" className={`ml-1 w-20 ${inp}`} /></label>
      <button onClick={save} disabled={saving} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded font-semibold">{saving ? 'saving…' : saved ? '✓ saved' : 'save'}</button>
      {!compact && <span className="text-slate-600">drives the PAY amount and due-date urgency</span>}
    </div>
  );
}

function NicknameEditor({ card, onSaved }: { card: any; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [nick, setNick] = useState(card.nickname || '');
  const save = async () => {
    await fetch('/api/transactions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'nickname', accountId: card.id, nickname: nick }),
    });
    setEditing(false);
    onSaved();
  };
  if (editing) return (
    <span className="inline-flex items-center gap-1">
      <input autoFocus value={nick} onChange={e => setNick(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        placeholder="internal name (e.g. Purebite ads card)"
        className="w-52 bg-slate-950 border border-blue-500 rounded px-1.5 py-0.5 text-[12px] text-white outline-none" />
      <button onClick={save} className="text-[10px] px-1.5 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-semibold">save</button>
    </span>
  );
  return (
    <button onClick={() => setEditing(true)} className="text-left hover:text-blue-300 group" title={`bank name: ${card.bankName || card.name}\nclick to set your internal name`}>
      <span className={card.nickname ? 'text-white font-medium' : ''}>{card.name.replace('American Express ', 'Amex ').replace('Bank of America ', 'BofA ').slice(0, 30)}</span>
      <span className="text-slate-600"> ·{card.last4}</span>
      <span className="text-slate-600 opacity-0 group-hover:opacity-100 ml-1">✏️</span>
    </button>
  );
}

function ClassChip({ cls }: { cls: string | null }) {
  const c = cls || 'other';
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${CLASS_COLORS[c] || CLASS_COLORS.other}`}>{CLASS_LABELS[c] || c}</span>;
}

export default function TransactionsPage() {
  const [tab, setTab] = useState<'command' | 'cards' | 'payplan' | 'truth' | 'ledger' | 'payments' | 'banks' | 'cc' | 'payroll' | 'adspend' | 'incoming'>('command');
  const [command, setCommand] = useState<any>(null);
  const [askQ, setAskQ] = useState('');
  const [askA, setAskA] = useState<any>(null);
  const [asking, setAsking] = useState(false);
  const [untracked, setUntracked] = useState<any>(null);
  const [accounts, setAccounts] = useState<{ banks: any[]; creditCards: any[] } | null>(null);
  const [adSpend, setAdSpend] = useState<{ spend: any[]; fbUnbilled: any[] } | null>(null);
  const [incoming, setIncoming] = useState<any>(null);
  // Company lens — the Brain knows YM and ShipSourced are different companies
  // sharing one money layer; this never blends them silently.
  const [company, setCompany] = useState<'all' | 'ymgv' | 'shipsourced'>('all');
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
  const [submittedPayments, setSubmittedPayments] = useState<any[]>([]);
  const loadPayments = useCallback(() => fetch('/api/transactions?view=payments&days=90').then(r => r.json()).then(d => {
    setPayments(d.payments?.bank || d.payments || []);
    setSubmittedPayments(d.payments?.submitted || []);
  }), []);
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
  useEffect(() => {
    if (tab === 'banks' || tab === 'cc') {
      fetch('/api/transactions?view=accounts').then(r => r.json()).then(setAccounts).catch(() => {});
      if (!payPlan) loadPayPlan(); // statement data for the credit-cards tab
    }
    if (tab === 'adspend') fetch('/api/transactions?view=adspend').then(r => r.json()).then(setAdSpend).catch(() => {});
    if (tab === 'incoming') fetch('/api/transactions?view=incoming').then(r => r.json()).then(setIncoming).catch(() => {});
    if (tab === 'command') {
      fetch('/api/brain').then(r => r.json()).then(setCommand).catch(() => {});
      fetch('/api/transactions?view=untracked').then(r => r.json()).then(setUntracked).catch(() => {});
    }
    if (tab === 'payroll' && !payPlan) loadPayPlan();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
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
        const bankNote = d.banks?.accounts != null ? `banks synced (${d.banks.accounts} accts, ${d.banks.transactions} new txns) · ` : '';
        setScanMsg(`${bankNote}Scanned ${d.stats.scanned} · attributed ${d.stats.storeAttributed} · invoices ${d.stats.invoiceMatched} · payment pairs ${d.stats.paymentsPaired}`);
        loadSummary(); loadCards(); loadPayPlan(); if (tab === 'ledger') loadLedger(); if (tab === 'payments') loadPayments();
      } else setScanMsg(d.error || 'Scan failed');
    } catch (e: any) { setScanMsg(String(e?.message || e)); }
    setScanning(false);
  };

  const assignStore = async (txnId: string, storeId: string) => {
    await fetch('/api/transactions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txnId, storeId: storeId || null }) });
    setAssigning(null); loadLedger();
  };

  // Company lens applied once, used by every panel
  const brainCards = (payPlan?.cards || []).filter((c: any) => company === 'all' || (c.company || 'ymgv') === company);
  const brainStores = (payPlan?.storePlans || []).filter((s: any) =>
    company === 'all' || ((s.store === 'ShipSourced') === (company === 'shipsourced')));

  return (
    <div className="p-6 max-w-[1500px]">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white">🧠 The Brain</h1>
          <p className="text-sm text-slate-400 mt-0.5">One money mind, two companies — who spent what, who owes what, who pays</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
            {([['all', 'ALL'], ['ymgv', 'YM'], ['shipsourced', 'SHIPSOURCED']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setCompany(k)}
                className={`text-[11px] rounded-md px-2.5 py-1 font-semibold ${company === k ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>{l}</button>
            ))}
          </div>
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
        {([['command', '🧠 Command'], ['payplan', '⚡ Operations'], ['banks', '🏦 Bank Accounts'], ['cc', '💳 Credit Cards'], ['payroll', '👥 Payroll'], ['adspend', '📣 Ad Spends'], ['incoming', '💰 Incoming Cash'], ['payments', 'Payments'], ['cards', 'Card Intelligence'], ['truth', 'Source of Truth'], ['ledger', 'Ledger']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === k ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {(tab === 'banks' || tab === 'cc') && (() => {
        if (!accounts) return <p className="text-slate-500 text-sm py-8">Loading accounts…</p>;
        const co = (r: any) => <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${r.company === 'shipsourced' ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/10 text-blue-400'}`}>{r.company === 'shipsourced' ? 'SS' : 'YM'}</span>;
        // Feed health = when the BANK last answered (balance heartbeat), not
        // the last transaction — an unused card is idle, not stale.
        const feed = (r: any) => {
          const balHours = r.balance_updated_at ? Math.round((Date.now() - new Date(r.balance_updated_at.replace(' ', 'T') + 'Z').getTime()) / 3600000) : null;
          const txnDays = r.bank_data_as_of ? Math.round((Date.now() - new Date(r.bank_data_as_of + 'T12:00:00Z').getTime()) / 86400000) : null;
          if (balHours != null && balHours <= 36) {
            return <span className="text-emerald-400 text-[10px]" title={r.last_sync_error || ''}>live{txnDays != null && txnDays > 2 ? <span className="text-slate-500"> · last txn {txnDays}d ago</span> : ''}</span>;
          }
          if (r.last_sync_error) return <span className="text-red-400 text-[10px]" title={r.last_sync_error}>⚠ reconnect needed</span>;
          if (balHours == null) return <span className="text-slate-600 text-[10px]">no feed</span>;
          return <span className="text-amber-400 text-[10px]">feed stale · {Math.round(balHours / 24)}d — reconnect</span>;
        };
        const nm = (r: any) => (r.nickname || `${r.institution_name} ${r.account_name}`).replace('American Express ', 'Amex ').replace('Bank of America ', 'BofA ').slice(0, 34);
        const thc = 'text-left text-[9px] uppercase tracking-wider text-slate-600 px-3 py-1.5 font-semibold';
        const thr = thc + ' text-right';
        const tdc = 'px-3 py-2 tabular-nums';
        if (tab === 'banks') {
          const rows = accounts.banks.filter((r: any) => company === 'all' || r.company === company);
          const totAvail = rows.reduce((s: number, r: any) => s + r.available_cents, 0);
          return (
            <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
              <table className="w-full text-[12px]">
                <thead><tr className="border-b border-slate-800">
                  <th className={thc}>ACCOUNT</th><th className={thc}>STORE</th><th className={thr}>AVAILABLE</th><th className={thr}>LEDGER</th><th className={thc}>FEED</th>
                </tr></thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className={`${tdc} text-slate-200`}>{nm(r)} <span className="text-slate-600">·{r.last_four}</span> {co(r)}</td>
                      <td className={`${tdc} text-slate-400`}>{r.store_name || <span className="text-slate-600">—</span>}</td>
                      <td className={`${tdc} text-right font-medium text-emerald-300`}>{fmt(r.available_cents)}</td>
                      <td className={`${tdc} text-right text-slate-300`}>{fmt(r.ledger_cents)}</td>
                      <td className={tdc}>{feed(r)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-800/20 font-semibold">
                    <td className={`${tdc} text-slate-400`} colSpan={2}>TOTAL AVAILABLE</td>
                    <td className={`${tdc} text-right text-emerald-400`}>{fmt(totAvail)}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          );
        }
        const stmtById = new Map((payPlan?.cards || []).map((c: any) => [c.id, c]));
        const rows = accounts.creditCards.filter((r: any) => company === 'all' || r.company === company);
        return (
          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-slate-800">
                <th className={thc}>CARD</th><th className={thr}>FULL BALANCE OWED</th><th className={thr}>LIMIT</th><th className={thr}>UTIL</th><th className={thr}>REMAINING FOR STMT</th><th className={thr}>DUE DATE</th><th className={thc}>FEED</th>
              </tr></thead>
              <tbody>
                {rows.map((r: any) => {
                  const p: any = stmtById.get(r.id);
                  const util = r.credit_limit_cents > 0 ? Math.round(100 * Math.abs(r.ledger_cents) / r.credit_limit_cents) : null;
                  return (
                    <Fragment key={r.id}>
                    <tr className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer" onClick={() => void openDrill(r.id)}>
                      <td className={`${tdc} text-slate-200`}>{nm(r)} <span className="text-slate-600">·{r.last_four}</span> {co(r)} <span className="text-slate-600">{drillCard === r.id ? '▾' : '▸'}</span></td>
                      <td className={`${tdc} text-right text-slate-200`}>{fmt(Math.abs(r.ledger_cents))}</td>
                      <td className={`${tdc} text-right text-slate-500`}>{r.credit_limit_cents ? fmt(r.credit_limit_cents) : '—'}</td>
                      <td className={`${tdc} text-right ${util == null ? 'text-slate-600' : util >= 100 ? 'text-red-400 font-bold' : util >= 70 ? 'text-amber-400' : 'text-slate-400'}`}>{util != null ? `${util}%` : '—'}</td>
                      <td className={`${tdc} text-right font-medium ${p?.remainingStmtCents === 0 ? 'text-emerald-400' : p?.remainingStmtCents != null ? 'text-white' : 'text-slate-600'}`}>
                        {p?.stmtBalanceCents == null ? '—' : p.remainingStmtCents === 0 ? 'PAID ✓' : fmt(p.remainingStmtCents ?? p.stmtBalanceCents)}
                        {(p?.inFlightLoggedCents || 0) > 0 && (p?.remainingStmtCents || 0) > 0 && (
                          <span className="block text-[9px] font-normal text-blue-300">−{fmt(p.inFlightLoggedCents)} sent ⏳</span>
                        )}
                      </td>
                      <td className={`${tdc} text-right whitespace-nowrap ${p?.daysToDue == null ? 'text-slate-600' : p.daysToDue < 0 ? 'text-red-400 font-bold' : p.daysToDue <= 3 ? 'text-red-400' : p.daysToDue <= 7 ? 'text-amber-400' : 'text-slate-300'}`}>
                        {p?.dueDate ? `${p.dueDate.slice(5)} (${p.daysToDue < 0 ? `${-p.daysToDue}d late` : `${p.daysToDue}d`})` : '—'}
                      </td>
                      <td className={tdc}>{feed(r)}</td>
                    </tr>
                    {drillCard === r.id && (
                      <tr className="bg-slate-950/60">
                        <td colSpan={7} className="px-4 py-3">
                          {!drill ? <p className="text-xs text-slate-500">decomposing the balance…</p> : (
                            <div>
                              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 mb-2">
                                <span className="text-[11px] uppercase tracking-wider text-slate-500">What composes this balance</span>
                                <span className="text-xs text-slate-300">{fmt(drill.postedCents)} decomposed into {drill.groups.length} merchant groups</span>
                                {drill.unownedCents > 0 && (
                                  <span className="text-xs font-bold text-amber-400">❓ {fmt(drill.unownedCents)} HAS NO BRAND — assign owners so the right store pays it by the due date</span>
                                )}
                                {drill.unexplainedCents > 0 && <span className="text-[10px] text-slate-600">history can&apos;t explain {fmt(drill.unexplainedCents)}</span>}
                              </div>
                              <table className="w-full text-[11px]">
                                <tbody>
                                  {drill.groups.map((g: any, gi: number) => (
                                    <tr key={gi} className={`border-b border-slate-800/40 ${!g.store_id ? 'bg-amber-950/10' : ''}`}>
                                      <td className="px-2 py-1 text-slate-200 font-medium max-w-[220px] truncate" title={g.samples.join(' · ')}>{g.merchant}</td>
                                      <td className="px-2 py-1 text-slate-500">{g.n}× · {g.firstDate.slice(5)}→{g.lastDate.slice(5)}</td>
                                      <td className="px-2 py-1"><ClassChip cls={g.class} /></td>
                                      <td className="px-2 py-1">
                                        {g.store ? <span className="text-emerald-400">{g.store}</span> : (
                                          <span className="inline-flex items-center gap-1.5">
                                            <span className="text-amber-400 font-semibold">❓ no brand</span>
                                            <select value={drillAssign[`${gi}`] || ''} onChange={e => setDrillAssign(prev => ({ ...prev, [`${gi}`]: e.target.value }))}
                                              onClick={e => e.stopPropagation()}
                                              className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-white">
                                              <option value="">assign to…</option>
                                              {(summary?.stores || []).map((st: any) => <option key={st.id} value={st.id}>{st.name}</option>)}
                                            </select>
                                            {drillAssign[`${gi}`] && (
                                              <button onClick={e => { e.stopPropagation(); void assignGroup(g, drillAssign[`${gi}`]); }}
                                                className="text-[10px] px-1.5 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-semibold">✓ + rule</button>
                                            )}
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-2 py-1 text-right tabular-nums text-white font-medium">{fmt(g.cents)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <p className="mt-1.5 text-[9px] text-slate-600">assigning a group attributes every charge in it AND creates a permanent rule — future charges from that merchant auto-attribute · groups compose the live balance exactly (newest-unpaid walk)</p>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}

      {tab === 'command' && (() => {
        if (!command) return <p className="text-slate-500 text-sm py-8">The Brain is thinking…</p>;
        const f = command.forward;
        const ask = async () => {
          if (!askQ.trim() || asking) return;
          setAsking(true); setAskA(null);
          try {
            const r = await fetch('/api/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: askQ }) });
            setAskA(await r.json());
          } catch { setAskA({ answer: 'ask failed — try again' }); }
          setAsking(false);
        };
        const coCard = (label: string, p: any, cashNow: any) => (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex-1 min-w-[280px]">
            <p className="text-[10px] uppercase tracking-widest text-slate-500">{label}</p>
            <p className="text-3xl font-bold text-emerald-400 mt-1">{fmt(p.safeToDeployCents)}</p>
            <p className="text-[11px] text-slate-500">SAFE TO DEPLOY — survives every known obligation for 14d</p>
            <div className="mt-2 space-y-0.5 text-[11px]">
              <p className="flex justify-between text-slate-400"><span>usable now</span><span className="tabular-nums text-slate-200">{fmt(cashNow.usableCents)}</span></p>
              <p className="flex justify-between text-slate-400"><span>lowest committed point (14d)</span><span className={`tabular-nums ${p.lowestCommitted14.cents < p.floorCents ? 'text-red-400 font-bold' : 'text-slate-200'}`}>{p.lowestCommitted14.cents < 0 ? '−' : ''}{fmt(p.lowestCommitted14.cents)} · {p.lowestCommitted14.date.slice(5)}</span></p>
              <p className="flex justify-between text-slate-500"><span>likely path low (14d)</span><span className="tabular-nums">{p.lowest14.cents < 0 ? '−' : ''}{fmt(p.lowest14.cents)}</span></p>
            </div>
            <p className="mt-2 text-[9px] text-slate-600 leading-relaxed" title={p.assumptions.join('\n')}>assumptions: {p.assumptions[0]} · hover for all</p>
          </div>
        );
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              {coCard('YM GLOBAL VENTURES', f.ymgv, f.cashNow.ymgv)}
              {coCard('SHIPSOURCED', f.shipsourced, f.cashNow.shipsourced)}
              <div className={`rounded-xl p-4 flex-1 min-w-[280px] border ${command.trust.trustworthy && command.integrity.ok ? 'bg-emerald-950/20 border-emerald-800/40' : 'bg-red-950/30 border-red-800/50'}`}>
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Verified</p>
                <p className={`text-xl font-bold mt-1 ${command.integrity.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {command.integrity.ok ? 'INTEGRITY ✓' : `${command.integrity.failures.length} INTEGRITY ERROR${command.integrity.failures.length > 1 ? 'S' : ''}`}
                </p>
                {command.integrity.failures.map((x: any, i: number) => (
                  <p key={i} className="text-[11px] text-red-300 mt-1">⚠ {x.detail}</p>
                ))}
                <p className={`text-[11px] mt-1 ${command.trust.trustworthy ? 'text-emerald-300' : 'text-amber-400'}`}>{command.trust.trustworthy ? 'all feeds current' : command.trust.summary}</p>
                {command.changed?.available && (
                  <div className="mt-2 border-t border-slate-800 pt-1.5">
                    <p className="text-[9px] uppercase tracking-widest text-slate-600">since {command.changed.from}</p>
                    {command.changed.changes.slice(0, 4).map((c: any, i: number) => (
                      <p key={i} className="flex justify-between text-[11px] text-slate-400"><span>{c.metric}</span><span className={`tabular-nums ${c.deltaCents > 0 ? 'text-emerald-300' : 'text-red-300'}`}>{c.deltaCents > 0 ? '+' : '−'}{fmt(c.deltaCents)}</span></p>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Recommendation — what to do next, and why */}
            <div className="bg-slate-900 border border-blue-800/50 rounded-xl px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">🧠 Brain recommendation <span className="text-slate-600 normal-case">· confidence {command.recommendation.confidence}</span></p>
              <p className="text-white font-semibold">{command.recommendation.title}{command.recommendation.cents > 0 ? ` — ${fmt(command.recommendation.cents)}` : ''}</p>
              <p className="text-sm text-blue-300 mt-0.5">→ {command.recommendation.action}</p>
              <p className="text-[11px] text-slate-500 mt-1">why: {command.recommendation.why}</p>
            </div>

            {/* WHAT MUST BE PAID — payment calendar with coverage + day-by-day paydown */}
            {command.coverage?.obligations?.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <p className="px-3 py-2 text-[11px] font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800">
                  What must be paid — pay date · coverage · day-by-day plan
                  {command.coverage.totalGapCents > 0 && <span className="text-red-400 normal-case font-bold ml-3">TOTAL GAP {fmt(command.coverage.totalGapCents)}</span>}
                </p>
                {command.coverage.obligations.map((o: any, i: number) => {
                  const chip = o.status === 'funded' ? ['🟢 FUNDED', 'text-emerald-400'] : o.status === 'funded_if_payout_lands' ? ['🟡 IF PAYOUTS LAND', 'text-amber-400'] : o.status === 'overdue_unfunded' ? ['🔴 OVERDUE · UNFUNDED', 'text-red-400'] : ['🔴 UNDERFUNDED', 'text-red-400'];
                  return (
                    <div key={i} className="px-3 py-2 border-b border-slate-800/40">
                      <div className="flex flex-wrap items-center gap-x-4">
                        <span className="text-[12px] text-slate-200 font-medium">{o.label}</span>
                        <span className="text-white font-bold tabular-nums">{fmt(o.amountCents)}</span>
                        <span className="text-[11px] text-slate-400">pay by <span className={o.overdue ? 'text-red-400 font-bold' : 'text-slate-200'}>{o.payDate.slice(5)}</span> · due {o.dueDate.slice(5)}</span>
                        <span className={`text-[11px] font-bold ${chip[1]}`}>{chip[0]}{o.gapCents > 0 && ` · gap ${fmt(o.gapCents)}`}</span>
                        {o.company === 'shipsourced' && <span className="text-[9px] px-1 rounded bg-purple-500/15 text-purple-400">SS</span>}
                      </div>
                      {(o.paydownPlan || []).length > 0 && (
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          plan: {o.paydownPlan.map((d: any) => `${d.date.slice(5)} pay ${fmt(d.cents)} (${d.sources.slice(0, 2).join(' + ')}${d.sources.length > 2 ? '…' : ''})`).join(' → ')}
                        </p>
                      )}
                      {o.holdNote && <p className="text-[11px] text-blue-300 mt-0.5">💡 {o.holdNote}</p>}
                    </div>
                  );
                })}
                <p className="px-3 py-1.5 text-[10px] text-slate-600">one dollar is never promised twice — earlier due dates reserve cash and payouts first · free cash after all reservations: YM {fmt(command.coverage.freeCashAfterReservations.ymgv)} · SS {fmt(command.coverage.freeCashAfterReservations.shipsourced)}</p>
              </div>
            )}

            {/* UNTRACKED — the resolution queue */}
            {untracked && (
              <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <p className="px-3 py-2 text-[11px] font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800 flex flex-wrap gap-x-4">
                  <span>Untracked money — resolve it</span>
                  <span className="text-slate-500 normal-case">traceability <span className={untracked.traceability.trackedPct >= 95 ? 'text-emerald-400' : 'text-amber-400'}>{untracked.traceability.trackedPct}%</span> of {fmt(untracked.traceability.totalCents)} (90d) · untracked {fmt(untracked.traceability.untrackedCents)} in {untracked.traceability.untrackedCount} txns</span>
                </p>
                {untracked.queue.length === 0 ? <p className="px-3 py-3 text-xs text-emerald-400">nothing unresolved ✓</p> :
                  untracked.queue.slice(0, 8).map((u: any) => (
                    <div key={u.id} className="px-3 py-1.5 border-b border-slate-800/40 flex flex-wrap items-center gap-x-3">
                      <span className="text-[11px] text-slate-500 w-16">{u.date.slice(5)}</span>
                      <span className="text-[12px] text-slate-300 flex-1 min-w-[180px] truncate" title={u.description}>{u.description}</span>
                      <span className="tabular-nums text-white text-[12px] font-medium">{fmt(Math.abs(u.amount_cents))}</span>
                      <span className="text-[11px] text-slate-500">{u.account}</span>
                      {u.candidate ? (
                        <button
                          onClick={async () => {
                            await fetch('/api/transactions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txnId: u.id, storeId: u.candidate.storeId, makeRule: true, pattern: u.suggestedPattern }) });
                            fetch('/api/transactions?view=untracked').then(r => r.json()).then(setUntracked).catch(() => {});
                          }}
                          title={u.candidate.evidence}
                          className="text-[11px] px-2 py-0.5 rounded bg-blue-600/20 border border-blue-600/40 text-blue-300 hover:bg-blue-600/40">
                          ✓ {u.candidate.store} ({u.candidate.confidence}%) + rule
                        </button>
                      ) : <span className="text-[10px] text-slate-600">no strong evidence — assign in Ledger</span>}
                    </div>
                  ))}
              </div>
            )}

            <div className="grid lg:grid-cols-2 gap-3">
              {/* Risks, ranked */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <p className="px-3 py-2 text-[11px] font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800">Biggest risks — ranked</p>
                {command.risks.length === 0 ? <p className="px-3 py-3 text-xs text-emerald-400">nothing ranked — clear skies</p> :
                  command.risks.map((r: any) => (
                    <div key={r.rank} className="px-3 py-2 border-b border-slate-800/40">
                      <p className="text-[12px] text-slate-200 font-medium">#{r.rank} {r.title} {r.cents > 0 && <span className="text-amber-400">{fmt(r.cents)}</span>}</p>
                      <p className="text-[11px] text-slate-500">{r.why}</p>
                      <p className="text-[11px] text-blue-300">→ {r.action}</p>
                    </div>
                  ))}
              </div>
              {/* What's about to happen */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <p className="px-3 py-2 text-[11px] font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800">What&apos;s about to happen — next 14 days</p>
                {command.forward.timeline.length === 0 ? <p className="px-3 py-3 text-xs text-slate-500">no dated events on the books</p> :
                  command.forward.timeline.map((e: any, i: number) => (
                    <p key={i} className="px-3 py-1.5 flex justify-between text-[12px] border-b border-slate-800/40">
                      <span className="text-slate-400">{e.date.slice(5)} <span className="text-slate-300">{e.label}</span> <span className={`text-[9px] px-1 rounded ${e.kind === 'committed' ? 'bg-blue-500/15 text-blue-300' : 'bg-slate-700/60 text-slate-500'}`}>{e.kind}</span> {e.company === 'shipsourced' && <span className="text-[9px] px-1 rounded bg-purple-500/15 text-purple-400">SS</span>}</span>
                      <span className={`tabular-nums font-medium ${e.cents > 0 ? 'text-emerald-300' : 'text-red-300'}`}>{e.cents > 0 ? '+' : '−'}{fmt(e.cents)}</span>
                    </p>
                  ))}
              </div>
            </div>

            {/* Ask the Brain */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
              <div className="flex gap-2">
                <input value={askQ} onChange={e => setAskQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') ask(); }}
                  placeholder={'Ask the Brain — "where is my money" · "what must I pay this week" · "can I spend $30k" · "biggest risk"'}
                  className="flex-1 bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-lg px-3 py-2 text-sm text-white outline-none" />
                <button onClick={ask} disabled={asking} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">{asking ? '…' : 'Ask'}</button>
              </div>
              {askA && (
                <div className="mt-2 text-sm text-slate-200 bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
                  {askA.answer}
                  {askA.facts?.assumptions && <p className="text-[10px] text-slate-500 mt-1">assumptions: {askA.facts.assumptions.join(' · ')}</p>}
                </div>
              )}
              <p className="text-[9px] text-slate-600 mt-1.5">answers are computed from live facts — the Brain never invents a number; scenarios never touch the books</p>
            </div>
          </div>
        );
      })()}

      {tab === 'incoming' && (() => {
        if (!incoming) return <p className="text-slate-500 text-sm py-8">Loading incoming cash…</p>;
        const thc = 'text-left text-[9px] uppercase tracking-wider text-slate-600 px-3 py-1.5 font-semibold';
        const tdc = 'px-3 py-2 tabular-nums';
        const t = incoming.totals;
        const dayTag = (d: string) => {
          const days = Math.round((new Date(d + 'T12:00:00Z').getTime() - Date.now()) / 86400000);
          if (days <= 0) return <span className="text-emerald-400 font-bold">today</span>;
          if (days === 1) return <span className="text-emerald-300">tomorrow</span>;
          return <span className="text-slate-400">{days}d</span>;
        };
        return (
          <div className="space-y-3">
            {/* The money's journey, left to right: at Shopify → held → landing → landed */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-2 gap-y-2">
              {[['AT SHOPIFY', t.atShopifyCents, 'text-emerald-400', 'sitting in Shopify Balance accounts'],
                ['HELD IN RESERVE', t.reservesCents, 'text-amber-400', 'held back by Shopify — releases on their schedule'],
                ['LANDING ≤7D', t.upcoming7Cents, 'text-blue-300', 'payouts scheduled/in transit to the banks this week'],
                ['LANDED · 7D', t.landed7Cents, 'text-slate-200', 'confirmed deposits in the banks, last 7 days']].map(([l, c, cls, tip]: any, i: number) => (
                <span key={l} className="flex items-center gap-2">
                  {i > 0 && <span className="text-slate-700 text-lg px-1">→</span>}
                  <span title={tip}>
                    <span className="block text-[9px] uppercase tracking-widest text-slate-500">{l}</span>
                    <span className={`text-xl font-bold ${cls}`}>{fmt(c)}</span>
                  </span>
                </span>
              ))}
            </div>

            {/* ONE ROW PER STORE — where its cash is right now */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
              <table className="w-full text-[12px]">
                <thead><tr className="border-b border-slate-800">
                  <th className={thc}>STORE</th>
                  <th className={thc + ' text-right'}>AT SHOPIFY</th>
                  <th className={thc + ' text-right'}>RESERVED</th>
                  <th className={thc + ' text-right'}>LANDING ≤7D</th>
                  <th className={thc}>NEXT PAYOUT</th>
                  <th className={thc + ' text-right'}>LANDED 7D</th>
                  <th className={thc + ' text-right'}>TOTAL INCOMING</th>
                </tr></thead>
                <tbody>
                  {incoming.stores.map((s: any) => (
                    <tr key={s.store} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className={`${tdc} text-slate-200 font-medium`}>{s.store}</td>
                      <td className={`${tdc} text-right ${s.atShopifyCents ? 'text-emerald-300' : 'text-slate-700'}`}>{s.atShopifyCents ? fmt(s.atShopifyCents) : '—'}</td>
                      <td className={`${tdc} text-right ${s.reservedCents ? 'text-amber-400 font-medium' : 'text-slate-700'}`}>{s.reservedCents ? fmt(s.reservedCents) : '—'}</td>
                      <td className={`${tdc} text-right ${s.upcoming7Cents ? 'text-blue-300' : 'text-slate-700'}`}>{s.upcoming7Cents ? fmt(s.upcoming7Cents) : '—'}</td>
                      <td className={`${tdc} text-slate-400 whitespace-nowrap`}>{s.nextPayout ? <>{dayTag(s.nextPayout.date)} · {fmt(s.nextPayout.cents)}</> : <span className="text-slate-700">—</span>}</td>
                      <td className={`${tdc} text-right ${s.landed7Cents ? 'text-slate-200' : 'text-slate-700'}`}>{s.landed7Cents ? fmt(s.landed7Cents) : '—'}</td>
                      <td className={`${tdc} text-right font-bold text-white`}>{fmt(s.totalIncomingCents)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-800/20 font-semibold">
                    <td className={`${tdc} text-slate-400`}>TOTAL</td>
                    <td className={`${tdc} text-right text-emerald-400`}>{fmt(t.atShopifyCents)}</td>
                    <td className={`${tdc} text-right text-amber-400`}>{fmt(t.reservesCents)}</td>
                    <td className={`${tdc} text-right text-blue-300`}>{fmt(t.upcoming7Cents)}</td>
                    <td className={tdc} />
                    <td className={`${tdc} text-right text-slate-200`}>{fmt(t.landed7Cents)}</td>
                    <td className={`${tdc} text-right text-white`}>{fmt(t.atShopifyCents + t.reservesCents + t.upcoming7Cents)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="px-3 py-2 text-[10px] text-slate-600 border-t border-slate-800">
                AT SHOPIFY = spendable balance held at Shopify · RESERVED = held back from payouts, releases on Shopify&apos;s schedule · LANDING = scheduled/in-transit payouts · LANDED = confirmed in your banks
              </p>
            </div>

            {/* Day-by-day schedule, secondary */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
              <p className="px-3 py-2 text-[11px] font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800">Day by day — next 14 days</p>
              {incoming.upcoming.length === 0 ? <p className="px-3 py-3 text-xs text-slate-500">no scheduled payouts in the next 14 days</p> : (
                <table className="w-full text-[12px]">
                  <tbody>
                    {incoming.upcoming.map((u: any, i: number) => (
                      <tr key={i} className="border-b border-slate-800/40 hover:bg-slate-800/30">
                        <td className={`${tdc} w-20`}>{dayTag(u.date)}</td>
                        <td className={`${tdc} text-slate-500 w-24`}>{u.date.slice(5)}</td>
                        <td className={`${tdc} text-slate-200`}>{u.store}</td>
                        <td className={tdc}><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${u.status === 'in_transit' ? 'bg-blue-500/15 text-blue-300' : u.status === 'paid' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-700/60 text-slate-400'}`}>{u.status.replace('_', ' ')}</span></td>
                        <td className={`${tdc} text-right text-white font-medium`}>{fmt(u.cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        );
      })()}

      {tab === 'payroll' && (() => {
        if (!payPlan) return <p className="text-slate-500 text-sm py-8">Loading…</p>;
        const thc = 'text-left text-[9px] uppercase tracking-wider text-slate-600 px-3 py-1.5 font-semibold';
        const thr = thc + ' text-right';
        const tdc = 'px-3 py-2 tabular-nums';
        return (
          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-slate-800">
                <th className={thc}>PAYROLL</th><th className={thr}>AMOUNT</th><th className={thr}>DUE</th><th className={thc}>RECURS</th><th className={thr}></th>
              </tr></thead>
              <tbody>
                {(payPlan.payroll?.items || []).map((pr: any) => {
                  const days = Math.round((new Date(pr.due_date + 'T12:00:00Z').getTime() - new Date(payPlan.generatedAt + 'T12:00:00Z').getTime()) / 86400000);
                  return (
                    <tr key={pr.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className={`${tdc} text-slate-200`}>{pr.label}{pr.store_name ? <span className="text-slate-500"> · {pr.store_name}</span> : ''}</td>
                      <td className={`${tdc} text-right text-white font-medium`}>{fmt2(pr.amount_cents)}</td>
                      <td className={`${tdc} text-right whitespace-nowrap ${days <= 3 ? 'text-red-400 font-bold' : days <= 7 ? 'text-amber-400' : 'text-slate-300'}`}>{dayLabel(pr.due_date)} ({days}d)</td>
                      <td className={`${tdc} text-slate-500`}>{pr.recurrence === 'once' ? '—' : pr.recurrence}</td>
                      <td className={`${tdc} text-right whitespace-nowrap`}>
                        <button onClick={() => payrollAction({ action: 'payroll_update', id: pr.id, op: 'paid' })} className="text-emerald-400 hover:text-emerald-300 mr-3">✓ paid</button>
                        <button onClick={() => payrollAction({ action: 'payroll_update', id: pr.id, op: 'delete' })} className="text-red-500/60 hover:text-red-400">✕</button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-800/20">
                  <td className={tdc}>
                    <input value={prLabel} onChange={e => setPrLabel(e.target.value)} placeholder="add payroll — who/what"
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-[11px]" />
                  </td>
                  <td className={`${tdc} text-right`}>
                    <input type="number" step="0.01" value={prAmount} onChange={e => setPrAmount(e.target.value)} placeholder="$"
                      className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-[11px] text-right" />
                  </td>
                  <td className={`${tdc} text-right`}>
                    <input type="date" value={prDue} onChange={e => setPrDue(e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-[11px]" />
                  </td>
                  <td className={tdc}>
                    <select value={prRecur} onChange={e => setPrRecur(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-white text-[11px]">
                      <option value="once">once</option><option value="weekly">weekly</option>
                      <option value="biweekly">biweekly</option><option value="monthly">monthly</option>
                    </select>
                  </td>
                  <td className={`${tdc} text-right`}>
                    <button onClick={() => { if (prLabel && prAmount && prDue) { payrollAction({ action: 'payroll_add', label: prLabel, amountCents: Math.round(parseFloat(prAmount) * 100), dueDate: prDue, recurrence: prRecur }); setPrLabel(''); setPrAmount(''); setPrDue(''); } }}
                      className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-semibold text-[11px]">add</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="px-3 py-2 text-[10px] text-slate-600 border-t border-slate-800">Payroll due within 7 days is paid BEFORE cards — it comes off the safe envelope first in the Operations pay plan.</p>
          </div>
        );
      })()}

      {tab === 'adspend' && (() => {
        if (!adSpend) return <p className="text-slate-500 text-sm py-8">Loading ad spend…</p>;
        const thc = 'text-left text-[9px] uppercase tracking-wider text-slate-600 px-3 py-1.5 font-semibold';
        const thr = thc + ' text-right';
        const tdc = 'px-3 py-2 tabular-nums';
        const tot = (k: string) => adSpend.spend.reduce((s: number, r: any) => s + (r[k] || 0), 0);
        const est: any[] = (adSpend as any).estimates || [];
        const estDailyTotal = est.reduce((s, e) => s + e.est_daily_cents, 0);
        const camps: any[] = (adSpend as any).campaigns || [];
        return (
          <div className="space-y-3">
            {/* Forward burn — what active campaigns are ON TRACK to spend */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-8 gap-y-2">
              <span>
                <span className="block text-[9px] uppercase tracking-widest text-slate-500">EST BURN / DAY</span>
                <span className="text-xl font-bold text-orange-400">{fmt(estDailyTotal)}</span>
              </span>
              <span>
                <span className="block text-[9px] uppercase tracking-widest text-slate-500">EST NEXT 7 DAYS</span>
                <span className="text-xl font-bold text-orange-300">{fmt(estDailyTotal * 7)}</span>
              </span>
              <span>
                <span className="block text-[9px] uppercase tracking-widest text-slate-500">ACTIVE CAMPAIGNS</span>
                <span className="text-xl font-bold text-white">{camps.filter((c: any) => c.active).length}</span>
              </span>
              <span className="flex flex-wrap gap-1.5 items-center">
                {est.map((e: any) => (
                  <span key={e.store} className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300" title={`${e.n} active campaigns`}>
                    {e.store} <span className="text-orange-300 font-semibold">{fmt(e.est_daily_cents)}/d</span>
                  </span>
                ))}
              </span>
            </div>

            {/* Campaign level — run rate per campaign */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
              <p className="px-3 py-2 text-[11px] font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800">Campaigns — last 7 days · est/day from actual run rate</p>
              <table className="w-full text-[12px]">
                <thead><tr className="border-b border-slate-800">
                  <th className={thc}>STORE</th><th className={thc}>CAMPAIGN</th><th className={thc}>STATUS</th><th className={thr}>YESTERDAY</th><th className={thr}>7D TOTAL</th><th className={thr}>EST / DAY</th>
                </tr></thead>
                <tbody>
                  {camps.map((c: any, i: number) => (
                    <tr key={i} className={`border-b border-slate-800/40 hover:bg-slate-800/30 ${!c.active ? 'opacity-50' : ''}`}>
                      <td className={`${tdc} text-slate-200 font-medium whitespace-nowrap`}>{c.store}</td>
                      <td className={`${tdc} text-slate-300 max-w-[300px] truncate`} title={c.campaign_name}>{c.campaign_name || c.campaign_id}</td>
                      <td className={tdc}>{c.active ? <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400">ACTIVE</span> : <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-700/60 text-slate-500">idle · last {c.last_spend_date?.slice(5)}</span>}</td>
                      <td className={`${tdc} text-right ${c.y_cents ? 'text-slate-200' : 'text-slate-700'}`}>{c.y_cents ? fmt(c.y_cents) : '—'}</td>
                      <td className={`${tdc} text-right text-slate-300`}>{fmt(c.d7_cents)}</td>
                      <td className={`${tdc} text-right font-medium ${c.est_daily_cents ? 'text-orange-300' : 'text-slate-700'}`}>{c.est_daily_cents ? fmt(c.est_daily_cents) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
              <table className="w-full text-[12px]">
                <thead><tr className="border-b border-slate-800">
                  <th className={thc}>STORE</th><th className={thc}>PLATFORM</th><th className={thr}>YESTERDAY</th><th className={thr}>7 DAYS</th><th className={thr}>30 DAYS</th>
                </tr></thead>
                <tbody>
                  {adSpend.spend.map((r: any, i: number) => (
                    <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className={`${tdc} text-slate-200 font-medium`}>{r.store}</td>
                      <td className={`${tdc} text-slate-400`}>{r.platform}</td>
                      <td className={`${tdc} text-right text-slate-300`}>{r.y_cents ? fmt(r.y_cents) : '—'}</td>
                      <td className={`${tdc} text-right text-white font-medium`}>{fmt(r.d7_cents)}</td>
                      <td className={`${tdc} text-right text-slate-300`}>{fmt(r.d30_cents)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-800/20 font-semibold">
                    <td className={`${tdc} text-slate-400`} colSpan={2}>TOTAL</td>
                    <td className={`${tdc} text-right text-slate-200`}>{fmt(tot('y_cents'))}</td>
                    <td className={`${tdc} text-right text-white`}>{fmt(tot('d7_cents'))}</td>
                    <td className={`${tdc} text-right text-slate-200`}>{fmt(tot('d30_cents'))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
              <p className="px-3 py-2 text-[11px] font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800">FB unbilled — spend accrued that hasn&apos;t hit a card yet</p>
              {adSpend.fbUnbilled.length === 0 ? <p className="px-3 py-3 text-xs text-slate-500">nothing unbilled</p> : (
                <table className="w-full text-[12px]">
                  <tbody>
                    {adSpend.fbUnbilled.map((f: any, i: number) => (
                      <tr key={i} className="border-b border-slate-800/40">
                        <td className={`${tdc} text-slate-200`}>{f.declining ? '⛔ ' : ''}{f.profile_name} <span className="text-slate-500">· {f.store}</span></td>
                        <td className={`${tdc} text-slate-400`}>{f.card_last4 ? `→ card ·${f.card_last4}` : <span className="text-amber-400">no funding card linked</span>}</td>
                        <td className={`${tdc} text-right text-blue-300 font-medium`}>{fmt(f.balance_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        );
      })()}

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
              const owed = (c.drivers || []).reduce((s: number, r: any) => s + r.cents, 0);
              const charges = (c.activityByClass || []).reduce((s: number, r: any) => s + r.cents, 0);
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
                    <span className="text-slate-500">activity {cardDays}d: <span className="text-amber-400">+{fmt(charges)} charged</span> <span className="text-emerald-400">−{fmt(paid)} paid</span></span>
                  </div>
                  <p className="mt-3 text-[10px] uppercase tracking-wider text-slate-500">Still owed now — unpaid charges composing the balance</p>
                  <div className="mt-1 space-y-1">
                    {(c.drivers || []).slice(0, 5).map((r: any) => (
                      <div key={r.class} className="flex items-center justify-between text-xs">
                        <ClassChip cls={r.class} />
                        <div className="flex-1 mx-2 h-1.5 bg-slate-800 rounded overflow-hidden">
                          <div className="h-full bg-blue-500/60" style={{ width: `${owed ? Math.round(100 * r.cents / owed) : 0}%` }} />
                        </div>
                        <span className="text-slate-300 w-16 text-right">{fmt(r.cents)}</span>
                      </div>
                    ))}
                    {c.unexplainedCents > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-700/60 text-slate-400">unexplained</span>
                        <span className="text-slate-500 w-16 text-right">{fmt(c.unexplainedCents)}</span>
                      </div>
                    )}
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
              if (c.verdict === 'stmt_paid') return { t: 'STMT PAID ✓', c: 'text-emerald-400 font-bold', tip: `statement ${fmt2(c.stmtBalanceCents)} fully covered by payments since ${c.stmtDate || 'statement date'}` };
              if ((c.inFlightLoggedCents || 0) >= (c.remainingStmtCents ?? c.needCents ?? 0) && (c.remainingStmtCents ?? 0) > 0) return { t: `SENT ${fmt2(c.inFlightLoggedCents)} ⏳`, c: 'text-blue-300 font-bold', tip: 'payment(s) already sent covering the remaining statement — waiting for the bank debit to post; confirms automatically' };
              if (c.verdict === 'balance_clear') return { t: 'BALANCE CLEAR ✓', c: 'text-emerald-400 font-bold', tip: 'live balance is zero' };
              if (c.verdict === 'clear_full') return { t: `CLEAR ${fmt2(c.payNowCents)}`, c: 'text-emerald-400 font-bold', tip: `no live statement feed — target is the LIVE balance (auto-updates every sync), funded by: ${fundStr}` };
              if (c.verdict === 'clear_partial') return { t: `CLEAR ${fmt2(c.payNowCents)} · SHORT ${fmt2(c.shortCents)}`, c: 'text-amber-400 font-bold', tip: `no live statement feed — target is the LIVE balance; funded by: ${fundStr}` };
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
                      {(health.warnings || []).map((w: any, i: number) => (
                        <span key={`w${i}`} className="text-[10px] px-2 py-0.5 rounded bg-red-500/15 text-red-400 font-bold cursor-help animate-pulse" title={w.detail}>
                          🚨 {w.label}
                        </span>
                      ))}
                      {health.blockers.map((b: any, i: number) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 cursor-help" title={`${b.detail}\n→ ${b.action}`}>
                          {b.owner}: {b.label} <span className="font-bold">+{b.pts.toFixed(1)}</span>
                        </span>
                      ))}
                      {health.blockers.length === 0 && <span className="text-[10px] text-emerald-400">all feeds live — full precision</span>}
                    </div>
                  </div>
                )}

                {/* ── MEET THE STATEMENT — remaining balances vs due dates ── */}
                {payPlan.meetStatement && (() => {
                  const m = payPlan.meetStatement;
                  const chip = (c: any) => `${c.name.replace('American Express ', 'Amex ').replace('Bank of America ', 'BofA ')} ·${c.last4}: ${fmt2(c.cents)} (${c.daysToDue < 0 ? `${-c.daysToDue}d late` : c.daysToDue === 0 ? 'TODAY' : `${c.daysToDue}d`})`;
                  const clean = !m.overdueCents && !m.dueSoonCents;
                  return (
                    <div className={`rounded-lg px-4 py-2.5 mb-3 border flex flex-wrap items-center gap-x-6 gap-y-1 ${clean ? 'bg-emerald-950/20 border-emerald-800/40' : m.overdueCents ? 'bg-red-950/30 border-red-800/50' : 'bg-amber-950/20 border-amber-800/40'}`}>
                      <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Meet the statement</span>
                      {clean && <span className="text-emerald-400 text-sm font-bold">all statements met ✓{m.laterCents > 0 ? ` · ${fmt2(m.laterCents)} due later this cycle` : ''}</span>}
                      {m.overdueCents > 0 && (
                        <span className="text-red-400 text-sm font-bold" title={m.overdueCards.map(chip).join('\n')}>
                          🚨 OVERDUE {fmt2(m.overdueCents)} <span className="font-normal text-red-300/70">({m.overdueCards.map((c: any) => `·${c.last4}`).join(' ')})</span>
                        </span>
                      )}
                      {m.dueSoonCents > 0 && (
                        <span className="text-amber-400 text-sm font-bold" title={m.dueSoonCards.map(chip).join('\n')}>
                          DUE ≤7D {fmt2(m.dueSoonCents)} <span className="font-normal text-amber-300/70">({m.dueSoonCards.map((c: any) => `·${c.last4}`).join(' ')})</span>
                        </span>
                      )}
                      {m.nextDue && (
                        <span className="text-slate-400 text-xs">
                          next: <span className="text-white font-medium">{fmt2(m.nextDue.cents)}</span> on {m.nextDue.name.replace('American Express ', 'Amex ').replace('Bank of America ', 'BofA ')} ·{m.nextDue.last4} — {m.nextDue.daysToDue === 0 ? <span className="text-red-400 font-bold">due TODAY</span> : m.nextDue.daysToDue === 1 ? <span className="text-red-400 font-bold">due TOMORROW</span> : `due in ${m.nextDue.daysToDue}d`}
                        </span>
                      )}
                    </div>
                  );
                })()}

                {/* ── CARDS TABLE ── */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden mb-3">
                  <table className="w-full text-[12px]">
                    <thead><tr className="border-b border-slate-800">
                      <th className={thCls}>CARD</th>
                      <th className={thR} title="what's still unpaid on the last statement — pay this by the due date">REMAINING FOR STMT</th>
                      <th className={thR}>DUE DATE</th>
                      <th className={thR} title="everything currently on the card, incl. new spend after the statement cut">FULL BALANCE OWED</th>
                      <th className={thR}>FB INC</th>
                      <th className={thR}>UTIL</th>
                      <th className={thCls}>OWED BY</th>
                      <th className={thR}>PAY (FUNDED BY)</th>
                    </tr></thead>
                    <tbody>
                      {brainCards.map((c: any) => {
                        const a = cAction(c);
                        const owners = c.owners.filter((o: any) => o.store !== '(unattributed)' && o.owesCents > 0).map((o: any) => o.store).join(', ');
                        const paidOff = c.owners.filter((o: any) => o.store !== '(unattributed)' && o.owesCents === 0 && (o.paidRecentlyCents || 0) > 0).map((o: any) => o.store);
                        const editing = openCard === c.id;
                        return (
                          <Fragment key={c.id}>
                            <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                              <td className={`${td} text-slate-200 whitespace-nowrap`}>
                                <button onClick={() => setWhyCard(whyCard === c.id ? null : c.id)} className="hover:text-blue-300 text-left" title="click: why does this card owe money">
                                  {c.declining && <span className="text-red-400 mr-1">⛔</span>}{c.name.replace('American Express ', 'Amex ').replace('Bank of America ', 'BofA ').slice(0, 30)} <span className="text-slate-600">·{c.last4}</span>
                                  <span className={`ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold ${c.company === 'shipsourced' ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/10 text-blue-400'}`}>{c.company === 'shipsourced' ? 'SS' : 'YM'}</span>
                                  <span className="text-slate-600"> {whyCard === c.id ? '▾' : '▸'}</span>
                                </button>
                              </td>
                              <td className={`${td} text-right`}>
                                <button onClick={() => setOpenCard(editing ? null : c.id)}
                                  title={c.remainingStmtCents != null && c.remainingStmtCents !== c.stmtBalanceCents
                                    ? `statement at cut: ${fmt2(c.stmtBalanceCents)} — payments since bring the REMAINING to ${fmt2(c.remainingStmtCents)}`
                                    : 'remaining statement balance — click to edit statement'}
                                  className={c.stmtBalanceCents != null ? 'text-white font-medium hover:text-blue-300' : 'text-slate-500 hover:text-blue-300 underline decoration-dotted'}>
                                  {c.stmtBalanceCents == null ? 'set'
                                    : c.stmtExpired ? <span className="text-slate-600 line-through">{fmt2(c.remainingStmtCents ?? c.stmtBalanceCents)}</span>
                                    : c.remainingStmtCents === 0 ? <span className="text-emerald-400">PAID ✓</span>
                                    : fmt2(c.remainingStmtCents ?? c.stmtBalanceCents)}
                                  {c.stmtExpired && <span className="block text-[9px] font-normal text-amber-500">old cycle — update</span>}
                                  {(c.inFlightLoggedCents || 0) > 0 && !c.stmtExpired && (
                                    <span className="block text-[9px] font-normal text-blue-300">−{fmt2(c.inFlightLoggedCents)} sent · in flight ⏳</span>
                                  )}
                                  {!c.stmtExpired && c.remainingStmtCents != null && c.remainingStmtCents > 0 && c.remainingStmtCents !== c.stmtBalanceCents && (
                                    <span className="block text-[9px] font-normal text-slate-500">of {fmt2(c.stmtBalanceCents)} stmt</span>
                                  )}
                                </button>
                              </td>
                              <td className={`${td} text-right whitespace-nowrap ${c.stmtExpired ? 'text-slate-600' : c.daysToDue == null ? 'text-slate-600' : c.daysToDue <= 3 ? 'text-red-400 font-bold' : c.daysToDue <= 7 ? 'text-amber-400' : 'text-slate-300'}`}>
                                {c.stmtExpired ? <span className="line-through">{dayLabel(c.dueDate).replace(/^\w+, /, '')}</span> : c.dueDate ? `${dayLabel(c.dueDate).replace(/^\w+, /, '')} (${c.daysToDue}d)` : '—'}
                              </td>
                              <td className={`${td} text-right text-slate-300`}>{fmt2(c.postedCents)}</td>
                              <td className={`${td} text-right ${c.fbOwedCents > 0 ? 'text-blue-300' : 'text-slate-700'}`}>{c.fbOwedCents > 0 ? fmt2(c.fbOwedCents) : '—'}</td>
                              <td className={`${td} text-right ${(c.utilization || 0) >= 100 ? 'text-red-400 font-bold' : (c.utilization || 0) >= 70 ? 'text-amber-400' : 'text-slate-400'}`}>{c.utilization != null ? `${c.utilization}%` : '—'}</td>
                              <td className={`${td} text-slate-400 max-w-[150px]`} title={`${owners}${paidOff.length ? ` · paid off: ${paidOff.join(', ')}` : ''}`}>
                                <span className="block truncate">{owners || <span className="text-slate-600">untraced</span>}</span>
                                {paidOff.length > 0 && <span className="block truncate text-[9px] text-emerald-500">{paidOff.join(', ')} ✓paid</span>}
                              </td>
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
                                        <p key={o.store} className="flex justify-between text-slate-300">
                                          <span>{o.store}{o.paidRecentlyCents > 0 && <span className="text-emerald-500 text-[10px]"> · paid {fmt2(o.paidRecentlyCents)} ✓</span>}</span>
                                          <span className="tabular-nums text-white">{fmt2(o.owesCents)}</span>
                                        </p>
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

                {/* ── STATEMENTS PANEL — one editable row per card, always visible ── */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden mb-3">
                  <div className="px-3 py-2 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">📅 Card statements — balances &amp; dates</p>
                    <p className="text-[10px] text-slate-500">auto-filled from the bank where the connection allows it · <span className="text-blue-400">🏦 bank</span> = live from Plaid, <span className="text-slate-400">✍️ manual</span> = you typed it (bank data replaces it when available)</p>
                  </div>
                  <div className="divide-y divide-slate-800/60">
                    {brainCards.map((c: any) => (
                      <div key={`st-${c.id}`} className="px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="text-[12px] text-slate-200 w-52 truncate">
                          <NicknameEditor card={c} onSaved={loadPayPlan} />
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${c.stmtSource === 'plaid' ? 'bg-blue-500/15 text-blue-400' : c.stmtSource ? 'bg-slate-700/60 text-slate-400' : 'bg-amber-500/10 text-amber-400'}`}>
                          {c.stmtSource === 'plaid' ? '🏦 bank' : c.stmtSource ? '✍️ manual' : 'not set'}
                        </span>
                        <StatementEditor compact card={c} onSaved={loadPayPlan} />
                      </div>
                    ))}
                  </div>
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
                      {brainStores.map((s: any) => {
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
                      {/* Company row — untraced debt against shared cash (YM lens only) */}
                      {company !== 'shipsourced' && <tr className="bg-slate-800/20">
                        <td className={`${td} text-slate-400 font-medium`}>COMPANY <span className="text-slate-600 font-normal">(untraced — link FB cards)</span></td>
                        <td className={`${td} text-right text-slate-300`}>{fmt2(payPlan.company.untracedCents)}</td>
                        <td className={`${td} text-slate-600`}>all</td>
                        <td className={`${td} text-right text-slate-600`}>—</td>
                        <td className={`${td} text-right text-slate-600`}>—</td>
                        <td className={`${td} text-right text-emerald-400`}>{fmt2(payPlan.company.safeTodayCents)}</td>
                        <td className={`${td} text-right font-bold text-emerald-400`}>{fmt2(Math.min(payPlan.company.safeTodayCents, payPlan.company.untracedCents))}</td>
                        <td className={`${td} text-right font-bold text-amber-400`}>SHARED CASH</td>
                      </tr>}
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
        <div className="space-y-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <p className="px-3 py-2 text-[11px] font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800">Submitted payments — what you logged, and whether the bank took it</p>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500 border-b border-slate-800">
              <th className="px-3 py-2">Date</th><th className="px-3 py-2">Store</th><th className="px-3 py-2">Card</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Bank status</th><th className="px-3 py-2 text-right">Amount</th>
            </tr></thead>
            <tbody>
              {submittedPayments.map(sp => (
                <tr key={sp.id} className="border-b border-slate-800/50">
                  <td className="px-3 py-1.5 text-slate-400">{sp.date}</td>
                  <td className="px-3 py-1.5 text-slate-200">{sp.store || '—'}</td>
                  <td className="px-3 py-1.5 text-slate-300">··{sp.card_last4}</td>
                  <td className="px-3 py-1.5 text-slate-500">{sp.category}</td>
                  <td className="px-3 py-1.5">
                    {sp.status === 'confirmed' && <span className="text-emerald-400">✓ confirmed — left {sp.bankAccount} ··{sp.bankLast4} {sp.bankDate}</span>}
                    {sp.status === 'pending' && <span className="text-blue-300">debit pending at bank</span>}
                    {sp.status === 'too_recent' && <span className="text-blue-300">in flight ⏳ — awaiting bank debit</span>}
                    {sp.status === 'not_taken' && <span className="text-red-400 font-semibold">⚠ NOT TAKEN — no bank debit found</span>}
                    {sp.status === 'unknown' && <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-200 font-medium">{fmt2(sp.cents)}</td>
                </tr>
              ))}
              {!submittedPayments.length && <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-500">no submitted payments in window</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <p className="px-3 py-2 text-[11px] font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800">Bank-verified payments — credits confirmed on cards</p>
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
        </div>
      )}
    </div>
  );
}
