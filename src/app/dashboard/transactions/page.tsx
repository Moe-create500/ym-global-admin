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
}

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
  const [editing, setEditing] = useState<string | null>(null);

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
    if (append && cur) { p.set('beforeDate', cur.beforeDate); p.set('beforeId', cur.beforeId); }
    const d = await fetch(`/api/transactions?${p}`).then(r => r.json()).catch(() => null);
    if (d) {
      setTxns(prev => append ? [...prev, ...(d.transactions || [])] : (d.transactions || []));
      setAccounts(d.accounts || []);
      setTotals(d.totals || { n: 0, inflow_cents: 0, outflow_cents: 0 });
      setHasMore(!!d.hasMore);
      setCursor(d.nextCursor || null);
    }
    setLoading(false);
    setLoadingMore(false);
  }, [qDebounced, kind, accountId]);

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

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search description, merchant, category, or exact amount"
          className="w-80 bg-slate-900/70 rounded-lg px-3 py-1.5 text-[13px] text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-600" />
        <div className="flex rounded-lg overflow-hidden bg-slate-900/70">
          {(['all', 'bank', 'card'] as const).map(k => (
            <button key={k} onClick={() => setKind(k)}
              className={`px-3 py-1.5 text-[12px] font-medium capitalize ${kind === k ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}>
              {k === 'all' ? 'All' : k === 'bank' ? 'Banks' : 'Cards'}
            </button>
          ))}
        </div>
        <select value={accountId} onChange={e => setAccountId(e.target.value)}
          className="bg-slate-900/70 text-slate-300 text-[13px] rounded-lg px-2.5 py-1.5 max-w-[280px]">
          <option value="">All accounts</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{acctLabel(a)}{a.account_type === 'credit' ? ' (card)' : ''}</option>)}
        </select>
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
                    <td colSpan={4} className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      {date} <span className="normal-case font-normal">· {timeAgoStr(date + ' 12:00:00')}</span>
                    </td>
                  </tr>
                  {rows.map(t => (
                    <tr key={t.id} className="border-b border-slate-800/30 last:border-b-0 hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-2 max-w-[420px]">
                        <span className="text-slate-100 truncate block">{t.description || t.counterparty || '—'}</span>
                        {t.status === 'pending' && <span className="text-[10px] text-blue-300">pending</span>}
                      </td>
                      <td className="px-4 py-2 text-slate-400 whitespace-nowrap">
                        {acctLabel(t)}
                        {t.account_type === 'credit' && <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-slate-800 text-slate-500">card</span>}
                      </td>
                      <td className="px-4 py-2">
                        {editing === t.id ? (
                          <select autoFocus defaultValue={t.custom_category || ''} onBlur={() => setEditing(null)}
                            onChange={e => setCategory(t.id, e.target.value)}
                            className="bg-slate-800 text-slate-200 text-[12px] rounded px-1.5 py-1">
                            <option value="">uncategorized</option>
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : (
                          <button onClick={() => setEditing(t.id)}
                            className={`text-[11px] px-2 py-0.5 rounded-full ${t.custom_category || t.category ? 'bg-slate-800 text-slate-300' : 'text-slate-600 hover:text-slate-400'}`}>
                            {t.custom_category || t.category || '+ categorize'}
                          </button>
                        )}
                      </td>
                      <td className={`px-4 py-2 text-right tabular-nums font-medium whitespace-nowrap ${t.amount_cents >= 0 ? 'text-emerald-300' : 'text-slate-100'}`}>
                        {t.amount_cents >= 0 ? '+' : ''}{fmtCents(t.amount_cents)}
                      </td>
                    </tr>
                  ))}
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
