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

interface CardPaymentLog {
  id: string;
  card_last4: string;
  date: string;
  amount_cents: number;
  method: string | null;
  notes: string | null;
  store_name?: string;
}

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function todayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function GooglePaymentsContent() {
  const searchParams = useSearchParams();
  const storeFilter = searchParams.get('storeId') || '';

  const [stores, setStores] = useState<Store[]>([]);
  const [charges, setCharges] = useState<AdPayment[]>([]);
  const [payments, setPayments] = useState<CardPaymentLog[]>([]);
  const [bankRecon, setBankRecon] = useState<any>({});
  const [chargeRecon, setChargeRecon] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [showPayments, setShowPayments] = useState(false);

  // Import state
  const [importStoreId, setImportStoreId] = useState('');
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [showImport, setShowImport] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const loadSeqRef = useRef(0);

  // Wrong-box fixes: reassign an invoice to another store, or delete it
  const [reassigning, setReassigning] = useState<string | null>(null);
  const [fixMsg, setFixMsg] = useState('');
  async function reassignCharge(paymentId: string, newStoreId: string) {
    if (!newStoreId) { setReassigning(null); return; }
    const res = await fetch('/api/ads/import', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId, newStoreId }),
    });
    const d = await res.json();
    setFixMsg(res.ok ? `✓ moved to ${d.movedTo}` : `✗ ${d.error}`);
    setReassigning(null);
    loadData();
  }
  async function deleteCharge(paymentId: string) {
    if (!confirm('Delete this invoice? Re-importing the same CSV will recreate it.')) return;
    const res = await fetch(`/api/ads/import?paymentId=${paymentId}`, { method: 'DELETE' });
    const d = await res.json();
    setFixMsg(res.ok ? '✓ invoice deleted' : `✗ ${d.error}`);
    loadData();
  }

  // Add payment state
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

  useEffect(() => { loadData(); }, [storeFilter]);

  useEffect(() => {
    if (storeFilter) { setImportStoreId(storeFilter); setPayStoreId(storeFilter); }
  }, [storeFilter]);

  async function loadData() {
    // Stale-response guard — see ads/payments: pin-injection races the mount load
    const seq = ++loadSeqRef.current;
    setLoading(true);
    const params = new URLSearchParams();
    if (storeFilter) params.set('storeId', storeFilter);
    params.set('platform', 'google');

    const cpParams = new URLSearchParams(params);

    const [chargeRes, payRes] = await Promise.all([
      fetch(`/api/ads/import?${params}`),
      fetch(`/api/ads/card-payments?${cpParams}`),
    ]);
    const chargeData = await chargeRes.json();
    const payData = await payRes.json();
    if (seq !== loadSeqRef.current) return; // superseded by a newer load — drop

    setCharges(chargeData.payments || []);
    setChargeRecon(chargeData.chargeRecon || {});
    setPayments(payData.payments || []);
    setBankRecon(payData.bankRecon || {});
    setLoading(false);
  }

  // Charge truth per invoice: did it actually hit a credit card?
  const chargeChip = (r: any) => {
    if (!r) return <span className="text-slate-600 text-[10px]">—</span>;
    if (r.status === 'verified') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 whitespace-nowrap" title={`matched at ${r.score ?? '—'}% confidence`}>✓ on ··{r.cardLast4} · {r.txnDate}</span>;
    if (r.status === 'missing') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 whitespace-nowrap" title="Card is linked but no matching charge found — billed with no card charge, or amount mismatch">⚠ NO CARD CHARGE — ··{r.cardLast4} is linked</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400 whitespace-nowrap" title="Funding card not connected in Banking — link it to verify">○ card {r.cardLast4 ? `··${r.cardLast4}` : '?'} not linked</span>;
  };

  // Bank truth per logged payment: which account it left + has the issuer taken it
  const bankChip = (r: any) => {
    if (!r) return <span className="text-slate-600 text-[10px]">—</span>;
    if (r.status === 'confirmed') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 whitespace-nowrap">✓ {r.bankAccount} ··{r.bankLast4} · {r.bankDate}</span>;
    if (r.status === 'pending') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 whitespace-nowrap">⏳ debit pending · {r.bankAccount} ··{r.bankLast4}</span>;
    if (r.status === 'too_recent') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400 whitespace-nowrap">⋯ awaiting bank debit</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 whitespace-nowrap" title="No matching bank debit within 10 days of the logged date — the card issuer hasn't pulled this payment, or it was logged wrong">⚠ NOT TAKEN — no bank debit</span>;
  };

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
    const res = await fetch('/api/ads/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: importStoreId, platform: 'google', csvText }),
    });
    setImportResult(await res.json());
    setImporting(false);
    loadData();
  }

  async function handleAddPayment() {
    if (!payStoreId || !payCard || !payAmount) return;
    setAddingPayment(true);
    await fetch('/api/ads/card-payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: payStoreId,
        cardLast4: payCard,
        date: payDate || 'N/A',
        amountCents: Math.round(parseFloat(payAmount) * 100),
        method: payMethod || null,
        notes: payNotes || null,
        platform: 'google',
      }),
    });
    setAddingPayment(false);
    setPayAmount('');
    setPayNotes('');
    setShowAddPayment(false);
    loadData();
  }

  async function handleDeletePayment(id: string) {
    if (!confirm('Delete this payment?')) return;
    await fetch(`/api/ads/card-payments?id=${id}`, { method: 'DELETE' });
    loadData();
  }

  // Build card summaries from Google charges only
  const cardCharged: Record<string, number> = {};
  const cardPaid: Record<string, number> = {};
  for (const c of charges) { if (c.card_last4) cardCharged[c.card_last4] = (cardCharged[c.card_last4] || 0) + c.amount_cents; }
  for (const p of payments) { cardPaid[p.card_last4] = (cardPaid[p.card_last4] || 0) + p.amount_cents; }

  const totalCharged = charges.reduce((s, c) => s + c.amount_cents, 0);
  const totalPaid = payments.reduce((s, p) => s + p.amount_cents, 0);
  const totalBalance = totalCharged - totalPaid;
  const selectedStore = stores.find(s => s.id === storeFilter);
  const allCards = [...new Set(charges.map(c => c.card_last4).filter(Boolean))];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-baseline gap-2 min-w-0">
            <h1 className="text-[12px] uppercase tracking-wider text-slate-500 whitespace-nowrap">Google Ads Invoices</h1>
            <p className="text-[11px] text-slate-600 truncate">
              {selectedStore ? selectedStore.name : 'All stores'} — Google ad payment reconciliation
            </p>
          </div>
          <StoreSelector />
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowAddPayment(!showAddPayment); setShowImport(false); }}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[12px] font-semibold rounded-lg flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Card Payment
          </button>
          <button onClick={() => { setShowImport(!showImport); setShowAddPayment(false); }}
            className="px-3 py-1.5 bg-slate-100 hover:bg-white text-slate-900 text-[12px] font-semibold rounded-lg flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Import Charges
          </button>
        </div>
      </div>

      {/* Add Payment Panel */}
      {showAddPayment && (
        <div className="rounded-xl bg-slate-900/60 p-5 mb-6">
          <h2 className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider mb-4">Record Google Ads Payment</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Store</label>
              <select value={payStoreId} onChange={(e) => setPayStoreId(e.target.value)}
                className="w-full bg-slate-800 rounded-lg px-2.5 py-1.5 text-[13px] text-white focus:outline-none">
                <option value="">Select...</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Card</label>
              <input type="text" placeholder="1009" value={payCard} onChange={(e) => setPayCard(e.target.value)}
                className="w-full bg-slate-800 rounded-lg px-2.5 py-1.5 text-[13px] text-white focus:outline-none" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Date</label>
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)}
                className="w-full bg-slate-800 rounded-lg px-2.5 py-1.5 text-[13px] text-white focus:outline-none" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Amount ($)</label>
              <input type="number" step="0.01" placeholder="500.00" value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
                className="w-full bg-slate-800 rounded-lg px-2.5 py-1.5 text-[13px] text-white focus:outline-none" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Notes</label>
              <input type="text" placeholder="Optional" value={payNotes} onChange={(e) => setPayNotes(e.target.value)}
                className="w-full bg-slate-800 rounded-lg px-2.5 py-1.5 text-[13px] text-white focus:outline-none" />
            </div>
          </div>
          <button onClick={handleAddPayment} disabled={!payStoreId || !payCard || !payAmount || addingPayment}
            className="px-3 py-1.5 bg-slate-100 hover:bg-white disabled:opacity-50 text-slate-900 text-[12px] font-semibold rounded-lg">
            {addingPayment ? 'Saving...' : 'Record Payment'}
          </button>
        </div>
      )}

      {/* Import Panel */}
      {showImport && (
        <div className="rounded-xl bg-slate-900/60 p-5 mb-6">
          <h2 className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider mb-4">Import Google Ads Charges (CSV)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Store</label>
              <select value={importStoreId} onChange={(e) => setImportStoreId(e.target.value)}
                className="w-full bg-slate-800 rounded-lg px-2.5 py-1.5 text-[13px] text-white focus:outline-none">
                <option value="">Select store...</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Google Billing CSV</label>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFile}
                className="w-full bg-slate-800 rounded-lg px-2.5 py-1.5 text-[13px] text-white file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-slate-700 file:text-slate-300 file:cursor-pointer" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleImport} disabled={!importStoreId || !csvText || importing}
              className="px-3 py-1.5 bg-slate-100 hover:bg-white disabled:opacity-50 text-slate-900 text-[12px] font-semibold rounded-lg">
              {importing ? 'Importing...' : 'Import Charges'}
            </button>
            {importResult && (
              <span className={`text-xs ${importResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                {importResult.success ? `${importResult.imported} imported, ${importResult.duplicates} duplicates skipped` : importResult.error || 'Failed'}
              </span>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-400" /></div>
      ) : charges.length === 0 && payments.length === 0 ? (
        <div className="rounded-xl bg-slate-900/60 p-12 text-center">
          <p className="text-slate-400 mb-3">No Google Ads charges{selectedStore ? ` for ${selectedStore.name}` : ''}</p>
          <button onClick={() => setShowImport(true)} className="text-sm text-green-400 hover:text-green-300">Import Google Billing CSV</button>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="rounded-xl bg-slate-900/60 p-4">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Total Charged</p>
              <p className="text-2xl font-semibold text-white tabular-nums">{cents(totalCharged)}</p>
              <p className="text-[10px] text-slate-500">{charges.length} charges</p>
            </div>
            <div className="rounded-xl bg-slate-900/60 p-4">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Total Paid</p>
              <p className="text-2xl font-semibold text-emerald-300 tabular-nums">{cents(totalPaid)}</p>
            </div>
            <div className="rounded-xl bg-slate-900/60 p-4">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Balance Due</p>
              <p className={`text-2xl font-semibold tabular-nums ${totalBalance > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{cents(totalBalance)}</p>
            </div>
          </div>

          {/* Card Balances */}
          {allCards.length > 0 && (
            <div className="rounded-xl bg-slate-900/60 p-5 mb-6">
              <h2 className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider mb-4">Card Balances</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {allCards.map(card => {
                  const charged = cardCharged[card] || 0;
                  const paid = cardPaid[card] || 0;
                  const balance = charged - paid;
                  return (
                    <div key={card} className="p-4 rounded-lg bg-slate-800/40">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-semibold text-white">····{card}</p>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${balance <= 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                          {balance <= 0 ? 'Paid' : 'Due'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div><p className="text-[10px] text-slate-500">Charged</p><p className="text-xs font-semibold text-white tabular-nums">{cents(charged)}</p></div>
                        <div><p className="text-[10px] text-slate-500">Paid</p><p className="text-xs font-semibold text-emerald-300 tabular-nums">{cents(paid)}</p></div>
                        <div><p className="text-[10px] text-slate-500">Balance</p><p className={`text-xs font-semibold tabular-nums ${balance > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{cents(balance)}</p></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Card Payments Made - Collapsible */}
          {payments.length > 0 && (
            <div className="rounded-xl bg-slate-900/60 overflow-hidden mb-6">
              <button onClick={() => setShowPayments(!showPayments)}
                className="w-full flex items-center justify-between px-5 py-3 border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
                <h2 className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider">Card Payments Made <span className="text-slate-500 font-normal">({payments.length})</span></h2>
                <svg className={`w-4 h-4 text-slate-400 transition-transform ${showPayments ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showPayments && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
                        <th className="text-left px-4 py-2">Date</th>
                        <th className="text-left px-4 py-2">Card</th>
                        <th className="text-right px-4 py-2">Amount</th>
                        <th className="text-left px-4 py-2">Bank (verified)</th>
                        <th className="text-left px-4 py-2">Method</th>
                        <th className="text-left px-4 py-2">Notes</th>
                        <th className="px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map(p => (
                        <tr key={p.id} className="border-b border-slate-800/30 hover:bg-slate-800/30">
                          <td className="px-4 py-2 text-slate-300">{p.date || 'N/A'}</td>
                          <td className="px-4 py-2 text-slate-400">····{p.card_last4}</td>
                          <td className="px-4 py-2 text-right text-emerald-300 font-medium tabular-nums">{cents(p.amount_cents)}</td>
                          <td className="px-4 py-2">{bankChip(bankRecon[p.id])}</td>
                          <td className="px-4 py-2 text-slate-500 text-xs">{p.method || '—'}</td>
                          <td className="px-4 py-2 text-slate-500 text-xs max-w-[200px] truncate">{p.notes || '—'}</td>
                          <td className="px-4 py-2">
                            <button onClick={() => handleDeletePayment(p.id)} className="text-xs text-red-400/80 hover:text-red-300">Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Charges Table */}
          <div className="rounded-xl bg-slate-900/60 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-800/60 flex items-center justify-between">
              <h2 className="text-[12px] font-semibold text-slate-200 uppercase tracking-wider">Google Ads Charges</h2>
              {fixMsg && <span className={`text-xs ${fixMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{fixMsg}</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800/60">
                    <th className="text-left px-4 py-2">Date</th>
                    <th className="text-left px-4 py-2">Store</th>
                    <th className="text-left px-4 py-2">Card</th>
                    <th className="text-right px-4 py-2">Amount</th>
                    <th className="text-left px-4 py-2">Card charge (verified)</th>
                    <th className="text-left px-4 py-2">Reference</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {charges.map(c => (
                    <tr key={c.id} className="border-b border-slate-800/30 hover:bg-slate-800/30">
                      <td className="px-4 py-2 text-slate-300">{c.date || 'N/A'}</td>
                      <td className="px-4 py-2">
                        {reassigning === c.id ? (
                          <select autoFocus defaultValue={c.store_id} onChange={e => reassignCharge(c.id, e.target.value)} onBlur={() => setReassigning(null)}
                            className="bg-slate-800 rounded px-1.5 py-1 text-xs text-white">
                            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        ) : (
                          <button onClick={() => setReassigning(c.id)} title="Click to move this invoice to another store"
                            className="text-slate-300 hover:text-blue-400 text-xs border-b border-dotted border-slate-600">{c.store_name}</button>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-400">····{c.card_last4}</td>
                      <td className="px-4 py-2 text-right text-white font-medium tabular-nums">{cents(c.amount_cents)}</td>
                      <td className="px-4 py-2">{chargeChip(chargeRecon[c.id])}</td>
                      <td className="px-4 py-2 text-slate-500 text-xs font-mono">{c.transaction_id?.replace('google-', '')}</td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => deleteCharge(c.id)} className="text-xs text-red-400/80 hover:text-red-300">✕</button>
                      </td>
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

export default function GooglePaymentsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400" /></div>}>
      <GooglePaymentsContent />
    </Suspense>
  );
}
