'use client';

import type { GeneratorConfig, Product, Store } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface ProductPickerProps {
  stores: Store[];
  storeFilter: string;
  products: Product[];
  productSearch: string;
  setProductSearch: React.Dispatch<React.SetStateAction<string>>;
  productId: GeneratorConfig['productId'];
  setGenConfig: SetGenConfig;
  onLoadFoundation: (productId: string) => void;
}

export function ProductPicker({
  stores,
  storeFilter,
  products,
  productSearch,
  setProductSearch,
  productId,
  setGenConfig,
  onLoadFoundation,
}: ProductPickerProps) {
  const norm = (s: string) => s.toLowerCase().replace(/[™®©+\-–—.,|]/g, ' ').replace(/\s+/g, ' ').trim();
  const activeStore = stores.find(s => s.id === storeFilter);
  // All products from API are already scoped to the user's store — no client-side filter needed
  const allProducts = products;
  // Apply search
  const tokens = norm(productSearch).split(' ').filter(Boolean);
  const searchFiltered = tokens.length === 0
    ? allProducts
    : allProducts.filter(p => { const t = norm(String(p.title || '')); return tokens.every(tok => t.includes(tok)); });

  return (
    <>
      <label className="text-[9px] text-slate-500 uppercase mb-1 flex items-center justify-between">
        <span>Product{activeStore?.name ? ` (${activeStore.name})` : ''}</span>
        <span className="text-slate-600 normal-case">{allProducts.length} products</span>
      </label>
      {allProducts.length > 10 && (
        <input
          type="text"
          value={productSearch}
          onChange={e => setProductSearch(e.target.value)}
          placeholder={`Search ${allProducts.length} products...`}
          className="w-full px-3 py-1.5 mb-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-600"
        />
      )}
      <select value={productId} onChange={e => { setGenConfig(c => ({ ...c, productId: e.target.value, coverImageUrl: '' })); onLoadFoundation(e.target.value); }}
        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white">
        <option value="">Select product...</option>
        {searchFiltered.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>
      {productSearch && (
        <p className="text-[9px] text-slate-500 mt-1">
          {searchFiltered.length} match{searchFiltered.length === 1 ? '' : 'es'}
        </p>
      )}
    </>
  );
}
