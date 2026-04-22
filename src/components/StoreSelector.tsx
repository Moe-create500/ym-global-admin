'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

interface Store {
  id: string;
  name: string;
}

export default function StoreSelector() {
  const [stores, setStores] = useState<Store[]>([]);
  const [isAdmin, setIsAdmin] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentStoreId = searchParams.get('storeId') || '';

  useEffect(() => {
    fetch('/api/stores')
      .then(r => r.json())
      .then(d => {
        const storeList = d.stores || [];
        setStores(storeList);
        const role = d.session?.role || '';
        const admin = role === 'admin' || role === 'data_corrector';
        setIsAdmin(admin);

        // If client user with 1 store and no store selected → auto-select it
        if (!admin && storeList.length === 1 && !searchParams.get('storeId')) {
          const params = new URLSearchParams(searchParams.toString());
          params.set('storeId', storeList[0].id);
          router.replace(`${pathname}?${params.toString()}`);
        }
      });
  }, []);

  function handleChange(storeId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (storeId) {
      params.set('storeId', storeId);
    } else {
      params.delete('storeId');
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  if (stores.length === 0) return null;

  // Client with 1 store → show store name as label, no dropdown
  if (!isAdmin && stores.length === 1) {
    return (
      <span className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white">
        {stores[0].name}
      </span>
    );
  }

  // Client with multiple stores → dropdown but no "All Stores" option
  // Admin → full dropdown with "All Stores"
  return (
    <select
      value={currentStoreId}
      onChange={(e) => handleChange(e.target.value)}
      className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
    >
      {isAdmin && <option value="">All Stores</option>}
      {!isAdmin && !currentStoreId && <option value="">Select Store</option>}
      {stores.map(s => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  );
}
