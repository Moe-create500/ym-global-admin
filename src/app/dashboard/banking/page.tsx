'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Script from 'next/script';
import StoreSelector from '@/components/StoreSelector';

interface BankAccount {
  id: string;
  store_id: string;
  teller_account_id: string;
  institution_name: string;
  account_name: string;
  account_type: string;
  account_subtype: string;
  last_four: string;
  currency: string;
  balance_available_cents: number;
  balance_ledger_cents: number;
  balance_updated_at: string | null;
  status: string;
}

interface Transaction {
  id: string;
  bank_account_id: string;
  date: string;
  description: string;
  category: string | null;
  custom_category: string | null;
  custom_note: string | null;
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

function BankingContent() {
  const searchParams = useSearchParams();
  const storeId = searchParams.get('storeId') || '';

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [summary, setSummary] = useState({ total_available_cents: 0, total_ledger_cents: 0, account_count: 0 });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [tellerReady, setTellerReady] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Transaction view
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txnLoading, setTxnLoading] = useState(false);
  const [txnSummary, setTxnSummary] = useState({ inflow_cents: 0, outflow_cents: 0, total_count: 0 });
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdown[]>([]);
  const [editingTxn, setEditingTxn] = useState<string | null>(null);
  const [txnFilter, setTxnFilter] = useState('');

  // Loans state
  interface Loan { id: string; lender: string | null; description: string | null; amount_cents: number; remaining_cents: number; total_paid_cents: number; interest_rate: number; loan_date: string; due_date: string | null; status: string; }
  interface LoanSummary { total_borrowed_cents: number; borrowed_remaining_cents: number; borrowed_paid_cents: number; borrowed_active: number; total_lent_cents: number; lent_remaining_cents: number; lent_paid_cents: number; lent_active: number; }
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loanSummary, setLoanSummary] = useState<LoanSummary | null>(null);
  const [loanShowForm, setLoanShowForm] = useState(false);
  const [loanForm, setLoanForm] = useState({ type: 'borrowed', lender: '', description: '', amount: '', loanDate: '', dueDate: '', interestRate: '' });
  const [loanTab, setLoanTab] = useState<'borrowed' | 'lent'>('borrowed');
  const [loanAdding, setLoanAdding] = useState(false);
  const [loanPayForm, setLoanPayForm] = useState({ loanId: '', paymentAmount: '', paymentDate: '', note: '' });
  const [loanPaying, setLoanPaying] = useState(false);
  const [payingLoanId, setPayingLoanId] = useState<string | null>(null);

  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => setStores(d.stores || []));
  }, []);

  useEffect(() => {
    loadAccounts();
    loadLoans();
  }, [storeId]);

  async function loadAccounts() {
    setLoading(true);
    const params = storeId ? `?storeId=${storeId}` : '';
    const res = await fetch(`/api/banking${params}`);
    const data = await res.json();
    setAccounts(data.accounts || []);
    setSummary(data.summary || { total_available_cents: 0, total_ledger_cents: 0, account_count: 0 });
    setLoading(false);
  }

  async function loadLoans() {
    if (!storeId) return;
    const res = await fetch(`/api/loans?storeId=${storeId}`);
    const data = await res.json();
    setLoans(data.loans || []);
    setLoanSummary(data.summary || null);
  }

  async function addLoan(e: React.FormEvent) {
    e.preventDefault();
    setLoanAdding(true);
    await fetch('/api/loans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, ...loanForm }),
    });
    setLoanForm({ type: loanTab, lender: '', description: '', amount: '', loanDate: '', dueDate: '', interestRate: '' });
    setLoanShowForm(false);
    setLoanAdding(false);
    loadLoans();
  }

  async function addLoanPayment(e: React.FormEvent) {
    e.preventDefault();
    setLoanPaying(true);
    await fetch('/api/loans', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loanPayForm),
    });
    setLoanPayForm({ loanId: '', paymentAmount: '', paymentDate: '', note: '' });
    setPayingLoanId(null);
    setLoanPaying(false);
    loadLoans();
  }

  async function deleteLoan(id: string) {
    if (!confirm('Delete this loan and all its payments?')) return;
    await fetch(`/api/loans?id=${id}`, { method: 'DELETE' });
    loadLoans();
  }

  async function loadTransactions(accountId: string) {
    setTxnLoading(true);
    setSelectedAccount(accountId);
    const res = await fetch(`/api/banking/transactions?accountId=${accountId}&limit=500`);
    const data = await res.json();
    setTransactions(data.transactions || []);
    setTxnSummary(data.summary || { inflow_cents: 0, outflow_cents: 0, total_count: 0 });
    setCategoryBreakdown(data.categoryBreakdown || []);
    setTxnLoading(false);
  }

  async function updateTxnCategory(txnId: string, category: string) {
    await fetch('/api/banking/transactions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: txnId, category }),
    });
    if (selectedAccount) loadTransactions(selectedAccount);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    const res = await fetch('/api/banking/sync', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      setSyncResult(`Synced ${data.accounts_synced} accounts, ${data.transactions_imported} new transactions`);
      loadAccounts();
      if (selectedAccount) loadTransactions(selectedAccount);
    } else {
      setSyncResult(data.error || 'Sync failed');
    }
    setSyncing(false);
  }

  async function handleDisconnect(accountId: string) {
    if (!confirm('Disconnect this bank account?')) return;
    await fetch(`/api/banking?accountId=${accountId}`, { method: 'DELETE' });
    setSelectedAccount(null);
    setTransactions([]);
    loadAccounts();
  }

  const handleTellerConnect = useCallback(() => {
    if (!storeId) { alert('Select a store first'); return; }
    const w = window as any;
    if (!w.TellerConnect) { alert('Teller Connect not loaded yet'); return; }

    setConnecting(true);
    const teller = w.TellerConnect.setup({
      applicationId: TELLER_APP_ID,
      environment: process.env.NEXT_PUBLIC_TELLER_ENV || 'sandbox',
      selectAccount: 'multiple',
      onSuccess: async (enrollment: any) => {
        console.log('[teller-connect] enrollment:', JSON.stringify(enrollment));
        const token = enrollment.accessToken || enrollment.access_token;
        const eid = enrollment.enrollment?.id || enrollment.id;
        if (!token) { alert('No access token received from Teller'); setConnecting(false); return; }
        try {
          const res = await fetch('/api/banking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              storeId,
              accessToken: token,
              enrollmentId: eid,
            }),
          });
          const data = await res.json();
          console.log('[teller-connect] API response:', JSON.stringify(data));
          if (data.error) { alert('Error: ' + data.error); }
          loadAccounts();
          // Auto-sync after connecting
          await fetch('/api/banking/sync', { method: 'POST' });
          loadAccounts();
        } catch (err: any) { alert('Failed: ' + err.message); }
        setConnecting(false);
      },
      onExit: () => { setConnecting(false); },
      onFailure: () => { setConnecting(false); },
    });
    teller.open();
  }, [storeId]);

  // Smart transaction filter
  function filterTransactions(txns: Transaction[], query: string): Transaction[] {
    const q = query.trim().toLowerCase();
    if (!q) return txns;

    // Parse multiple conditions separated by commas or "and"
    const conditions = q.split(/,|\band\b/).map(c => c.trim()).filter(Boolean);

    return txns.filter(txn => {
      const amt = Math.abs(txn.amount_cents) / 100;
      const rawAmt = txn.amount_cents / 100;
      const desc = (txn.description || '').toLowerCase();
      const party = (txn.counterparty || '').toLowerCase();
      const cat = (txn.custom_category || txn.category || '').toLowerCase();

      return conditions.every(cond => {
        // "inflow" / "deposits" / "credits"
        if (/^(inflow|deposits?|credits?|positive|incoming)$/.test(cond)) return txn.amount_cents > 0;
        // "outflow" / "withdrawals" / "debits"
        if (/^(outflow|withdrawals?|debits?|negative|outgoing|expenses?)$/.test(cond)) return txn.amount_cents < 0;
        // "pending" / "posted"
        if (cond === 'pending') return txn.status === 'pending';
        if (cond === 'posted') return txn.status === 'posted';

        // Amount comparisons: ">5000", ">=5000", "<1000", "<=1000", "=10000"
        let m = cond.match(/^(>|>=|<|<=|=)\s*\$?([\d,.]+)$/);
        if (m) {
          const val = parseFloat(m[2].replace(/,/g, ''));
          if (m[1] === '>') return amt > val;
          if (m[1] === '>=') return amt >= val;
          if (m[1] === '<') return amt < val;
          if (m[1] === '<=') return amt <= val;
          if (m[1] === '=') return Math.abs(amt - val) < 0.01;
        }

        // "above/over/more than X", "below/under/less than X"
        m = cond.match(/^(?:above|over|more than|greater than|bigger than)\s+\$?([\d,.]+)$/);
        if (m) return amt > parseFloat(m[1].replace(/,/g, ''));
        m = cond.match(/^(?:below|under|less than|smaller than)\s+\$?([\d,.]+)$/);
        if (m) return amt < parseFloat(m[1].replace(/,/g, ''));

        // "between X and Y"
        m = cond.match(/^between\s+\$?([\d,.]+)\s+(?:and|-)\s+\$?([\d,.]+)$/);
        if (m) {
          const lo = parseFloat(m[1].replace(/,/g, ''));
          const hi = parseFloat(m[2].replace(/,/g, ''));
          return amt >= Math.min(lo, hi) && amt <= Math.max(lo, hi);
        }

        // "exactly X" or just a number like "10000"
        m = cond.match(/^(?:exactly\s+)?\$?([\d,.]+)$/);
        if (m) {
          const val = parseFloat(m[1].replace(/,/g, ''));
          // Allow 1% tolerance for rounding
          const tolerance = Math.max(val * 0.01, 0.01);
          return Math.abs(amt - val) <= tolerance;
        }

        // Date filter: "2026-04" or "april" etc
        m = cond.match(/^(\d{4}-\d{2}(?:-\d{2})?)$/);
        if (m) return txn.date.startsWith(m[1]);

        // Text search: match description, counterparty, or category
        return desc.includes(cond) || party.includes(cond) || cat.includes(cond);
      });
    });
  }

  const filteredTransactions = filterTransactions(transactions, txnFilter);

  const selectedStore = stores.find(s => s.id === storeId);
  const selectedAccountData = accounts.find(a => a.id === selectedAccount);

  return (
    <div>
      <Script
        src="https://cdn.teller.io/connect/connect.js"
        onLoad={() => setTellerReady(true)}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Bank Accounts</h1>
            <p className="text-sm text-slate-400 mt-1">
              {selectedStore ? selectedStore.name : 'All stores'} — Connected via Teller
            </p>
          </div>
          <StoreSelector />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSync}
            disabled={syncing || accounts.length === 0}
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
            disabled={!tellerReady || !storeId || connecting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            {connecting ? 'Connecting...' : 'Connect Bank'}
          </button>
        </div>
      </div>

      {syncResult && (
        <div className="mb-4 px-4 py-3 bg-blue-900/30 border border-blue-800 rounded-lg text-sm text-blue-300">
          {syncResult}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
          <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-white mb-2">No bank accounts connected</h3>
          <p className="text-xs text-slate-400 mb-4">
            {storeId
              ? 'Click "Connect Bank" to link your bank account via Teller.'
              : 'Select a store first, then connect a bank account.'}
          </p>
        </div>
      ) : (
        <>
          {/* Total Balance KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Total Available</p>
              <p className="text-xl font-bold text-emerald-400">{cents(summary.total_available_cents)}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Total Ledger</p>
              <p className="text-xl font-bold text-white">{cents(summary.total_ledger_cents)}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Accounts</p>
              <p className="text-xl font-bold text-blue-400">{summary.account_count}</p>
            </div>
          </div>

          {/* Account Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {accounts.map(account => (
              <button
                key={account.id}
                onClick={() => loadTransactions(account.id)}
                className={`bg-slate-900 border rounded-xl p-5 text-left transition-colors ${
                  selectedAccount === account.id ? 'border-blue-600' : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-white text-sm">{account.institution_name}</h3>
                    <p className="text-xs text-slate-400">{account.account_name} {account.last_four ? `****${account.last_four}` : ''}</p>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                    {account.account_subtype || account.account_type}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Available</p>
                    <p className="text-sm font-semibold text-emerald-400">{cents(account.balance_available_cents || 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Ledger</p>
                    <p className="text-sm font-semibold text-white">{cents(account.balance_ledger_cents || 0)}</p>
                  </div>
                </div>
                <p className="text-[10px] text-slate-600 mt-2">Updated {timeAgo(account.balance_updated_at)}</p>
              </button>
            ))}
          </div>

          {/* Transactions */}
          {selectedAccount && (
            <>
            {/* Category Breakdown */}
            {categoryBreakdown.length > 0 && categoryBreakdown.some(c => c.category !== 'Uncategorized') && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-4">
                <h3 className="text-sm font-semibold text-white mb-3">Cash Flow by Category</h3>
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
              <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Transactions — {selectedAccountData?.institution_name} {selectedAccountData?.last_four ? `****${selectedAccountData.last_four}` : ''}
                  </h2>
                  <div className="flex gap-4 mt-1">
                    <span className="text-xs text-emerald-400">In: {cents(txnSummary.inflow_cents)}</span>
                    <span className="text-xs text-red-400">Out: {cents(Math.abs(txnSummary.outflow_cents))}</span>
                    <span className="text-xs text-slate-500">{txnSummary.total_count} transactions</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDisconnect(selectedAccount)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Disconnect
                </button>
              </div>

              {/* Smart Filter */}
              <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/30">
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      value={txnFilter}
                      onChange={(e) => setTxnFilter(e.target.value)}
                      placeholder='Filter: "10000", ">5000", "shopify", "outflow", "between 1000 and 5000"'
                      className="w-full pl-9 pr-8 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                    />
                    {txnFilter && (
                      <button onClick={() => setTxnFilter('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {txnFilter && (
                    <span className="text-xs text-slate-400 whitespace-nowrap">
                      {filteredTransactions.length} of {transactions.length}
                    </span>
                  )}
                </div>
                {/* Quick filter chips */}
                <div className="flex gap-2 mt-2 flex-wrap">
                  {['>1000', '>5000', '>10000', 'outflow', 'inflow', 'pending'].map(chip => (
                    <button
                      key={chip}
                      onClick={() => setTxnFilter(txnFilter === chip ? '' : chip)}
                      className={`text-[10px] px-2.5 py-1 rounded-full transition-colors ${
                        txnFilter === chip
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-800 text-slate-500 hover:text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              {txnLoading ? (
                <div className="flex items-center justify-center h-24">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400" />
                </div>
              ) : transactions.length === 0 ? (
                <p className="px-5 py-8 text-xs text-slate-500 text-center">No transactions yet. Click Sync to pull latest.</p>
              ) : filteredTransactions.length === 0 ? (
                <p className="px-5 py-8 text-xs text-slate-500 text-center">No transactions match "{txnFilter}"</p>
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

      {/* Loans Section */}
      {storeId && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-bold text-white">Loans</h2>
              <div className="flex bg-slate-800 rounded-lg p-0.5">
                {(['borrowed', 'lent'] as const).map((t) => (
                  <button key={t} onClick={() => setLoanTab(t)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      loanTab === t ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}>
                    {t === 'borrowed' ? 'Borrowed' : 'Lent Out'}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => { setLoanShowForm(!loanShowForm); setLoanForm({ ...loanForm, type: loanTab }); }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
              {loanShowForm ? 'Cancel' : loanTab === 'borrowed' ? '+ Add Borrowed' : '+ Add Lent'}
            </button>
          </div>

          {/* Loan KPIs */}
          {loanSummary && (loanSummary.total_borrowed_cents > 0 || loanSummary.total_lent_cents > 0) && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              {loanTab === 'borrowed' ? (
                <>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <p className="text-xs text-slate-500 uppercase mb-1">Total Borrowed</p>
                    <p className="text-xl font-bold text-white">{cents(loanSummary.total_borrowed_cents)}</p>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <p className="text-xs text-slate-500 uppercase mb-1">Repaid</p>
                    <p className="text-xl font-bold text-emerald-400">{cents(loanSummary.borrowed_paid_cents)}</p>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <p className="text-xs text-slate-500 uppercase mb-1">Owed</p>
                    <p className="text-xl font-bold text-red-400">{cents(loanSummary.borrowed_remaining_cents)}</p>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <p className="text-xs text-slate-500 uppercase mb-1">Active</p>
                    <p className="text-xl font-bold text-blue-400">{loanSummary.borrowed_active}</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <p className="text-xs text-slate-500 uppercase mb-1">Total Lent</p>
                    <p className="text-xl font-bold text-white">{cents(loanSummary.total_lent_cents)}</p>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <p className="text-xs text-slate-500 uppercase mb-1">Collected</p>
                    <p className="text-xl font-bold text-emerald-400">{cents(loanSummary.lent_paid_cents)}</p>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <p className="text-xs text-slate-500 uppercase mb-1">Outstanding</p>
                    <p className="text-xl font-bold text-orange-400">{cents(loanSummary.lent_remaining_cents)}</p>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <p className="text-xs text-slate-500 uppercase mb-1">Active</p>
                    <p className="text-xl font-bold text-blue-400">{loanSummary.lent_active}</p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Add Loan Form */}
          {loanShowForm && (
            <form onSubmit={addLoan} className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
              <h3 className="text-sm font-semibold text-white mb-4">
                {loanForm.type === 'lent' ? 'Record Money Lent Out' : 'Record Money Borrowed'}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">{loanForm.type === 'lent' ? 'Borrower' : 'Lender'}</label>
                  <input type="text" value={loanForm.lender} onChange={e => setLoanForm({ ...loanForm, lender: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                    placeholder="e.g. BofA, Personal" />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Description</label>
                  <input type="text" value={loanForm.description} onChange={e => setLoanForm({ ...loanForm, description: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                    placeholder="Business line of credit" />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Amount ($) *</label>
                  <input type="number" step="0.01" required value={loanForm.amount} onChange={e => setLoanForm({ ...loanForm, amount: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                    placeholder="10000" />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Loan Date *</label>
                  <input type="date" required value={loanForm.loanDate} onChange={e => setLoanForm({ ...loanForm, loanDate: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Due Date</label>
                  <input type="date" value={loanForm.dueDate} onChange={e => setLoanForm({ ...loanForm, dueDate: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div className="flex items-end">
                  <button type="submit" disabled={loanAdding}
                    className="w-full px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                    {loanAdding ? 'Adding...' : 'Add Loan'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Loans List */}
          {loans.filter(l => loanTab === 'lent' ? (l as any).type === 'lent' : (l as any).type !== 'lent').length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                      <th className="text-left px-5 py-3">{loanTab === 'lent' ? 'Borrower' : 'Lender'}</th>
                      <th className="text-left px-5 py-3">Description</th>
                      <th className="text-left px-5 py-3">Date</th>
                      <th className="text-right px-5 py-3">Amount</th>
                      <th className="text-right px-5 py-3">Repaid</th>
                      <th className="text-right px-5 py-3">Remaining</th>
                      <th className="text-center px-5 py-3">Status</th>
                      <th className="px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loans.filter(l => loanTab === 'lent' ? (l as any).type === 'lent' : (l as any).type !== 'lent').map(loan => (
                      <>
                        <tr key={loan.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="px-5 py-3 text-white font-medium">{loan.lender || '—'}</td>
                          <td className="px-5 py-3 text-slate-400 text-xs">{loan.description || '—'}</td>
                          <td className="px-5 py-3 text-slate-300 text-xs">{loan.loan_date}{loan.due_date ? ` → ${loan.due_date}` : ''}</td>
                          <td className="px-5 py-3 text-right text-white font-medium">{cents(loan.amount_cents)}</td>
                          <td className="px-5 py-3 text-right text-emerald-400">{cents(loan.total_paid_cents || 0)}</td>
                          <td className="px-5 py-3 text-right text-orange-400 font-medium">{cents(loan.remaining_cents)}</td>
                          <td className="px-5 py-3 text-center">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                              loan.status === 'paid_off' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-orange-900/30 text-orange-400'
                            }`}>{loan.status === 'paid_off' ? 'Paid Off' : 'Active'}</span>
                          </td>
                          <td className="px-5 py-3 text-right">
                            {loan.status === 'active' && (
                              <button onClick={() => { setPayingLoanId(payingLoanId === loan.id ? null : loan.id); setLoanPayForm({ loanId: loan.id, paymentAmount: '', paymentDate: '', note: '' }); }}
                                className="text-xs text-blue-400 hover:text-blue-300 mr-2">{loanTab === 'lent' ? 'Collect' : 'Pay'}</button>
                            )}
                            <button onClick={() => deleteLoan(loan.id)} className="text-xs text-red-400 hover:text-red-300">Del</button>
                          </td>
                        </tr>
                        {payingLoanId === loan.id && (
                          <tr key={`${loan.id}-pay`} className="bg-slate-800/50">
                            <td colSpan={8} className="px-5 py-3">
                              <form onSubmit={addLoanPayment} className="flex items-center gap-3">
                                <input type="number" step="0.01" required placeholder="Amount" value={loanPayForm.paymentAmount}
                                  onChange={e => setLoanPayForm({ ...loanPayForm, paymentAmount: e.target.value })}
                                  className="w-32 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none" />
                                <input type="date" required value={loanPayForm.paymentDate}
                                  onChange={e => setLoanPayForm({ ...loanPayForm, paymentDate: e.target.value })}
                                  className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none" />
                                <input type="text" placeholder="Note (optional)" value={loanPayForm.note}
                                  onChange={e => setLoanPayForm({ ...loanPayForm, note: e.target.value })}
                                  className="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none" />
                                <button type="submit" disabled={loanPaying}
                                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium rounded">
                                  {loanPaying ? '...' : 'Record Payment'}
                                </button>
                                <button type="button" onClick={() => setPayingLoanId(null)} className="text-xs text-slate-500 hover:text-white">Cancel</button>
                              </form>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {loans.filter(l => loanTab === 'lent' ? (l as any).type === 'lent' : (l as any).type !== 'lent').length === 0 && !loanShowForm && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-slate-400 text-sm">No {loanTab === 'lent' ? 'loans given' : 'loans borrowed'}</p>
              <p className="text-xs text-slate-500 mt-1">Click "+ Add {loanTab === 'lent' ? 'Lent' : 'Borrowed'}" to start tracking</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BankAccountsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    }>
      <BankingContent />
    </Suspense>
  );
}
