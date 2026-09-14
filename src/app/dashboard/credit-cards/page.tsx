'use client';

import { useEffect, useState, useCallback } from 'react';
import Script from 'next/script';
import { StatusPill, type Connection, type Freshness } from '@/components/finance-ui';

interface CreditCard {
  id: string;
  institution_name: string;
  account_name: string;
  nickname?: string | null;
  account_type: string;
  account_subtype: string;
  last_four: string;
  balance_available_cents: number;
  balance_ledger_cents: number;
  balance_updated_at: string | null;
  teller_enrollment_id: string | null;
  item_id?: string | null;
  connection: Connection;
  balance_verified: boolean;
  freshness: Freshness;
  statement?: {
    balance_cents: number | null;
    payments_since_close_cents: number;
    remaining_cents: number;
    paid: boolean;
    statement_date: string | null;
    due_date: string | null;
    days_to_due: number | null;
    min_payment_cents: number | null;
    min_satisfied: boolean;
    source: string;
  } | null;
  in_flight?: {
    cents: number;
    ambiguous_cents: number;
    projected_owed_cents: number | null;
    projected_statement_remaining_cents: number | null;
    rows: { id: string; date: string; amount_cents: number; card_last4: string; status: string; notes: string | null; store_name: string | null; ambiguous: boolean }[];
  } | null;
}

interface RepairGroup {
  item_id: string | null;
  institution_name: string;
  connection: Connection;
  affected_count: number;
  accounts: { id: string; name: string; last_four: string }[];
}

interface Transaction {
  id: string;
  bank_account_id: string;
  date: string;
  description: string;
  category: string | null;
  custom_category: string | null;
  amount_cents: number;
  type: string;
  status: string;
  counterparty: string | null;
  running_balance_cents: number | null;
}

interface CategoryBreakdown {
  category: string;
  inflow_cents: number;
  outflow_cents: number;
  count: number;
}

const CATEGORIES = [
  'Shopify Payout', 'Ad Spend', 'Inventory', 'Fulfillment', 'Loan',
  'Transfer In', 'Transfer Out', 'Payroll', 'Software', 'Taxes',
  'Refund', 'Wire', 'Owner Draw', 'Reinvest', 'Savings', 'Other',
];

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

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



export default function CreditCardsPage() {
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [summary, setSummary] = useState({ total_available_cents: 0, verified_owed_cents: 0, last_known_owed_cents: 0, verified_cards: 0, card_count: 0, attention_count: 0, in_flight_cents: 0 });
  const [repairGroups, setRepairGroups] = useState<RepairGroup[]>([]);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [plaidReady, setPlaidReady] = useState(false);
  // Script onLoad never re-fires on client-side navigation — poll for the SDK
  // (same fix as Banking's Connect button, 2026-08-10)
  useEffect(() => {
    if ((window as any).Plaid) { setPlaidReady(true); return; }
    const t = setInterval(() => { if ((window as any).Plaid) { setPlaidReady(true); clearInterval(t); } }, 500);
    const stop = setTimeout(() => clearInterval(t), 15000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, []);
  const [connecting, setConnecting] = useState(false);

  // Transaction view
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txnLoading, setTxnLoading] = useState(false);
  const [txnSummary, setTxnSummary] = useState({ inflow_cents: 0, outflow_cents: 0, total_count: 0 });
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdown[]>([]);
  const [editingTxn, setEditingTxn] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState<string>('all');

  useEffect(() => {
    loadCards();
  }, []);

  // Plaid Link. Fresh connects re-attach to
  // existing card rows by institution + last_four; reconnect on a plaid card
  // opens Plaid's UPDATE mode for its item.
  const handlePlaidConnect = useCallback(async (reconnectAccountId?: string | null) => {
    const w = window as any;
    if (!w.Plaid) { alert('Plaid not loaded yet — give the page a second and try again'); return; }
    setConnecting(true);
    try {
      const lt = await fetch('/api/plaid/link-token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: reconnectAccountId || undefined }),
      }).then(r => r.json());
      if (!lt.link_token) { alert(lt.error || 'Could not create Plaid link token'); setConnecting(false); return; }
      const handler = w.Plaid.create({
        token: lt.link_token,
        onSuccess: async (public_token: string) => {
          try {
            if (lt.mode !== 'update' && public_token) {
              const res = await fetch('/api/plaid/exchange', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ publicToken: public_token }),
              });
              const data = await res.json();
              if (data.error) alert('Error: ' + data.error);
              else setSyncResult(`Connected ${data.imported} account(s) via ${data.institution}`);
            } else {
              await fetch('/api/credit-cards', { method: 'POST' });
            }
            loadCards();
          } catch (err: any) { alert('Failed: ' + err.message); }
          setConnecting(false);
        },
        onExit: () => { setConnecting(false); },
      });
      handler.open();
    } catch (e: any) { alert(String(e?.message || e)); setConnecting(false); }
  }, []);

  async function loadCards() {
    setLoading(true);
    const res = await fetch('/api/credit-cards');
    const data = await res.json();
    setCards(data.cards || []);
    setRepairGroups(data.repair_groups || []);
    setSummary(data.summary || { total_available_cents: 0, verified_owed_cents: 0, last_known_owed_cents: 0, verified_cards: 0, card_count: 0, attention_count: 0, in_flight_cents: 0 });
    setLoading(false);
  }

  async function openDrawer(cardId: string) {
    setDrawerId(cardId);
    setDrawer(null);
    // detail endpoint is account-generic — works for credit accounts too
    const d = await fetch(`/api/banking?detail=${cardId}`).then(r => r.json()).catch(() => null);
    setDrawer(d);
  }

  async function loadTransactions(cardId: string) {
    setTxnLoading(true);
    setSelectedCard(cardId);
    setMonthFilter('all');
    const res = await fetch(`/api/credit-cards?accountId=${cardId}`);
    const data = await res.json();
    setTransactions(data.transactions || []);
    setTxnSummary(data.summary || { inflow_cents: 0, outflow_cents: 0, total_count: 0 });
    setCategoryBreakdown(data.categoryBreakdown || []);
    setTxnLoading(false);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    const res = await fetch('/api/credit-cards', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      setSyncResult(`Synced ${data.accounts_synced} cards, ${data.transactions_imported} new transactions`);
      loadCards();
      if (selectedCard) loadTransactions(selectedCard);
    } else {
      setSyncResult(data.error || 'Sync failed');
    }
    setSyncing(false);
  }

  async function updateTxnCategory(txnId: string, category: string) {
    await fetch('/api/credit-cards', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: txnId, category }),
    });
    if (selectedCard) loadTransactions(selectedCard);
  }

  const selectedCardData = cards.find(c => c.id === selectedCard);

  // Compute available months from transactions
  const availableMonths = Array.from(new Set(transactions.map(t => t.date?.slice(0, 7)).filter(Boolean))).sort().reverse();

  // Filter transactions by month
  const filteredTransactions = monthFilter === 'all' ? transactions : transactions.filter(t => t.date?.startsWith(monthFilter));
  const filteredInflow = filteredTransactions.filter(t => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0);
  const filteredOutflow = filteredTransactions.filter(t => t.amount_cents < 0).reduce((s, t) => s + t.amount_cents, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }

  return (
    <div>
      <Script
        src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"
        onLoad={() => setPlaidReady(true)}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Credit Cards</h1>
          <p className="text-sm text-slate-400 mt-1">American Express accounts — live via Plaid</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSync}
            disabled={syncing || cards.length === 0}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            {syncing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          Sync
          </button>
          <button
            onClick={() => handlePlaidConnect()}
            disabled={!plaidReady || connecting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            {connecting ? 'Connecting...' : 'Connect Card'}
          </button>
        </div>
      </div>

      {syncResult && (
        <div className="mb-4 px-4 py-3 bg-blue-900/30 border border-blue-800 rounded-lg text-sm text-blue-300">
          {syncResult}
        </div>
      )}

      {cards.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
          <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-white mb-2">No credit cards connected</h3>
          <p className="text-xs text-slate-400">Connect your Amex accounts via Bank Accounts page.</p>
        </div>
      ) : (
        <>
          {/* Coverage-aware headline — verified vs last-known debt never blended */}
          <div className="flex flex-wrap items-end gap-x-12 gap-y-4 mb-8">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Owed (bank-verified)</p>
              <p className="text-3xl font-semibold text-white tabular-nums">{cents(summary.verified_owed_cents)}</p>
              <p className="text-[11px] text-slate-500 mt-1.5">{summary.verified_cards} of {summary.card_count} cards verified within 36h</p>
              {summary.in_flight_cents > 0 && (
                <p className="text-[11px] text-teal-300 mt-1">≈ {cents(summary.verified_owed_cents + summary.last_known_owed_cents - summary.in_flight_cents)} once {cents(summary.in_flight_cents)} in flight lands</p>
              )}
            </div>
            {summary.last_known_owed_cents !== 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Owed (last-known)</p>
                <p className="text-2xl font-semibold text-slate-300 tabular-nums">{cents(summary.last_known_owed_cents)}</p>
                <p className="text-[11px] text-slate-500 mt-1.5">{summary.card_count - summary.verified_cards} cards awaiting verification</p>
              </div>
            )}
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Statements remaining</p>
              <p className="text-2xl font-semibold text-slate-200 tabular-nums">{cents(cards.reduce((s, c) => s + (c.statement?.remaining_cents || 0), 0))}</p>
              <p className="text-[11px] text-slate-500 mt-1.5">min still due {cents(cards.reduce((s, c) => s + (!c.statement || c.statement.paid || c.statement.min_satisfied ? 0 : c.statement.min_payment_cents || 0), 0))} · statement per bank, payments from card feed</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Real available (lines)</p>
              <p className={`text-2xl font-semibold tabular-nums ${summary.total_available_cents >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{cents(summary.total_available_cents)}</p>
              <p className="text-[11px] text-slate-500 mt-1.5">child-card ceilings excluded</p>
            </div>
          </div>

          {/* Repair center — one issue per bank login */}
          {repairGroups.length > 0 && (
            <div className="mb-6 rounded-xl bg-slate-900/70 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-800/60">
                <p className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider">Needs attention <span className="ml-1.5 text-slate-500">{repairGroups.length}</span></p>
              </div>
              {repairGroups.map(g => (
                <div key={g.item_id || g.accounts[0]?.id} className="px-4 py-3 flex items-center gap-4 border-b border-slate-800/40 last:border-b-0">
                  <StatusPill c={g.connection} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{g.institution_name}{g.affected_count > 1 && <span className="text-slate-500"> · {g.affected_count} cards on this login</span>}</p>
                    <p className="text-[12px] text-slate-400 truncate">{g.connection.reason}</p>
                  </div>
                  {g.connection.requiresUserAction && (
                    <button onClick={() => handlePlaidConnect(g.accounts[0]?.id)} disabled={connecting}
                      className="flex-shrink-0 px-3 py-1.5 bg-slate-100 hover:bg-white disabled:opacity-50 text-slate-900 text-[12px] font-semibold rounded-lg transition-colors">
                      {g.connection.userActionType === 'reauth' ? 'Fix connection' : 'Review'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Cards table — credit LINES as parent rows, their cards indented.
              Connection state from provider evidence only; freshness descriptive. */}
          <div className="rounded-xl bg-slate-900/60 overflow-hidden mb-6">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
                  <th className="px-4 py-2.5 font-semibold">Card</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Remaining balance</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Statement</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Min due</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Due</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Available</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...cards].sort((a, b) => {
                  const fam = (c: CreditCard) => c.account_name.replace(/^CORP Account - /i, '').replace(/ LINE$/i, '').slice(0, 14).toLowerCase();
                  const isParent = (c: CreditCard) => /^CORP Account/i.test(c.account_name) ? 0 : 1;
                  return fam(a).localeCompare(fam(b)) || isParent(a) - isParent(b);
                }).map(card => {
                  const fam = (c: CreditCard) => c.account_name.replace(/^CORP Account - /i, '').replace(/ LINE$/i, '').slice(0, 14).toLowerCase();
                  const isLine = /^CORP Account/i.test(card.account_name);
                  const parent = !isLine ? cards.find(c => /^CORP Account/i.test(c.account_name) && fam(c) === fam(card)) : undefined;
                  // A card can only spend what its LINE has left — its own
                  // "available" is just an allocation ceiling
                  const lineAvail = parent ? (parent.balance_available_cents || 0) : null;
                  const overstated = lineAvail !== null && lineAvail < (card.balance_available_cents || 0);
                  return (
                    <tr key={card.id} onClick={() => openDrawer(card.id)}
                      className={`border-b border-slate-800/30 last:border-b-0 cursor-pointer transition-colors hover:bg-slate-800/30 ${drawerId === card.id ? 'bg-slate-800/40' : ''} ${isLine ? 'bg-slate-800/20' : ''}`}>
                      <td className={`px-4 py-2.5 ${parent ? 'pl-8' : ''}`}>
                        <span className={isLine ? 'text-slate-100 font-medium' : 'text-slate-100'}>{card.nickname || card.account_name}</span>
                        <span className="text-slate-500"> ····{card.last_four}</span>
                        {isLine && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300">credit line</span>}
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${card.balance_verified ? 'text-slate-100' : 'text-slate-400'}`}>
                        {cents(Math.abs(card.balance_ledger_cents || 0))}
                        {!card.balance_verified && <span className="block text-[10px] font-normal text-slate-500">last-known {timeAgo(card.freshness?.balance_verified_at || card.balance_updated_at)}</span>}
                        {/* Payments sent to this card that its feed hasn't shown yet */}
                        {card.in_flight && card.in_flight.cents > 0 && card.in_flight.projected_owed_cents != null && (
                          <span className="block text-[10px] font-normal text-teal-300" title={card.in_flight.rows.filter(r => !r.ambiguous).map(r => `${r.date} ${cents(r.amount_cents)} from ${r.store_name || '?'}`).join('\n')}>
                            ≈ {cents(card.in_flight.projected_owed_cents)} after {cents(card.in_flight.cents)} in flight
                          </span>
                        )}
                        {card.in_flight && card.in_flight.ambiguous_cents > 0 && (
                          <span className="block text-[10px] font-normal text-amber-300/80" title="Logged to a mask two live cards share — say which card and it will be projected">
                            {cents(card.in_flight.ambiguous_cents)} in flight to ··{card.last_four} — this card or its twin?
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {!card.statement || card.statement.balance_cents == null ? <span className="text-slate-600">—</span>
                          : card.statement.paid ? <span className="text-emerald-400 font-medium">PAID ✓</span>
                          : <span className="text-slate-100 font-medium">{cents(card.statement.remaining_cents)}</span>}
                        {card.statement && !card.statement.paid && card.in_flight && card.in_flight.cents > 0 && card.in_flight.projected_statement_remaining_cents != null && (
                          <span className="block text-[10px] text-teal-300">→ {card.in_flight.projected_statement_remaining_cents === 0 ? 'PAID once in-flight lands' : `${cents(card.in_flight.projected_statement_remaining_cents)} after in-flight`}</span>
                        )}
                        {card.statement && !card.statement.paid && card.statement.payments_since_close_cents > 0 && (
                          <span className="block text-[10px] text-slate-500">of {cents(card.statement.balance_cents || 0)} · {cents(card.statement.payments_since_close_cents)} paid</span>
                        )}
                        {card.statement && !card.statement.paid && card.statement.payments_since_close_cents === 0 && card.statement.statement_date && (
                          <span className="block text-[10px] text-slate-500">closed {card.statement.statement_date.slice(5)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-200">
                        {!card.statement ? <span className="text-slate-600">—</span>
                          : card.statement.paid || card.statement.min_satisfied ? <span className="text-emerald-400">✓</span>
                          : card.statement.min_payment_cents ? cents(card.statement.min_payment_cents)
                          : <span className="text-slate-600">$0</span>}
                      </td>
                      <td className={`px-4 py-2.5 text-right whitespace-nowrap tabular-nums ${
                        card.statement?.days_to_due == null || card.statement?.paid ? 'text-slate-600'
                          : card.statement.days_to_due < 0 ? 'text-red-400 font-semibold'
                          : card.statement.days_to_due <= 3 ? 'text-red-300'
                          : card.statement.days_to_due <= 7 ? 'text-amber-300' : 'text-slate-300'}`}>
                        {card.statement?.due_date
                          ? <>{card.statement.due_date.slice(5)}{!card.statement.paid && <span className="block text-[10px] font-normal opacity-70">{card.statement.days_to_due! < 0 ? `${-card.statement.days_to_due!}d late` : `${card.statement.days_to_due}d`}</span>}</>
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <span className={card.balance_available_cents >= 0 ? 'text-emerald-300' : 'text-red-300'}>{cents(card.balance_available_cents || 0)}</span>
                        {overstated && <span className="block text-[10px] text-amber-400" title={`Capped by the ${parent!.account_name.replace(/^CORP Account - /i, '')} line`}>real ≈ {cents(lineAvail!)}</span>}
                      </td>
                      <td className="px-4 py-2.5 max-w-[300px]">
                        <StatusPill c={card.connection} />
                        {card.connection.status !== 'HEALTHY' && card.connection.status !== 'SYNCING' && (
                          <p className="text-[10px] text-slate-500 mt-1 truncate" title={card.connection.reason}>{card.connection.reason}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Transactions */}
          {selectedCard && (
            <>
              {/* Category Breakdown */}
              {categoryBreakdown.length > 0 && categoryBreakdown.some(c => c.category !== 'Uncategorized') && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-4">
                  <h3 className="text-sm font-semibold text-white mb-3">Spend by Category</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {categoryBreakdown.filter(c => c.category !== 'Uncategorized').map(c => (
                      <div key={c.category} className="px-3 py-2 bg-slate-800/50 rounded-lg">
                        <p className="text-xs text-slate-400 font-medium">{c.category}</p>
                        <div className="flex justify-between mt-1">
                          {c.inflow_cents > 0 && <span className="text-[10px] text-emerald-400">+{cents(c.inflow_cents)}</span>}
                          {c.outflow_cents > 0 && <span className="text-[10px] text-red-400">-{cents(c.outflow_cents)}</span>}
                        </div>
                        <p className="text-[10px] text-slate-600 mt-0.5">{c.count} txns</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-800">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-white">
                      Transactions — {selectedCardData?.institution_name} {selectedCardData?.account_name} ****{selectedCardData?.last_four}
                    </h2>
                    <select
                      value={monthFilter}
                      onChange={e => setMonthFilter(e.target.value)}
                      className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="all">All Months</option>
                      {availableMonths.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-4 mt-1">
                    <span className="text-xs text-emerald-400">In: {cents(filteredInflow)}</span>
                    <span className="text-xs text-red-400">Out: {cents(Math.abs(filteredOutflow))}</span>
                    <span className="text-xs text-slate-500">{filteredTransactions.length} transactions</span>
                  </div>
                </div>

                {txnLoading ? (
                  <div className="flex items-center justify-center h-24">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400" />
                  </div>
                ) : filteredTransactions.length === 0 ? (
                  <p className="px-5 py-8 text-xs text-slate-500 text-center">{transactions.length === 0 ? 'No transactions yet. Click Sync to pull latest.' : 'No transactions for this month.'}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                          <th className="text-left px-5 py-3">Date</th>
                          <th className="text-left px-5 py-3">Description</th>
                          <th className="text-left px-5 py-3">Category</th>
                          <th className="text-left px-5 py-3">Counterparty</th>
                          <th className="text-right px-5 py-3">Amount</th>
                          <th className="text-right px-5 py-3">Balance</th>
                          <th className="text-center px-5 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTransactions.map(txn => (
                          <tr key={txn.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                            <td className="px-5 py-3 text-slate-300 text-xs">{txn.date}</td>
                            <td className="px-5 py-3 text-white text-xs whitespace-normal">{txn.description}</td>
                            <td className="px-5 py-3 text-xs">
                              {editingTxn === txn.id ? (
                                <div className="flex gap-1 items-center">
                                  <input
                                    list={`cat-${txn.id}`}
                                    defaultValue={txn.custom_category || ''}
                                    placeholder="Type or select..."
                                    autoFocus
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') { updateTxnCategory(txn.id, (e.target as HTMLInputElement).value); setEditingTxn(null); }
                                      if (e.key === 'Escape') setEditingTxn(null);
                                    }}
                                    onBlur={e => { if (e.target.value !== (txn.custom_category || '')) updateTxnCategory(txn.id, e.target.value); setEditingTxn(null); }}
                                    className="px-1 py-0.5 bg-slate-800 border border-slate-600 rounded text-[10px] text-white focus:outline-none focus:border-blue-500 w-36"
                                  />
                                  <datalist id={`cat-${txn.id}`}>
                                    <option value="">None</option>
                                    {CATEGORIES.map(c => <option key={c} value={c} />)}
                                  </datalist>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setEditingTxn(txn.id)}
                                  className={`text-[10px] px-2 py-0.5 rounded-full cursor-pointer ${
                                    txn.custom_category
                                      ? 'bg-blue-900/30 text-blue-400 hover:bg-blue-900/50'
                                      : 'bg-slate-800 text-slate-500 hover:text-slate-300'
                                  }`}
                                >
                                  {txn.custom_category || txn.category || 'Categorize'}
                                </button>
                              )}
                            </td>
                            <td className="px-5 py-3 text-slate-400 text-xs">{txn.counterparty || '—'}</td>
                            <td className={`px-5 py-3 text-right font-medium text-xs ${txn.amount_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {txn.amount_cents >= 0 ? '+' : ''}{cents(txn.amount_cents)}
                            </td>
                            <td className="px-5 py-3 text-right text-slate-400 text-xs">
                              {txn.running_balance_cents != null ? cents(txn.running_balance_cents) : '—'}
                            </td>
                            <td className="px-5 py-3 text-center">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                                txn.status === 'posted' ? 'bg-emerald-900/30 text-emerald-400'
                                  : 'bg-yellow-900/30 text-yellow-400'
                              }`}>{txn.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Card detail drawer — same evidence-on-demand pattern as Banking */}
      {drawerId && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => { setDrawerId(null); setDrawer(null); }} />
          <aside className="fixed right-0 top-0 bottom-0 w-full sm:w-[420px] bg-slate-900 z-50 overflow-y-auto shadow-2xl">
            {!drawer ? (
              <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" /></div>
            ) : (() => {
              const a = drawer.account;
              return (
                <div className="p-6">
                  <div className="flex items-start justify-between mb-5">
                    <div>
                      <h2 className="text-lg font-semibold text-white">{a.nickname || a.account_name}</h2>
                      <p className="text-[12px] text-slate-400">{a.institution_name} ····{a.last_four}</p>
                    </div>
                    <button onClick={() => { setDrawerId(null); setDrawer(null); }} className="text-slate-500 hover:text-white text-lg leading-none">✕</button>
                  </div>

                  <div className="mb-5">
                    <StatusPill c={a.connection} />
                    <p className="text-[12px] text-slate-400 mt-2 leading-relaxed">{a.connection.reason}</p>
                    {a.connection.requiresUserAction && (
                      <button onClick={() => handlePlaidConnect(a.id)} disabled={connecting}
                        className="mt-3 w-full px-3 py-2 bg-slate-100 hover:bg-white disabled:opacity-50 text-slate-900 text-[13px] font-semibold rounded-lg">
                        {connecting ? 'Opening…' : 'Fix connection'}
                      </button>
                    )}
                  </div>

                  <div className="rounded-lg bg-slate-800/40 p-4 mb-5">
                    <div className="flex items-baseline justify-between mb-1">
                      <p className="text-[11px] uppercase tracking-wider text-slate-500">{a.balance_verified ? 'Bank-verified balance owed' : 'Last verified balance owed'}</p>
                      <p className="text-[11px] text-slate-500">{timeAgo(a.freshness?.balance_verified_at)}</p>
                    </div>
                    <p className="text-2xl font-semibold text-white tabular-nums">{cents(Math.abs(a.balance_ledger_cents || 0))}</p>
                    <p className="text-[12px] text-slate-400 mt-1 tabular-nums">Available {cents(a.balance_available_cents || 0)}</p>
                    {!a.balance_verified && (
                      <p className="text-[11px] text-amber-300/80 mt-2">Not freshly verified — last balance the bank confirmed, preserved until the connection verifies again.</p>
                    )}
                  </div>

                  {(() => {
                    const st = cards.find(c => c.id === drawerId)?.statement;
                    if (!st) return null;
                    return (
                      <div className="rounded-lg bg-slate-800/40 p-4 mb-5">
                        <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Statement <span className="normal-case">({st.source === 'plaid' ? 'from the bank' : 'manual entry'})</span></p>
                        <div className="space-y-1.5 text-[12px]">
                          <div className="flex justify-between"><span className="text-slate-400">Remaining on statement</span>
                            <span className={`font-medium tabular-nums ${st.paid ? 'text-emerald-400' : 'text-slate-100'}`}>{st.paid ? 'PAID ✓' : cents(st.remaining_cents)}</span>
                          </div>
                          <div className="flex justify-between"><span className="text-slate-400">Statement balance at close</span><span className="text-slate-200 tabular-nums">{st.balance_cents != null ? cents(st.balance_cents) : '—'}</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">Payments since close</span><span className="text-slate-200 tabular-nums">{cents(st.payments_since_close_cents)}</span></div>
                          {(() => {
                            const inf = cards.find(c => c.id === drawerId)?.in_flight;
                            if (!inf || !inf.rows.length) return null;
                            return (
                              <div className="pt-2 mt-2 border-t border-slate-700/50">
                                <p className="text-[11px] uppercase tracking-wider text-teal-300/80 mb-1">Sent, not yet on the card</p>
                                {inf.rows.map(r => (
                                  <div key={r.id} className="flex justify-between">
                                    <span className="text-slate-400">{r.date} · {r.store_name || '—'}{r.ambiguous ? ' · this card or its twin?' : ''}{r.status === 'not_taken' ? ' · 4+ days, check the bank' : ''}</span>
                                    <span className="text-teal-300 tabular-nums">{cents(r.amount_cents)}</span>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                          <div className="flex justify-between"><span className="text-slate-400">Minimum payment</span><span className="text-slate-100 tabular-nums">{st.paid || st.min_satisfied ? '✓ satisfied' : st.min_payment_cents != null ? cents(st.min_payment_cents) : '—'}</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">Statement closed</span><span className="text-slate-200">{st.statement_date || '—'}</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">Payment due</span>
                            <span className={st.days_to_due != null && st.days_to_due < 0 ? 'text-red-300 font-semibold' : st.days_to_due != null && st.days_to_due <= 7 ? 'text-amber-300' : 'text-slate-200'}>
                              {st.due_date || '—'}{st.days_to_due != null && ` (${st.days_to_due < 0 ? `${-st.days_to_due}d late` : `${st.days_to_due}d`})`}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="mb-5">
                    <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Data freshness</p>
                    <div className="space-y-1.5 text-[12px]">
                      <div className="flex justify-between"><span className="text-slate-400">Balance verified</span><span className="text-slate-200">{a.freshness?.balance_verified_at ? timeAgo(a.freshness.balance_verified_at) : 'never'}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">Transactions checked</span><span className="text-slate-200">{a.freshness?.transactions_checked_at ? timeAgo(a.freshness.transactions_checked_at) : 'no record'}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">Transactions through</span><span className="text-slate-200">{a.freshness?.transactions_through || '—'}</span></div>
                      {drawer.transactions?.n > 0 && (
                        <div className="flex justify-between"><span className="text-slate-400">History held</span><span className="text-slate-200 tabular-nums">{drawer.transactions.n.toLocaleString()} txns · {drawer.transactions.first} → {drawer.transactions.last}</span></div>
                      )}
                    </div>
                  </div>

                  {drawer.item && (
                    <div className="mb-5">
                      <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Connection health</p>
                      <div className="space-y-1.5 text-[12px]">
                        <div className="flex justify-between"><span className="text-slate-400">Authorization</span><span className={drawer.item.provider_error_code ? 'text-amber-300' : 'text-emerald-300'}>{drawer.item.provider_error_code ? 'Action required' : 'Valid'}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Last sync attempt</span><span className="text-slate-200">{drawer.item.last_sync_attempt_at ? timeAgo(drawer.item.last_sync_attempt_at) : 'no record'}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Last successful sync</span><span className="text-slate-200">{drawer.item.last_sync_success_at ? timeAgo(drawer.item.last_sync_success_at) : 'no record'}</span></div>
                      </div>
                      {drawer.item.provider_error_code && (
                        <div className="mt-3 rounded-lg bg-red-500/5 px-3 py-2.5">
                          <p className="text-[12px] font-semibold text-red-300">{drawer.item.provider_error_code}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">{drawer.item.provider_error_message}</p>
                        </div>
                      )}
                      {drawer.siblings?.length > 0 && (
                        <p className="text-[11px] text-slate-500 mt-2">Same login also covers: {drawer.siblings.map((s: any) => `${s.nickname || s.account_name} ····${s.last_four}`).join(', ')} — one repair fixes all.</p>
                      )}
                    </div>
                  )}

                  {drawer.sync_runs?.length > 0 && (
                    <div className="mb-5">
                      <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Recent sync history</p>
                      <div className="space-y-1">
                        {drawer.sync_runs.map((r: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 text-[11px]">
                            <span className="text-slate-500 w-24 flex-shrink-0">{(r.started_at || '').slice(5, 16).replace('T', ' ')}</span>
                            <span className={r.status === 'success' ? 'text-emerald-400' : r.status === 'partial' ? 'text-amber-400' : 'text-red-400'}>{r.status}</span>
                            <span className="text-slate-500 truncate">{r.error_code || (r.records_added ? `${r.records_added} new txns` : 'no changes')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 pt-2 border-t border-slate-800/60">
                    <button onClick={() => { loadTransactions(drawerId!); setDrawerId(null); setDrawer(null); }}
                      className="flex-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[13px] font-medium rounded-lg">View transactions</button>
                  </div>
                </div>
              );
            })()}
          </aside>
        </>
      )}
    </div>
  );
}
