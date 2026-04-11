'use client';

import { useEffect, useState } from 'react';

interface CreditCard {
  id: string;
  store_id: string | null;
  institution_name: string;
  account_name: string;
  account_subtype: string;
  last_four: string;
  currency: string;
  balance_available_cents: number;
  balance_ledger_cents: number;
  balance_updated_at: string | null;
  status: string;
  store_name: string | null;
}

interface Summary {
  total_available_cents: number;
  total_ledger_cents: number;
  card_count: number;
}

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
  const [summary, setSummary] = useState<Summary>({ total_available_cents: 0, total_ledger_cents: 0, card_count: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCards();
  }, []);

  async function loadCards() {
    setLoading(true);
    const res = await fetch('/api/credit-cards');
    const data = await res.json();
    setCards(data.cards || []);
    setSummary(data.summary || { total_available_cents: 0, total_ledger_cents: 0, card_count: 0 });
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Credit Cards</h1>
        <p className="text-sm text-slate-400 mt-1">Connected American Express accounts</p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase mb-1">Cards Connected</p>
          <p className="text-2xl font-bold text-white">{summary.card_count}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase mb-1">Total Available</p>
          <p className={`text-2xl font-bold ${summary.total_available_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {cents(summary.total_available_cents)}
          </p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase mb-1">Total Ledger Balance</p>
          <p className="text-2xl font-bold text-white">{cents(summary.total_ledger_cents)}</p>
        </div>
      </div>

      {/* Cards Grid */}
      {cards.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400">No credit cards connected. Connect your Amex accounts in Bank Accounts.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => (
            <div key={card.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-white">{card.institution_name}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{card.account_name} ****{card.last_four}</p>
                </div>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  {card.account_subtype || 'credit_card'}
                </span>
              </div>

              {/* Balances */}
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <p className="text-[10px] text-slate-500 uppercase">Available</p>
                  <p className={`text-lg font-bold ${card.balance_available_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {cents(card.balance_available_cents)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase">Ledger</p>
                  <p className="text-lg font-bold text-white">{cents(card.balance_ledger_cents)}</p>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <span>Updated {timeAgo(card.balance_updated_at)}</span>
                {card.store_name && (
                  <span className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">{card.store_name}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
