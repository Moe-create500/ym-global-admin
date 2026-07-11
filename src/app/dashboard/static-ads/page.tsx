'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Store { id: string; name: string }
interface Product { id: string; title: string; image_url: string | null; images: string; price_cents: number | null }
interface Audience { id: string; name: string; description: string | null }
interface Template {
  id: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  template_data: { aspect_ratio?: string; preview_file?: string };
}
interface Creative {
  id: string;
  title: string;
  imageUrl: string;
  createdAt: string;
  templateName: string;
}
interface Batch {
  key: string;
  date: string;
  productTitle: string;
  audienceName: string;
  creatives: Creative[];
}

// Stores hidden from the Picture Ads store picker (no ads run for these)
const HIDDEN_STORES = ['apex loom', 'neeyahpure', 'vitaedge', 'ymo - amazon', 'zen essential', 'zenchoice'];

export default function StaticAdsPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('');

  const [products, setProducts] = useState<Product[]>([]);
  const [productFilter, setProductFilter] = useState('');
  const [productId, setProductId] = useState('');
  const [selectedImageUrl, setSelectedImageUrl] = useState('');

  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [audienceId, setAudienceId] = useState('');
  const [showNewAudience, setShowNewAudience] = useState(false);
  const [audienceText, setAudienceText] = useState('');
  const [creatingAudience, setCreatingAudience] = useState(false);
  const [autoAudienceLoading, setAutoAudienceLoading] = useState(false);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateIds, setTemplateIds] = useState<Set<string>>(new Set());

  const [customInstructions, setCustomInstructions] = useState('');

  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionImages, setSessionImages] = useState<{ imageUrl: string; template: string; audience: string }[]>([]);
  const [copyVariations, setCopyVariations] = useState<Record<string, string>[]>([]);

  const [batches, setBatches] = useState<Batch[]>([]);
  const [totalAds, setTotalAds] = useState(0);
  const [openBatches, setOpenBatches] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);

  // Load stores + templates once
  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => {
      const s = (d.stores || []).filter((st: Store) => !HIDDEN_STORES.includes(st.name.trim().toLowerCase()));
      setStores(s);
      if (s.length && !storeId) setStoreId(s[0].id);
    }).catch(() => {});
    fetch('/api/static-ads/templates').then(r => r.json()).then(d => setTemplates(d.templates || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadGallery = useCallback((sid: string) => {
    fetch(`/api/static-ads/creatives?storeId=${sid}`)
      .then(r => r.json()).then(d => {
        const b: Batch[] = d.batches || [];
        setBatches(b);
        setTotalAds(d.total || 0);
        // Newest batch open by default, everything else collapsed
        setOpenBatches(new Set(b.length ? [b[0].key] : []));
      }).catch(() => {});
  }, []);

  // Per-store data
  useEffect(() => {
    if (!storeId) return;
    setProductId(''); setSelectedImageUrl(''); setAudienceId(''); setSelectedIds(new Set());
    fetch(`/api/products?storeId=${storeId}&onBrand=1`).then(r => r.json()).then(d => setProducts(d.products || [])).catch(() => {});
    fetch(`/api/static-ads/audiences?storeId=${storeId}`).then(r => r.json()).then(d => setAudiences(d.audiences || [])).catch(() => {});
    loadGallery(storeId);
  }, [storeId, loadGallery]);

  const product = products.find(p => p.id === productId);
  const productImages: string[] = (() => {
    if (!product) return [];
    let imgs: string[] = [];
    try { imgs = JSON.parse(product.images || '[]'); } catch {}
    if (product.image_url && !imgs.includes(product.image_url)) imgs.unshift(product.image_url);
    return imgs.slice(0, 12);
  })();

  const filteredProducts = productFilter
    ? products.filter(p => p.title.toLowerCase().includes(productFilter.toLowerCase()))
    : products;

  const ready = storeId && productId && audienceId && templateIds.size > 0;

  async function autoGenerateAudience() {
    if (!storeId || !productId) return;
    setAutoAudienceLoading(true); setError('');
    try {
      const res = await fetch('/api/static-ads/audiences/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, productId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Audience generation failed');
      const list = await fetch(`/api/static-ads/audiences?storeId=${storeId}`).then(r => r.json());
      setAudiences(list.audiences || []);
      setAudienceId(d.id);
      setShowNewAudience(false);
    } catch (e: any) { setError(e.message); }
    setAutoAudienceLoading(false);
  }

  async function createAudience() {
    if (!audienceText.trim()) return;
    setCreatingAudience(true); setError('');
    try {
      const res = await fetch('/api/static-ads/audiences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, rawText: audienceText }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to create audience');
      const list = await fetch(`/api/static-ads/audiences?storeId=${storeId}`).then(r => r.json());
      setAudiences(list.audiences || []);
      setAudienceId(d.id);
      setShowNewAudience(false); setAudienceText('');
    } catch (e: any) { setError(e.message); }
    setCreatingAudience(false);
  }

  async function generateImage() {
    if (!ready) return;
    const ids = Array.from(templateIds);
    setGenerating(true); setError(''); setSessionImages([]);
    setProgress({ done: 0, total: ids.length });
    const failures: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      try {
        const res = await fetch('/api/static-ads/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storeId, productId, audienceId, templateId: ids[i], customInstructions, selectedImageUrl: selectedImageUrl || undefined }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Generation failed');
        setSessionImages(prev => [...prev, d.creative]);
        loadGallery(storeId);
      } catch (e: any) {
        const name = templates.find(t => t.id === ids[i])?.name || ids[i];
        failures.push(`${name}: ${e.message}`);
      }
      setProgress({ done: i + 1, total: ids.length });
    }
    if (failures.length) setError(`${failures.length}/${ids.length} failed — ${failures.join(' · ')}`);
    setProgress(null);
    setGenerating(false);
  }

  async function previewCopy() {
    if (!ready) return;
    setCopyLoading(true); setError(''); setCopyVariations([]);
    try {
      const res = await fetch('/api/static-ads/generate-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, productId, audienceId, templateId: Array.from(templateIds)[0], count: 3 }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Copy generation failed');
      setCopyVariations(d.variations || []);
    } catch (e: any) { setError(e.message); }
    setCopyLoading(false);
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function downloadZip() {
    if (!selectedIds.size) return;
    setZipping(true); setError('');
    try {
      const res = await fetch('/api/static-ads/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creativeIds: Array.from(selectedIds) }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'ZIP failed'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'static-ads.zip'; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setError(e.message); }
    setZipping(false);
  }

  const inputCls = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500';
  const labelCls = 'block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5';

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Picture Ads</h1>
          <p className="text-sm text-slate-400 mt-1">Template-based static ad generator — product + audience + template → finished ad image</p>
        </div>
        <Link href="/dashboard/creatives"
          className="text-xs bg-slate-800 border border-slate-700 hover:border-blue-500 text-slate-300 rounded-lg px-3 py-2 transition-colors">
          Also: <span className="text-blue-400 font-medium">Image mode in Creatives</span> — AI-designed statics (nano-banana / gpt-image) →
        </Link>
      </div>

      {error && (
        <div className="mb-4 bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* ── Config column ── */}
        <div className="xl:col-span-2 space-y-5">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
            <div>
              <label className={labelCls}>Store</label>
              <select value={storeId} onChange={e => setStoreId(e.target.value)} className={inputCls}>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div>
              <label className={labelCls}>Product</label>
              <input value={productFilter} onChange={e => setProductFilter(e.target.value)}
                placeholder="Filter products…" className={`${inputCls} mb-2`} />
              <select value={productId} onChange={e => { setProductId(e.target.value); setSelectedImageUrl(''); }} className={inputCls}>
                <option value="">— select product —</option>
                {filteredProducts.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.title}{p.price_cents ? ` — $${(p.price_cents / 100).toFixed(2)}` : ''}
                  </option>
                ))}
              </select>
              {productImages.length > 0 && (
                <div className="mt-2">
                  <p className="text-[11px] text-slate-500 mb-1.5">Reference photo (click to choose)</p>
                  <div className="grid grid-cols-6 gap-1.5">
                    {productImages.map(url => (
                      <button key={url} onClick={() => setSelectedImageUrl(url === selectedImageUrl ? '' : url)}
                        className={`aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
                          selectedImageUrl === url ? 'border-blue-500' : 'border-slate-700 hover:border-slate-500'
                        }`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={`${labelCls} mb-0`}>Audience</label>
                <button onClick={() => setShowNewAudience(v => !v)}
                  className="text-[11px] text-blue-400 hover:text-blue-300">
                  {showNewAudience ? 'cancel' : '+ new (paste research)'}
                </button>
              </div>
              {showNewAudience ? (
                <div className="space-y-2">
                  <textarea value={audienceText} onChange={e => setAudienceText(e.target.value)} rows={6}
                    placeholder="Paste raw audience research — pain points, desires, objections, mindset. AI structures it."
                    className={inputCls} />
                  <button onClick={createAudience} disabled={creatingAudience || !audienceText.trim()}
                    className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg py-2 transition-colors">
                    {creatingAudience ? 'Parsing with AI…' : 'Create Audience'}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <select value={audienceId} onChange={e => setAudienceId(e.target.value)} className={inputCls}>
                    <option value="">— select audience —</option>
                    {audiences.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <button onClick={autoGenerateAudience} disabled={!productId || autoAudienceLoading}
                    title="Fable 5 reads the product and builds the full audience: psychographics, usage moments, objections, and the claims they need to hear"
                    className="w-full bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg py-2 transition-colors">
                    {autoAudienceLoading ? 'Fable 5 is building the audience… (~1 min)' : '✨ Generate Audience from Product'}
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className={labelCls}>Custom instructions (optional)</label>
              <textarea value={customInstructions} onChange={e => setCustomInstructions(e.target.value)} rows={2}
                placeholder="e.g. summer sale theme, green background, mention 40% off" className={inputCls} />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className={`${labelCls} mb-0`}>Templates ({templates.length}) — {templateIds.size} selected, 1 ad each</label>
              {templateIds.size > 0 && (
                <button onClick={() => setTemplateIds(new Set())} className="text-[11px] text-blue-400 hover:text-blue-300">clear</button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 max-h-96 overflow-y-auto pr-1">
              {templates.map(t => {
                const preview = t.template_data.preview_file
                  ? `/api/static-ads/templates/preview/${t.template_data.preview_file}`
                  : t.thumbnail_url;
                return (
                  <button key={t.id} onClick={() => setTemplateIds(prev => {
                    const next = new Set(prev);
                    if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                    return next;
                  })}
                    className={`relative rounded-lg overflow-hidden border-2 text-left transition-colors ${
                      templateIds.has(t.id) ? 'border-blue-500' : 'border-slate-700 hover:border-slate-500'
                    }`}>
                    <div className="aspect-square bg-slate-800 flex items-center justify-center">
                      {preview ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={preview} alt={t.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] text-slate-500 px-2 text-center">{t.template_data.aspect_ratio || '1:1'}</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-300 px-1.5 py-1 truncate">{t.name}</p>
                    {templateIds.has(t.id) && (
                      <div className="absolute top-1 right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center text-white text-[10px]">✓</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={generateImage} disabled={!ready || generating}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-medium rounded-lg py-3 transition-colors">
              {generating && progress
                ? `Generating ${Math.min(progress.done + 1, progress.total)}/${progress.total}…`
                : templateIds.size > 1 ? `Generate ${templateIds.size} Picture Ads` : 'Generate Picture Ad'}
            </button>
            <button onClick={previewCopy} disabled={!ready || copyLoading}
              className="bg-slate-800 border border-slate-700 hover:border-blue-500 disabled:opacity-40 text-slate-300 text-sm rounded-lg px-4 transition-colors">
              {copyLoading ? 'Writing…' : 'Preview Copy ×3'}
            </button>
          </div>
        </div>

        {/* ── Output column ── */}
        <div className="xl:col-span-3 space-y-5">
          {sessionImages.length > 0 && (
            <div className="bg-slate-900 border border-blue-800 rounded-xl p-4">
              <p className="text-xs text-slate-400 mb-2">
                This run — {sessionImages.length} ad{sessionImages.length > 1 ? 's' : ''}
                {generating && progress ? ` (${progress.total - sessionImages.length} more coming…)` : ''}
              </p>
              <div className={`grid gap-3 ${sessionImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-3'}`}>
                {sessionImages.map((img, i) => (
                  <a key={i} href={img.imageUrl} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.imageUrl} alt={img.template}
                      className={`rounded-lg mx-auto ${sessionImages.length === 1 ? 'max-h-[480px]' : 'w-full'}`} />
                    <p className="text-[10px] text-slate-400 mt-1 truncate">{img.template}</p>
                  </a>
                ))}
              </div>
            </div>
          )}

          {copyVariations.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className={labelCls}>Copy variations</p>
              <div className="grid gap-3 md:grid-cols-3">
                {copyVariations.map((v, i) => (
                  <div key={i} className="bg-slate-800 rounded-lg p-3 space-y-1.5">
                    {Object.entries(v).map(([zone, text]) => (
                      <div key={zone}>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">{zone}</p>
                        <p className="text-sm text-slate-200">{String(text)}</p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className={`${labelCls} mb-0`}>Generated ads ({totalAds} in {batches.length} batches)</p>
              <button onClick={downloadZip} disabled={!selectedIds.size || zipping}
                className="text-xs bg-slate-800 border border-slate-700 hover:border-blue-500 disabled:opacity-40 text-slate-300 rounded-lg px-3 py-1.5 transition-colors">
                {zipping ? 'Zipping…' : `Download ZIP (${selectedIds.size})`}
              </button>
            </div>
            {batches.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">No picture ads generated for this store yet.</p>
            ) : (
              <div className="space-y-2">
                {batches.map(b => {
                  const open = openBatches.has(b.key);
                  const batchIds = b.creatives.map(c => c.id);
                  const allSelected = batchIds.every(id => selectedIds.has(id));
                  return (
                    <div key={b.key} className="border border-slate-800 rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 bg-slate-800/60 px-3 py-2">
                        <button onClick={() => setOpenBatches(prev => {
                          const next = new Set(prev);
                          if (next.has(b.key)) next.delete(b.key); else next.add(b.key);
                          return next;
                        })} className="flex-1 flex items-center gap-2 text-left min-w-0">
                          <span className={`text-slate-500 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
                          <span className="text-sm text-slate-200 truncate">{b.productTitle}</span>
                          <span className="text-xs text-slate-500 truncate">· {b.audienceName}</span>
                          <span className="text-xs text-slate-500 whitespace-nowrap ml-auto pl-2">{b.date} · {b.creatives.length} ads</span>
                        </button>
                        <button onClick={() => setSelectedIds(prev => {
                          const next = new Set(prev);
                          if (allSelected) batchIds.forEach(id => next.delete(id));
                          else batchIds.forEach(id => next.add(id));
                          return next;
                        })} className="text-[11px] text-blue-400 hover:text-blue-300 whitespace-nowrap">
                          {allSelected ? 'unselect all' : 'select all'}
                        </button>
                      </div>
                      {open && (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-3">
                          {b.creatives.map(c => (
                            <div key={c.id}
                              className={`relative rounded-lg overflow-hidden border-2 cursor-pointer transition-colors ${
                                selectedIds.has(c.id) ? 'border-blue-500' : 'border-slate-800 hover:border-slate-600'
                              }`}
                              onClick={() => toggleSelect(c.id)}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={`${c.imageUrl}?w=300`} alt={c.title} loading="lazy"
                                className="w-full aspect-square object-cover" />
                              <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1 flex items-center gap-1">
                                <p className="text-[10px] text-slate-200 truncate flex-1">{c.templateName || c.title}</p>
                                <a href={c.imageUrl} target="_blank" rel="noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className="text-[10px] text-blue-400 hover:text-blue-300 whitespace-nowrap">full ↗</a>
                              </div>
                              {selectedIds.has(c.id) && (
                                <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs">✓</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
