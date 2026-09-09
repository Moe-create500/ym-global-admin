'use client';

// Shared primitives for financial account pages (Banking + Credit Cards).
// One implementation of the status pill so the truthfulness presentation
// can never drift between pages.

export interface Connection {
  status: 'HEALTHY' | 'SYNCING' | 'STALE' | 'DEGRADED' | 'ACTION_REQUIRED' | 'PENDING_DISCONNECT' | 'DISCONNECTED' | 'PROVIDER_OUTAGE' | 'ERROR' | 'UNKNOWN';
  reason: string;
  source: string;
  requiresUserAction: boolean;
  userActionType: string | null;
}

export interface Freshness {
  balance_verified_at: string | null;
  transactions_through: string | null;
  transactions_checked_at: string | null;
}

// Calm by default — red ONLY for proven user-action states
export const PILL: Record<string, { label: string; cls: string; dot: string }> = {
  HEALTHY: { label: 'Healthy', cls: 'bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400' },
  SYNCING: { label: 'Syncing', cls: 'bg-blue-500/10 text-blue-300', dot: 'bg-blue-400' },
  STALE: { label: 'Stale', cls: 'bg-amber-500/10 text-amber-300', dot: 'bg-amber-400' },
  DEGRADED: { label: 'Degraded', cls: 'bg-amber-500/10 text-amber-300', dot: 'bg-amber-400' },
  ACTION_REQUIRED: { label: 'Fix connection', cls: 'bg-red-500/10 text-red-300', dot: 'bg-red-400' },
  PENDING_DISCONNECT: { label: 'Repair soon', cls: 'bg-amber-500/10 text-amber-300', dot: 'bg-amber-400' },
  DISCONNECTED: { label: 'Disconnected', cls: 'bg-red-500/10 text-red-300', dot: 'bg-red-400' },
  PROVIDER_OUTAGE: { label: 'Bank outage', cls: 'bg-amber-500/10 text-amber-300', dot: 'bg-amber-400' },
  ERROR: { label: 'Sync error', cls: 'bg-amber-500/10 text-amber-300', dot: 'bg-amber-400' },
  UNKNOWN: { label: 'Unknown', cls: 'bg-slate-500/10 text-slate-300', dot: 'bg-slate-400' },
};

export function StatusPill({ c }: { c: Connection }) {
  const p = PILL[c.status] || PILL.UNKNOWN;
  return (
    <span title={c.reason} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${p.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${p.dot}`} />
      {p.label}
    </span>
  );
}

export function fmtCents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function timeAgoStr(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z');
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
