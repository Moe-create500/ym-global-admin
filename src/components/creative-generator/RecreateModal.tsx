'use client';

import type { Ad, Product } from '@/components/creative-generator/types';
import { enginesByContentType, ENGINE_METADATA } from '@/lib/engine-metadata';

export interface RecreateModalProps {
  recreateAd: Ad | null;
  setRecreateAd: React.Dispatch<React.SetStateAction<Ad | null>>;
  recreateProductId: string;
  setRecreateProductId: React.Dispatch<React.SetStateAction<string>>;
  recreateEngine: string;
  setRecreateEngine: React.Dispatch<React.SetStateAction<string>>;
  recreateDuration: string;
  setRecreateDuration: React.Dispatch<React.SetStateAction<string>>;
  recreating: boolean;
  products: Product[];
  onRecreate: () => void;
}

export function RecreateModal({
  recreateAd,
  setRecreateAd,
  recreateProductId,
  setRecreateProductId,
  recreateEngine,
  setRecreateEngine,
  recreateDuration,
  setRecreateDuration,
  recreating,
  products,
  onRecreate,
}: RecreateModalProps) {
  if (!recreateAd) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-green-900/50 rounded-xl p-6 w-full max-w-md">
        <h2 className="text-sm font-semibold text-white mb-1">Recreate from DNA</h2>
        <p className="text-[10px] text-slate-400 mb-4">
          Recreating: <span className="text-green-400">{recreateAd.adName}</span>
        </p>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] text-slate-400 uppercase font-semibold mb-1 block">Product</label>
            <select
              value={recreateProductId}
              onChange={e => setRecreateProductId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="">Select a product...</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.title} — ${(p.price_cents / 100).toFixed(2)}</option>
              ))}
            </select>
            {/* Product image preview */}
            {recreateProductId && (() => {
              const selProduct = products.find(p => p.id === recreateProductId);
              if (!selProduct) return null;
              const imgs: string[] = (() => {
                try { return selProduct.images ? JSON.parse(selProduct.images) : []; } catch { return []; }
              })();
              if (selProduct.image_url && !imgs.includes(selProduct.image_url)) imgs.unshift(selProduct.image_url);
              if (imgs.length === 0) return null;
              return (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {imgs.map((url, i) => (
                    <img key={i} src={url} alt="" className="w-14 h-14 rounded object-cover bg-slate-800 border border-slate-700 flex-shrink-0" />
                  ))}
                </div>
              );
            })()}
          </div>

          <div>
            <label className="text-[10px] text-slate-400 uppercase font-semibold mb-1 block">Engine</label>
            <div className="flex gap-2">
              {enginesByContentType('video', { includePseudo: false, includeHidden: true }).filter(e => ['veo', 'sora', 'minimax'].includes(e.key)).map(eng => (
                <button
                  key={eng.key}
                  onClick={() => {
                    setRecreateEngine(eng.key);
                    // Reset duration to engine max (per schema durationRange)
                    const defaultDur = ENGINE_METADATA[eng.key]?.durationRange?.[1] ?? 8;
                    setRecreateDuration(String(defaultDur));
                  }}
                  className={`flex-1 px-3 py-2 rounded-lg text-[10px] font-medium border ${
                    recreateEngine === eng.key
                      ? 'bg-green-600 border-green-500 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  {eng.label}<br />
                  <span className="text-[8px] opacity-60">{eng.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 uppercase font-semibold mb-1 block">Duration</label>
            <div className="flex gap-2">
              {(recreateEngine === 'sora' ? ['8', '16', '20'] : recreateEngine === 'veo' ? ['4', '6', '8'] : ['5', '6', '8', '10']).map(d => (
                <button
                  key={d}
                  onClick={() => setRecreateDuration(d)}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border ${
                    recreateDuration === d
                      ? 'bg-green-600 border-green-500 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  {d}s
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setRecreateAd(null)}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={onRecreate}
              disabled={!recreateProductId || recreating}
              className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg"
            >
              {recreating ? 'Recreating...' : 'Recreate Video'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
