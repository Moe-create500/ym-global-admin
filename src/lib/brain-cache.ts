// The Brain's speed layer: payplan/health/truth are heavy computations
// (cashflow projection + balance-composition walks) that only change when
// data changes. Cache 60s; every write path drops the whole cache so the
// Brain is fast but never stale after an action.
const TTL_MS = 60_000;

function store(): Map<string, { at: number; data: any }> {
  const g = globalThis as any;
  if (!g.__brainCache) g.__brainCache = new Map();
  return g.__brainCache;
}

export function brainCached<T>(key: string, compute: () => T): T {
  const c = store();
  const hit = c.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T;
  const data = compute();
  c.set(key, { at: Date.now(), data });
  return data;
}

export function dropBrainCache() { store().clear(); }
