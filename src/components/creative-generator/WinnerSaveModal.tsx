'use client';

import type { UseWinnerTemplateModalStateReturn } from './hooks/useWinnerTemplateModalState';

export interface WinnerSaveModalProps {
  winnerTemplateModal: UseWinnerTemplateModalStateReturn;
  onSaveAsWinner: (pkg: any, idx: number, creativeId?: string) => void;
}

export function WinnerSaveModal({ winnerTemplateModal, onSaveAsWinner }: WinnerSaveModalProps) {
  const {
    showWinnerModal, setShowWinnerModal,
    savingWinner,
    winnerNotes, setWinnerNotes,
  } = winnerTemplateModal;

  if (!showWinnerModal) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowWinnerModal(null)}>
      <div className="bg-slate-900 border border-amber-800/50 rounded-xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500 text-black font-bold">WINNER</span>
          <h3 className="text-lg font-semibold text-white">Save as Winner Reference</h3>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          This creative will be saved as a winner reference. The system will automatically use its DNA patterns
          when you generate with a similar setup in the future.
        </p>
        <div className="mb-4">
          <p className="text-sm text-white font-medium mb-1">{showWinnerModal.pkg?.title || 'Untitled'}</p>
          <p className="text-xs text-slate-500">{showWinnerModal.pkg?.angle || showWinnerModal.pkg?.conceptAngle || ''}</p>
        </div>
        <div className="mb-4">
          <label className="text-[10px] text-slate-500 uppercase font-semibold mb-1 block">Notes (optional)</label>
          <textarea
            value={winnerNotes}
            onChange={e => setWinnerNotes(e.target.value)}
            placeholder="Why is this a winner? What makes it special?"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-600 h-20 resize-none"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onSaveAsWinner(showWinnerModal.pkg, showWinnerModal.idx, showWinnerModal.creativeId)}
            disabled={!!savingWinner}
            className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
          >
            {savingWinner ? 'Saving...' : 'Save as Winner'}
          </button>
          <button onClick={() => setShowWinnerModal(null)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm rounded-lg border border-slate-700">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
