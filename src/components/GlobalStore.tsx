'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

// ── Centralized store selection ─────────────────────────────────────────────
// Pick a store ONCE, everywhere follows:
//  · saved in localStorage ('ym_store') — survives navigation and reloads
//  · injected as ?storeId= on every dashboard page that lacks it (ten pages
//    already read that param natively)
//  · broadcast as a 'ym-store-changed' window event for pages that keep the
//    selection in local state (cashflow, inventory-flow)
// Choosing "All stores" anywhere clears the pin everywhere.

export const STORE_KEY = 'ym_store';

export function readGlobalStore(): string {
  if (typeof window === 'undefined') return '';
  try { return localStorage.getItem(STORE_KEY) || ''; } catch { return ''; }
}

export function writeGlobalStore(storeId: string) {
  try {
    if (storeId) localStorage.setItem(STORE_KEY, storeId);
    else localStorage.removeItem(STORE_KEY);
    window.dispatchEvent(new CustomEvent('ym-store-changed', { detail: storeId }));
  } catch { /* private mode etc. */ }
}

/** Subscribe local page state to the global store selection. */
export function onGlobalStoreChange(cb: (storeId: string) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent).detail ?? '');
  window.addEventListener('ym-store-changed', handler);
  return () => window.removeEventListener('ym-store-changed', handler);
}

function GlobalStoreBarInner() {
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [pinned, setPinned] = useState('');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => setStores(d.stores || [])).catch(() => {});
    setPinned(readGlobalStore());
    return onGlobalStoreChange(setPinned);
  }, []);

  // Keep ?storeId= present on navigation whenever a store is pinned — the
  // pages that read the param then follow the pin with zero code changes.
  useEffect(() => {
    const saved = readGlobalStore();
    if (!saved) return;
    if (searchParams.get('storeId')) return; // page already scoped (deep link wins)
    const params = new URLSearchParams(searchParams.toString());
    params.set('storeId', saved);
    router.replace(`${pathname}?${params.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const change = (id: string) => {
    writeGlobalStore(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set('storeId', id); else params.delete('storeId');
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`);
  };

  if (!stores.length) return null;
  const current = searchParams.get('storeId') || pinned;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">Store</span>
      <select value={current} onChange={e => change(e.target.value)}
        className={`bg-slate-900 border text-xs rounded-lg px-2.5 py-1.5 text-white focus:outline-none ${current ? 'border-blue-600' : 'border-slate-700'}`}>
        <option value="">All stores</option>
        {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {current && <span className="text-[10px] text-blue-400" title="This store follows you across every tab until you switch back to All stores">📌 pinned</span>}
    </div>
  );
}

export default function GlobalStoreBar() {
  return <Suspense fallback={null}><GlobalStoreBarInner /></Suspense>;
}
