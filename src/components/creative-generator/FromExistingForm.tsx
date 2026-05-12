// TODO (Phase 3B / data hygiene): this component takes handleGenerateMoreLikeThis as a prop — the first handler-as-prop pattern in the creative-generator extraction. The handler reaches into THREE state buckets: it calls setGenConfig (9-field cascade pre-filling from the winner record), setMatchedWinnerRef (a separate page-level useState), and setTab (the tab switcher). The wiring stays at the call site; this component just invokes the prop. Also: `winner` and `selectedExistingConcept` are typed `any` here because the underlying useStates at page.tsx:601 / page.tsx:610 are typed `any[]` and `any`. Tightening to a Winner schema (likely matching a row from the winners API at /api/creatives/winners) requires a type pass that touches the useStates, the fetch handler at page.tsx:688, and handleGenerateMoreLikeThis. Out of scope for pure extraction.
'use client';

export interface FromExistingFormProps {
  winners: any[];
  selectedExistingConcept: any;
  setSelectedExistingConcept: React.Dispatch<React.SetStateAction<any>>;
  handleGenerateMoreLikeThis: (winner: any) => void;
}

export function FromExistingForm({ winners, selectedExistingConcept, setSelectedExistingConcept, handleGenerateMoreLikeThis }: FromExistingFormProps) {
  return (
    <div className="mt-3 bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
      <label className="text-[10px] text-amber-400 uppercase font-bold mb-2 block">Select Concept</label>
      {winners.length === 0 ? (
        <p className="text-xs text-slate-500">No saved concepts yet. Generate first, then save winners.</p>
      ) : (
        <div className="space-y-1.5 max-h-32 overflow-y-auto">
          {winners.map(w => (
            <button key={w.id} onClick={() => { setSelectedExistingConcept(w); handleGenerateMoreLikeThis(w); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-[10px] transition-colors ${
                selectedExistingConcept?.id === w.id ? 'bg-amber-900/30 border border-amber-700' : 'bg-slate-800/50 hover:bg-slate-800'
              }`}>
              <div className="flex items-center gap-2">
                <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-500 text-black font-bold">W</span>
                <span className="text-white font-medium truncate">{w.title}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
