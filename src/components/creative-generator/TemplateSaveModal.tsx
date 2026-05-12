'use client';

import type { GeneratorConfig } from '@/components/creative-generator/types';
import type { UseWinnerTemplateModalStateReturn } from './hooks/useWinnerTemplateModalState';

export type TemplateSaveBadgeFields = Pick<
  GeneratorConfig,
  'contentType' | 'creativeType' | 'funnelStage' | 'hookStyle' | 'avatarStyle' | 'dimension' | 'platformTarget' | 'videoDuration'
>;

export interface TemplateSaveModalProps {
  winnerTemplateModal: UseWinnerTemplateModalStateReturn;
  genConfig: TemplateSaveBadgeFields;
  onSaveTemplate: () => void;
}

export function TemplateSaveModal({ winnerTemplateModal, genConfig, onSaveTemplate }: TemplateSaveModalProps) {
  const {
    showTemplateSave, setShowTemplateSave,
    templateName, setTemplateName,
  } = winnerTemplateModal;

  if (!showTemplateSave) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowTemplateSave(false)}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-white mb-4">Save Setup as Template</h3>
        <p className="text-xs text-slate-400 mb-4">Save your current generator settings as a reusable template.</p>
        <div className="mb-4">
          <label className="text-[10px] text-slate-500 uppercase font-semibold mb-1 block">Template Name</label>
          <input
            value={templateName}
            onChange={e => setTemplateName(e.target.value)}
            placeholder='e.g., "My 10/10 Meta Testimonial Template"'
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-600"
          />
        </div>
        <div className="mb-4 bg-slate-800/50 rounded-lg p-3">
          <p className="text-[10px] text-slate-500 uppercase mb-2">Settings to save:</p>
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{genConfig.contentType}</span>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{genConfig.creativeType}</span>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{genConfig.funnelStage.toUpperCase()}</span>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{genConfig.hookStyle}</span>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{genConfig.avatarStyle}</span>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{genConfig.dimension}</span>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{genConfig.platformTarget}</span>
            {genConfig.contentType === 'video' && <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{genConfig.videoDuration}s</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onSaveTemplate} disabled={!templateName.trim()}
            className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            Save Template
          </button>
          <button onClick={() => setShowTemplateSave(false)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm rounded-lg border border-slate-700">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
