'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/** Card charges linked to a store — the CFO-side workbench.
 *
 *  Same filters as the Transactions page (search, dates, card, state, paid),
 *  plus the fulfilment ones (part, centre, how it was classified), a
 *  by-merchant view where one change classifies every charge from that
 *  merchant, checkbox selection with bulk actions, filtered totals and a CSV
 *  export. Everything a worker needs to categorise ShipSourced's spend end
 *  to end without leaving this page. */

type Charge = {
  id: string; date: string; description: string; amount_cents: number; settled_at: string | null;
  card: string; card_id: string; card_last4: string | null; merchant: string | null;
  paid_by?: { paymentId: string; date: string; amountCents: number; cardLast4: string | null; notes: string | null }; method: string | null; category: string | null; custom_category: string | null;
  fulfilment?: { line: string; center: string; source: 'manual' | 'rule' | 'default'; needsReview: boolean; ruleKey: string | null; lineLabel: string; centerLabel: string };
};
type Data = {
  charges: Charge[];
  summary: { count: number; open_cents: number; settled_cents: number; by_line: Record<string, number> | null };
  fulfilment: { lines: Record<string, string>; centers: Record<string, string> } | null;
};

const money = (c: number) => (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d: Date) => d.toISOString().slice(0, 10);

function presetRange(p: string): { from: string; to: string } {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  switch (p) {
    case 'month': return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(now) };
    case 'last': return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
    case '90': return { from: iso(new Date(now.getTime() - 90 * 864e5)), to: iso(now) };
    case 'ytd': return { from: `${y}-01-01`, to: iso(now) };
    default: return { from: '', to: '' };
  }
}

const sel = 'text-[11px] rounded-lg px-2 py-1.5 border border-slate-700 bg-slate-950 text-slate-200';
const btn = 'text-[11px] px-2.5 py-1 rounded-lg font-medium disabled:opacity-50';

export function StoreCharges({ storeId }: { storeId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // filters
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [card, setCard] = useState('');
  const [line, setLine] = useState('');        // '' any · 'review' needs review · line key
  const [center, setCenter] = useState('');
  const [source, setSource] = useState('');    // manual | rule | default
  const [paid, setPaid] = useState('unpaid');  // unpaid | paid | all
  const [minAmt, setMinAmt] = useState('');
  const [maxAmt, setMaxAmt] = useState('');
  const [sort, setSort] = useState('date_desc');
  const [view, setView] = useState<'list' | 'merchant'>('list');
  const [limit, setLimit] = useState(80);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLine, setBulkLine] = useState('');
  const [bulkCenter, setBulkCenter] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ date: iso(new Date()), cardLast4: '', amount: '', method: 'ach', notes: '' });

  const load = useCallback(() => fetch(`/api/store-charges?storeId=${storeId}`).then(r => r.json()).then(setData).catch(() => {}), [storeId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch('/api/stores').then(r => r.json()).then(j => setStores((Array.isArray(j) ? j : j.stores || []).map((s: any) => ({ id: s.id, name: s.name })))).catch(() => {}); }, []);
  useEffect(() => { setSelected(new Set()); setLimit(80); }, [q, from, to, card, line, center, source, paid, minAmt, maxAmt, sort, view]);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 3500); return () => clearTimeout(t); }, [flash]);

  const isSs = !!data?.fulfilment;
  const cards = useMemo(() => { const m = new Map<string, string>(); for (const c of data?.charges || []) m.set(c.card_id, c.card); return [...m.entries()]; }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [] as Charge[];
    const ql = q.trim().toLowerCase();
    const exact = /^\$?\d+(\.\d{1,2})?$/.test(ql) ? Math.round(parseFloat(ql.replace('$', '')) * 100) : null;
    const lo = minAmt ? Math.round(parseFloat(minAmt) * 100) : null, hi = maxAmt ? Math.round(parseFloat(maxAmt) * 100) : null;
    let rows = data.charges.filter(c => {
      const amt = Math.abs(c.amount_cents);
      if (paid === 'unpaid' && c.settled_at) return false;
      if (paid === 'paid' && !c.settled_at) return false;
      if (from && c.date < from) return false;
      if (to && c.date > to) return false;
      if (card && c.card_id !== card) return false;
      if (lo != null && amt < lo) return false;
      if (hi != null && amt > hi) return false;
      if (ql) {
        if (exact != null) { if (amt !== exact) return false; }
        else if (!(c.description.toLowerCase().includes(ql) || (c.merchant || '').toLowerCase().includes(ql) || c.card.toLowerCase().includes(ql))) return false;
      }
      if (c.fulfilment) {
        if (line === 'review' && !c.fulfilment.needsReview) return false;
        if (line && line !== 'review' && c.fulfilment.line !== line) return false;
        if (center && c.fulfilment.center !== center) return false;
        if (source && c.fulfilment.source !== source) return false;
      }
      return true;
    });
    const cmp: Record<string, (a: Charge, b: Charge) => number> = {
      date_desc: (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
      date_asc: (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
      amount_desc: (a, b) => Math.abs(b.amount_cents) - Math.abs(a.amount_cents),
      amount_asc: (a, b) => Math.abs(a.amount_cents) - Math.abs(b.amount_cents),
      merchant: (a, b) => (a.merchant || a.description).localeCompare(b.merchant || b.description) || b.date.localeCompare(a.date),
    };
    rows = rows.slice().sort(cmp[sort] || cmp.date_desc);
    return rows;
  }, [data, q, from, to, card, line, center, source, paid, minAmt, maxAmt, sort]);

  const merchants = useMemo(() => {
    const m = new Map<string, { key: string; merchantKey: string | null; label: string; rows: Charge[]; cents: number; lines: Map<string, number>; centers: Map<string, number>; review: number; sources: Set<string> }>();
    for (const c of filtered) {
      const key = c.merchant || c.description.toUpperCase();
      const g = m.get(key) || { key, merchantKey: c.merchant, label: c.description, rows: [] as Charge[], cents: 0, lines: new Map(), centers: new Map(), review: 0, sources: new Set<string>() };
      g.rows.push(c); g.cents += Math.abs(c.amount_cents);
      if (c.fulfilment) { g.lines.set(c.fulfilment.line, (g.lines.get(c.fulfilment.line) || 0) + 1); g.centers.set(c.fulfilment.center, (g.centers.get(c.fulfilment.center) || 0) + 1); if (c.fulfilment.needsReview) g.review++; g.sources.add(c.fulfilment.source); }
      m.set(key, g);
    }
    for (const g of m.values()) {
      const freq = new Map<string, number>();
      for (const r of g.rows) { const d = r.description.replace(/\s+/g, ' ').trim(); freq.set(d, (freq.get(d) || 0) + 1); }
      g.label = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
      g.rows.sort((a, b) => a.date.localeCompare(b.date));
    }
    return [...m.values()].sort((a, b) => b.cents - a.cents);
  }, [filtered]);

  const totals = useMemo(() => ({ n: filtered.length, cents: filtered.reduce((s, c) => s + Math.abs(c.amount_cents), 0), review: filtered.filter(c => c.fulfilment?.needsReview).length }), [filtered]);
  const selectedRows = useMemo(() => filtered.filter(c => selected.has(c.id)), [filtered, selected]);
  const selectedCents = selectedRows.reduce((s, c) => s + Math.abs(c.amount_cents), 0);
  const visible = filtered.slice(0, limit);

  // Pre-fill the payment from the selection: its total, and the card when they all share one.
  useEffect(() => {
    if (!payOpen) return;
    const cards = new Set(selectedRows.map(c => c.card_last4).filter(Boolean) as string[]);
    setPayForm(f => ({ ...f, amount: (selectedCents / 100).toFixed(2), cardLast4: cards.size === 1 ? [...cards][0] : f.cardLast4 }));
  }, [payOpen, selectedCents, selectedRows]);


  async function patch(ids: string[], body: Record<string, unknown>, done: string) {
    if (!ids.length) return;
    setBusy(true);
    const r = await fetch('/api/store-charges', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txnIds: ids, ...body }) }).then(r => r.json()).catch(() => null);
    setBusy(false);
    if (r && !r.error) { setFlash(done + (r.rules?.length ? ` · rule saved for ${r.rules.length} merchant${r.rules.length > 1 ? 's' : ''}` : '')); setSelected(new Set()); load(); }
    else setFlash('Failed: ' + (r?.error || 'network'));
  }
  // Ad spend and app invoices have their own payment logs. Every OTHER card
  // charge — software, supplies, Whop — had nowhere to record the payment that
  // cleared it, so the money left the bank invisibly. This records it.
  async function logPayment() {
    const ids = [...selected];
    const cents = Math.round(parseFloat(payForm.amount || '0') * 100);
    if (!cents || !payForm.cardLast4) { setFlash('Enter the amount and the card that was paid'); return; }
    setBusy(true);
    const r = await fetch('/api/store-charges', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txnIds: ids, payment: { storeId, date: payForm.date, cardLast4: payForm.cardLast4, amountCents: cents, method: payForm.method, notes: payForm.notes || null } }),
    }).then(r => r.json()).catch(() => null);
    setBusy(false);
    if (r?.success) {
      const diff = r.differenceCents || 0;
      setFlash(`Payment of ${money(r.amountCents)} recorded against ${r.linked} charge${r.linked === 1 ? '' : 's'} (${money(r.appliedCents)})`
        + (diff ? ` · ${money(Math.abs(diff))} ${diff < 0 ? 'of those charges is still unpaid' : 'more than the charges selected'}` : '')
        + (r.skipped?.length ? ` · ${r.skipped.length} skipped (already paid by another payment)` : '')
        + ' · shows as a payment in flight until the bank takes it');
      setPayOpen(false); setSelected(new Set()); setPayForm(f => ({ ...f, amount: '', notes: '' })); load();
    } else setFlash('Failed: ' + (r?.error || 'network'));
  }

  async function undoPayment(paymentId: string) {
    setBusy(true);
    const r = await fetch(`/api/store-charges?paymentId=${paymentId}`, { method: 'DELETE' }).then(r => r.json()).catch(() => null);
    setBusy(false);
    if (r?.success) { setFlash(`Payment removed · ${r.unsettled} charge${r.unsettled === 1 ? '' : 's'} back to unpaid`); load(); }
    else setFlash('Failed: ' + (r?.error || 'network'));
  }

  async function moveToStore(ids: string[], target: string) {
    if (!ids.length || !target) return;
    setBusy(true);
    const r = await fetch('/api/transactions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionIds: ids, storeId: target }) }).then(r => r.json()).catch(() => null);
    setBusy(false);
    if (r?.success) { setFlash(target === 'none' ? `${ids.length} unpaired from this store` : `${ids.length} moved to ${stores.find(s => s.id === target)?.name || 'store'}`); setSelected(new Set()); load(); }
    else setFlash('Failed: ' + (r?.error || 'network'));
  }
  const classifyRows = (ids: string[], l: string, c: string, remember: boolean) => patch(ids, { line: l, center: c, remember }, `${ids.length} classified → ${data!.fulfilment!.lines[l]} · ${data!.fulfilment!.centers[c]}`);

  function exportCsv() {
    const head = ['date', 'description', 'card', 'amount', 'paid_at', 'merchant', ...(isSs ? ['fulfilment_part', 'fulfilment_centre', 'classified_by'] : [])];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [head.join(','), ...filtered.map(c => [c.date, c.description, c.card, (Math.abs(c.amount_cents) / 100).toFixed(2), c.settled_at || '', c.merchant || '', ...(c.fulfilment ? [c.fulfilment.lineLabel, c.fulfilment.centerLabel, c.fulfilment.source] : [])].map(esc).join(','))];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = `card-charges-${storeId.slice(0, 8)}-${iso(new Date())}.csv`; a.click();
  }
  const toggleSel = (id: string) => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allVisibleSelected = visible.length > 0 && visible.every(c => selected.has(c.id));
  const activeFilters = [q, from, to, card, line, center, source, minAmt, maxAmt].filter(Boolean).length + (paid !== 'unpaid' ? 1 : 0);
  const reset = () => { setQ(''); setFrom(''); setTo(''); setCard(''); setLine(''); setCenter(''); setSource(''); setPaid('unpaid'); setMinAmt(''); setMaxAmt(''); setSort('date_desc'); };

  if (!data) return null;
  const F = data.fulfilment;

  return (
    <div className="rounded-xl bg-slate-900/60 overflow-hidden">
      {/* header */}
      <div className="px-5 py-3 border-b border-slate-800/60 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider">Card charges linked to this store</p>
          <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
            <span className="text-amber-300">{money(data.summary.open_cents)} unpaid</span>
            {data.summary.settled_cents > 0 && <span> · {money(data.summary.settled_cents)} paid</span>}
            <span> · {data.summary.count} charges (proven attribution)</span>
          </p>
          {data.summary.by_line && (
            <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
              Unpaid by fulfilment part: {Object.entries(data.summary.by_line).sort((a, b) => b[1] - a[1]).map(([l, v]) => `${F!.lines[l]} ${money(v)}`).join(' · ')}
              <span className="text-slate-500"> — feeds the ShipSourced P&amp;L by centre (P&amp;L tab)</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-700 overflow-hidden text-[11px]">
            <button onClick={() => setView('list')} className={`px-2.5 py-1 ${view === 'list' ? 'bg-slate-700/70 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}>List</button>
            <button onClick={() => setView('merchant')} className={`px-2.5 py-1 ${view === 'merchant' ? 'bg-slate-700/70 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}>By merchant</button>
          </div>
          <button onClick={exportCsv} className={`${btn} bg-slate-800/60 text-slate-200 hover:bg-slate-700/60`} title="Download the filtered charges as CSV">Export CSV</button>
        </div>
      </div>

      {/* filters */}
      <div className="px-5 py-3 border-b border-slate-800/40 bg-slate-950/30 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search description, merchant, card, or exact amount" className={`${sel} flex-1 min-w-[240px]`} />
          <select value={paid} onChange={e => setPaid(e.target.value)} className={sel}>
            <option value="unpaid">Unpaid only</option><option value="paid">✓ Paid only</option><option value="all">Paid + unpaid</option>
          </select>
          <select value={card} onChange={e => setCard(e.target.value)} className={`${sel} max-w-[260px]`}>
            <option value="">All cards</option>{cards.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          {F && (
            <>
              <select value={line} onChange={e => setLine(e.target.value)} className={`${sel} ${line === 'review' ? 'border-amber-500/60 text-amber-300' : ''}`}>
                <option value="">Any fulfilment part</option>
                <option value="review">⚠ Needs review{totals.review ? ` (${totals.review})` : ''}</option>
                {Object.entries(F.lines).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={center} onChange={e => setCenter(e.target.value)} className={sel}>
                <option value="">Any centre</option>{Object.entries(F.centers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={source} onChange={e => setSource(e.target.value)} className={sel}>
                <option value="">Classified any way</option><option value="manual">Set by a worker</option><option value="rule">Remembered rule</option><option value="default">Default guess</option>
              </select>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500">Dates</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={sel} />
          <span className="text-[11px] text-slate-600">→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={sel} />
          <div className="inline-flex gap-1">
            {[['month', 'This month'], ['last', 'Last month'], ['90', '90 days'], ['ytd', 'YTD'], ['all', 'All']].map(([k, l]) => (
              <button key={k} onClick={() => { const r = presetRange(k); setFrom(r.from); setTo(r.to); }} className={`${btn} bg-slate-800/50 text-slate-300 hover:bg-slate-700/60`}>{l}</button>
            ))}
          </div>
          <span className="text-[11px] text-slate-500 ml-2">Amount</span>
          <input value={minAmt} onChange={e => setMinAmt(e.target.value)} placeholder="min" inputMode="decimal" className={`${sel} w-20`} />
          <input value={maxAmt} onChange={e => setMaxAmt(e.target.value)} placeholder="max" inputMode="decimal" className={`${sel} w-20`} />
          <select value={sort} onChange={e => setSort(e.target.value)} className={`${sel} ml-2`}>
            <option value="date_desc">Newest first</option><option value="date_asc">Oldest first</option><option value="amount_desc">Largest first</option><option value="amount_asc">Smallest first</option><option value="merchant">Merchant A→Z</option>
          </select>
          <span className="ml-auto text-[11px] text-slate-400 tabular-nums">
            {totals.n} charge{totals.n === 1 ? '' : 's'} · {money(totals.cents)}{F && totals.review > 0 && <span className="text-amber-300"> · {totals.review} need review</span>}
            {activeFilters > 0 && <button onClick={reset} className="ml-2 text-blue-300 hover:text-blue-200">clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}</button>}
          </span>
        </div>
      </div>

      {flash && <div className="px-5 py-2 text-[11px] text-emerald-300 bg-emerald-500/5 border-b border-emerald-500/10">{flash}</div>}

      {filtered.length === 0 ? (
        <p className="px-5 py-6 text-center text-[13px] text-slate-500">
          {data.summary.count === 0 ? 'No card charges are linked to this store yet — pair them on the Transactions page.' : activeFilters > 0 ? 'Nothing matches these filters.' : 'All linked card charges are marked paid ✓'}
        </p>
      ) : view === 'merchant' ? (
        /* ── By merchant: one change classifies every charge from that merchant ── */
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-[13px]">
            <colgroup><col className="w-10" /><col /><col className="w-[88px]" /><col className="w-[110px]" />{F && <col className="w-[300px]" />}</colgroup>
            <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
              <th className="pl-5 py-2 text-left"><input type="checkbox" className="accent-blue-500" checked={merchants.every(g => g.rows.every(r => selected.has(r.id)))} onChange={e => setSelected(e.target.checked ? new Set(filtered.map(c => c.id)) : new Set())} /></th>
              <th className="px-3 py-2 text-left">Merchant</th><th className="px-3 py-2 text-right">Charges</th><th className="px-3 py-2 text-right">Total</th>{F && <th className="px-3 py-2 text-left">Fulfilment part · centre (applies to all, remembered)</th>}
            </tr></thead>
            <tbody>
              {merchants.map(g => {
                const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
                const mixed = g.lines.size > 1 || g.centers.size > 1;
                const allSel = g.rows.every(r => selected.has(r.id));
                return (
                  <tr key={g.key} className={`border-b border-slate-800/30 last:border-b-0 ${g.review ? 'bg-amber-500/5' : ''}`}>
                    <td className="pl-5 py-2"><input type="checkbox" className="accent-blue-500" checked={allSel} onChange={() => setSelected(p => { const n = new Set(p); g.rows.forEach(r => allSel ? n.delete(r.id) : n.add(r.id)); return n; })} /></td>
                    <td className="px-3 py-2 min-w-0">
                      <span className="text-slate-100 truncate block" title={g.rows[0].description}>{g.label}</span>
                      <span className="text-[11px] text-slate-500 truncate block">{g.rows[0].date === g.rows[g.rows.length - 1].date ? g.rows[0].date : `${g.rows[0].date} → ${g.rows[g.rows.length - 1].date}`}{g.merchantKey && g.merchantKey !== g.label ? ` · ${g.merchantKey}` : ''}{g.review ? <span className="text-amber-300"> · {g.review} need review</span> : null}{mixed ? ' · mixed' : ''}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-300">{g.rows.length}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-100">{money(g.cents)}</td>
                    {F && (
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <select value={mixed ? '' : top(g.lines)} disabled={busy} onChange={e => e.target.value && classifyRows(g.rows.map(r => r.id), e.target.value, top(g.centers) || 'shared', true)} className={`w-[168px] ${sel} ${g.review ? 'border-amber-500/60 text-amber-300' : ''}`}>
                            {mixed && <option value="">— mixed —</option>}{Object.entries(F.lines).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                          <select value={mixed ? '' : top(g.centers)} disabled={busy} onChange={e => e.target.value && classifyRows(g.rows.map(r => r.id), top(g.lines) || 'other', e.target.value, true)} className={`w-[92px] ${sel}`}>
                            {mixed && <option value="">—</option>}{Object.entries(F.centers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                          {g.sources.has('manual') && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" title="some set by a worker" />}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── List ── */
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-[13px]">
            <colgroup><col className="w-10" /><col className="w-[96px]" /><col />{F && <col className="w-[284px]" />}<col className="w-[104px]" /><col className="w-[108px]" /></colgroup>
            <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
              <th className="pl-5 py-2 text-left"><input type="checkbox" className="accent-blue-500" checked={allVisibleSelected} onChange={e => setSelected(e.target.checked ? new Set(filtered.map(c => c.id)) : new Set())} title="Select every charge matching the filters" /></th>
              <th className="px-2 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Charge · card</th>{F && <th className="px-3 py-2 text-left">Fulfilment part · centre</th>}<th className="px-3 py-2 text-right">Amount</th><th className="pr-5 py-2 text-right"></th>
            </tr></thead>
            <tbody>
              {visible.map(c => (
                <tr key={c.id} className={`border-b border-slate-800/30 last:border-b-0 ${c.settled_at ? 'opacity-50' : ''} ${selected.has(c.id) ? 'bg-blue-500/5' : ''}`}>
                  <td className="pl-5 py-2"><input type="checkbox" className="accent-blue-500" checked={selected.has(c.id)} onChange={() => toggleSel(c.id)} /></td>
                  <td className="px-2 py-2 text-slate-500 whitespace-nowrap tabular-nums">{c.date}</td>
                  <td className="px-3 py-1.5 min-w-0">
                    <span className="text-slate-100 truncate block leading-tight" title={c.description}>{c.description}</span>
                    <span className="text-slate-500 text-[11px] truncate block leading-tight" title={c.card}>{c.card}</span>
                  </td>
                  {F && c.fulfilment && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <select value={c.fulfilment.line} disabled={busy} onChange={e => classifyRows([c.id], e.target.value, c.fulfilment!.center, true)} title={`Fulfilment part — ${c.fulfilment.source === 'manual' ? 'set by a worker' : c.fulfilment.source === 'rule' ? 'remembered rule for this merchant' : 'default from merchant name'}${c.fulfilment.needsReview ? ' — needs a look' : ''}`}
                          className={`w-[168px] ${sel} ${c.fulfilment.needsReview ? 'border-amber-500/60 bg-amber-500/10 text-amber-300' : ''}`}>
                          {Object.entries(F.lines).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <select value={c.fulfilment.center} disabled={busy} onChange={e => classifyRows([c.id], c.fulfilment!.line, e.target.value, true)} className={`w-[92px] ${sel}`}>
                          {Object.entries(F.centers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        {c.fulfilment.source === 'manual' && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" title="set by a worker" />}
                      </span>
                    </td>
                  )}
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-100 whitespace-nowrap">{money(Math.abs(c.amount_cents))}</td>
                  <td className="pl-2 pr-5 py-2 text-right whitespace-nowrap">
                    {c.paid_by
                      ? <button onClick={() => undoPayment(c.paid_by!.paymentId)} disabled={busy} title={`Paid by the ${money(c.paid_by.amountCents)} payment logged ${c.paid_by.date} to ··${c.paid_by.cardLast4} — click to undo that payment`} className="text-[11px] text-emerald-400 hover:text-emerald-300 disabled:opacity-50">✓ paid {c.paid_by.date.slice(5)}</button>
                      : c.settled_at
                      ? <button onClick={() => patch([c.id], { settled: false }, 'Marked unpaid')} disabled={busy} className="text-[11px] text-emerald-400 hover:text-emerald-300 disabled:opacity-50">✓ paid · undo</button>
                      : <button onClick={() => patch([c.id], { settled: true }, 'Marked paid')} disabled={busy} className={`${btn} bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/25`}>Mark paid</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > visible.length && (
            <div className="px-5 py-3 border-t border-slate-800/40 flex items-center justify-between text-[11px] text-slate-500">
              <span>Showing {visible.length} of {filtered.length}</span>
              <button onClick={() => setLimit(l => l + 200)} className={`${btn} bg-slate-800/60 text-slate-200 hover:bg-slate-700/60`}>Show 200 more</button>
            </div>
          )}
        </div>
      )}

      {/* bulk bar */}
      {selected.size > 0 && (
        <div className="sticky bottom-3 mx-4 my-3 rounded-xl border border-blue-500/30 bg-slate-950/95 backdrop-blur px-4 py-2.5 flex flex-wrap items-center gap-2 shadow-lg">
          <span className="text-[12px] text-slate-100 font-medium tabular-nums">{selectedRows.length} selected · {money(selectedCents)}</span>
          {F && (
            <>
              <select value={bulkLine} onChange={e => setBulkLine(e.target.value)} className={sel}><option value="">Fulfilment part…</option>{Object.entries(F.lines).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select value={bulkCenter} onChange={e => setBulkCenter(e.target.value)} className={sel}><option value="">Centre…</option>{Object.entries(F.centers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button disabled={busy || !bulkLine || !bulkCenter} onClick={() => classifyRows([...selected], bulkLine, bulkCenter, false)} className={`${btn} bg-blue-500/15 text-blue-200 hover:bg-blue-500/30`} title="These charges only">Apply</button>
              <button disabled={busy || !bulkLine || !bulkCenter} onClick={() => classifyRows([...selected], bulkLine, bulkCenter, true)} className={`${btn} bg-blue-500/25 text-blue-100 hover:bg-blue-500/40`} title="And every future charge from the same merchants">Apply &amp; remember</button>
              <button disabled={busy} onClick={() => classifyRows([...selected], 'movement', 'shared', true)} className={`${btn} bg-slate-800/60 text-slate-300 hover:bg-slate-700/60`} title="Card payment / own transfer — never a cost">Not a cost</button>
            </>
          )}
          <button disabled={busy} onClick={() => setPayOpen(v => !v)} className={`${btn} ${payOpen ? 'bg-emerald-500/30 text-emerald-100' : 'bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/30'}`} title="Record the payment that pays these charges off — it shows as a payment in flight until the bank takes it">Log payment…</button>
          <button disabled={busy} onClick={() => patch([...selected], { settled: true }, `${selected.size} marked paid`)} className={`${btn} bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/25`} title="Mark settled without recording a payment">Mark paid</button>
          <button disabled={busy} onClick={() => patch([...selected], { settled: false }, `${selected.size} marked unpaid`)} className={`${btn} bg-slate-800/60 text-slate-300 hover:bg-slate-700/60`}>Mark unpaid</button>
          <select defaultValue="" disabled={busy} onChange={e => { const v = e.target.value; e.target.value = ''; if (v) moveToStore([...selected], v); }} className={sel} title="Re-pair these charges to another store (same rules as the Transactions page)">
            <option value="">⇢ Move to store…</option>{stores.filter(s => s.id !== storeId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="none">✕ Unpair from this store</option>
          </select>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-[11px] text-slate-400 hover:text-slate-200">Clear</button>
          {payOpen && (
            <div className="w-full mt-1 pt-2 border-t border-slate-800 flex flex-wrap items-end gap-2">
              <label className="text-[11px] text-slate-400">Paid on<input type="date" value={payForm.date} onChange={e => setPayForm(f => ({ ...f, date: e.target.value }))} className={`${sel} block mt-0.5`} /></label>
              <label className="text-[11px] text-slate-400">Card paid
                <select value={payForm.cardLast4} onChange={e => setPayForm(f => ({ ...f, cardLast4: e.target.value }))} className={`${sel} block mt-0.5`}>
                  <option value="">choose…</option>
                  {[...new Set((data.charges || []).map(c => c.card_last4).filter(Boolean) as string[])].map(l4 => <option key={l4} value={l4}>····{l4}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-slate-400">Amount paid<input value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} inputMode="decimal" placeholder="0.00" className={`${sel} block mt-0.5 w-28`} /></label>
              <label className="text-[11px] text-slate-400">How
                <select value={payForm.method} onChange={e => setPayForm(f => ({ ...f, method: e.target.value }))} className={`${sel} block mt-0.5`}>
                  <option value="ach">ACH / bank</option><option value="card">card</option><option value="zelle">Zelle</option><option value="wire">wire</option><option value="other">other</option>
                </select>
              </label>
              <input value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} placeholder="Note (optional)" className={`${sel} flex-1 min-w-[160px]`} />
              <button disabled={busy} onClick={logPayment} className={`${btn} bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/40`}>Record payment</button>
              <span className="text-[11px] text-slate-500 basis-full">Marks the selected charges paid and records the money leaving the bank, so it shows in Payments in Flight until the debit lands. Selected: {money(selectedCents)}.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
