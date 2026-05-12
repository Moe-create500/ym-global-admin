'use client';

export interface GenerationHistoryPanelProps {
  genHistory: any[];
  genHistoryLoading: boolean;
  viewingHistory: string | null;
  onLoadHistoryItem: (id: string) => void;
}

export function GenerationHistoryPanel({ genHistory, genHistoryLoading, viewingHistory, onLoadHistoryItem }: GenerationHistoryPanelProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h3 className="text-[10px] text-slate-400 uppercase font-semibold mb-3">Past Generations</h3>
      {genHistoryLoading ? (
        <div className="text-center py-4"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-500 mx-auto" /></div>
      ) : genHistory.length === 0 ? (
        <p className="text-[10px] text-slate-600 text-center py-3">No generations yet</p>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {genHistory.map(h => (
            <button key={h.id} onClick={() => onLoadHistoryItem(h.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-[10px] transition-colors ${
                viewingHistory === h.id ? 'bg-purple-900/30 border border-purple-800/50' : 'bg-slate-800/50 hover:bg-slate-800'
              }`}>
              <div className="flex justify-between items-center mb-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-white font-medium capitalize">{h.creative_type?.replace('-', ' ')}</span>
                  {h.version > 1 && <span className="px-1 py-0 rounded text-[8px] bg-purple-900/30 text-purple-400">v{h.version}</span>}
                  {h.parent_id && <span className="text-[8px] text-purple-400/60">variation</span>}
                </div>
                <span className={`px-1.5 py-0.5 rounded text-[8px] ${h.status === 'completed' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>{h.status}</span>
              </div>
              <div className="flex gap-2 text-slate-500">
                <span>{h.content_type}</span>
                <span>{h.funnel_stage?.toUpperCase()}</span>
                <span>×{h.quantity}</span>
                <span>{new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
