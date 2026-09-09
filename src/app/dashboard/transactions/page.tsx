'use client';

import { Fragment, useEffect, useState, useCallback } from 'react';
import { fmtCents, timeAgoStr } from '@/components/finance-ui';

// Unified transaction feed — every movement across all bank accounts and
// credit cards in one stream. Read-only truth from the bank feeds; the only
// mutation is manual categorization.

interface Txn {
  id: string;
  date: string;
  description: string;
  amount_cents: number;
  status: string;
  counterparty: string | null;
  category: string | null;
  custom_category: string | null;
  account_id: string;
  institution_name: string;
  account_name: string;
  nickname: string | null;
  last_four: string;
  account_type: string;
  // reconciliation verdict (classification_results)
  cls_category: string | null;
  suggested_category: string | null;
  cls_method: string | null;
  cls_confidence: number | null;
  cls_reason: string | null;
  evidence_json: string | null;
  cls_needs_review: number | null;
  store_name: string | null;
  suggested_store_name: string | null;
  // the OTHER leg when paired
  pair_description: string | null;
  pair_date: string | null;
  pair_amount_cents: number | null;
  pair_institution: string | null;
  pair_last_four: string | null;
  pair_nickname: string | null;
  pair_account_name: string | null;
}

const METHOD_LABEL: Record<string, string> = {
  MANUAL: '✓ manual', TRANSFER_MATCH: '↔ transfer pair', CARD_PAYMENT_MATCH: '↔ card payment',
  INVOICE_MATCH: '🧾 invoice', PAYOUT_MATCH: '⬇ payout', EXACT_HISTORY: '✓ verified history',
  MERCHANT_RULE: '§ rule', MERCHANT_KNOWLEDGE: '~ merchant', SEMANTIC_HISTORY: '~ similar',
  LLM_ASSISTED: '🤖 suggested', TRANSFER_SUSPECT: '⚠ ambiguous pair', UNKNOWN: '',
};

interface Account {
  id: string;
  institution_name: string;
  account_name: string;
  nickname: string | null;
  last_four: string;
  account_type: string;
}

const CATEGORIES = [
  'Shopify Payout', 'Ad Spend', 'Inventory', 'Fulfillment', 'Loan',
  'Transfer In', 'Transfer Out', 'Payroll', 'Software', 'Taxes',
  'Refund', 'Wire', 'Owner Draw', 'Reinvest', 'Savings', 'Other',
];

const acctLabel = (a: { nickname?: string | null; account_name: string; institution_name: string; last_four: string }) =>
  `${a.nickname || a.account_name || a.institution_name} ····${a.last_four}`;

export default function TransactionsPage() {
  const [txns, setTxns] = useState<Txn[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [totals, setTotals] = useState({ n: 0, inflow_cents: 0, outflow_cents: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<{ beforeDate: string; beforeId: string } | null>(null);

  const [health, setHealth] = useState<{ issues: { key: string; severity: string; label: string; count: number; amount_cents?: number; href?: string }[] } | null>(null);
  useEffect(() => { fetch('/api/health-finance').then(r => r.json()).then(setHealth).catch(() => {}); }, []);

  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [kind, setKind] = useState<'all' | 'bank' | 'card'>('all');
  const [accountId, setAccountId] = useState('');
  const [status, setStatus] = useState('all');
  const [storeFilter, setStoreFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [confFilter, setConfFilter] = useState('');
  const [storesList, setStoresList] = useState<{ id: string; name: string }[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async (append = false, cur: typeof cursor = null) => {
    if (append) setLoadingMore(true); else setLoading(true);
    const p = new URLSearchParams({ limit: '100' });
    if (qDebounced) p.set('q', qDebounced);
    if (kind !== 'all') p.set('kind', kind);
    if (accountId) p.set('accountId', accountId);
    if (status !== 'all') p.set('status', status);
    if (storeFilter) p.set('store', storeFilter);
    if (methodFilter) p.set('method', methodFilter);
    if (confFilter) p.set('conf', confFilter);
    if (append && cur) { p.set('beforeDate', cur.beforeDate); p.set('beforeId', cur.beforeId); }
    const d = await fetch(`/api/transactions?${p}`).then(r => r.json()).catch(() => null);
    if (d) {
      setTxns(prev => append ? [...prev, ...(d.transactions || [])] : (d.transactions || []));
      setAccounts(d.accounts || []);
      setStoresList(d.stores || []);
      setTotals(d.totals || { n: 0, inflow_cents: 0, outflow_cents: 0 });
      setHasMore(!!d.hasMore);
      setCursor(d.nextCursor || null);
    }
    setLoading(false);
    setLoadingMore(false);
  }, [qDebounced, kind, accountId, status, storeFilter, methodFilter, confFilter]);

  useEffect(() => { load(false); }, [load]);

  async function setCategory(txnId: string, category: string) {
    await fetch('/api/transactions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: txnId, category }),
    });
    setTxns(prev => prev.map(t => t.id === txnId ? { ...t, custom_category: category || null } : t));
    setEditing(null);
  }

  // group rows by date for calm scanning
  const byDate: [string, Txn[]][] = [];
  for (const t of txns) {
    const last = byDate[byDate.length - 1];
    if (last && last[0] === t.date) last[1].push(t);
    else byDate.push([t.date, [t]]);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Transactions</h1>
          <p className="text-sm text-slate-400 mt-1">Every movement across all bank accounts and credit cards</p>
        </div>
      </div>

      {/* Integrity issues — the system reports what's wrong, you don't hunt */}
      {health && health.issues.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {health.issues.map(i => (
            <a key={i.key} href={i.href || '#'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                i.severity === 'critical' ? 'bg-red-500/10 text-red-300 hover:bg-red-500/20'
                : i.severity === 'warning' ? 'bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800'}`}>
              <span className="font-semibold tabular-nums">{i.count}</span> {i.label}
              {i.amount_cents != null && i.amount_cents > 0 && <span className="opacity-70 tabular-nums">· {fmtCents(i.amount_cents)}</span>}
            </a>
          ))}
        </div>
      )}

      {/* Filter-scoped totals */}
      <div className="flex flex-wrap items-end gap-x-10 gap-y-3 mb-6">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">In</p>
          <p className="text-xl font-semibold text-emerald-300 tabular-nums">{fmtCents(totals.inflow_cents)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Out</p>
          <p className="text-xl font-semibold text-red-300 tabular-nums">{fmtCents(Math.abs(totals.outflow_cents))}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Net</p>
          <p className={`text-xl font-semibold tabular-nums ${totals.inflow_cents + totals.outflow_cents >= 0 ? 'text-slate-100' : 'text-red-300'}`}>
            {fmtCents(totals.inflow_cents + totals.outflow_cents)}
          </p>
        </div>
        <p className="text-[12px] text-slate-500 pb-1 ml-auto tabular-nums">{totals.n.toLocaleString()} transactions match</p>
      </div>

      {/* Controls — status pills + dimension filters */}
      <div className="space-y-2 mb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {([['all', 'All'], ['categorized', '✓ Categorized'], ['suggested', '~ Suggested'], ['uncategorized', '∅ Uncategorized'], ['review', '⚠ Needs review'], ['paired', '↔ Paired']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setStatus(k)}
              className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                status === k ? 'bg-slate-100 text-slate-900' : 'bg-slate-900/70 text-slate-400 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search description, merchant, or exact amount"
            className="w-72 bg-slate-900/70 rounded-lg px-3 py-1.5 text-[13px] text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-600" />
          <div className="flex rounded-lg overflow-hidden bg-slate-900/70">
            {(['all', 'bank', 'card'] as const).map(k => (
              <button key={k} onClick={() => setKind(k)}
                className={`px-3 py-1.5 text-[12px] font-medium capitalize ${kind === k ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}>
                {k === 'all' ? 'All' : k === 'bank' ? 'Banks' : 'Cards'}
              </button>
            ))}
          </div>
          <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}
            className={`text-[13px] rounded-lg px-2.5 py-1.5 ${storeFilter ? 'bg-slate-700 text-white' : 'bg-slate-900/70 text-slate-300'}`}>
            <option value="">All stores</option>
            <option value="unattributed">⚠ Unattributed</option>
            {storesList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={confFilter} onChange={e => setConfFilter(e.target.value)}
            className={`text-[13px] rounded-lg px-2.5 py-1.5 ${confFilter ? 'bg-slate-700 text-white' : 'bg-slate-900/70 text-slate-300'}`}>
            <option value="">Any confidence</option>
            <option value="high">≥ 95% (asserted)</option>
            <option value="mid">80–95% (suggestions)</option>
            <option value="low">&lt; 80% (unknown)</option>
          </select>
          <select value={methodFilter} onChange={e => setMethodFilter(e.target.value)}
            className={`text-[13px] rounded-lg px-2.5 py-1.5 ${methodFilter ? 'bg-slate-700 text-white' : 'bg-slate-900/70 text-slate-300'}`}>
            <option value="">Any method</option>
            {Object.entries(METHOD_LABEL).filter(([, v]) => v).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={accountId} onChange={e => setAccountId(e.target.value)}
            className={`text-[13px] rounded-lg px-2.5 py-1.5 max-w-[240px] ${accountId ? 'bg-slate-700 text-white' : 'bg-slate-900/70 text-slate-300'}`}>
            <option value="">All accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{acctLabel(a)}{a.account_type === 'credit' ? ' (card)' : ''}</option>)}
          </select>
          {(status !== 'all' || storeFilter || methodFilter || confFilter || accountId || q) && (
            <button onClick={() => { setStatus('all'); setStoreFilter(''); setMethodFilter(''); setConfFilter(''); setAccountId(''); setQ(''); }}
              className="text-[12px] text-slate-500 hover:text-white px-1">✕ Clear</button>
          )}
        </div>
      </div>

      {/* Feed */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" />
        </div>
      ) : txns.length === 0 ? (
        <div className="rounded-xl bg-slate-900/60 p-10 text-center text-slate-500 text-sm">No transactions match</div>
      ) : (
        <div className="rounded-xl bg-slate-900/60 overflow-hidden mb-6">
          <table className="w-full text-[13px]">
            <tbody>
              {byDate.map(([date, rows]) => (
                <Fragment key={date}>
                  <tr className="bg-slate-800/30">
                    <td colSpan={6} className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      {date} <span className="normal-case font-normal">· {timeAgoStr(date + ' 12:00:00')}</span>
                    </td>
                  </tr>
                  {rows.map(t => {
                    const cat = t.custom_category || t.cls_category;
                    const isPaired = !!t.pair_description;
                    const evidence: { type: string; reference: string }[] = (() => {
                      try { return JSON.parse(t.evidence_json || '[]'); } catch { return []; }
                    })();
                    return (
                    <Fragment key={t.id}>
                    <tr onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                      className={`border-b border-slate-800/30 last:border-b-0 hover:bg-slate-800/30 transition-colors cursor-pointer ${expanded === t.id ? 'bg-slate-800/40' : ''}`}>
                      <td className="px-4 py-2 max-w-[380px]">
                        <span className="text-slate-100 truncate block">{t.description || t.counterparty || '—'}</span>
                        {t.status === 'pending' && <span className="text-[10px] text-blue-300">pending</span>}
                      </td>
                      <td className="px-4 py-2 text-slate-400 whitespace-nowrap">
                        {acctLabel(t)}
                        {t.account_type === 'credit' && <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-slate-800 text-slate-500">card</span>}
                      </td>
                      <td className="px-4 py-2 text-slate-400 whitespace-nowrap">
                        {t.store_name || <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {t.cls_method && METHOD_LABEL[t.cls_method] ? (
                          <span title={t.cls_reason || ''} className={`text-[11px] ${
                            t.cls_method === 'TRANSFER_SUSPECT' ? 'text-amber-300'
                            : isPaired ? 'text-blue-300' : 'text-slate-400'}`}>
                            {METHOD_LABEL[t.cls_method]}
                          </span>
                        ) : t.cls_needs_review ? <span className="text-[11px] text-slate-600">needs review</span> : null}
                      </td>
                      <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                        {editing === t.id ? (
                          <select autoFocus defaultValue={t.custom_category || ''} onBlur={() => setEditing(null)}
                            onChange={e => setCategory(t.id, e.target.value)}
                            className="bg-slate-800 text-slate-200 text-[12px] rounded px-1.5 py-1">
                            <option value="">uncategorized</option>
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : (
                          <button onClick={() => setEditing(t.id)}
                            className={`text-[11px] px-2 py-0.5 rounded-full ${cat ? (t.custom_category ? 'bg-blue-500/10 text-blue-300' : 'bg-slate-800 text-slate-300')
                              : t.suggested_category ? 'bg-amber-500/5 text-amber-300/70 italic' : 'text-slate-600 hover:text-slate-400'}`}>
                            {cat || (t.suggested_category ? `suggest: ${t.suggested_category}?` : '+ categorize')}
                          </button>
                        )}
                      </td>
                      <td className={`px-4 py-2 text-right tabular-nums font-medium whitespace-nowrap ${t.amount_cents >= 0 ? 'text-emerald-300' : 'text-slate-100'}`}>
                        {t.amount_cents >= 0 ? '+' : ''}{fmtCents(t.amount_cents)}
                      </td>
                    </tr>
                    {expanded === t.id && (
                      <tr className="bg-slate-950/50">
                        <td colSpan={6} className="px-6 py-3">
                          {/* WHY does YM believe this — the reconciliation evidence */}
                          {t.cls_reason ? (
                            <div className="space-y-1.5">
                              <p className="text-[12px] text-slate-300">
                                {t.cls_reason}
                                {t.cls_confidence != null && t.cls_method !== 'MANUAL' && (
                                  <span className="text-slate-500"> · confidence {(t.cls_confidence * 100).toFixed(0)}%</span>
                                )}
                              </p>
                              {isPaired && (
                                <p className="text-[12px] text-blue-300">
                                  ↔ connected to: <span className="text-slate-200">{t.pair_description}</span>
                                  {t.pair_amount_cents != null && <span className="text-slate-100 font-medium tabular-nums"> {t.pair_amount_cents >= 0 ? '+' : ''}{fmtCents(t.pair_amount_cents)}</span>}
                                  <span className="text-slate-500"> on {t.pair_nickname || t.pair_account_name || t.pair_institution} ····{t.pair_last_four} · {t.pair_date}</span>
                                </p>
                              )}
                              {!t.store_name && t.suggested_store_name && (
                                <p className="text-[11px] text-amber-300/70 italic">likely {t.suggested_store_name} (unconfirmed — transaction itself is unexplained, so no store is claimed)</p>
                              )}
                              {evidence.length > 0 && (
                                <p className="text-[11px] text-slate-500">
                                  evidence: {evidence.map(e => `${e.type.replace(/_/g, ' ')} (${String(e.reference).slice(0, 60)})`).join(' · ')}
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-[12px] text-slate-500">Not yet reconciled — run the categorizer or categorize manually.</p>
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );})}
                </Fragment>
              ))}
            </tbody>
          </table>
          {hasMore && (
            <button onClick={() => load(true, cursor)} disabled={loadingMore}
              className="w-full py-2.5 text-[13px] text-blue-400 hover:text-blue-300 hover:bg-slate-800/30 disabled:opacity-50 border-t border-slate-800/40">
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
