// TODO (Phase 3B / data hygiene): the textarea's `value` masks the single-space sentinel to '' via `conceptAngle.trim() === '' ? '' : conceptAngle`. The sentinel is set by the GenModeSelector "My Angle" button (see encoding-hack TODO there) so that the picker's active-state styling can discriminate Auto Generate from My Angle on conceptAngle truthiness without ever showing the user a literal ' ' in the textarea. Both halves of this hack should disappear together when the genMode union gets a 'my_angle' literal or a separate angleMode discriminator. Out of scope for pure extraction.
'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';

export interface MyAngleFormProps {
  conceptAngle: GeneratorConfig['conceptAngle'];
  setGenConfig: SetGenConfig;
}

export function MyAngleForm({ conceptAngle, setGenConfig }: MyAngleFormProps) {
  return (
    <div className="mt-3">
      <textarea value={conceptAngle.trim() === '' ? '' : conceptAngle} onChange={e => setGenConfig(c => ({ ...c, conceptAngle: e.target.value }))}
        placeholder='Type your angle — e.g. "Sleep angle — people who struggle falling asleep" or "Before/after skin transformation"'
        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-600 resize-none h-14" autoFocus />
    </div>
  );
}
