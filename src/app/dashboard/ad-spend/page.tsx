'use client';

import { Suspense, useState } from 'react';
import FbInvoices from '../ads/payments/page';
import GoogleInvoices from '../ads/google-payments/page';
import AppInvoices from '../app-invoices/page';

// AD SPEND — one home for all invoice/payment tracking (Moe 2026-09-09):
// Facebook, Google, and App invoices consolidated behind a segmented control.
// Each tab renders the EXISTING page component unchanged — zero data or
// logic differences; the old deep-link routes keep working too.

const TABS = [
  { key: 'facebook', label: 'Facebook', Comp: FbInvoices },
  { key: 'google', label: 'Google', Comp: GoogleInvoices },
  { key: 'apps', label: 'Apps', Comp: AppInvoices },
] as const;

export default function AdSpendPage() {
  const [tab, setTab] = useState<'facebook' | 'google' | 'apps'>('facebook');
  const Active = TABS.find(t => t.key === tab)!.Comp;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Ad Spend</h1>
          <p className="text-sm text-slate-400 mt-1">Invoices and payment tracking — Facebook, Google, and apps in one place</p>
        </div>
        <div className="flex rounded-xl overflow-hidden bg-slate-900/70 p-1 gap-1">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 text-[13px] font-medium rounded-lg transition-colors ${
                tab === t.key ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-white'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <Suspense fallback={<div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" /></div>}>
        {/* key forces a clean mount per tab — each page manages its own state */}
        <Active key={tab} />
      </Suspense>
    </div>
  );
}
