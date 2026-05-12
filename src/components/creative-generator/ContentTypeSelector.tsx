'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { SetGenConfig } from './hooks/useGeneratorState';
import { enginesByContentType } from '@/lib/engine-metadata';

export interface ContentTypeSelectorProps {
  contentType: GeneratorConfig['contentType'];
  setGenConfig: SetGenConfig;
}

export function ContentTypeSelector({ contentType, setGenConfig }: ContentTypeSelectorProps) {
  return (
    <div>
      <label className="text-[10px] text-purple-400 uppercase font-bold mb-2 block">1. Content Type</label>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setGenConfig(c => ({
          ...c,
          contentType: 'video',
          contentMix: c.contentMix === 'image' ? 'video' : c.contentMix,
          // Reset engine to auto if currently set to an image-only engine
          engine: enginesByContentType('image', { includePseudo: false }).map(e => e.key).includes(c.engine) ? 'auto' : c.engine,
        }))}
          className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
            contentType === 'video' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
          }`}>
          Video<br /><span className="text-[8px] font-normal opacity-70">AI-generated video ads</span>
        </button>
        <button onClick={() => setGenConfig(c => ({
          ...c,
          contentType: 'image',
          contentMix: 'image',
          // Reset engine to 'nano-banana' (image-side default) if currently
          // set to a video-only engine. Was 'auto' before the gpt-image-2
          // integration; switched to 'nano-banana' so the EngineSelector
          // renders an active selection (auto isn't in UNLOCKED_IMAGE_ENGINES,
          // would render no highlighted button).
          engine: enginesByContentType('video').map(e => e.key).includes(c.engine) ? 'nano-banana' : c.engine,
        }))}
          className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-center ${
            contentType === 'image' ? 'bg-orange-600 border-orange-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
          }`}>
          Image<br /><span className="text-[8px] font-normal opacity-70">Static ad creatives</span>
        </button>
      </div>
    </div>
  );
}
