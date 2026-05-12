'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { ProductFoundation } from './hooks/useGeneratorTabState';

export interface ProductFoundationPanelProps {
  productId: GeneratorConfig['productId'];
  productFoundation: ProductFoundation | null;
  setProductFoundation: React.Dispatch<React.SetStateAction<ProductFoundation | null>>;
  showFoundation: boolean;
  setShowFoundation: React.Dispatch<React.SetStateAction<boolean>>;
  foundationSaving: boolean;
  onSaveFoundation: () => void;
}

export function ProductFoundationPanel({
  productId,
  productFoundation,
  setProductFoundation,
  showFoundation,
  setShowFoundation,
  foundationSaving,
  onSaveFoundation,
}: ProductFoundationPanelProps) {
  if (!productId) return null;

  return (
    <div className="bg-slate-800/30 border border-amber-900/30 rounded-lg overflow-hidden">
      <button onClick={() => setShowFoundation(!showFoundation)}
        className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-slate-800/50 transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-amber-400 uppercase font-bold">Product Foundation</span>
          {productFoundation?.beliefs && productFoundation.beliefs.filter(b => b.trim()).length > 0 && (
            <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">{productFoundation.beliefs.filter(b => b.trim()).length} beliefs</span>
          )}
        </div>
        <svg className={`w-3 h-3 text-slate-500 transition-transform ${showFoundation ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {showFoundation && productFoundation && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-800">
          <p className="text-[9px] text-slate-500 mt-2">What must the customer believe before buying? Each belief drives a different ad.</p>

          {/* Beliefs */}
          <div>
            <label className="text-[9px] text-amber-400 uppercase font-semibold mb-1 block">Necessary Beliefs (max 6)</label>
            {(productFoundation.beliefs.length === 0 ? [''] : productFoundation.beliefs).map((belief, bi) => (
              <div key={bi} className="flex gap-1 mb-1">
                <span className="text-[9px] text-slate-600 mt-1.5 w-3 flex-shrink-0">{bi + 1}.</span>
                <input value={belief} onChange={e => {
                  const newBeliefs = [...productFoundation.beliefs];
                  if (bi >= newBeliefs.length) newBeliefs.push('');
                  newBeliefs[bi] = e.target.value;
                  setProductFoundation({ ...productFoundation, beliefs: newBeliefs });
                }}
                  placeholder={`e.g. "I believe ${bi === 0 ? 'this product is different from what I\'ve tried' : bi === 1 ? 'natural ingredients work better' : 'this is worth the price'}"` }
                  className="flex-1 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[10px] text-white placeholder-slate-600" />
              </div>
            ))}
            {productFoundation.beliefs.length < 6 && (
              <button onClick={() => setProductFoundation({ ...productFoundation, beliefs: [...productFoundation.beliefs, ''] })}
                className="text-[9px] text-amber-400 hover:text-amber-300 mt-1">+ Add belief</button>
            )}
          </div>

          {/* Unique Mechanism */}
          <div>
            <label className="text-[9px] text-slate-500 uppercase mb-1 block">Unique Mechanism</label>
            <input value={productFoundation.uniqueMechanism} onChange={e => setProductFoundation({ ...productFoundation, uniqueMechanism: e.target.value })}
              placeholder="What makes this product different and proprietary? Why can't they get this elsewhere?"
              className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[10px] text-white placeholder-slate-600" />
          </div>

          {/* Offer Brief */}
          <div>
            <label className="text-[9px] text-slate-500 uppercase mb-1 block">Offer Brief</label>
            <textarea value={productFoundation.offerBrief} onChange={e => setProductFoundation({ ...productFoundation, offerBrief: e.target.value })}
              placeholder="What's the offer? What do they get? Why is it a no-brainer?"
              className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[10px] text-white placeholder-slate-600 resize-none h-10" />
          </div>

          {/* Save */}
          <button onClick={onSaveFoundation} disabled={foundationSaving}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-[9px] font-medium rounded">
            {foundationSaving ? 'Saving...' : 'Save Foundation'}
          </button>
        </div>
      )}
    </div>
  );
}
