'use client';

import { useEffect, useState } from 'react';

interface Store {
  id: string;
  name: string;
}

interface Card {
  id: string;
  card_name: string;
  last_four: string;
  card_type: string;
  issuer: string | null;
  expiry_month: number | null;
  expiry_year: number | null;
  assignment_count: number;
  total_monthly_cents: number | null;
}

interface Assignment {
  id: string;
  card_id: string;
  card_name: string;
  last_four: string;
  store_id: string | null;
  store_name: string | null;
  service: string;
  monthly_cost_cents: number;
  notes: string | null;
}

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function PaymentsPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddCard, setShowAddCard] = useState(false);
  const [showAddAssignment, setShowAddAssignment] = useState(false);
  const [saving, setSaving] = useState(false);

  const [cardForm, setCardForm] = useState({ cardName: '', lastFour: '', cardType: 'visa', issuer: '' });
  const [assignForm, setAssignForm] = useState({ cardId: '', storeId: '', service: 'shopify', monthlyCost: '', notes: '' });

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => setStores(d.stores || []));
    loadPayments();
  }, []);

  async function loadPayments() {
    setLoading(true);
    const res = await fetch('/api/payments');
    const data = await res.json();
    setCards(data.cards || []);
    setAssignments(data.assignments || []);
    setLoading(false);
  }

  async function handleAddCard(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/payments/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cardForm),
    });
    setCardForm({ cardName: '', lastFour: '', cardType: 'visa', issuer: '' });
    setShowAddCard(false);
    setSaving(false);
    loadPayments();
  }

  async function handleAddAssignment(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/payments/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: assignForm.cardId,
        storeId: assignForm.storeId || null,
        service: assignForm.service,
        monthlyCostCents: Math.round(parseFloat(assignForm.monthlyCost || '0') * 100),
        notes: assignForm.notes || undefined,
      }),
    });
    setAssignForm({ cardId: '', storeId: '', service: 'shopify', monthlyCost: '', notes: '' });
    setShowAddAssignment(false);
    setSaving(false);
    loadPayments();
  }

  async function handleRemoveAssignment(id: string) {
    if (!confirm('Remove this assignment?')) return;
    await fetch('/api/payments/assignments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    loadPayments();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }

  const totalMonthly = assignments.reduce((sum, a) => sum + (a.monthly_cost_cents || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Payment Cards</h1>
          <p className="text-sm text-slate-400 mt-1">Track which cards pay for which services</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowAddCard(!showAddCard); setShowAddAssignment(false); }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
          >
            + Card
          </button>
          <button
            onClick={() => { setShowAddAssignment(!showAddAssignment); setShowAddCard(false); }}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg"
          >
            + Assignment
          </button>
        </div>
      </div>

      {/* Total Monthly */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6">
        <p className="text-xs text-slate-500 uppercase mb-1">Total Monthly Recurring</p>
        <p className="text-2xl font-bold text-white">{cents(totalMonthly)}</p>
      </div>

      {/* Add Card Form */}
      {showAddCard && (
        <form onSubmit={handleAddCard} className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-white mb-4">New Card</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Card Name *</label>
              <input
                type="text"
                required
                value={cardForm.cardName}
                onChange={(e) => setCardForm({ ...cardForm, cardName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="e.g. Chase Ink Business"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Last 4 Digits *</label>
              <input
                type="text"
                required
                maxLength={4}
                value={cardForm.lastFour}
                onChange={(e) => setCardForm({ ...cardForm, lastFour: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="1234"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Card Type</label>
              <select
                value={cardForm.cardType}
                onChange={(e) => setCardForm({ ...cardForm, cardType: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="visa">Visa</option>
                <option value="mastercard">Mastercard</option>
                <option value="amex">Amex</option>
                <option value="discover">Discover</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Issuer</label>
              <input
                type="text"
                value={cardForm.issuer}
                onChange={(e) => setCardForm({ ...cardForm, issuer: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="e.g. Chase, Amex"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {saving ? 'Saving...' : 'Add Card'}
            </button>
          </div>
        </form>
      )}

      {/* Add Assignment Form */}
      {showAddAssignment && (
        <form onSubmit={handleAddAssignment} className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-white mb-4">New Assignment</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Card *</label>
              <select
                required
                value={assignForm.cardId}
                onChange={(e) => setAssignForm({ ...assignForm, cardId: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Select card</option>
                {cards.map(c => <option key={c.id} value={c.id}>{c.card_name} (****{c.last_four})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Store</label>
              <select
                value={assignForm.storeId}
                onChange={(e) => setAssignForm({ ...assignForm, storeId: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Company-wide</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Service *</label>
              <select
                value={assignForm.service}
                onChange={(e) => setAssignForm({ ...assignForm, service: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="shopify">Shopify</option>
                <option value="fb_ads">Facebook Ads</option>
                <option value="google_ads">Google Ads</option>
                <option value="apps">Apps/Plugins</option>
                <option value="hosting">Hosting</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Monthly Cost ($)</label>
              <input
                type="number"
                step="0.01"
                value={assignForm.monthlyCost}
                onChange={(e) => setAssignForm({ ...assignForm, monthlyCost: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Notes</label>
              <input
                type="text"
                value={assignForm.notes}
                onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                placeholder="Optional"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {saving ? 'Saving...' : 'Add Assignment'}
            </button>
          </div>
        </form>
      )}

      {/* Cards Grid */}
      <h2 className="text-sm font-semibold text-white mb-3">Cards</h2>
      {cards.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center mb-8">
          <p className="text-slate-400">No cards added yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {cards.map((card) => (
            <div key={card.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-white">{card.card_name}</h3>
                <span className="text-xs text-slate-500 uppercase">{card.card_type}</span>
              </div>
              <p className="text-sm text-slate-400 mb-3">****{card.last_four}{card.issuer ? ` · ${card.issuer}` : ''}</p>
              <div className="flex justify-between text-xs text-slate-500">
                <span>{card.assignment_count} assignment{card.assignment_count !== 1 ? 's' : ''}</span>
                <span>{cents(card.total_monthly_cents || 0)}/mo</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Assignments Table */}
      <h2 className="text-sm font-semibold text-white mb-3">Assignments</h2>
      {assignments.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center">
          <p className="text-slate-400">No assignments yet</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                <th className="text-left px-4 py-3">Card</th>
                <th className="text-left px-4 py-3">Store</th>
                <th className="text-left px-4 py-3">Service</th>
                <th className="text-right px-4 py-3">Monthly</th>
                <th className="text-left px-4 py-3">Notes</th>
                <th className="text-center px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="px-4 py-3 text-slate-300">{a.card_name} (****{a.last_four})</td>
                  <td className="px-4 py-3 text-slate-300">{a.store_name || 'Company-wide'}</td>
                  <td className="px-4 py-3 text-slate-400 capitalize">{a.service.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-right text-white font-medium">{cents(a.monthly_cost_cents || 0)}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{a.notes || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleRemoveAssignment(a.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
