'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import StoreSelector from '@/components/StoreSelector';

interface Store { id: string; name: string; }

interface AdPayment {
  id: string;
  store_id: string;
  store_name: string;
  platform: string;
  date: string;
  transaction_id: string;
  payment_method: string;
  card_last4: string;
  amount_cents: number;
}

interface CardSummary {
  card_last4: string;
  payment_method: string;
  payment_count: number;
  total_cents: number;
}

interface CardPaidTotal {
  card_last4: string;
  total_paid_cents: number;
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

interface MonthlyTotal {
  month: string;
  payment_count: number;
  total_cents: number;
}

interface PlatformSummary {
  platform: string;
  payment_count: number;
  total_cents: number;
}

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function todayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function InvoiceDashboardContent() {
  const searchParams = useSearchParams();
  const storeFilter = searchParams.get('storeId') || '';

  const [stores, setStores] = useState<Store[]>([]);
  const [adPayments, setAdPayments] = useState<AdPayment[]>([]);
  const [cardSummary, setCardSummary] = useState<CardSummary[]>([]);
  const [platformSummary, setPlatformSummary] = useState<PlatformSummary[]>([]);
  const [monthlyTotals, setMonthlyTotals] = useState<MonthlyTotal[]>([]);
  const [cardPaidTotals, setCardPaidTotals] = useState<CardPaidTotal[]>([]);
  const [cardPayments, setCardPayments] = useState<CardPaymentLog[]>([]);
  const [pendingCents, setPendingCents] = useState<Record<string, number>>({});
  const [totalPendingCents, setTotalPendingCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cardFilter, setCardFilter] = useState('');
  const [hiddenCards, setHiddenCards] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);

  // Import state
  const [importStoreId, setImportStoreId] = useState('');
  const [importPlatform, setImportPlatform] = useState('facebook');
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<{ rows: number; total: string; cards: string[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [showImport, setShowImport] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Add card payment state
  const [showCardPayments, setShowCardPayments] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [payCard, setPayCard] = useState('');
  const [payDate, setPayDate] = useState(todayStr());
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payStoreId, setPayStoreId] = useState('');
  const [addingPayment, setAddingPayment] = useState(false);

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => setStores(d.stores || []));
  }, []);

  useEffect(() => {
    loadData();
  }, [storeFilter, cardFilter]);

  useEffect(() => {
    if (storeFilter) {
      setImportStoreId(storeFilter);
      setPayStoreId(storeFilter);
    }
  }, [storeFilter]);

  async function loadData() {
    setLoading(true);
    const params = new URLSearchParams();
    if (storeFilter) params.set('storeId', storeFilter);
    if (cardFilter) params.set('cardLast4', cardFilter);
    params.set('platform', 'facebook');

    const cpParams = new URLSearchParams();
    if (storeFilter) cpParams.set('storeId', storeFilter);
    if (cardFilter) cpParams.set('cardLast4', cardFilter);
    cpParams.set('platform', 'facebook');

    const [invoiceRes, cardPayRes] = await Promise.all([
      fetch(`/api/ads/import?${params}`),
      fetch(`/api/ads/card-payments?${cpParams}`),
    ]);
    const invoiceData = await invoiceRes.json();
    const cardPayData = await cardPayRes.json();

    setAdPayments(invoiceData.payments || []);
    setCardSummary(invoiceData.cardSummary || []);
    setPlatformSummary(invoiceData.platformSummary || []);
    setMonthlyTotals(invoiceData.monthlyTotals || []);
    setPendingCents(invoiceData.pendingCents || {});
    setTotalPendingCents(invoiceData.totalPendingCents || 0);
    setHiddenCards(invoiceData.hiddenCards || []);
    setCardPaidTotals(cardPayData.cardTotals || []);
    setCardPayments(cardPayData.payments || []);
    setLoading(false);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportResult(null);
    setPreview(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);

      const lines = text.split('\n').map(l => l.trim());
      let headerIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('Date,Transaction ID,')) { headerIdx = i; break; }
      }
      if (headerIdx === -1) { setPreview({ rows: 0, total: '$0', cards: [] }); return; }

      let totalCents = 0; let count = 0;
      const cards = new Set<string>();
      for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.startsWith(',,Total')) continue;
        const parts = line.split(',');
        if (parts.length < 4 || !parts[0] || !parts[1]) continue;
        const cardMatch = (parts[2] || '').match(/(\d{4})\s*$/);
        if (cardMatch) cards.add(cardMatch[1]);
        let amountStr = '';
        if (line.includes('"')) {
          const qMatch = line.match(/"([^"]+)"/);
          if (qMatch) amountStr = qMatch[1].replace(/,/g, '');
        } else { amountStr = parts[3] || '0'; }
        const amt = parseFloat(amountStr) || 0;
        if (amt > 0) { totalCents += Math.round(amt * 100); count++; }
      }
      setPreview({
        rows: count,
        total: `$${(totalCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        cards: Array.from(cards),
      });
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!importStoreId || !csvText) return;
    setImporting(true);
    setImportResult(null);
    const res = await fetch('/api/ads/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: importStoreId, platform: importPlatform, csvText }),
    });
    setImportResult(await res.json());
    setImporting(false);
    loadData();
  }

  async function handleAddCardPayment() {
    if (!payStoreId || !payCard || !payAmount) return;
    setAddingPayment(true);
    await fetch('/api/ads/card-payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: payStoreId,
        cardLast4: payCard,
        date: payDate,
        amountCents: Math.round(parseFloat(payAmount) * 100),
        method: payMethod || null,
        notes: payNotes || null,
      }),
    });
    setAddingPayment(false);
    setPayAmount('');
    setPayNotes('');
    setShowAddPayment(false);
    loadData();
  }

  async function toggleCardVisibility(cardLast4: string, action: 'hide' | 'show') {
    await fetch('/api/ads/import', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: storeFilter, cardLast4, platform: 'facebook', action }),
    });
    loadData();
  }

  async function handleDeleteCardPayment(id: string) {
    if (!confirm('Delete this card payment?')) return;
    await fetch(`/api/ads/card-payments?id=${id}`, { method: 'DELETE' });
    loadData();
  }

  // Build card balance map: charges - payments
  const paidMap: Record<string, number> = {};
  for (const cp of cardPaidTotals) {
    paidMap[cp.card_last4] = cp.total_paid_cents || 0;
  }

  const visibleCards = cardSummary.filter(c => !hiddenCards.includes(c.card_last4));
  const totalCharged = visibleCards.reduce((s, c) => s + (c.total_cents || 0), 0);
  const totalPaid = cardPaidTotals.filter(c => !hiddenCards.includes(c.card_last4)).reduce((s, c) => s + (c.total_paid_cents || 0), 0);
  const totalBalance = totalCharged - totalPaid;
  const selectedStore = stores.find(s => s.id === storeFilter);
  const allCards = cardSummary.map(c => c.card_last4).filter(Boolean);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Invoice Dashboard</h1>
            <p className="text-sm text-slate-400 mt-1">
              {selectedStore ? selectedStore.name : 'All stores'} — ad payment reconciliation
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
            Import Invoice
          </button>
        </div>
      </div>

      {/* Add Card Payment Panel */}
      {showAddPayment && (
        <div className="bg-slate-900 border border-emerald-900/50 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-white mb-4">Record Card Payment</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Store</label>
              <select
                value={payStoreId}
                onChange={(e) => setPayStoreId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">Select...</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Card</label>
              <select
                value={payCard}
                onChange={(e) => setPayCard(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">Select card...</option>
                {allCards.map(c => <option key={c} value={c}>····{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Date</label>
              <input
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Amount ($)</label>
              <input
                type="number"
                step="0.01"
                placeholder="5000.00"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Method</label>
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">Select...</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="ach">ACH</option>
                <option value="check">Check</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleAddCardPayment}
              disabled={!payStoreId || !payCard || !payAmount || addingPayment}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
            >
              {addingPayment ? 'Saving...' : 'Record Payment'}
            </button>
            <input
              type="text"
              placeholder="Notes (optional)"
              value={payNotes}
              onChange={(e) => setPayNotes(e.target.value)}
              className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>
      )}

      {/* Import Panel */}
      {showImport && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-white mb-4">Import Ad Invoice CSV</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Store</label>
              <select value={importStoreId} onChange={(e) => setImportStoreId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="">Select store...</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Platform</label>
              <select value={importPlatform} onChange={(e) => setImportPlatform(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500">
                <option value="facebook">Facebook / Meta</option>
                <option value="google">Google Ads</option>
                <option value="shopify">Shopify</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase mb-1">Invoice CSV</label>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFile}
                className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-slate-700 file:text-slate-300 file:cursor-pointer" />
            </div>
          </div>
          {preview && preview.rows > 0 && (
            <div className="mb-4 px-4 py-3 bg-slate-800/50 rounded-lg flex items-center gap-6">
              <div><p className="text-[10px] text-slate-500 uppercase">Payments</p><p className="text-sm font-semibold text-white">{preview.rows}</p></div>
              <div><p className="text-[10px] text-slate-500 uppercase">Total</p><p className="text-sm font-semibold text-white">{preview.total}</p></div>
              <div><p className="text-[10px] text-slate-500 uppercase">Cards</p><div className="flex gap-1.5">{preview.cards.map(c => <span key={c} className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">····{c}</span>)}</div></div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button onClick={handleImport} disabled={!importStoreId || !csvText || importing}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {importing ? 'Importing...' : `Import ${preview?.rows || 0} Payments`}
            </button>
            {importResult && (
              <span className={`text-xs ${importResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                {importResult.success ? `${importResult.imported} imported, ${importResult.updated || 0} updated, ${importResult.duplicates} unchanged` : importResult.error || 'Failed'}
              </span>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" /></div>
      ) : adPayments.length === 0 && cardPayments.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
          <p className="text-slate-400 mb-3">No invoices imported{selectedStore ? ` for ${selectedStore.name}` : ''}</p>
          <button onClick={() => setShowImport(true)} className="text-sm text-blue-400 hover:text-blue-300">Import your first invoice CSV</button>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase mb-1">Total Charged</p>
              <p className="text-xl font-bold text-white">{cents(totalCharged)}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase mb-1">Total Paid</p>
              <p className="text-xl font-bold text-emerald-400">{cents(totalPaid)}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 uppercase mb-1">Balance Due</p>
              <p className={`text-xl font-bold ${totalBalance > 0 ? 'text-orange-400' : 'text-emerald-400'}`}>{cents(totalBalance)}</p>
            </div>
            <div className="bg-slate-900 border border-yellow-900/50 rounded-xl p-4">
              <p className="text-xs text-yellow-500 uppercase mb-1">Pending Charges</p>
              <p className="text-xl font-bold text-yellow-400">{cents(totalPendingCents)}</p>
              <div className="flex gap-2 mt-1">
                {Object.entries(pendingCents).map(([platform, amt]) => (
                  <span key={platform} className="text-[10px] text-yellow-600 capitalize">{platform}: {cents(amt)}</span>
                ))}
              </div>
            </div>
            {platformSummary.map(p => (
              <div key={p.platform} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-500 uppercase mb-1">{p.platform}</p>
                <p className="text-lg font-bold text-white">{cents(p.total_cents)}</p>
                <p className="text-[10px] text-slate-500">{p.payment_count} charges</p>
              </div>
            ))}
          </div>

          {/* Cards with Balance */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Card Balances</h2>
              {hiddenCards.length > 0 && (
                <button
                  onClick={() => setShowHidden(!showHidden)}
                  className="text-xs text-slate-400 hover:text-white transition-colors"
                >
                  {showHidden ? 'Hide' : 'Show'} {hiddenCards.length} hidden card{hiddenCards.length !== 1 ? 's' : ''}
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {cardSummary.filter(c => !hiddenCards.includes(c.card_last4)).map(card => {
                const paid = paidMap[card.card_last4] || 0;
                const balance = (card.total_cents || 0) - paid;
                return (
                  <div
                    key={card.card_last4}
                    className={`p-4 rounded-lg border text-left transition-colors relative group ${
                      cardFilter === card.card_last4 ? 'bg-blue-950/30 border-blue-700' : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <button
                      onClick={() => setCardFilter(cardFilter === card.card_last4 ? '' : card.card_last4)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-xs text-slate-400">{card.payment_method?.split('····')[0]?.trim() || 'Card'}</p>
                          <p className="text-sm font-semibold text-white">····{card.card_last4}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          balance <= 0 ? 'bg-emerald-900/30 text-emerald-400' : 'bg-orange-900/30 text-orange-400'
                        }`}>
                          {balance <= 0 ? 'Paid' : 'Due'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-[10px] text-slate-500">Charged</p>
                          <p className="text-xs font-semibold text-white">{cents(card.total_cents)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500">Paid</p>
                          <p className="text-xs font-semibold text-emerald-400">{cents(paid)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500">Balance</p>
                          <p className={`text-xs font-semibold ${balance > 0 ? 'text-orange-400' : 'text-emerald-400'}`}>{cents(balance)}</p>
                        </div>
                      </div>
                    </button>
                    {storeFilter && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleCardVisibility(card.card_last4, 'hide'); }}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-slate-500 hover:text-red-400 px-1.5 py-0.5 rounded bg-slate-900/80"
                        title="Hide this card"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Hidden cards */}
            {showHidden && hiddenCards.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-800">
                <p className="text-xs text-slate-500 mb-2">Hidden cards</p>
                <div className="flex flex-wrap gap-2">
                  {hiddenCards.map(card => {
                    const cs = cardSummary.find(c => c.card_last4 === card);
                    return (
                      <button
                        key={card}
                        onClick={() => toggleCardVisibility(card, 'show')}
                        className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/50 border border-slate-700 rounded-lg text-xs text-slate-400 hover:text-white hover:border-slate-600 transition-colors"
                      >
                        <span>····{card}</span>
                        {cs && <span className="text-slate-600">{cents(cs.total_cents)}</span>}
                        <span className="text-emerald-500">+ Show</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Card Payments Log — Collapsible */}
          {cardPayments.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-6">
              <button
                onClick={() => setShowCardPayments(!showCardPayments)}
                className="w-full px-5 py-4 border-b border-slate-800 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
              >
                <h2 className="text-sm font-semibold text-white">
                  Card Payments Made
                  <span className="ml-2 text-xs font-normal text-slate-400">({cardPayments.length})</span>
                </h2>
                <svg className={`w-4 h-4 text-slate-400 transition-transform ${showCardPayments ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showCardPayments && (
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
                      {cardPayments.map(cp => (
                        <tr key={cp.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="px-5 py-3 text-slate-300">{cp.date}</td>
                          <td className="px-5 py-3 text-slate-400">····{cp.card_last4}</td>
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
              )}
            </div>
          )}

          {/* Monthly Totals */}
          {monthlyTotals.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
              <h2 className="text-sm font-semibold text-white mb-4">Monthly Charges</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {monthlyTotals.map(m => (
                  <div key={m.month} className="px-3 py-2 bg-slate-800/50 rounded-lg">
                    <p className="text-xs text-slate-400">{m.month}</p>
                    <p className="text-sm font-semibold text-white">{cents(m.total_cents)}</p>
                    <p className="text-[10px] text-slate-500">{m.payment_count} charges</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Charges Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">
                Ad Charges {cardFilter && <span className="text-blue-400 font-normal ml-2">····{cardFilter}</span>}
              </h2>
              {cardFilter && <button onClick={() => setCardFilter('')} className="text-xs text-slate-400 hover:text-white">Clear</button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="text-left px-5 py-3">Date</th>
                    <th className="text-left px-5 py-3">Platform</th>
                    <th className="text-left px-5 py-3">Card</th>
                    <th className="text-right px-5 py-3">Amount</th>
                    <th className="text-left px-5 py-3">Transaction ID</th>
                  </tr>
                </thead>
                <tbody>
                  {adPayments.map(p => (
                    <tr key={p.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-slate-300">{p.date}</td>
                      <td className="px-5 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${p.platform === 'facebook' ? 'bg-blue-900/30 text-blue-400' : p.platform === 'shopify' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-green-900/30 text-green-400'}`}>{p.platform}</span></td>
                      <td className="px-5 py-3 text-slate-400">····{p.card_last4}</td>
                      <td className="px-5 py-3 text-right text-white font-medium">{cents(p.amount_cents)}</td>
                      <td className="px-5 py-3 text-slate-500 text-xs font-mono truncate max-w-[200px]">{p.transaction_id}</td>
                    </tr>
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

export default function InvoiceDashboardPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" /></div>}>
      <InvoiceDashboardContent />
    </Suspense>
  );
}
