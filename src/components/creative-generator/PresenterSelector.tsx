// TODO (Phase 3B / data hygiene): a constant with this same name is also exported from src/lib/creative-taxonomy.ts but as a different shape (Record<string, ...> vs the array used here). Reconcile during Phase 3B — likely consolidate to a single canonical source of truth in the taxonomy module.
'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

const AVATAR_STYLES = [
  { key: 'female_ugc', label: 'Female UGC' },
  { key: 'male_ugc', label: 'Male UGC' },
  { key: 'creator_influencer', label: 'Creator / Influencer' },
  { key: 'expert_authority', label: 'Expert / Authority' },
  { key: 'podcast_host', label: 'Podcast Host' },
  { key: 'faceless_product_only', label: 'Faceless / Product Only' },
] as const;

export interface PresenterSelectorProps {
  avatarStyle: GeneratorConfig['avatarStyle'];
  setGenConfig: SetGenConfig;
}

export function PresenterSelector({ avatarStyle, setGenConfig }: PresenterSelectorProps) {
  return (
    <div>
      <label className="text-[9px] text-slate-500 uppercase mb-1.5 block">Presenter</label>
      <div className="flex flex-wrap gap-1">
        {AVATAR_STYLES.map(a => (
          <button key={a.key} onClick={() => setGenConfig(c => ({ ...c, avatarStyle: a.key }))}
            className={`px-2 py-1 rounded text-[9px] font-medium border ${
              avatarStyle === a.key ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}>{a.label}</button>
        ))}
      </div>
    </div>
  );
}
