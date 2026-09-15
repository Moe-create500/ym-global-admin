/** A reported number that carries its own provenance. "Unknown is not zero":
 *  a figure with no source has cents = null and kind = 'missing'; a figure
 *  whose source is older than its freshness threshold keeps its last-known
 *  value with kind = 'stale' and the timestamp it was true at. */

export type FigureKind = 'actual' | 'estimated' | 'manual' | 'derived' | 'stale' | 'missing';

export interface Figure {
  cents: number | null;
  kind: FigureKind;
  asOf: string | null;      // ISO / SQLite timestamp the value was true at
  source: string;           // human-readable source system
  note?: string;            // why it is estimated / manual / missing / stale
  trace: string;            // key for /api/cfo/v2/trace
  compare?: number | null;  // same figure for the comparison period (period figures only)
  mixedAsOf?: boolean;      // an aggregate that added values from different as-of dates
}

export const FRESH_HOURS = { bank: 36, pnl: 48, snapshot: 24 * 7, shopify: 36, ss: 36 } as const;

export function parseTs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const s = ts.includes('T') ? ts : ts.replace(' ', 'T') + (ts.length <= 10 ? 'T00:00:00' : '') + (ts.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(ts) ? '' : 'Z');
  const n = Date.parse(s);
  return Number.isNaN(n) ? null : n;
}

export function hoursSince(ts: string | null | undefined, now = Date.now()): number | null {
  const t = parseTs(ts);
  return t == null ? null : (now - t) / 3_600_000;
}

export function figure(partial: Omit<Figure, 'kind'> & { kind?: FigureKind; maxAgeHours?: number }, now = Date.now()): Figure {
  const { maxAgeHours, ...rest } = partial;
  let kind: FigureKind = partial.kind || 'actual';
  if (rest.cents == null) kind = 'missing';
  else if (maxAgeHours != null && kind !== 'manual') {
    const h = hoursSince(rest.asOf, now);
    if (h == null || h > maxAgeHours) kind = 'stale';
  }
  return { ...rest, kind };
}

export function missing(trace: string, source: string, note: string): Figure {
  return { cents: null, kind: 'missing', asOf: null, source, note, trace };
}

/** Add figures. Missing inputs make the total missing unless `partial` is
 *  allowed, in which case the total is marked derived and the note says how
 *  many inputs were unknown. Different as-of dates are flagged, never hidden. */
export function sumFigures(parts: Figure[], trace: string, source: string, opts: { partial?: boolean } = {}): Figure {
  const known = parts.filter(p => p.cents != null);
  if (!parts.length) return missing(trace, source, 'nothing in scope');
  if (known.length < parts.length && !opts.partial) return missing(trace, source, `${parts.length - known.length} of ${parts.length} inputs unknown`);
  const cents = known.reduce((s, p) => s + (p.cents || 0), 0);
  const asOfs = known.map(p => parseTs(p.asOf)).filter((n): n is number => n != null);
  const oldest = asOfs.length ? new Date(Math.min(...asOfs)).toISOString() : null;
  const spreadDays = asOfs.length ? (Math.max(...asOfs) - Math.min(...asOfs)) / 86_400_000 : 0;
  const kinds = new Set(known.map(p => p.kind));
  const kind: FigureKind = kinds.has('stale') ? 'stale' : kinds.has('estimated') ? 'estimated' : kinds.has('manual') ? 'manual' : known.length < parts.length ? 'derived' : 'actual';
  const compareKnown = known.filter(p => p.compare != null);
  return {
    cents, kind, asOf: oldest, source, trace,
    note: known.length < parts.length ? `${parts.length - known.length} of ${parts.length} inputs unknown — partial total` : undefined,
    compare: compareKnown.length === known.length && known.length ? compareKnown.reduce((s, p) => s + (p.compare || 0), 0) : null,
    mixedAsOf: spreadDays > 1,
  };
}
