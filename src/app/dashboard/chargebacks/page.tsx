'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

interface Chargeback {
  id: string;
  store_id: string;
  store_name: string;
  shop_domain: string | null;
  dispute_id: string | null;
  order_number: string | null;
  chargeback_date: string;
  amount_cents: number;
  reason: string | null;
  status: string;
  chargeflow_fee_cents: number;
  source: string;
  notes: string | null;
  dispute_type: string | null;
  raw_status: string | null;
  evidence_due_by: string | null;
  workflow_status: string | null;
  response_notes: string | null;
  handled_at: string | null;
  response_workflow_id: string | null;
}

interface ResponseWorkflow {
  id: string;
  name: string;
  description: string | null;
  is_active: number;
  used_count: number;
  won_count: number;
  lost_count: number;
  template_json: string | null;
  match_reasons: string | null;
}

// Shopify Dispute Evidence API — the exact text fields we're allowed to submit
const EVIDENCE_FIELDS = [
  { key: 'uncategorized_text', label: 'Response Narrative', hint: 'The main free-form argument the bank reads' },
  { key: 'product_description', label: 'Product Description', hint: 'What was bought, price, quantity' },
  { key: 'refund_refusal_explanation', label: 'Refund Refusal Explanation', hint: 'Why a refund was not owed' },
  { key: 'cancellation_rebuttal', label: 'Cancellation Rebuttal', hint: 'Why the "canceled" claim is wrong' },
  { key: 'access_activity_log', label: 'Access / Activity Log', hint: 'Proof the customer used the product or account' },
] as const;

const EVIDENCE_FILES = [
  { key: 'shipping_documentation', label: 'Shipping documentation' },
  { key: 'customer_communication', label: 'Customer communication' },
  { key: 'refund_policy', label: 'Refund policy' },
  { key: 'cancellation_policy', label: 'Cancellation policy' },
  { key: 'service_documentation', label: 'Service documentation' },
  { key: 'response_summary', label: 'Response summary' },
] as const;

const TEMPLATE_VARS = ['store_name', 'order_number', 'order_date', 'amount', 'reason', 'customer_name', 'customer_email', 'tracking_number', 'carrier', 'shipping_date', 'tracking_url', 'line_items', 'shipping_address'];

const MATCHABLE_REASONS = ['fraudulent', 'unrecognized', 'product_not_received', 'product_unacceptable', 'credit_not_processed', 'duplicate', 'subscription_canceled', 'general'];

const PIPELINE_NODES = [
  { icon: '📥', title: 'Dispute In', sub: 'auto-detected by sync' },
  { icon: '🧾', title: 'Order Data', sub: 'customer + tracking pulled live' },
  { icon: '✍️', title: 'Evidence Draft', sub: 'templates auto-filled' },
  { icon: '📎', title: 'Files', sub: 'attach in Shopify' },
  { icon: '👀', title: 'Review', sub: 'you approve' },
  { icon: '🚀', title: 'Submit', sub: 'in Shopify admin' },
  { icon: '🏆', title: 'Outcome', sub: 'win/loss auto-tracked' },
] as const;

const cents = (c: number) =>
  `$${((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const REASON_LABELS: Record<string, string> = {
  fraudulent: 'Fraudulent',
  unrecognized: 'Unrecognized charge',
  duplicate: 'Duplicate charge',
  subscription_canceled: 'Subscription canceled',
  product_unacceptable: 'Product unacceptable',
  product_not_received: 'Product not received',
  credit_not_processed: 'Credit not processed',
  incorrect_account_details: 'Incorrect account details',
  insufficient_funds: 'Insufficient funds',
  customer_initiated: 'Customer initiated',
  debit_not_authorized: 'Debit not authorized',
  general: 'General',
  dispute: 'Dispute',
};
const reasonLabel = (r: string | null) => {
  if (!r) return '—';
  const k = r.toLowerCase().trim();
  if (REASON_LABELS[k]) return REASON_LABELS[k];
  return k.replace(/_/g, ' ').replace(/^\w/, ch => ch.toUpperCase());
};

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-amber-500/15 text-amber-400 border-amber-600/40',
  won: 'bg-emerald-500/15 text-emerald-400 border-emerald-600/40',
  lost: 'bg-red-500/15 text-red-400 border-red-600/40',
  refunded: 'bg-slate-500/20 text-slate-300 border-slate-600',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLE[status] || STATUS_STYLE.open;
  return (
    <span className={`inline-block px-2.5 py-1 rounded-full border text-xs font-semibold capitalize ${cls}`}>
      {status}
    </span>
  );
}

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const due = new Date(`${date}T00:00:00`);
  return Math.round((due.getTime() - now.getTime()) / 86400000);
}

function DueBadge({ dueBy }: { dueBy: string | null }) {
  const d = daysUntil(dueBy);
  if (d === null) return <span className="text-slate-600 text-xs">no deadline</span>;
  const cls = d < 0 ? 'bg-red-600 text-white'
    : d <= 3 ? 'bg-amber-500 text-black'
    : 'bg-slate-700 text-slate-200';
  const label = d < 0 ? `${-d}d overdue` : d === 0 ? 'Due today' : `${d} days left`;
  return (
    <div>
      <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-bold ${cls}`}>{label}</span>
      <p className="text-[11px] text-slate-500 mt-1">{dueBy}</p>
    </div>
  );
}

const PRESETS = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: 'ytd', label: 'This Year', days: null },
  { key: 'all', label: 'All Time', days: null },
] as const;

function presetFrom(key: string): string {
  const p = PRESETS.find(x => x.key === key);
  if (!p || key === 'all') return '';
  if (key === 'ytd') return `${new Date().getFullYear()}-01-01`;
  const d = new Date(); d.setDate(d.getDate() - (p.days as number));
  return d.toISOString().slice(0, 10);
}

const WF_STAGES = [
  { key: 'new', label: 'Not started' },
  { key: 'responding', label: 'Working on it' },
  { key: 'submitted', label: 'Response submitted' },
] as const;

interface TrendPoint { label: string; won: number; lost: number; rate: number }

function WinRateChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-slate-500">No resolved disputes in this range yet.</p>;
  }
  const W = 900, H = 210, PAD = 34, BOT = 34;
  const plotH = H - PAD - BOT;
  const bw = (W - PAD * 2) / points.length;
  const maxVol = Math.max(...points.map(p => p.won + p.lost), 1);
  const y = (rate: number) => PAD + ((100 - rate) / 100) * plotH;
  const line = points.map((p, i) => `${PAD + bw * i + bw / 2},${y(p.rate)}`).join(' ');
  const labelStep = Math.max(1, Math.ceil(points.length / 12));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Win rate trend">
      {[0, 25, 50, 75, 100].map(g => (
        <g key={g}>
          <line x1={PAD} x2={W - PAD} y1={y(g)} y2={y(g)}
            stroke={g === 50 ? '#64748b' : '#1e293b'} strokeWidth={1} strokeDasharray={g === 50 ? '5 4' : undefined} />
          <text x={PAD - 6} y={y(g) + 3} textAnchor="end" fontSize={10} fill="#64748b">{g}%</text>
        </g>
      ))}
      {points.map((p, i) => {
        const vol = p.won + p.lost;
        const vh = (vol / maxVol) * plotH * 0.85;
        return (
          <g key={p.label}>
            <rect x={PAD + bw * i + bw * 0.2} y={H - BOT - vh} width={bw * 0.6} height={vh}
              fill="#334155" opacity={0.5} rx={2}>
              <title>{p.label}: {p.won} won / {p.lost} lost ({p.rate.toFixed(0)}%)</title>
            </rect>
            {i % labelStep === 0 && (
              <text x={PAD + bw * i + bw / 2} y={H - BOT + 14} textAnchor="middle" fontSize={9} fill="#64748b">
                {p.label.length > 7 ? p.label.slice(5) : p.label}
              </text>
            )}
            <text x={PAD + bw * i + bw / 2} y={H - BOT + 26} textAnchor="middle" fontSize={9} fill="#475569">{vol}</text>
          </g>
        );
      })}
      <polyline points={line} fill="none" stroke="#10b981" strokeWidth={2.5} strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={p.label} cx={PAD + bw * i + bw / 2} cy={y(p.rate)} r={4}
          fill={p.rate >= 50 ? '#10b981' : '#ef4444'} stroke="#0f172a" strokeWidth={1.5}>
          <title>{p.label}: {p.rate.toFixed(0)}% ({p.won}W/{p.lost}L)</title>
        </circle>
      ))}
    </svg>
  );
}

export default function ChargebacksPage() {
  const [rows, setRows] = useState<Chargeback[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const [preset, setPreset] = useState('30d');
  const [fromDate, setFromDate] = useState(presetFrom('30d'));
  const [toDate, setToDate] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [workflows, setWorkflows] = useState<ResponseWorkflow[]>([]);
  const [newWfName, setNewWfName] = useState('');
  const [view, setView] = useState<'disputes' | 'workflows'>('disputes');
  const [editingWf, setEditingWf] = useState<string | null>(null);
  const [tplDraft, setTplDraft] = useState<any>({});
  const [reasonsDraft, setReasonsDraft] = useState<string[]>([]);
  const [savingTpl, setSavingTpl] = useState(false);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [draftMsg, setDraftMsg] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [r, w] = await Promise.all([
        fetch('/api/chargebacks'),
        fetch('/api/chargebacks/workflows'),
      ]);
      const d = await r.json();
      const wd = await w.json();
      setRows(d.chargebacks || []);
      setWorkflows(wd.workflows || []);
    } catch { /* keep last data */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const pickPreset = (key: string) => {
    setPreset(key);
    setFromDate(presetFrom(key));
    setToDate('');
  };

  const handleSync = async () => {
    setSyncing(true); setSyncNote('');
    try {
      const r = await fetch('/api/chargebacks/sync-shopify', { method: 'POST' });
      const d = await r.json();
      setSyncNote(r.ok ? `Synced ${d.stores} stores` : (d.error || 'Sync failed'));
    } catch (e: any) { setSyncNote(e?.message || 'Sync failed'); }
    setSyncing(false);
    load();
  };

  const patch = async (id: string, payload: any, optimistic: Partial<Chargeback>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...optimistic } : r));
    await fetch('/api/chargebacks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...payload }),
    });
    load();
  };

  const stores = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach(r => m.set(r.store_id, r.store_name));
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  // Date range + store filter applied to stats and history (NOT the action
  // queue — an open dispute needs handling no matter when it was opened).
  const inRange = useCallback((r: Chargeback) => {
    if (fromDate && r.chargeback_date < fromDate) return false;
    if (toDate && r.chargeback_date > toDate) return false;
    return true;
  }, [fromDate, toDate]);

  const ranged = useMemo(() =>
    rows.filter(inRange).filter(r => !storeFilter || r.store_id === storeFilter),
  [rows, inRange, storeFilter]);

  const openQueue = useMemo(() =>
    rows.filter(r => r.status === 'open')
      .filter(r => !storeFilter || r.store_id === storeFilter)
      .sort((a, b) => (a.evidence_due_by || '9999').localeCompare(b.evidence_due_by || '9999')),
  [rows, storeFilter]);

  const stats = useMemo(() => {
    const s = { open: 0, openCents: 0, won: 0, wonCents: 0, lost: 0, lostCents: 0, refunded: 0, total: ranged.length };
    for (const r of ranged) {
      if (r.status === 'open') { s.open++; s.openCents += r.amount_cents; }
      else if (r.status === 'won') { s.won++; s.wonCents += r.amount_cents; }
      else if (r.status === 'lost') { s.lost++; s.lostCents += r.amount_cents; }
      else if (r.status === 'refunded') s.refunded++;
    }
    return s;
  }, [ranged]);
  const winRate = (stats.won + stats.lost) > 0 ? (stats.won / (stats.won + stats.lost)) * 100 : 0;
  const overdue = openQueue.filter(r => { const d = daysUntil(r.evidence_due_by); return d !== null && d < 0; }).length;

  // Per-store performance within the selected date range
  const storeStats = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of rows.filter(inRange)) {
      let s = m.get(r.store_id);
      if (!s) { s = { store_id: r.store_id, store_name: r.store_name, total: 0, open: 0, won: 0, lost: 0, openCents: 0, lostCents: 0 }; m.set(r.store_id, s); }
      s.total++;
      if (r.status === 'open') { s.open++; s.openCents += r.amount_cents; }
      else if (r.status === 'won') s.won++;
      else if (r.status === 'lost') { s.lost++; s.lostCents += r.amount_cents; }
    }
    return Array.from(m.values())
      .map(s => ({ ...s, winRate: (s.won + s.lost) > 0 ? (s.won / (s.won + s.lost)) * 100 : null }))
      .sort((a, b) => b.total - a.total);
  }, [rows, inRange]);

  const historyRows = useMemo(() =>
    ranged.filter(r => !statusFilter || r.status === statusFilter)
      .sort((a, b) => b.chargeback_date.localeCompare(a.chargeback_date)),
  [ranged, statusFilter]);

  // Win-rate trend: weekly buckets for short ranges, monthly for long ones
  const trend = useMemo<TrendPoint[]>(() => {
    const resolved = ranged.filter(r => r.status === 'won' || r.status === 'lost');
    if (!resolved.length) return [];
    const dates = resolved.map(r => r.chargeback_date).sort();
    const spanDays = (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / 86400000;
    const weekly = spanDays <= 120;
    const bucketOf = (d: string) => {
      if (!weekly) return d.slice(0, 7);
      const dt = new Date(`${d}T00:00:00`);
      dt.setDate(dt.getDate() - dt.getDay());
      return dt.toISOString().slice(0, 10);
    };
    const m = new Map<string, { won: number; lost: number }>();
    for (const r of resolved) {
      const k = bucketOf(r.chargeback_date);
      const b = m.get(k) || { won: 0, lost: 0 };
      if (r.status === 'won') b.won++; else b.lost++;
      m.set(k, b);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ label: k, ...v, rate: (v.won / (v.won + v.lost)) * 100 }));
  }, [ranged]);

  const wfName = useMemo(() => new Map(workflows.map(w => [w.id, w.name])), [workflows]);
  const activeWorkflows = useMemo(() => workflows.filter(w => w.is_active), [workflows]);

  // Intelligence: outcomes per reason, and which playbook wins for each reason
  const reasonStats = useMemo(() => {
    const m = new Map<string, { reason: string; won: number; lost: number; byWf: Map<string, { won: number; lost: number }> }>();
    for (const r of ranged) {
      if (r.status !== 'won' && r.status !== 'lost') continue;
      const key = reasonLabel(r.reason);
      let s = m.get(key);
      if (!s) { s = { reason: key, won: 0, lost: 0, byWf: new Map() }; m.set(key, s); }
      if (r.status === 'won') s.won++; else s.lost++;
      if (r.response_workflow_id) {
        const w = s.byWf.get(r.response_workflow_id) || { won: 0, lost: 0 };
        if (r.status === 'won') w.won++; else w.lost++;
        s.byWf.set(r.response_workflow_id, w);
      }
    }
    return Array.from(m.values()).map(s => {
      let best: { wfId: string; rate: number; n: number } | null = null;
      for (const [wfId, v] of Array.from(s.byWf.entries())) {
        const n = v.won + v.lost;
        if (n < 2) continue; // need at least 2 outcomes before calling a winner
        const rate = (v.won / n) * 100;
        if (!best || rate > best.rate) best = { wfId, rate, n };
      }
      const total = s.won + s.lost;
      return { ...s, total, rate: (s.won / total) * 100, best };
    }).sort((a, b) => b.total - a.total);
  }, [ranged]);

  // Playbook performance within the selected range
  const wfStats = useMemo(() => {
    const m = new Map<string, { won: number; lost: number; open: number }>();
    for (const r of ranged) {
      if (!r.response_workflow_id) continue;
      const s = m.get(r.response_workflow_id) || { won: 0, lost: 0, open: 0 };
      if (r.status === 'won') s.won++;
      else if (r.status === 'lost') s.lost++;
      else if (r.status === 'open') s.open++;
      m.set(r.response_workflow_id, s);
    }
    return workflows
      .map(w => {
        const s = m.get(w.id) || { won: 0, lost: 0, open: 0 };
        const n = s.won + s.lost;
        return { ...w, ...s, outcomes: n, rate: n > 0 ? (s.won / n) * 100 : null };
      })
      .filter(w => w.is_active || w.outcomes > 0)
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
  }, [ranged, workflows]);

  const addWorkflow = async () => {
    const name = newWfName.trim();
    if (!name) return;
    setNewWfName('');
    await fetch('/api/chargebacks/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    load();
  };

  const setPlaybook = (r: Chargeback, wfId: string) => {
    const payload: any = { responseWorkflowId: wfId || null };
    const optimistic: Partial<Chargeback> = { response_workflow_id: wfId || null };
    // Picking a playbook on an untouched dispute means work has started
    if (wfId && (r.workflow_status || 'new') === 'new') {
      payload.workflowStatus = 'responding';
      optimistic.workflow_status = 'responding';
    }
    patch(r.id, payload, optimistic);
  };

  const openEditor = (w: ResponseWorkflow) => {
    setEditingWf(w.id);
    try { setTplDraft(w.template_json ? JSON.parse(w.template_json) : {}); } catch { setTplDraft({}); }
    try { setReasonsDraft(w.match_reasons ? JSON.parse(w.match_reasons) : []); } catch { setReasonsDraft([]); }
  };

  const saveTemplate = async () => {
    if (!editingWf) return;
    setSavingTpl(true);
    await fetch('/api/chargebacks/workflows', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editingWf, templateJson: tplDraft, matchReasons: reasonsDraft }),
    });
    setSavingTpl(false);
    setEditingWf(null);
    load();
  };

  const draftEvidence = async (r: Chargeback) => {
    if (!r.response_workflow_id) return;
    setDrafting(r.id);
    setDraftMsg(p => ({ ...p, [r.id]: '' }));
    try {
      const res = await fetch('/api/chargebacks/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chargebackId: r.id }),
      });
      const d = await res.json();
      setDraftMsg(p => ({ ...p, [r.id]: res.ok ? `✓ Drafted ${Object.keys(d.drafted).length} fields — review in Shopify` : `✗ ${d.error}` }));
      if (res.ok) load();
    } catch (e: any) {
      setDraftMsg(p => ({ ...p, [r.id]: `✗ ${e?.message || 'failed'}` }));
    }
    setDrafting(null);
  };

  const tplConfigured = (w: ResponseWorkflow) => {
    try {
      const t = w.template_json ? JSON.parse(w.template_json) : {};
      return EVIDENCE_FIELDS.some(f => (t[f.key] || '').trim());
    } catch { return false; }
  };

  const shopifyLink = (r: Chargeback) =>
    r.source === 'shopify_api' && r.shop_domain && r.dispute_id
      ? `https://${r.shop_domain}/admin/payments/disputes/${r.dispute_id}` : null;

  // 📋 Evidence pack viewer — the dispute_evidences API scope is not grantable
  // to custom apps, so the pack is built server-side and pasted into the
  // Shopify dispute form by hand.
  const [evidFor, setEvidFor] = useState<Chargeback | null>(null);
  const [evidData, setEvidData] = useState<any>(null);
  const [evidLoading, setEvidLoading] = useState<string | null>(null);
  const [copied, setCopied] = useState<string>('');
  const openEvidence = async (r: Chargeback) => {
    setEvidLoading(r.id); setEvidData(null); setEvidFor(r); setCopied('');
    try {
      const res = await fetch(`/api/chargebacks/auto?chargebackId=${r.id}`);
      const d = await res.json();
      setEvidData(res.ok ? d : { error: d.error || 'failed to build evidence' });
    } catch (e: any) {
      setEvidData({ error: e?.message || 'failed to build evidence' });
    }
    setEvidLoading(null);
  };
  const copyText = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(c => (c === key ? '' : c)), 1500);
  };
  const EVID_LABELS: Record<string, string> = {
    uncategorized_text: 'Additional evidence (main narrative)',
    product_description: 'Product description',
    shipping_tracking_number: 'Tracking number',
    shipping_carrier: 'Shipping carrier',
    shipping_date: 'Shipping date',
    shipping_address: 'Shipping address',
    billing_address: 'Billing address',
    customer_email_address: 'Customer email',
    customer_first_name: 'Customer first name',
    customer_last_name: 'Customer last name',
    customer_purchase_ip: 'Customer purchase IP',
    access_activity_log: 'Activity log',
    refund_policy_disclosure: 'Refund policy disclosure',
    refund_refusal_explanation: 'Refund refusal explanation',
    cancellation_policy_disclosure: 'Cancellation policy disclosure',
    cancellation_rebuttal: 'Cancellation rebuttal',
  };

  return (
    <div className="p-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white">Chargebacks</h1>
          <p className="text-sm text-slate-400 mt-1">Every dispute, every store — handle it before the deadline.</p>
        </div>
        <div className="flex items-center gap-3">
          {syncNote && <span className="text-xs text-slate-400">{syncNote}</span>}
          <button onClick={handleSync} disabled={syncing}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {syncing ? 'Syncing…' : 'Sync All Stores'}
          </button>
        </div>
      </div>

      {/* View slide: Disputes ⇄ Defense Workflows */}
      <div className="relative inline-flex bg-slate-900 border border-slate-800 rounded-xl p-1 mb-5">
        <div className={`absolute top-1 bottom-1 rounded-lg bg-blue-600 transition-transform duration-300 ease-out ${view === 'workflows' ? 'translate-x-full' : ''}`}
          style={{ left: 4, width: 'calc(50% - 4px)' }} />
        <button onClick={() => setView('disputes')}
          className={`relative z-10 w-48 py-2 text-sm font-semibold rounded-lg transition-colors ${view === 'disputes' ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}>
          🛡 Disputes
        </button>
        <button onClick={() => setView('workflows')}
          className={`relative z-10 w-48 py-2 text-sm font-semibold rounded-lg transition-colors ${view === 'workflows' ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}>
          ⚙️ Defense Workflows
        </button>
      </div>

      {view === 'workflows' && (
        <div>
          {/* What Shopify lets us submit */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-5">
            <h3 className="text-sm font-medium text-white mb-1">The Shopify Dispute Evidence API — what a response can contain</h3>
            <p className="text-xs text-slate-400 mb-3">Each playbook below is a template for these exact fields. Draft fills them with live order data; you review and submit in Shopify.</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {EVIDENCE_FIELDS.map(f => (
                <span key={f.key} className="px-2 py-1 bg-blue-500/10 text-blue-300 border border-blue-800/50 rounded text-[11px]" title={f.hint}>{f.label}</span>
              ))}
              <span className="px-2 py-1 bg-slate-800 text-slate-400 border border-slate-700 rounded text-[11px]">Customer name + email (auto)</span>
              <span className="px-2 py-1 bg-slate-800 text-slate-400 border border-slate-700 rounded text-[11px]">Tracking per fulfillment (auto)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {EVIDENCE_FILES.map(f => (
                <span key={f.key} className="px-2 py-1 bg-violet-500/10 text-violet-300 border border-violet-800/50 rounded text-[11px]">📎 {f.label}</span>
              ))}
            </div>
          </div>

          {/* Playbook pipelines */}
          {workflows.filter(w => w.is_active).map(w => {
            const configured = tplConfigured(w);
            let files: string[] = [];
            let reasons: string[] = [];
            try { files = w.template_json ? (JSON.parse(w.template_json).files || []) : []; } catch { /* none */ }
            try { reasons = w.match_reasons ? JSON.parse(w.match_reasons) : []; } catch { /* none */ }
            const outcomes = w.won_count + w.lost_count;
            const rate = outcomes > 0 ? (w.won_count / outcomes) * 100 : null;
            return (
              <div key={w.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-4">
                <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-white">{w.name}</h3>
                    {rate !== null && (
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${rate >= 50 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                        {rate.toFixed(0)}% win · {outcomes} resolved
                      </span>
                    )}
                    {reasons.length > 0 && (
                      <span className="text-[11px] text-slate-500">auto-match: {reasons.map(reasonLabel).join(', ')}</span>
                    )}
                  </div>
                  <button onClick={() => editingWf === w.id ? setEditingWf(null) : openEditor(w)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors">
                    {editingWf === w.id ? 'Close' : 'Edit Templates'}
                  </button>
                </div>

                {/* Pipeline — same visual language as Launch Flow */}
                <div className="px-4 py-4 flex items-center gap-2 overflow-x-auto">
                  {PIPELINE_NODES.map((n, i) => {
                    const ring =
                      n.title === 'Evidence Draft' ? (configured ? 'border-emerald-500' : 'border-amber-500 animate-pulse')
                      : n.title === 'Files' ? (files.length ? 'border-emerald-500' : 'border-slate-700')
                      : n.title === 'Review' || n.title === 'Submit' ? 'border-slate-600'
                      : 'border-emerald-500';
                    const badge =
                      n.title === 'Evidence Draft' ? (configured ? 'templates ready' : 'needs templates')
                      : n.title === 'Files' ? (files.length ? `${files.length} to attach` : 'none set')
                      : n.title === 'Review' || n.title === 'Submit' ? 'manual'
                      : 'live';
                    return (
                      <div key={n.title} className="flex items-center gap-2 flex-shrink-0">
                        <div className={`w-[130px] rounded-xl border-2 bg-slate-950/60 px-2.5 py-2 ${ring}`}>
                          <div className="flex items-center gap-1.5">
                            <span className="text-base">{n.icon}</span>
                            <span className="text-[11px] font-semibold text-white">{n.title}</span>
                          </div>
                          <p className="text-[9px] text-slate-500 mt-0.5 leading-tight">{n.sub}</p>
                          <p className={`text-[9px] mt-1 uppercase tracking-wider ${
                            badge === 'live' || badge === 'templates ready' || badge.endsWith('to attach') ? 'text-emerald-400'
                            : badge === 'needs templates' ? 'text-amber-400' : 'text-slate-500'
                          }`}>{badge}</p>
                        </div>
                        {i < PIPELINE_NODES.length - 1 && <span className="text-slate-600 text-lg">→</span>}
                      </div>
                    );
                  })}
                </div>

                {/* Template editor */}
                {editingWf === w.id && (
                  <div className="border-t border-slate-800 px-4 py-4 bg-slate-950/40">
                    <div className="mb-3">
                      <p className="text-xs font-medium text-slate-300 mb-1.5">Auto-match reasons <span className="text-slate-500 font-normal">— disputes with these reasons suggest this playbook</span></p>
                      <div className="flex flex-wrap gap-1.5">
                        {MATCHABLE_REASONS.map(rs => (
                          <button key={rs}
                            onClick={() => setReasonsDraft(p => p.includes(rs) ? p.filter(x => x !== rs) : [...p, rs])}
                            className={`px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                              reasonsDraft.includes(rs) ? 'bg-blue-600/20 text-blue-300 border-blue-700' : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'
                            }`}>
                            {reasonLabel(rs)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-3 mb-3">
                      {EVIDENCE_FIELDS.map(f => (
                        <div key={f.key} className={f.key === 'uncategorized_text' ? 'md:col-span-2' : ''}>
                          <p className="text-xs font-medium text-slate-300">{f.label} <span className="text-slate-500 font-normal">— {f.hint}</span></p>
                          <textarea rows={f.key === 'uncategorized_text' ? 5 : 3}
                            value={tplDraft[f.key] || ''}
                            onChange={e => setTplDraft((p: any) => ({ ...p, [f.key]: e.target.value }))}
                            placeholder={`Use variables like {{order_number}}, {{tracking_number}}, {{customer_name}}…`}
                            className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono" />
                        </div>
                      ))}
                    </div>

                    <div className="mb-3">
                      <p className="text-xs font-medium text-slate-300 mb-1.5">Files to attach <span className="text-slate-500 font-normal">— checklist shown when drafting (attach in Shopify)</span></p>
                      <div className="flex flex-wrap gap-1.5">
                        {EVIDENCE_FILES.map(f => {
                          const on = (tplDraft.files || []).includes(f.key);
                          return (
                            <button key={f.key}
                              onClick={() => setTplDraft((p: any) => ({ ...p, files: on ? (p.files || []).filter((x: string) => x !== f.key) : [...(p.files || []), f.key] }))}
                              className={`px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                                on ? 'bg-violet-600/20 text-violet-300 border-violet-700' : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'
                              }`}>
                              📎 {f.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-slate-500">
                        Variables: {TEMPLATE_VARS.map(v => `{{${v}}}`).join(' ')}
                      </p>
                      <button onClick={saveTemplate} disabled={savingTpl}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors">
                        {savingTpl ? 'Saving…' : 'Save Playbook'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex gap-2 mt-4 max-w-md">
            <input type="text" placeholder="New playbook name…"
              value={newWfName} onChange={e => setNewWfName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addWorkflow(); }}
              className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-violet-500" />
            <button onClick={addWorkflow} disabled={!newWfName.trim()}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors">
              Add Playbook
            </button>
          </div>
        </div>
      )}

      {view === 'disputes' && (<>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex rounded-lg overflow-hidden border border-slate-700">
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => pickPreset(p.key)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                preset === p.key ? 'bg-blue-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-white'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPreset(''); }}
          className="px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-blue-500" />
        <span className="text-slate-600 text-xs">to</span>
        <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPreset(''); }}
          className="px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-blue-500" />
        <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}
          className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-blue-500">
          <option value="">All stores</option>
          {stores.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" />
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Needs Response</p>
              <p className={`text-2xl font-bold mt-1 ${openQueue.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{openQueue.length}</p>
              <p className="text-[11px] mt-0.5">
                {overdue > 0 ? <span className="text-red-400 font-semibold">{overdue} overdue</span> : <span className="text-slate-500">none overdue</span>}
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Money At Risk</p>
              <p className="text-2xl font-bold mt-1 text-white">{cents(stats.openCents)}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{stats.open} open in range</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Win Rate</p>
              <p className={`text-2xl font-bold mt-1 ${winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{winRate.toFixed(0)}%</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{stats.won} won · {stats.lost} lost</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Lost / Won Back</p>
              <p className="text-2xl font-bold mt-1"><span className="text-red-400">{cents(stats.lostCents)}</span></p>
              <p className="text-[11px] text-slate-500 mt-0.5"><span className="text-emerald-400">{cents(stats.wonCents)}</span> recovered</p>
            </div>
          </div>

          {/* Needs Response queue */}
          {openQueue.length > 0 && (
            <div className="bg-slate-900 border border-amber-700/40 rounded-xl overflow-hidden mb-6">
              <div className="px-4 py-3 border-b border-slate-800 bg-amber-500/5 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-amber-300">⚡ Needs Response ({openQueue.length})</h3>
                <span className="text-xs text-slate-500">sorted by deadline — closest first</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                      <th className="text-left px-4 py-2.5">Deadline</th>
                      <th className="text-left px-4 py-2.5">Store</th>
                      <th className="text-right px-4 py-2.5">Amount</th>
                      <th className="text-left px-4 py-2.5">Reason</th>
                      <th className="text-left px-4 py-2.5">Order</th>
                      <th className="text-left px-4 py-2.5">Playbook</th>
                      <th className="text-left px-4 py-2.5">Stage</th>
                      <th className="text-left px-4 py-2.5">Notes</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {openQueue.map(r => {
                      const link = shopifyLink(r);
                      return (
                        <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="px-4 py-3"><DueBadge dueBy={r.evidence_due_by} /></td>
                          <td className="px-4 py-3 text-white text-sm font-medium">{r.store_name}</td>
                          <td className="px-4 py-3 text-right text-white text-base font-bold">{cents(r.amount_cents)}</td>
                          <td className="px-4 py-3 text-slate-300 text-sm">{reasonLabel(r.reason)}
                            {r.dispute_type === 'inquiry' && <span className="ml-1.5 text-[10px] text-blue-400 border border-blue-800 rounded px-1">inquiry</span>}
                          </td>
                          <td className="px-4 py-3 text-blue-400 text-sm">{r.order_number || '—'}</td>
                          <td className="px-4 py-3">
                            <select value={r.response_workflow_id || ''}
                              onChange={e => setPlaybook(r, e.target.value)}
                              className={`px-2 py-1.5 rounded-lg border text-xs font-medium focus:outline-none max-w-[150px] ${
                                r.response_workflow_id ? 'bg-violet-900/30 text-violet-300 border-violet-800' : 'bg-slate-800 text-slate-500 border-slate-700'
                              }`}>
                              <option value="">pick playbook…</option>
                              {activeWorkflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <select value={r.workflow_status || 'new'}
                              onChange={e => patch(r.id, { workflowStatus: e.target.value }, { workflow_status: e.target.value })}
                              className={`px-2 py-1.5 rounded-lg border text-xs font-medium focus:outline-none ${
                                (r.workflow_status || 'new') === 'submitted' ? 'bg-emerald-900/30 text-emerald-300 border-emerald-800'
                                : (r.workflow_status || 'new') === 'responding' ? 'bg-blue-900/30 text-blue-300 border-blue-800'
                                : 'bg-slate-800 text-slate-300 border-slate-700'
                              }`}>
                              {WF_STAGES.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <input type="text" placeholder="notes…"
                              value={notesDraft[r.id] ?? r.response_notes ?? ''}
                              onChange={e => setNotesDraft(p => ({ ...p, [r.id]: e.target.value }))}
                              onBlur={() => { const v = notesDraft[r.id]; if (v !== undefined) patch(r.id, { responseNotes: v }, { response_notes: v }); }}
                              className="w-36 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-blue-500" />
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {r.source === 'shopify_api' && (
                                <button onClick={() => openEvidence(r)}
                                  disabled={evidLoading === r.id}
                                  title="Build the full evidence pack (order + tracking + DWS warehouse proof) for copy-paste into the Shopify dispute form"
                                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors">
                                  {evidLoading === r.id ? 'Building…' : '📋 Evidence'}
                                </button>
                              )}
                              <button onClick={() => draftEvidence(r)}
                                disabled={!r.response_workflow_id || drafting === r.id}
                                title={r.response_workflow_id ? 'Auto-fill the dispute evidence in Shopify from the playbook templates' : 'Pick a playbook first'}
                                className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors">
                                {drafting === r.id ? 'Drafting…' : '⚡ Draft'}
                              </button>
                              {link && (
                                <a href={link} target="_blank" rel="noopener noreferrer"
                                  className="inline-block px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors">
                                  Respond ↗
                                </a>
                              )}
                            </div>
                            {draftMsg[r.id] && (
                              <p className={`text-[10px] mt-1 max-w-[180px] whitespace-normal ${draftMsg[r.id].startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{draftMsg[r.id]}</p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 📋 Evidence pack modal — copy each field into the Shopify dispute form */}
          {evidFor && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6" onClick={() => setEvidFor(null)}>
              <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">📋 Evidence pack — {evidFor.store_name} {evidData?.orderName || evidFor.order_number || ''}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Copy each field into the matching box on the Shopify dispute form, then submit there.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {shopifyLink(evidFor) && (
                      <a href={shopifyLink(evidFor)!} target="_blank" rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg">Open dispute ↗</a>
                    )}
                    <button onClick={() => setEvidFor(null)} className="text-slate-400 hover:text-white text-sm px-2">✕</button>
                  </div>
                </div>
                <div className="p-5 overflow-y-auto space-y-3">
                  {!evidData && <p className="text-sm text-slate-400">Building evidence (order + tracking + DWS warehouse scan)…</p>}
                  {evidData?.error && <p className="text-sm text-red-400">{evidData.error}</p>}
                  {evidData?.checks && (
                    <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
                      {evidData.checks.map((c: string, i: number) => <p key={i} className="text-[11px] text-slate-300">{c}</p>)}
                      {evidData.dws?.photoUrl && (
                        <a href={evidData.dws.photoUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-emerald-400 hover:underline">
                          📷 warehouse photo of the sealed package ↗ (download and attach as shipping documentation)
                        </a>
                      )}
                    </div>
                  )}
                  {evidData?.evidence && Object.entries(evidData.evidence as Record<string, string>).map(([k, v]) => (
                    <div key={k} className="border border-slate-800 rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/60">
                        <span className="text-[11px] font-medium text-slate-300">{EVID_LABELS[k] || k}</span>
                        <button onClick={() => copyText(k, v)}
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded ${copied === k ? 'text-emerald-400' : 'text-blue-400 hover:text-blue-300'}`}>
                          {copied === k ? '✓ copied' : 'copy'}
                        </button>
                      </div>
                      <pre className="px-3 py-2 text-[11px] text-slate-400 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{v}</pre>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Win-rate trend chart */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">Win Rate Trend</h3>
              <span className="text-xs text-slate-500">line = win rate · bars = resolved disputes · dashed = 50%</span>
            </div>
            <div className="p-4">
              <WinRateChart points={trend} />
            </div>
          </div>

          {/* Intelligence: what wins, per reason and per playbook */}
          <div className="grid lg:grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h3 className="text-sm font-medium text-white">Win Rate by Reason</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">Which disputes we win — and the playbook that wins them</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="text-left px-4 py-2">Reason</th>
                    <th className="text-right px-4 py-2">W / L</th>
                    <th className="text-left px-4 py-2 w-36">Win Rate</th>
                    <th className="text-left px-4 py-2">Best Playbook</th>
                  </tr>
                </thead>
                <tbody>
                  {reasonStats.map(s => (
                    <tr key={s.reason} className="border-b border-slate-800/50">
                      <td className="px-4 py-2.5 text-slate-200 text-sm">{s.reason}</td>
                      <td className="px-4 py-2.5 text-right text-xs whitespace-nowrap">
                        <span className="text-emerald-400">{s.won}</span><span className="text-slate-600"> / </span><span className="text-red-400">{s.lost}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${s.rate >= 50 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${s.rate}%` }} />
                          </div>
                          <span className={`text-xs font-bold w-9 text-right ${s.rate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{s.rate.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {s.best ? (
                          <span className="text-violet-300">{wfName.get(s.best.wfId) || '?'} <span className="text-slate-500">({s.best.rate.toFixed(0)}% of {s.best.n})</span></span>
                        ) : <span className="text-slate-600">tag playbooks to learn</span>}
                      </td>
                    </tr>
                  ))}
                  {reasonStats.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">No resolved disputes in range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h3 className="text-sm font-medium text-white">Win Rate by Playbook</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">Tag every response with a playbook — outcomes accumulate here</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="text-left px-4 py-2">Playbook</th>
                    <th className="text-right px-4 py-2">In Progress</th>
                    <th className="text-right px-4 py-2">W / L</th>
                    <th className="text-left px-4 py-2 w-36">Win Rate</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {wfStats.map(w => (
                    <tr key={w.id} className="border-b border-slate-800/50">
                      <td className="px-4 py-2.5">
                        <span className="text-slate-200 text-sm">{w.name}</span>
                        {!w.is_active && <span className="ml-1.5 text-[10px] text-slate-500 border border-slate-700 rounded px-1">inactive</span>}
                        {w.description && <p className="text-[11px] text-slate-500">{w.description}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-amber-400">{w.open || ''}</td>
                      <td className="px-4 py-2.5 text-right text-xs whitespace-nowrap">
                        <span className="text-emerald-400">{w.won}</span><span className="text-slate-600"> / </span><span className="text-red-400">{w.lost}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {w.rate === null ? <span className="text-slate-600 text-xs">no outcomes yet</span> : (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${w.rate >= 50 ? 'bg-violet-500' : 'bg-red-500'}`} style={{ width: `${w.rate}%` }} />
                            </div>
                            <span className={`text-xs font-bold w-9 text-right ${w.rate >= 50 ? 'text-violet-300' : 'text-red-400'}`}>{w.rate.toFixed(0)}%</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {w.is_active === 1 && (
                          <button onClick={async () => { await fetch(`/api/chargebacks/workflows?id=${w.id}`, { method: 'DELETE' }); load(); }}
                            className="text-slate-600 hover:text-red-400 text-xs" title="Retire playbook">✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-3 border-t border-slate-800 flex gap-2">
                <input type="text" placeholder="New playbook name — e.g. Evidence + customer emails"
                  value={newWfName} onChange={e => setNewWfName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addWorkflow(); }}
                  className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-violet-500" />
                <button onClick={addWorkflow} disabled={!newWfName.trim()}
                  className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors">
                  Add Playbook
                </button>
              </div>
            </div>
          </div>

          {/* Win rate per store */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-slate-800">
              <h3 className="text-sm font-medium text-white">Store Performance <span className="text-slate-500 font-normal">— {preset ? PRESETS.find(p => p.key === preset)?.label : 'custom range'}</span></h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="text-left px-4 py-2.5">Store</th>
                    <th className="text-right px-4 py-2.5">Disputes</th>
                    <th className="text-right px-4 py-2.5">Open</th>
                    <th className="text-right px-4 py-2.5">Won</th>
                    <th className="text-right px-4 py-2.5">Lost</th>
                    <th className="text-left px-4 py-2.5 w-48">Win Rate</th>
                    <th className="text-right px-4 py-2.5">At Risk</th>
                    <th className="text-right px-4 py-2.5">Lost $</th>
                  </tr>
                </thead>
                <tbody>
                  {storeStats.map(s => (
                    <tr key={s.store_id}
                      onClick={() => setStoreFilter(storeFilter === s.store_id ? '' : s.store_id)}
                      className={`border-b border-slate-800/50 cursor-pointer transition-colors ${storeFilter === s.store_id ? 'bg-blue-600/10' : 'hover:bg-slate-800/30'}`}>
                      <td className="px-4 py-3 text-white text-sm font-medium">{s.store_name}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{s.total}</td>
                      <td className="px-4 py-3 text-right">{s.open > 0 ? <span className="text-amber-400 font-semibold">{s.open}</span> : <span className="text-slate-600">0</span>}</td>
                      <td className="px-4 py-3 text-right text-emerald-400">{s.won}</td>
                      <td className="px-4 py-3 text-right text-red-400">{s.lost}</td>
                      <td className="px-4 py-3">
                        {s.winRate === null ? <span className="text-slate-600 text-xs">no outcomes yet</span> : (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${s.winRate >= 50 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${s.winRate}%` }} />
                            </div>
                            <span className={`text-xs font-bold w-9 text-right ${s.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{s.winRate.toFixed(0)}%</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-white">{s.openCents > 0 ? cents(s.openCents) : '—'}</td>
                      <td className="px-4 py-3 text-right text-red-400/90">{s.lostCents > 0 ? cents(s.lostCents) : '—'}</td>
                    </tr>
                  ))}
                  {storeStats.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-500">No chargebacks in this date range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* All chargebacks */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">All Chargebacks <span className="text-slate-500 font-normal">({historyRows.length})</span></h3>
              <div className="flex gap-1">
                {['', 'open', 'won', 'lost', 'refunded'].map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      statusFilter === s ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}>
                    {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="text-left px-4 py-2.5">Date</th>
                    <th className="text-left px-4 py-2.5">Store</th>
                    <th className="text-right px-4 py-2.5">Amount</th>
                    <th className="text-left px-4 py-2.5">Reason</th>
                    <th className="text-left px-4 py-2.5">Order</th>
                    <th className="text-left px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map(r => {
                    const link = shopifyLink(r);
                    return (
                      <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                        <td className="px-4 py-2.5 text-slate-400 text-xs whitespace-nowrap">{r.chargeback_date}</td>
                        <td className="px-4 py-2.5 text-slate-200 text-sm">{r.store_name}</td>
                        <td className="px-4 py-2.5 text-right text-white font-semibold">{cents(r.amount_cents)}</td>
                        <td className="px-4 py-2.5 text-slate-300 text-sm">{reasonLabel(r.reason)}</td>
                        <td className="px-4 py-2.5 text-blue-400 text-xs">{r.order_number || '—'}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={r.status} />
                            <select value={r.status}
                              onChange={e => patch(r.id, { status: e.target.value }, { status: e.target.value })}
                              className="w-5 bg-transparent text-slate-500 text-xs focus:outline-none cursor-pointer"
                              title="Change status">
                              <option value="open">Open</option>
                              <option value="won">Won</option>
                              <option value="lost">Lost</option>
                              <option value="refunded">Refunded</option>
                            </select>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {link && <a href={link} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs">View ↗</a>}
                        </td>
                      </tr>
                    );
                  })}
                  {historyRows.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">No chargebacks match the filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      </>)}
    </div>
  );
}
