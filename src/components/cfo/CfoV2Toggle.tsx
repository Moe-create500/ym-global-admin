'use client';
import { useEffect, useState } from 'react';

/** Settings switch for the CFO v2 surface (overview + section tabs).
 *  Off = the CFO page is exactly as before. No deploy needed either way. */
export function CfoV2Toggle() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch('/api/cfo/v2/flag').then(r => r.json()).then(j => setOn(!!j.enabled)).catch(() => setOn(false)); }, []);
  const flip = async () => {
    if (on == null) return;
    setBusy(true);
    try { const r = await fetch('/api/cfo/v2/flag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: !on }) }); const j = await r.json(); setOn(!!j.enabled); }
    finally { setBusy(false); }
  };
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-white">CFO Overview (v2)</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-[60ch]">Adds the Overview page and splits the CFO page into Position / P&amp;L / Money Flow &amp; Reconciliation / History tabs. Nothing is removed; switching it off restores the previous layout instantly.</p>
        </div>
        <button onClick={flip} disabled={busy || on == null} role="switch" aria-checked={!!on}
          className={`relative w-11 h-6 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-slate-700'} disabled:opacity-50`}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`} />
        </button>
      </div>
      {on && <a href="/dashboard/cfo/overview" className="inline-block mt-3 text-xs text-slate-300 hover:text-white underline underline-offset-4">Open the CFO Overview →</a>}
    </div>
  );
}
