'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

interface Store {
  id: string;
  name: string;
}

const STORE_KEY = 'ym-selected-store';

export default function StoreSelector() {
  const [stores, setStores] = useState<Store[]>([]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlStoreId = searchParams.get('storeId') || '';

  // On mount, if no storeId in URL but one in localStorage, apply it
  useEffect(() => {
    if (!urlStoreId) {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) {
        const params = new URLSearchParams(searchParams.toString());
        params.set('storeId', saved);
        router.replace(`${pathname}?${params.toString()}`);
      }
    } else {
      localStorage.setItem(STORE_KEY, urlStoreId);
    }
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch('/api/stores')
      .then(r => r.json())
      .then(d => setStores(d.stores || []));
  }, []);

  function handleChange(storeId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (storeId) {
      params.set('storeId', storeId);
      localStorage.setItem(STORE_KEY, storeId);
    } else {
      params.delete('storeId');
      localStorage.removeItem(STORE_KEY);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  const currentStoreId = urlStoreId || '';

  if (stores.length === 0) return null;

  return (
    <select
      value={currentStoreId}
      onChange={(e) => handleChange(e.target.value)}
      className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
    >
      <option value="">All Stores</option>
      {stores.map(s => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  );
}
