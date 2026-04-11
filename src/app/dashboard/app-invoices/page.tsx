'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import StoreSelector from '@/components/StoreSelector';

interface Store { id: string; name: string; }

interface InvoiceItem {
  id: string;
  category: string;
  description: string;
  app_name: string;
  amount_cents: number;
  billing_start: string;
  billing_end: string;
}

interface Invoice {
  id: string;
  bill_number: string;
  date: string;
  total_cents: number;
  item_count: number;
  currency: string;
  source: string;
  payment_method: string | null;
  card_last4: string | null;
  paid: number;
  paid_date: string | null;
  notes: string | null;
  items: InvoiceItem[];
}

interface AppSummary {
  app_name: string;
  count: number;
  total_cents: number;
}

interface SourceSummary {
  source: string;
  count: number;
  total_cents: number;
}

interface MonthlyTotal {
  month: string;
  invoice_count: number;
  total_cents: number;
}

interface Totals {
  total_cents: number;
  invoice_count: number;
  paid_cents: number;
  unpaid_cents: number;
  cf_shopify_cents: number;
  cf_shopify_count: number;
}

interface CardBalance {
  card: string;
  charged_cents: number;
  paid_cents: number;
  balance_cents: number;
  invoice_count: number;
  payment_count: number;
}

interface CardPaymentLog {
  id: string;
  card_last4: string;
  date: string;
  amount_cents: number;
  method: string | null;
  notes: string | null;
}

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function todayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function AppInvoicesContent() {
  const searchParams = useSearchParams();
  const storeFilter = searchParams.get('storeId') || '';

  const [stores, setStores] = useState<Store[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [appSummary, setAppSummary] = useState<AppSummary[]>([]);
  const [sourceSummary, setSourceSummary] = useState<SourceSummary[]>([]);
  const [monthlyTotals, setMonthlyTotals] = useState<MonthlyTotal[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null);
  const [editingPayment, setEditingPayment] = useState<string | null>(null);
  const [cardFilter, setCardFilter] = useState('');

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importStoreId, setImportStoreId] = useState('');
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Payment edit state
  const [payMethod, setPayMethod] = useState('');
  const [payCard, setPayCard] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [savedMethods, setSavedMethods] = useState<{ id: string; label: string; type: string; card_last4: string | null }[]>([]);

  // Card balances state
  const [cards, setCards] = useState<CardBalance[]>([]);
  const [cardLog, setCardLog] = useState<CardPaymentLog[]>([]);

  // Add card payment panel
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [newPayCard, setNewPayCard] = useState('');
  const [newPayDate, setNewPayDate] = useState(todayStr());
  const [newPayAmount, setNewPayAmount] = useState('');
  const [newPayMethod, setNewPayMethod] = useState('');
  const [newPayNotes, setNewPayNotes] = useState('');
  const [addingPayment, setAddingPayment] = useState(false);

  // Bulk select state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMethod, setBulkMethod] = useState('');
  const [bulkCard, setBulkCard] = useState('');
  const [bulkApplying, setBulkApplying] = useState(false);

  // Filter
  const [sourceFilter, setSourceFilter] = useState('');
  const [paidFilter, setPaidFilter] = useState('');

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => setStores(d.stores || []));
  }, []);

  useEffect(() => {
    if (storeFilter) {
      setImportStoreId(storeFilter);
      loadData();
      loadCards();
      fetch(`/api/saved-payment-methods?storeId=${storeFilter}`).then(r => r.json()).then(d => setSavedMethods(d.methods || []));
    } else {
      setInvoices([]);
      setAppSummary([]);
      setSourceSummary([]);
      setMonthlyTotals([]);
      setTotals(null);
      setCards([]);
      setCardLog([]);
      setLoading(false);
    }
  }, [storeFilter]);

  async function loadData() {
    if (!storeFilter) return;
    setLoading(true);
    const res = await fetch(`/api/shopify-invoices?storeId=${storeFilter}`);
    const data = await res.json();
    setInvoices(data.invoices || []);
    setAppSummary(data.appSummary || []);
    setSourceSummary(data.sourceSummary || []);
    setMonthlyTotals(data.monthlyTotals || []);
    setTotals(data.totals || null);
    setLoading(false);
  }

  async function loadCards() {
    if (!storeFilter) return;
    const res = await fetch(`/api/card-payments?storeId=${storeFilter}`);
    const data = await res.json();
    setCards(data.cards || []);
    setCardLog(data.log || []);
  }

  async function handleAddCardPayment() {
    if (!newPayCard || !newPayDate || !newPayAmount) return;
    setAddingPayment(true);
    await fetch('/api/card-payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: storeFilter,
        card: newPayCard,
        date: newPayDate,
        amountCents: Math.round(parseFloat(newPayAmount) * 100),
        method: newPayMethod || null,
        notes: newPayNotes || null,
      }),
    });
    setAddingPayment(false);
    setNewPayAmount('');
    setNewPayNotes('');
    setShowAddPayment(false);
    loadCards();
  }

  async function handleDeleteCardPayment(id: string) {
    if (!confirm('Delete this payment?')) return;
    await fetch(`/api/card-payments?id=${id}`, { method: 'DELETE' });
    loadCards();
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(ev.target?.result as string);
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!importStoreId || !csvText) return;
    setImporting(true);
    setImportResult(null);
    const res = await fetch('/api/shopify-invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: importStoreId, csvText }),
    });
    setImportResult(await res.json());
    setImporting(false);
    setCsvText('');
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
    loadData();
    loadCards();
  }

  async function handleUpdatePayment(invoiceId: string, paid: boolean) {
    await fetch('/api/shopify-invoices', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: invoiceId,
        paymentMethod: payMethod || null,
        cardLast4: payCard || null,
        paid,
        paidDate: paid ? new Date().toISOString().split('T')[0] : null,
        notes: payNotes || null,
      }),
    });
    if (payMethod && storeFilter && !savedMethods.some(m => m.label === payMethod)) {
      await fetch('/api/saved-payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: storeFilter, label: payMethod, type: payMethod, cardLast4: payCard || null }),
      });
      const res = await fetch(`/api/saved-payment-methods?storeId=${storeFilter}`);
      const data = await res.json();
      setSavedMethods(data.methods || []);
    }
    setEditingPayment(null);
    setPayMethod('');
    setPayCard('');
    setPayNotes('');
    loadData();
    loadCards();
  }

  async function handleDelete(invoiceId: string) {
    if (!confirm('Delete this invoice?')) return;
    await fetch(`/api/shopify-invoices?id=${invoiceId}`, { method: 'DELETE' });
    loadData();
    loadCards();
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(inv => inv.id)));
    }
  }

  async function handleBulkUpdate(markPaid: boolean) {
    if (selected.size === 0) return;
    setBulkApplying(true);
    await fetch('/api/shopify-invoices', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: Array.from(selected),
        paymentMethod: bulkMethod || null,
        cardLast4: bulkCard || null,
        paid: markPaid,
        paidDate: markPaid ? new Date().toISOString().split('T')[0] : null,
      }),
    });
    setBulkApplying(false);
    setSelected(new Set());
    setBulkMethod('');
    setBulkCard('');
    loadData();
    loadCards();
  }

  // Compute totals
  const totalCharged = totals ? (totals.total_cents || 0) - (totals.cf_shopify_cents || 0) : 0;
  const totalPaid = cards.reduce((s, c) => s + c.paid_cents, 0);
  const totalBalance = cards.reduce((s, c) => s + c.balance_cents, 0);
  const allCards = cards.map(c => c.card);

  // Filtered invoices
  const filtered = invoices.filter(inv => {
    if (sourceFilter && inv.source !== sourceFilter) return false;
    if (paidFilter === 'paid' && !inv.paid) return false;
    if (paidFilter === 'unpaid' && inv.paid) return false;
    if (cardFilter && inv.payment_method !== cardFilter) return false;
    return true;
  });

  const selectedStore = stores.find(s => s.id === storeFilter);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">App Invoices</h1>
            <p className="text-sm text-slate-400 mt-1">
              {selectedStore ? selectedStore.name : 'Select a store'} — Shopify & Chargeflow invoices
            </p>
          </div>
          <StoreSelector />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowAddPayment(!showAddPayment); setShowImport(false); }}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Card Payment
          </button>
          <button
            onClick={() => { setShowImport(!showImport); setShowAddPayment(false); }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Import CSV
          </button>
        </div>
      </div>

      {/* Add Card Payment Panel */}
      {showAddPayment && (
        <div className="bg-slate-900 border border-emerald-900/50 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-white mb-4">Record Card Payment</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Card</label>
              <select
                value={newPayCard}
                onChange={(e) => setNewPayCard(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">Select card...</option>
                {allCards.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Date</label>
              <input
                type="date"
                value={newPayDate}
                onChange={(e) => setNewPayDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Amount ($)</label>
              <input
                type="number"
                step="0.01"
                placeholder="500.00"
                value={newPayAmount}
                onChange={(e) => setNewPayAmount(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Method</label>
              <select
                value={newPayMethod}
                onChange={(e) => setNewPayMethod(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">Select...</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="ach">ACH</option>
                <option value="check">Check</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Notes</label>
              <input
                type="text"
                placeholder="Optional"
                value={newPayNotes}
                onChange={(e) => setNewPayNotes(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
          <button
            onClick={handleAddCardPayment}
            disabled={!newPayCard || !newPayAmount || addingPayment}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
          >
            {addingPayment ? 'Saving...' : 'Record Payment'}
          </button>
        </div>
      )}

      {/* Import Panel */}
      {showImport && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-white mb-3">Import Shopify Charges or Chargeflow Invoices</h2>
          <p className="text-xs text-slate-500 mb-4">Auto-detects CSV format (Shopify charges_export or Chargeflow invoices)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Store</label>
              <select value={importStoreId} onChange={(e) => setImportStoreId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="">Select store...</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">CSV File</label>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFile}
                className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-slate-700 file:text-slate-300 file:cursor-pointer" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleImport} disabled={!importStoreId || !csvText || importing}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {importing ? 'Importing...' : 'Import'}
            </button>
            {fileName && <span className="text-xs text-slate-400">{fileName}</span>}
            {importResult && (
              <span className={`text-xs ${importResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                {importResult.success
                  ? `${importResult.imported} imported, ${importResult.updated || 0} updated (${importResult.format}), ${importResult.duplicates} unchanged`
                  : importResult.error || 'Failed'}
              </span>
            )}
          </div>
        </div>
      )}

      {!storeFilter ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
          <p className="text-slate-400">Select a store to view app invoices</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" /></div>
      ) : invoices.length === 0 && cardLog.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
          <p className="text-slate-400 mb-3">No invoices imported for {selectedStore?.name}</p>
          <button onClick={() => setShowImport(true)} className="text-sm text-blue-400 hover:text-blue-300">Import your first CSV</button>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase mb-1">Total Charged</p>
              <p className="text-xl font-bold text-white">{cents(totalCharged)}</p>
              <p className="text-[10px] text-slate-500">{totals ? totals.invoice_count - (totals.cf_shopify_count || 0) : 0} invoices</p>
            </div>
            <div className="bg-slate-900 border border-emerald-900/50 rounded-xl p-4">
              <p className="text-xs text-emerald-500 uppercase mb-1">Total Paid</p>
              <p className="text-xl font-bold text-emerald-400">{cents(totalPaid)}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase mb-1">Balance Due</p>
              <p className={`text-xl font-bold ${totalBalance > 0 ? 'text-orange-400' : 'text-emerald-400'}`}>{cents(totalBalance)}</p>
            </div>
            <div className="bg-slate-900 border border-purple-900/50 rounded-xl p-4">
              <p className="text-xs text-purple-500 uppercase mb-1">CF via Shopify</p>
              <p className="text-xl font-bold text-purple-400">{cents(totals?.cf_shopify_cents || 0)}</p>
              <p className="text-[10px] text-slate-500">{totals?.cf_shopify_count || 0} in Shopify bills</p>
            </div>
            {sourceSummary.map(s => (
              <div key={s.source} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-500 uppercase mb-1">{s.source === 'shopify' ? 'Shopify' : 'Chargeflow'}</p>
                <p className="text-lg font-bold text-white">{cents(s.total_cents)}</p>
                <p className="text-[10px] text-slate-500">{s.count} invoices</p>
              </div>
            ))}
          </div>

          {/* Card Balances */}
          {cards.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
              <h2 className="text-sm font-semibold text-white mb-4">Card Balances</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {cards.map(card => (
                  <button
                    key={card.card}
                    onClick={() => setCardFilter(cardFilter === card.card ? '' : card.card)}
                    className={`p-4 rounded-lg border text-left transition-colors ${
                      cardFilter === card.card ? 'bg-blue-950/30 border-blue-700' : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold text-white">{card.card}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        card.balance_cents <= 0 ? 'bg-emerald-900/30 text-emerald-400' : 'bg-orange-900/30 text-orange-400'
                      }`}>
                        {card.balance_cents <= 0 ? 'Paid' : 'Due'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-[10px] text-slate-500">Charged</p>
                        <p className="text-xs font-semibold text-white">{cents(card.charged_cents)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500">Paid</p>
                        <p className="text-xs font-semibold text-emerald-400">{cents(card.paid_cents)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500">Balance</p>
                        <p className={`text-xs font-semibold ${card.balance_cents > 0 ? 'text-orange-400' : 'text-emerald-400'}`}>{cents(card.balance_cents)}</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-600 mt-2">{card.invoice_count} invoices · {card.payment_count} payments</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Card Payments Log */}
          {cardLog.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-6">
              <div className="px-5 py-4 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-white">Card Payments Made</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                      <th className="text-left px-5 py-3">Date</th>
                      <th className="text-left px-5 py-3">Card</th>
                      <th className="text-right px-5 py-3">Amount</th>
                      <th className="text-left px-5 py-3">Method</th>
                      <th className="text-left px-5 py-3">Notes</th>
                      <th className="px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cardLog.map(cp => (
                      <tr key={cp.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                        <td className="px-5 py-3 text-slate-300">{cp.date}</td>
                        <td className="px-5 py-3 text-white text-xs">{cp.card_last4}</td>
                        <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(cp.amount_cents)}</td>
                        <td className="px-5 py-3 text-slate-400 text-xs">{cp.method || '—'}</td>
                        <td className="px-5 py-3 text-slate-500 text-xs whitespace-pre-wrap">{cp.notes || '—'}</td>
                        <td className="px-5 py-3">
                          <button onClick={() => handleDeleteCardPayment(cp.id)} className="text-xs text-red-400 hover:text-red-300">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Monthly Charges */}
          {monthlyTotals.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
              <h2 className="text-sm font-semibold text-white mb-4">Monthly Charges</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {monthlyTotals.map(m => (
                  <div key={m.month} className="px-3 py-2 bg-slate-800/50 rounded-lg">
                    <p className="text-xs text-slate-400">{m.month}</p>
                    <p className="text-sm font-semibold text-white">{cents(m.total_cents)}</p>
                    <p className="text-[10px] text-slate-500">{m.invoice_count} invoices</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* App Breakdown */}
          {appSummary.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
              <h2 className="text-sm font-semibold text-white mb-3">Spend by App</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {appSummary.filter(a => a.total_cents > 0).map(app => (
                  <div key={app.app_name} className="px-3 py-2 bg-slate-800/50 rounded-lg">
                    <p className="text-xs text-slate-400 truncate">{app.app_name || 'Unknown'}</p>
                    <p className="text-sm font-semibold text-white">{cents(app.total_cents)}</p>
                    <p className="text-[10px] text-slate-500">{app.count} charges</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex gap-1">
              {['', 'shopify', 'chargeflow'].map(s => (
                <button key={s} onClick={() => setSourceFilter(s)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${sourceFilter === s
                    ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                  {s === '' ? 'All' : s === 'shopify' ? 'Shopify' : 'Chargeflow'}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {['', 'paid', 'unpaid'].map(s => (
                <button key={s} onClick={() => setPaidFilter(s)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${paidFilter === s
                    ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                  {s === '' ? 'All Status' : s === 'paid' ? 'Paid' : 'Unpaid'}
                </button>
              ))}
            </div>
            {cardFilter && (
              <button onClick={() => setCardFilter('')} className="text-xs text-blue-400 hover:text-white flex items-center gap-1">
                {cardFilter} <span className="text-slate-500">x</span>
              </button>
            )}
            <span className="text-xs text-slate-500">{filtered.length} invoices</span>
          </div>

          {/* Bulk Action Bar */}
          {selected.size > 0 && (
            <div className="flex items-center gap-3 mb-4 px-4 py-3 bg-blue-950/30 border border-blue-800 rounded-xl">
              <span className="text-sm text-blue-300 font-medium">{selected.size} selected</span>
              <span className="text-slate-600">|</span>
              <select value={bulkMethod} onChange={(e) => {
                setBulkMethod(e.target.value);
                const saved = savedMethods.find(m => m.label === e.target.value);
                if (saved?.card_last4) setBulkCard(saved.card_last4);
              }}
                className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none">
                <option value="">Payment method...</option>
                {savedMethods.map(m => (
                  <option key={m.id} value={m.label}>{m.label}{m.card_last4 ? ` - ${m.card_last4}` : ''}</option>
                ))}
                <option disabled>──────────</option>
                <option value="Visa">Visa</option>
                <option value="Amex">Amex</option>
                <option value="Mastercard">Mastercard</option>
                <option value="Discover">Discover</option>
                <option value="Shopify Billing">Shopify Billing</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Other">Other</option>
              </select>
              <input type="text" placeholder="Last 4" value={bulkCard} onChange={(e) => setBulkCard(e.target.value)}
                className="w-20 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none" />
              <button onClick={() => handleBulkUpdate(true)} disabled={bulkApplying}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium rounded">
                {bulkApplying ? 'Applying...' : 'Mark Paid'}
              </button>
              <button onClick={() => handleBulkUpdate(false)} disabled={bulkApplying}
                className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-xs font-medium rounded">
                Mark Unpaid
              </button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-slate-500 hover:text-white ml-auto">
                Clear
              </button>
            </div>
          )}

          {/* Invoices Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="px-3 py-3 w-8">
                      <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-0 focus:ring-offset-0 cursor-pointer" />
                    </th>
                    <th className="text-left px-5 py-3">Invoice #</th>
                    <th className="text-left px-5 py-3">Date</th>
                    <th className="text-left px-5 py-3">Source</th>
                    <th className="text-right px-5 py-3">Amount</th>
                    <th className="text-left px-5 py-3">Items</th>
                    <th className="text-left px-5 py-3">Payment</th>
                    <th className="text-center px-5 py-3">Status</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(inv => (
                    <>
                      <tr key={inv.id} className={`border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer ${selected.has(inv.id) ? 'bg-blue-950/20' : ''}`}
                        onClick={() => setExpandedInvoice(expandedInvoice === inv.id ? null : inv.id)}>
                        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(inv.id)}
                            onChange={() => toggleSelect(inv.id)}
                            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-0 focus:ring-offset-0 cursor-pointer" />
                        </td>
                        <td className="px-5 py-3 text-slate-300 font-mono text-xs">{inv.bill_number}</td>
                        <td className="px-5 py-3 text-slate-300">{inv.date}</td>
                        <td className="px-5 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            inv.source === 'chargeflow' ? 'bg-violet-900/30 text-violet-400' : 'bg-emerald-900/30 text-emerald-400'
                          }`}>{inv.source}</span>
                        </td>
                        <td className="px-5 py-3 text-right text-white font-medium">{cents(inv.total_cents)}</td>
                        <td className="px-5 py-3 text-slate-400 text-xs">
                          {inv.items.slice(0, 2).map(it => it.app_name || it.description).join(', ')}
                          {inv.items.length > 2 && ` +${inv.items.length - 2}`}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-400">
                          {inv.payment_method
                            ? inv.card_last4
                              ? `${inv.payment_method} - ${inv.card_last4}`
                              : inv.payment_method
                            : '—'}
                        </td>
                        <td className="px-5 py-3 text-center">
                          {inv.source === 'chargeflow' && inv.payment_method?.toLowerCase().includes('shopify') ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400">In Shopify Bill</span>
                          ) : (
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              inv.paid ? 'bg-emerald-900/30 text-emerald-400' : 'bg-orange-900/30 text-orange-400'
                            }`}>{inv.paid ? 'Paid' : 'Unpaid'}</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={(e) => { e.stopPropagation(); setEditingPayment(editingPayment === inv.id ? null : inv.id); setPayMethod(inv.payment_method || ''); setPayCard(inv.card_last4 || ''); setPayNotes(inv.notes || ''); }}
                            className="text-xs text-blue-400 hover:text-blue-300 mr-2">Edit</button>
                          <button onClick={(e) => { e.stopPropagation(); handleDelete(inv.id); }}
                            className="text-xs text-red-400 hover:text-red-300">Del</button>
                        </td>
                      </tr>
                      {/* Payment edit row */}
                      {editingPayment === inv.id && (
                        <tr key={`${inv.id}-edit`} className="bg-slate-800/50">
                          <td colSpan={9} className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <select value={payMethod} onChange={(e) => {
                                setPayMethod(e.target.value);
                                const saved = savedMethods.find(m => m.label === e.target.value);
                                if (saved?.card_last4) setPayCard(saved.card_last4);
                              }}
                                className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none">
                                <option value="">Payment method...</option>
                                {savedMethods.map(m => (
                                  <option key={m.id} value={m.label}>{m.label}{m.card_last4 ? ` - ${m.card_last4}` : ''}</option>
                                ))}
                                <option disabled>──────────</option>
                                <option value="Visa">Visa</option>
                                <option value="Amex">Amex</option>
                                <option value="Mastercard">Mastercard</option>
                                <option value="Discover">Discover</option>
                                <option value="Shopify Billing">Shopify Billing</option>
                                <option value="Bank Transfer">Bank Transfer</option>
                                <option value="Other">Other</option>
                              </select>
                              <input type="text" placeholder="Card last 4" value={payCard} onChange={(e) => setPayCard(e.target.value)}
                                className="w-20 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none" />
                              <input type="text" placeholder="Notes" value={payNotes} onChange={(e) => setPayNotes(e.target.value)}
                                className="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none" />
                              <button onClick={() => handleUpdatePayment(inv.id, true)}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded">
                                Mark Paid
                              </button>
                              {inv.paid ? (
                                <button onClick={() => handleUpdatePayment(inv.id, false)}
                                  className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs rounded">
                                  Mark Unpaid
                                </button>
                              ) : null}
                              <button onClick={() => setEditingPayment(null)}
                                className="text-xs text-slate-500 hover:text-white">Cancel</button>
                            </div>
                          </td>
                        </tr>
                      )}
                      {/* Expanded items */}
                      {expandedInvoice === inv.id && (
                        <tr key={`${inv.id}-items`} className="bg-slate-950/50">
                          <td colSpan={9} className="px-6 py-3">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-[10px] text-slate-600 uppercase">
                                  <th className="text-left py-1">Category</th>
                                  <th className="text-left py-1">App</th>
                                  <th className="text-left py-1">Description</th>
                                  <th className="text-right py-1">Amount</th>
                                  <th className="text-left py-1">Period</th>
                                </tr>
                              </thead>
                              <tbody>
                                {inv.items.map(item => (
                                  <tr key={item.id} className="border-t border-slate-800/30">
                                    <td className="py-1.5 text-slate-500">{item.category}</td>
                                    <td className="py-1.5 text-slate-300">{item.app_name || '—'}</td>
                                    <td className="py-1.5 text-slate-400">{item.description || '—'}</td>
                                    <td className="py-1.5 text-right text-white">{cents(item.amount_cents)}</td>
                                    <td className="py-1.5 text-slate-500">
                                      {item.billing_start && item.billing_end
                                        ? `${item.billing_start} → ${item.billing_end}`
                                        : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function AppInvoicesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" /></div>}>
      <AppInvoicesContent />
    </Suspense>
  );
}
