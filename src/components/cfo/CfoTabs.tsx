'use client';
import Link from 'next/link';

/** Section tabs across the CFO surfaces. Overview is the new v2 page; the
 *  other four are the existing CFO page, sectioned — nothing was removed. */
export type CfoTab = 'overview' | 'position' | 'pnl' | 'recon' | 'history';

export function CfoTabs({ active, storeId }: { active: CfoTab; storeId?: string }) {
  const q = storeId ? `storeId=${encodeURIComponent(storeId)}` : '';
  const tabs: { id: CfoTab; label: string; href: string }[] = [
    { id: 'overview', label: 'Overview', href: `/dashboard/cfo/overview${storeId ? `?scope=store:${encodeURIComponent(storeId)}` : ''}` },
    { id: 'position', label: 'Position', href: `/dashboard/cfo?${q}${q ? '&' : ''}tab=position` },
    { id: 'pnl', label: 'P&L', href: `/dashboard/cfo?${q}${q ? '&' : ''}tab=pnl` },
    { id: 'recon', label: 'Money Flow & Reconciliation', href: `/dashboard/cfo?${q}${q ? '&' : ''}tab=recon` },
    { id: 'history', label: 'History', href: `/dashboard/cfo?${q}${q ? '&' : ''}tab=history` },
  ];
  return (
    <nav className="flex gap-1 mb-5 border-b border-slate-800/60" aria-label="CFO sections">
      {tabs.map(t => (
        <Link key={t.id} href={t.href}
          className={`px-3 py-2 text-[12.5px] font-medium -mb-px border-b-2 transition-colors ${active === t.id ? 'border-slate-100 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
