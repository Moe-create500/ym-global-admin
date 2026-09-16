'use client';

/** A money figure that shows what it is: the number, a small chip for
 *  anything that is not a fresh actual (estimated / manual / stale / partial),
 *  and "—" with the reason when the source is unknown. Clicking opens the
 *  drilldown for that figure. Unknown is never rendered as $0. */

export interface FigureDto {
  cents: number | null;
  kind: 'actual' | 'estimated' | 'manual' | 'derived' | 'stale' | 'missing';
  asOf: string | null;
  source: string;
  note?: string;
  trace: string;
  compare?: number | null;
  mixedAsOf?: boolean;
}

export const money = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function ageLabel(ts: string | null | undefined): string {
  if (!ts) return 'never';
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  const h = (Date.now() - d.getTime()) / 3_600_000;
  if (h < 1) return 'just now';
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const CHIP: Record<string, { label: string; cls: string }> = {
  estimated: { label: 'est.', cls: 'bg-sky-500/10 text-sky-300' },
  manual: { label: 'manual', cls: 'bg-violet-500/10 text-violet-300' },
  derived: { label: 'partial', cls: 'bg-slate-500/10 text-slate-300' },
  stale: { label: 'stale', cls: 'bg-amber-500/10 text-amber-300' },
};

export function FigureCell({ f, onTrace, align = 'right', size = 'md', showCompare = false, signed = false }: {
  f: FigureDto; onTrace?: (key: string) => void; align?: 'left' | 'right'; size?: 'md' | 'lg'; showCompare?: boolean; signed?: boolean;
}) {
  const clickable = !!onTrace;
  const title = [f.source, f.asOf ? `as of ${f.asOf}` : null, f.note].filter(Boolean).join(' · ');
  const chip = CHIP[f.kind];
  const num = size === 'lg' ? 'text-2xl font-semibold' : 'text-[13px] font-medium';
  const delta = showCompare && f.compare != null && f.cents != null ? f.cents - f.compare : null;
  return (
    <button type="button" disabled={!clickable} onClick={() => onTrace?.(f.trace)} title={title}
      className={`group inline-flex flex-col ${align === 'right' ? 'items-end' : 'items-start'} tabular-nums ${clickable ? 'cursor-pointer hover:underline decoration-slate-500 underline-offset-4' : 'cursor-default'}`}>
      {f.cents == null ? (
        <span className={`${num} text-slate-500`}>—</span>
      ) : (
        <span className={`${num} ${signed && f.cents < 0 ? 'text-red-300' : 'text-slate-100'}`}>{signed && f.cents > 0 ? '+' : ''}{money(f.cents)}</span>
      )}
      <span className="flex items-center gap-1 text-[10px] leading-4">
        {f.cents == null && <span className="text-slate-500 truncate max-w-[220px]" title={f.note}>{f.note ? f.note.split(' — ')[0] : 'unknown'}</span>}
        {chip && <span className={`px-1.5 rounded ${chip.cls}`}>{chip.label}{f.kind === 'stale' && f.asOf ? ` · ${ageLabel(f.asOf)}` : ''}</span>}
        {f.mixedAsOf && <span className="px-1.5 rounded bg-amber-500/10 text-amber-300" title="Adds values captured on different dates">mixed dates</span>}
        {delta != null && <span className={delta >= 0 ? 'text-emerald-400' : 'text-red-300'} title="vs the comparison period">{delta >= 0 ? '▲' : '▼'} {money(Math.abs(delta))}</span>}
      </span>
    </button>
  );
}
