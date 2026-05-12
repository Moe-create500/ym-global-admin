// TODO (data hygiene): higgsStyle is typed `string` because the source useState at page.tsx:616 has no explicit generic. Tighten to the 7-key literal union ('product_showcase' | 'broll' | 'ugc' | 'cartoon' | 'asmr' | 'cinematic' | 'unboxing') when schemas/CreativeBrief.ts gains a HiggsfieldStyle enum. Tightening requires touching the useState declaration and the handleGeneratePackage reads at 1687/1701/1703 simultaneously — out of scope for a pure extraction.
'use client';

export interface HiggsfieldStylePresetsProps {
  higgsStyle: string;
  setHiggsStyle: React.Dispatch<React.SetStateAction<string>>;
}

export function HiggsfieldStylePresets({ higgsStyle, setHiggsStyle }: HiggsfieldStylePresetsProps) {
  return (
    <div className="bg-slate-900 border border-orange-900/50 rounded-xl p-4">
      <label className="text-[10px] text-orange-400 uppercase font-bold mb-2 block">Higgsfield Style</label>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {([
          { key: 'product_showcase', label: 'Product Showcase', icon: '📦' },
          { key: 'broll', label: 'B-Roll', icon: '🎬' },
          { key: 'ugc', label: 'UGC Style', icon: '📱' },
          { key: 'cartoon', label: 'Cartoon', icon: '🎨' },
          { key: 'asmr', label: 'ASMR', icon: '✨' },
          { key: 'cinematic', label: 'Cinematic', icon: '🎥' },
          { key: 'unboxing', label: 'Unboxing', icon: '📬' },
        ]).map(s => (
          <button key={s.key} onClick={() => setHiggsStyle(s.key)}
            className={`px-2 py-2 rounded-lg text-[10px] font-semibold border transition-colors text-center ${
              higgsStyle === s.key ? 'bg-orange-600 border-orange-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}>
            <span className="text-sm block">{s.icon}</span>{s.label}
          </button>
        ))}
      </div>
      <p className="text-[9px] text-orange-400/60 mt-2">Each style generates 3-4 sequential scenes that get stitched into one continuous video</p>
    </div>
  );
}
