'use client';

import { useEffect, useState } from 'react';

interface CreditCard {
  card_last4: string;
  card_type: string;
  total_spent_cents: number;
  transaction_count: number;
  last_used: string | null;
  stores: string[];
  platforms: Record<string, number>;
}

interface Totals {
  total_spent_cents: number;
  total_transactions: number;
  card_count: number;
}

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function cardTypeBadge(type: string) {
  const styles: Record<string, string> = {
    amex: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    visa: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
    mastercard: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    discover: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    paypal: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    unknown: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  };
  const labels: Record<string, string> = {
    amex: 'American Express',
    visa: 'Visa',
    mastercard: 'Mastercard',
    discover: 'Discover',
    paypal: 'PayPal',
    unknown: 'Unknown',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${styles[type] || styles.unknown}`}>
      {labels[type] || type}
    </span>
  );
}

function platformLabel(p: string): string {
  const labels: Record<string, string> = {
    facebook: 'Facebook Ads',
    google: 'Google Ads',
    shopify: 'Shopify / Apps',
    ad_payments: 'Ad Payments (logged)',
    app_payments: 'App Payments (logged)',
  };
  return labels[p] || p;
}

export default function CreditCardsPage() {
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [totals, setTotals] = useState<Totals>({ total_spent_cents: 0, total_transactions: 0, card_count: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCards();
  }, []);

  async function loadCards() {
    setLoading(true);
    const res = await fetch('/api/credit-cards');
    const data = await res.json();
    setCards(data.cards || []);
    setTotals(data.totals || { total_spent_cents: 0, total_transactions: 0, card_count: 0 });
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
        <p className="text-sm text-slate-400 mt-1">All payment cards used across stores — global view</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase mb-1">Total Cards</p>
          <p className="text-2xl font-bold text-white">{totals.card_count}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase mb-1">Total Charged</p>
          <p className="text-2xl font-bold text-white">{cents(totals.total_spent_cents)}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 uppercase mb-1">Total Transactions</p>
          <p className="text-2xl font-bold text-white">{totals.total_transactions.toLocaleString()}</p>
        </div>
      </div>

      {/* Cards */}
      {cards.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400">No cards found. Import invoices or ad payments to see cards here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {cards.map((card) => (
            <div key={card.card_last4} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-8 rounded bg-gradient-to-br from-slate-700 to-slate-600 flex items-center justify-center">
                    <span className="text-xs font-bold text-white">{card.card_last4}</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold text-white">**** {card.card_last4}</span>
                      {cardTypeBadge(card.card_type)}
                    </div>
                    {card.last_used && (
                      <p className="text-xs text-slate-500 mt-0.5">Last used: {card.last_used}</p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-white">{cents(card.total_spent_cents)}</p>
                  <p className="text-xs text-slate-500">{card.transaction_count} transactions</p>
                </div>
              </div>

              {/* Stores */}
              <div className="mb-3">
                <p className="text-xs text-slate-500 uppercase mb-1.5">Stores Using This Card</p>
                <div className="flex flex-wrap gap-1.5">
                  {card.stores.length > 0 ? (
                    card.stores.map((store) => (
                      <span key={store} className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                        {store}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-600">No store data</span>
                  )}
                </div>
              </div>

              {/* Platform Breakdown */}
              <div>
                <p className="text-xs text-slate-500 uppercase mb-1.5">Spend by Platform</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {Object.entries(card.platforms)
                    .sort(([, a], [, b]) => b - a)
                    .map(([platform, amount]) => (
                      <div key={platform} className="bg-slate-800/50 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-slate-500 uppercase">{platformLabel(platform)}</p>
                        <p className="text-sm font-medium text-white">{cents(amount)}</p>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
