'use client';

import { useEffect, useState, useCallback } from 'react';
import Script from 'next/script';

interface CreditCard {
  id: string;
  institution_name: string;
  account_name: string;
  account_type: string;
  account_subtype: string;
  last_four: string;
  balance_available_cents: number;
  balance_ledger_cents: number;
  balance_updated_at: string | null;
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

const TELLER_APP_ID = process.env.NEXT_PUBLIC_TELLER_APP_ID || '';

export default function CreditCardsPage() {
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [summary, setSummary] = useState({ total_available_cents: 0, total_ledger_cents: 0, card_count: 0 });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [tellerReady, setTellerReady] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Transaction view
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txnLoading, setTxnLoading] = useState(false);
  const [txnSummary, setTxnSummary] = useState({ inflow_cents: 0, outflow_cents: 0, total_count: 0 });
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdown[]>([]);
  const [editingTxn, setEditingTxn] = useState<string | null>(null);

  useEffect(() => {
    loadCards();
  }, []);

  const handleTellerConnect = useCallback(() => {
    const w = window as any;
    if (!w.TellerConnect) { alert('Teller Connect not loaded yet'); return; }

    setConnecting(true);
    const teller = w.TellerConnect.setup({
      applicationId: TELLER_APP_ID,
      environment: process.env.NEXT_PUBLIC_TELLER_ENV || 'sandbox',
      selectAccount: 'multiple',
      onSuccess: async (enrollment: any) => {
        const token = enrollment.accessToken || enrollment.access_token;
        const eid = enrollment.enrollment?.id || enrollment.id;
        if (!token) { alert('No access token received from Teller'); setConnecting(false); return; }
        try {
          const res = await fetch('/api/credit-cards', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: token, enrollmentId: eid }),
          });
          const data = await res.json();
          if (data.error) { alert('Error: ' + data.error); }
          else { setSyncResult(`Connected ${data.imported} new credit card(s)`); }
          loadCards();
          // Auto-sync after connecting
          await fetch('/api/credit-cards', { method: 'POST' });
          loadCards();
        } catch (err: any) { alert('Failed: ' + err.message); }
        setConnecting(false);
      },
      onExit: () => { setConnecting(false); },
      onFailure: () => { setConnecting(false); },
    });
    teller.open();
  }, []);

  async function loadCards() {
    setLoading(true);
    const res = await fetch('/api/credit-cards');
    const data = await res.json();
    setCards(data.cards || []);
    setSummary(data.summary || { total_available_cents: 0, total_ledger_cents: 0, card_count: 0 });
    setLoading(false);
  }

  async function loadTransactions(cardId: string) {
    setTxnLoading(true);
    setSelectedCard(cardId);
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
        src="https://cdn.teller.io/connect/connect.js"
        onLoad={() => setTellerReady(true)}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Credit Cards</h1>
          <p className="text-sm text-slate-400 mt-1">American Express accounts — synced via Teller</p>
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
            onClick={handleTellerConnect}
            disabled={!tellerReady || connecting}
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
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Total Available</p>
              <p className={`text-xl font-bold ${summary.total_available_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {cents(summary.total_available_cents)}
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Total Ledger</p>
              <p className="text-xl font-bold text-white">{cents(summary.total_ledger_cents)}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Cards</p>
              <p className="text-xl font-bold text-blue-400">{summary.card_count}</p>
            </div>
          </div>

          {/* Card Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {cards.map(card => (
              <button
                key={card.id}
                onClick={() => loadTransactions(card.id)}
                className={`bg-slate-900 border rounded-xl p-5 text-left transition-colors ${
                  selectedCard === card.id ? 'border-blue-600' : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-white text-sm">{card.institution_name}</h3>
                    <p className="text-xs text-slate-400">{card.account_name} ****{card.last_four}</p>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                    {card.account_subtype || 'credit_card'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Available</p>
                    <p className={`text-sm font-semibold ${card.balance_available_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {cents(card.balance_available_cents || 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Ledger</p>
                    <p className="text-sm font-semibold text-white">{cents(card.balance_ledger_cents || 0)}</p>
                  </div>
                </div>
                <p className="text-[10px] text-slate-600 mt-2">Updated {timeAgo(card.balance_updated_at)}</p>
              </button>
            ))}
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
                  <h2 className="text-sm font-semibold text-white">
                    Transactions — {selectedCardData?.institution_name} {selectedCardData?.account_name} ****{selectedCardData?.last_four}
                  </h2>
                  <div className="flex gap-4 mt-1">
                    <span className="text-xs text-emerald-400">In: {cents(txnSummary.inflow_cents)}</span>
                    <span className="text-xs text-red-400">Out: {cents(Math.abs(txnSummary.outflow_cents))}</span>
                    <span className="text-xs text-slate-500">{txnSummary.total_count} transactions</span>
                  </div>
                </div>

                {txnLoading ? (
                  <div className="flex items-center justify-center h-24">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400" />
                  </div>
                ) : transactions.length === 0 ? (
                  <p className="px-5 py-8 text-xs text-slate-500 text-center">No transactions yet. Click Sync to pull latest.</p>
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
                        {transactions.map(txn => (
                          <tr key={txn.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                            <td className="px-5 py-3 text-slate-300 text-xs">{txn.date}</td>
                            <td className="px-5 py-3 text-white text-xs max-w-[200px] truncate">{txn.description}</td>
                            <td className="px-5 py-3 text-xs">
                              {editingTxn === txn.id ? (
                                <select
                                  defaultValue={txn.custom_category || ''}
                                  onChange={e => { updateTxnCategory(txn.id, e.target.value); setEditingTxn(null); }}
                                  onBlur={() => setEditingTxn(null)}
                                  autoFocus
                                  className="px-1 py-0.5 bg-slate-800 border border-slate-600 rounded text-[10px] text-white focus:outline-none focus:border-blue-500"
                                >
                                  <option value="">None</option>
                                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
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
    </div>
  );
}
