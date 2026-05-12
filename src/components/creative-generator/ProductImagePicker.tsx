'use client';

import type { GeneratorConfig, Product } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface ProductImagePickerProps {
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  productId: GeneratorConfig['productId'];
  coverImageUrl: GeneratorConfig['coverImageUrl'];
  setGenConfig: SetGenConfig;
}

export function ProductImagePicker({
  products,
  setProducts,
  productId,
  coverImageUrl,
  setGenConfig,
}: ProductImagePickerProps) {
  if (!productId) return null;
  const selProduct = products.find(p => p.id === productId);
  if (!selProduct) return null;

  const rawImgs: string[] = [];
  if (selProduct.image_url) rawImgs.push(selProduct.image_url);
  if (selProduct.images) {
    try { const parsed = JSON.parse(selProduct.images) as string[]; for (const u of parsed) { if (u && !rawImgs.includes(u)) rawImgs.push(u); } } catch {}
  }
  const allImgs = rawImgs.filter(u => {
    const lower = u.toLowerCase().split('?')[0];
    return !lower.endsWith('.svg');
  });
  const coverImg = coverImageUrl && allImgs.includes(coverImageUrl) ? coverImageUrl : allImgs[0] || '';

  // Add image handler — URL or file upload (internal helpers; close only over component cluster props)
  const handleAddImageUrl = async () => {
    const url = window.prompt('Paste an image URL (https://...)');
    if (!url || !url.trim()) return;
    const trimmed = url.trim();
    try {
      const res = await fetch('/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, imageUrl: trimmed }),
      });
      const data = await res.json();
      if (data.success) {
        // Update local product state so image appears immediately
        setProducts(prev => prev.map(p => {
          if (p.id !== productId) return p;
          const imgs: string[] = p.images ? JSON.parse(p.images) : [];
          if (!imgs.includes(trimmed)) imgs.push(trimmed);
          return { ...p, images: JSON.stringify(imgs) };
        }));
        setGenConfig(c => ({ ...c, coverImageUrl: trimmed }));
      } else {
        alert(data.error || 'Failed to add image');
      }
    } catch { alert('Failed to add image — network error'); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('productId', productId);
    formData.append('file', file);
    try {
      const res = await fetch('/api/products', { method: 'PATCH', body: formData });
      const data = await res.json();
      if (data.success && data.imageUrl) {
        setProducts(prev => prev.map(p => {
          if (p.id !== productId) return p;
          const imgs: string[] = p.images ? JSON.parse(p.images) : [];
          imgs.push(data.imageUrl);
          return { ...p, images: JSON.stringify(imgs) };
        }));
        setGenConfig(c => ({ ...c, coverImageUrl: data.imageUrl }));
      } else {
        alert(data.error || 'Upload failed');
      }
    } catch { alert('Upload failed — network error'); }
    e.target.value = '';
  };

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
      <div className="flex gap-3 mb-2">
        {coverImg ? (
          <img src={coverImg} alt="" className="w-16 h-16 rounded-lg object-cover border-2 border-purple-500 flex-shrink-0" />
        ) : (
          <div className="w-16 h-16 rounded-lg bg-slate-700 border-2 border-slate-600 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] text-slate-500">No img</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-white font-medium truncate">{selProduct.title}</p>
          <p className="text-[10px] text-purple-400 mt-0.5">Product reference image ({allImgs.length} available)</p>
        </div>
      </div>
      {/* Image grid */}
      <div className="grid grid-cols-6 gap-1.5 mb-2">
        {allImgs.map((url, i) => (
          <button key={i} onClick={() => setGenConfig(c => ({ ...c, coverImageUrl: url }))}
            className={`relative rounded-lg overflow-hidden border-2 aspect-square ${
              url === coverImg ? 'border-purple-500 ring-1 ring-purple-500/30' : 'border-slate-700 hover:border-purple-400'
            }`}>
            <img src={url} alt="" className="w-full h-full object-cover" />
            {url === coverImg && <div className="absolute inset-0 bg-purple-600/20 flex items-center justify-center"><svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></div>}
          </button>
        ))}
        {/* Add image button (in the grid) */}
        <label className="relative rounded-lg overflow-hidden border-2 border-dashed border-slate-600 hover:border-purple-400 aspect-square flex items-center justify-center cursor-pointer transition-colors">
          <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
        </label>
      </div>
      {/* Add via URL */}
      <button onClick={handleAddImageUrl}
        className="text-[9px] text-purple-400 hover:text-purple-300 underline">
        + Add image from URL
      </button>
    </div>
  );
}
