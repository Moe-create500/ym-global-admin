'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import StoreSelector from '@/components/StoreSelector';

interface Store { id: string; name: string; shipsourced_client_id: string | null; }

interface Product {
  id: string;
  store_id: string;
  store_name: string;
  title: string;
  sku: string | null;
  variant_title: string | null;
  image_url: string | null;
  images: string | null; // JSON array of image URLs
  price_cents: number;
  cost_cents: number;
  us_cost_cents: number;
  china_cost_cents: number;
  weight_grams: number;
  category: string | null;
  description: string | null;
  status: string;
  creative_count: number;
}

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function ProductsContent() {
  const searchParams = useSearchParams();
  const storeFilter = searchParams.get('storeId') || '';

  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [form, setForm] = useState({
    storeId: '', title: '', sku: '', priceCents: '', costCents: '',
    usCostCents: '', chinaCostCents: '', weightGrams: '', category: '', imageUrl: '',
  });
  const [viewImages, setViewImages] = useState<{ product: Product; images: string[] } | null>(null);
  const [editDesc, setEditDesc] = useState<{ id: string; description: string } | null>(null);
  const [savingDesc, setSavingDesc] = useState(false);

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => setStores(d.stores || []));
  }, []);

  useEffect(() => {
    loadProducts();
  }, [storeFilter]);

  async function loadProducts() {
    setLoading(true);
    const params = new URLSearchParams();
    if (storeFilter) params.set('storeId', storeFilter);
    const res = await fetch(`/api/products?${params}`);
    const data = await res.json();
    setProducts(data.products || []);
    setLoading(false);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: form.storeId,
        title: form.title,
        sku: form.sku || undefined,
        imageUrl: form.imageUrl || undefined,
        priceCents: form.priceCents ? Math.round(parseFloat(form.priceCents) * 100) : 0,
        costCents: form.costCents ? Math.round(parseFloat(form.costCents) * 100) : 0,
        usCostCents: form.usCostCents ? Math.round(parseFloat(form.usCostCents) * 100) : 0,
        chinaCostCents: form.chinaCostCents ? Math.round(parseFloat(form.chinaCostCents) * 100) : 0,
        weightGrams: form.weightGrams ? parseInt(form.weightGrams) : 0,
        category: form.category || undefined,
      }),
    });
    setForm({ storeId: '', title: '', sku: '', priceCents: '', costCents: '',
      usCostCents: '', chinaCostCents: '', weightGrams: '', category: '', imageUrl: '' });
    setShowAdd(false);
    setSaving(false);
    loadProducts();
  }

  async function handleSync() {
    const syncStores = storeFilter
      ? stores.filter(s => s.id === storeFilter && s.shipsourced_client_id)
      : stores.filter(s => s.shipsourced_client_id);

    if (syncStores.length === 0) {
      setSyncMsg('No stores with ShipSourced connected');
      setTimeout(() => setSyncMsg(''), 3000);
      return;
    }

    setSyncing(true);
    setSyncMsg('');
    let totalCreated = 0;
    let totalUpdated = 0;

    for (const s of syncStores) {
      try {
        const res = await fetch('/api/sync/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storeId: s.id }),
        });
        const data = await res.json();
        if (data.success) {
          totalCreated += data.created || 0;
          totalUpdated += data.updated || 0;
        }
      } catch {}
    }

    setSyncing(false);
    setSyncMsg(`Synced: ${totalCreated} new, ${totalUpdated} updated`);
    setTimeout(() => setSyncMsg(''), 5000);
    loadProducts();
  }

  async function handleCSVImport(file: File) {
    if (!storeFilter) {
      setImportMsg('Select a store first');
      setTimeout(() => setImportMsg(''), 3000);
      return;
    }
    setImporting(true);
    setImportMsg('');
    const csvText = await file.text();
    try {
      const res = await fetch('/api/products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: storeFilter, csvText }),
      });
      const data = await res.json();
      if (data.success) {
        setImportMsg(`Imported ${data.imported} new, updated ${data.updated}, skipped ${data.skipped}`);
        loadProducts();
      } else {
        setImportMsg(data.error || 'Import failed');
      }
    } catch (err: any) {
      setImportMsg(err.message || 'Import failed');
    }
    setImporting(false);
    setTimeout(() => setImportMsg(''), 5000);
  }

  async function saveDescription(productId: string, description: string) {
    setSavingDesc(true);
    await fetch(`/api/products/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: description || null }),
    });
    setSavingDesc(false);
    setEditDesc(null);
    loadProducts();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
      handleCSVImport(file);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleCSVImport(file);
    e.target.value = '';
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Products</h1>
          <p className="text-sm text-slate-400 mt-1">{products.length} product{products.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <StoreSelector />
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
          >
            {syncing ? 'Syncing...' : 'Sync Products'}
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
          >
            {showAdd ? 'Cancel' : '+ Add Product'}
          </button>
        </div>
      </div>

      {syncMsg && (
        <div className="mb-4 px-4 py-2 bg-emerald-900/20 border border-emerald-800 rounded-lg text-sm text-emerald-400">
          {syncMsg}
        </div>
      )}

      {/* Shopify CSV Import Drop Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`mb-6 border-2 border-dashed rounded-xl p-4 text-center transition-colors cursor-pointer ${
          dragOver ? 'border-blue-500 bg-blue-900/10' : 'border-slate-700 hover:border-slate-500'
        }`}
        onClick={() => document.getElementById('csv-file-input')?.click()}
      >
        <input
          id="csv-file-input"
          type="file"
          accept=".csv"
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="flex items-center justify-center gap-3">
          <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <div className="text-left">
            <p className="text-sm text-slate-300">
              {importing ? 'Importing...' : 'Drop Shopify CSV here or click to browse'}
            </p>
            <p className="text-[10px] text-slate-500">Export products from Shopify Admin → Products → Export</p>
          </div>
        </div>
        {importMsg && (
          <p className={`mt-2 text-xs ${importMsg.includes('Imported') ? 'text-emerald-400' : 'text-red-400'}`}>
            {importMsg}
          </p>
        )}
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-white mb-4">New Product</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Store *</label>
              <select
                required
                value={form.storeId}
                onChange={(e) => setForm({ ...form, storeId: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Select store</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Title *</label>
              <input
                type="text"
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">SKU</label>
              <input
                type="text"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Category</label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Price ($)</label>
              <input
                type="number"
                step="0.01"
                value={form.priceCents}
                onChange={(e) => setForm({ ...form, priceCents: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">US COGS ($)</label>
              <input
                type="number"
                step="0.01"
                value={form.usCostCents}
                onChange={(e) => setForm({ ...form, usCostCents: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">China COGS ($)</label>
              <input
                type="number"
                step="0.01"
                value={form.chinaCostCents}
                onChange={(e) => setForm({ ...form, chinaCostCents: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Weight (g)</label>
              <input
                type="number"
                value={form.weightGrams}
                onChange={(e) => setForm({ ...form, weightGrams: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-xs text-slate-400 mb-1">Image URL</label>
            <input
              type="url"
              value={form.imageUrl}
              onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              placeholder="https://..."
            />
          </div>
          <div className="mt-4 flex justify-end">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {saving ? 'Adding...' : 'Add Product'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" />
        </div>
      ) : products.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400">No products yet</p>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                  <th className="text-left px-4 py-3">Product</th>
                  <th className="text-left px-4 py-3">Store</th>
                  <th className="text-left px-4 py-3">SKU</th>
                  <th className="text-right px-4 py-3">Price</th>
                  <th className="text-right px-4 py-3">COGS</th>
                  <th className="text-right px-4 py-3">Margin</th>
                  <th className="text-left px-4 py-3">Description</th>
                  <th className="text-center px-4 py-3">Creatives</th>
                  <th className="text-center px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const margin = p.price_cents > 0 ? ((p.price_cents - p.cost_cents) / p.price_cents) * 100 : 0;
                  const allImages: string[] = (() => {
                    try { return p.images ? JSON.parse(p.images) : []; } catch { return []; }
                  })();
                  if (p.image_url && !allImages.includes(p.image_url)) allImages.unshift(p.image_url);
                  const imageCount = allImages.length;
                  return (
                    <tr key={p.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {p.image_url ? (
                            <button
                              onClick={() => imageCount > 0 && setViewImages({ product: p, images: allImages })}
                              className="relative flex-shrink-0 group"
                            >
                              <img src={p.image_url} alt="" className="w-10 h-10 rounded object-cover bg-slate-800" />
                              {imageCount > 1 && (
                                <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                                  {imageCount}
                                </span>
                              )}
                            </button>
                          ) : (
                            <div className="w-10 h-10 rounded bg-slate-800 flex items-center justify-center flex-shrink-0">
                              <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                              </svg>
                            </div>
                          )}
                          <div>
                            <p className="text-white font-medium">{p.title}</p>
                            {p.variant_title && <p className="text-[10px] text-slate-500">{p.variant_title}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{p.store_name}</td>
                      <td className="px-4 py-3 text-slate-400 font-mono text-xs">{p.sku || '—'}</td>
                      <td className="px-4 py-3 text-right text-white">{cents(p.price_cents)}</td>
                      <td className="px-4 py-3 text-right text-slate-400">{cents(p.cost_cents)}</td>
                      <td className={`px-4 py-3 text-right ${margin >= 50 ? 'text-emerald-400' : margin >= 30 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {margin.toFixed(0)}%
                      </td>
                      <td className="px-4 py-3 max-w-[200px]">
                        {editDesc?.id === p.id ? (
                          <div className="flex flex-col gap-1">
                            <textarea
                              autoFocus
                              value={editDesc.description}
                              onChange={(e) => setEditDesc({ ...editDesc, description: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && e.metaKey) saveDescription(p.id, editDesc.description);
                                if (e.key === 'Escape') setEditDesc(null);
                              }}
                              rows={3}
                              className="w-full px-2 py-1 bg-slate-800 border border-blue-500 rounded text-xs text-white focus:outline-none resize-none"
                              placeholder="e.g. Collagen powder + vitamin gummies bundle..."
                            />
                            <div className="flex gap-1">
                              <button
                                onClick={() => saveDescription(p.id, editDesc.description)}
                                disabled={savingDesc}
                                className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] rounded disabled:opacity-50"
                              >
                                {savingDesc ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                onClick={() => setEditDesc(null)}
                                className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-[10px] rounded"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditDesc({ id: p.id, description: p.description || '' })}
                            className="text-left w-full group"
                          >
                            {p.description ? (
                              <p className="text-xs text-slate-300 line-clamp-2 group-hover:text-white">{p.description}</p>
                            ) : (
                              <p className="text-[10px] text-slate-600 group-hover:text-slate-400">+ Add description</p>
                            )}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-400">{p.creative_count}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                          p.status === 'active' ? 'bg-emerald-900/30 text-emerald-400' :
                          p.status === 'draft' ? 'bg-yellow-900/30 text-yellow-400' :
                          'bg-slate-800 text-slate-400'
                        }`}>
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Product Images Modal */}
      {viewImages && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setViewImages(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white">{viewImages.product.title}</h2>
                <p className="text-[10px] text-slate-400">{viewImages.images.length} image{viewImages.images.length !== 1 ? 's' : ''}</p>
              </div>
              <button onClick={() => setViewImages(null)} className="text-slate-400 hover:text-white text-lg">&times;</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {viewImages.images.map((url, idx) => (
                <div key={idx} className="relative group">
                  <img
                    src={url}
                    alt={`${viewImages.product.title} - ${idx + 1}`}
                    className="w-full aspect-square object-cover rounded-lg bg-slate-800 border border-slate-700"
                  />
                  <span className="absolute top-1 left-1 bg-black/60 text-white text-[8px] px-1.5 py-0.5 rounded">
                    {idx + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" /></div>}>
      <ProductsContent />
    </Suspense>
  );
}
