'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import StoreSelector from '@/components/StoreSelector';

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr + 'Z');
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface CFOData {
  store: { id: string; name: string };
  assets: {
    cash_bank_cents: number;
    cash_shopify_cents: number;
    shopify_payout_cents: number;
    reserves_cents: number;
    inventory_cents: number;
    loans_receivable_cents: number;
    total_cents: number;
  };
  liabilities: {
    fulfillment_owed_cents: number;
    fulfillment_estimated_cents: number;
    ad_spend_pending_cents: number;
    fb_pending_balance_cents: number;
    app_invoices_due_cents: number;
    loans_payable_cents: number;
    manual_cc_cents: number;
    total_cents: number;
  };
  equity_cents: number;
  details: {
    fulfillment: { billed_cents: number; estimated_cents: number; estimated_order_count: number; total_unfulfilled: number; unfulfilled_with_estimate: number; paid_cents: number; total_owed_cents: number; balance_cents: number };
    adSpend: { total_invoiced_cents: number; total_paid_cents: number; balance_due_cents: number; fb_pending_balance_cents: number; platforms?: Record<string, { charged: number; paid: number; balance: number }> };
    appInvoices: { total_charged_cents: number; total_paid_cents: number; balance_due_cents: number; last_invoice: { bill_number: string; date: string; total_cents: number; source: string } | null };
    inventory: { asset_value_cents: number; cost_basis_cents: number };
    loans: { borrowed_total_cents: number; borrowed_remaining_cents: number; lent_total_cents: number; lent_remaining_cents: number };
    bankAccounts: { id: string; institution_name: string; account_name: string; last_four: string; balance_available_cents: number; balance_ledger_cents: number; balance_updated_at: string | null }[];
    shopify_balance_cents: number;
    shopify_live?: { source: string; as_of?: string; pending_balance_cents?: number; scheduled_cents?: number; paid_unlanded_cents?: number; reserves_cents?: number; error?: string };
    shopify_payout_cents: number;
    reserves: { id: string; amount_cents: number; held_at: string }[];
    manualCreditCards: { id: string; card_name: string; amount_owed_cents: number }[];
  };
}

interface OverviewStore {
  store_id: string;
  store_name: string;
  has_snapshot: boolean;
  snapshot_date: string | null;
  assets_cents: number;
  liabilities_cents: number;
  equity_cents: number;
  created_at: string | null;
  equity_change_cents: number | null;
  recon_status: 'matched' | 'flagged' | 'insufficient_data' | null;
  recon_residual_cents: number | null;
}

interface ReconItemDetail { id: string; date: string; amount_cents: number; description: string; card?: string; platform?: string; matched?: boolean }
interface ReconItem { key: string; label: string; amount_cents: number; kind: string; note?: string; details?: { invoices?: ReconItemDetail[]; payments?: ReconItemDetail[]; bank_txns?: ReconItemDetail[] } }

interface MoneyFlowSummary {
  total_invoiced_cents: number;
  total_paid_cents: number;
  total_matched_cents: number;
  total_unmatched_cents: number;
  match_rate_pct: number;
  ad_invoices: number;
  ad_payments: number;
  app_invoices: number;
  app_payments: number;
  ss_payments: number;
  owner_draws_cents: number;
  owner_contributions_cents: number;
}

interface ReconResult {
  store_id?: string;
  t2_snapshot_id?: string;
  period_start: string;
  period_end: string;
  period_start_ts?: string;
  period_end_ts?: string;
  delta_equity_cents: number;
  net_income_cents: number;
  gap_cents: number;
  explained_cents: number;
  residual_cents: number;
  tolerance_cents: number;
  status: 'matched' | 'flagged' | 'insufficient_data';
  items: ReconItem[];
  asset_deltas: { key: string; label: string; delta_cents: number }[];
  liability_deltas: { key: string; label: string; delta_cents: number }[];
  pnl: { revenue: number; fulfillment: number; ad: number; fees: number; app: number; other: number; chargeback: number; net: number };
  flows: { ss_paid: number; ad_paid: number; app_paid: number; owner_draws: number; owner_contributions: number };
  flows_detail?: { summary: MoneyFlowSummary } | null;
  unmodeled_keys: string[];
  drivers: { label: string; amount_cents: number }[];
}

interface OverviewTotals {
  total_assets_cents: number;
  total_liabilities_cents: number;
  total_equity_cents: number;
  store_count: number;
}

function signed(amount: number): string {
  const s = cents(Math.abs(amount));
  return amount < 0 ? `−${s}` : `+${s}`;
}

function formatTs(ts: string | undefined): string {
  if (!ts) return '';
  try {
    const d = new Date(ts.includes('T') || ts.includes('Z') ? ts : ts + 'Z');
    return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'America/Los_Angeles' })
      + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' });
  } catch { return ts || ''; }
}

function DetailRow({ d, type }: { d: ReconItemDetail; type: 'invoice' | 'payment' | 'bank_txn' }) {
  const bgClass = d.matched ? 'bg-emerald-950/20 border-emerald-900/30' : 'bg-red-950/10 border-red-900/20';
  const dotColor = d.matched ? 'bg-emerald-500' : 'bg-red-500';
  return (
    <div className={`flex items-center justify-between px-3 py-1.5 border rounded text-[11px] ${bgClass}`}>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
        <span className="text-slate-400 shrink-0">{d.date}</span>
        <span className="text-slate-300 truncate">{d.description || (type === 'bank_txn' ? 'Bank transaction' : type === 'payment' ? 'Payment' : 'Invoice')}</span>
        {d.card && <span className="text-slate-500 font-mono shrink-0">*{d.card}</span>}
        {d.platform && <span className="text-blue-400/60 shrink-0">{d.platform}</span>}
      </div>
      <span className={`font-mono shrink-0 ml-2 ${d.amount_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{cents(Math.abs(d.amount_cents))}</span>
    </div>
  );
}

function ReconciliationPanel({ recon, onRecompute }: { recon: ReconResult | null; onRecompute?: () => Promise<void> }) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [recomputing, setRecomputing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [aiMeta, setAiMeta] = useState<{ model?: string; created_at?: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [evidenceList, setEvidenceList] = useState<any[]>([]);

  const storeIdForAi = recon?.store_id;
  useEffect(() => {
    if (!storeIdForAi) return;
    fetch(`/api/cfo/reconcile/ai?storeId=${storeIdForAi}`)
      .then(r => r.json())
      .then(d => { if (d.analysis) { setAiAnalysis(d.analysis); setAiMeta({ model: d.model, created_at: d.created_at }); } })
      .catch(() => {});
    fetch(`/api/cfo/reconcile/evidence?storeId=${storeIdForAi}`)
      .then(r => r.json())
      .then(d => setEvidenceList(d.evidence || []))
      .catch(() => {});
  }, [storeIdForAi]);


  const runAiAnalysis = async () => {
    if (!storeIdForAi) return;
    setAiLoading(true); setAiError('');
    try {
      const r = await fetch('/api/cfo/reconcile/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: storeIdForAi }),
      });
      const d = await r.json();
      if (d.error) setAiError(d.error);
      else { setAiAnalysis(d.analysis); setAiMeta({ model: d.model || 'claude-fable-5', created_at: new Date().toISOString() }); }
    } catch (e: any) {
      setAiError(e?.message || 'analysis failed');
    } finally { setAiLoading(false); }
  };

  if (!recon || recon.status === 'insufficient_data') {
    return (
      <div className="mt-8 bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-1">CFO ↔ P&amp;L Reconciliation</h2>
        <p className="text-xs text-slate-500">
          Save at least two snapshots (with full balance detail) to reconcile equity movement against P&amp;L profit.
        </p>
      </div>
    );
  }

  const matched = recon.status === 'matched';
  const expected = recon.net_income_cents + recon.explained_cents;
  const flowSummary = recon.flows_detail?.summary;

  const toggleItem = (key: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const periodLabel = recon.period_start_ts
    ? `${formatTs(recon.period_start_ts)} → ${formatTs(recon.period_end_ts)}`
    : `${recon.period_start} → ${recon.period_end}`;

  return (
    <div className={`mt-8 bg-slate-900 border rounded-xl overflow-hidden ${matched ? 'border-emerald-900/50' : 'border-amber-800/60'}`}>
      <div className={`px-5 py-4 border-b flex items-center justify-between ${matched ? 'border-emerald-900/40 bg-emerald-950/20' : 'border-amber-900/40 bg-amber-950/20'}`}>
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            CFO ↔ P&amp;L Reconciliation
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${matched ? 'bg-emerald-900/50 text-emerald-300' : 'bg-amber-900/50 text-amber-300'}`}>
              {matched ? 'Matched' : 'Drift detected'}
            </span>
          </h2>
          <p className="text-[11px] text-slate-400 mt-1">
            {periodLabel} · tolerance {cents(recon.tolerance_cents)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">Unexplained</p>
          <p className={`text-xl font-bold ${matched ? 'text-emerald-400' : 'text-amber-400'}`}>{signed(recon.residual_cents)}</p>
        </div>
      </div>

      <div className="p-5">
        {/* Headline comparison */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-slate-800/40 rounded-lg p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Equity moved</p>
            <p className="text-lg font-bold text-white">{signed(recon.delta_equity_cents)}</p>
          </div>
          <div className="bg-slate-800/40 rounded-lg p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">P&amp;L net profit</p>
            <p className="text-lg font-bold text-white">{signed(recon.net_income_cents)}</p>
          </div>
        </div>

        {/* Money Flow Summary */}
        {flowSummary && (flowSummary.ad_invoices > 0 || flowSummary.app_invoices > 0 || flowSummary.ss_payments > 0) && (
          <div className="bg-slate-800/30 rounded-lg p-3 mb-5 border border-slate-700/50">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-semibold text-white uppercase tracking-wider">Money Flow</h3>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                flowSummary.match_rate_pct >= 90 ? 'bg-emerald-900/40 text-emerald-300' :
                flowSummary.match_rate_pct >= 50 ? 'bg-amber-900/40 text-amber-300' :
                'bg-red-900/40 text-red-300'
              }`}>{flowSummary.match_rate_pct}% matched</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              {flowSummary.ad_invoices > 0 && (
                <div className="bg-slate-900/50 rounded p-2">
                  <p className="text-blue-400 font-medium">Ad Spend</p>
                  <p className="text-white font-mono">{cents(flowSummary.total_invoiced_cents)}</p>
                  <p className="text-slate-500">{flowSummary.ad_invoices} invoices · {flowSummary.ad_payments} payments</p>
                </div>
              )}
              {flowSummary.app_invoices > 0 && (
                <div className="bg-slate-900/50 rounded p-2">
                  <p className="text-emerald-400 font-medium">App Costs</p>
                  <p className="text-white font-mono">{cents(flowSummary.total_invoiced_cents - (flowSummary.ad_invoices > 0 ? flowSummary.total_invoiced_cents : 0))}</p>
                  <p className="text-slate-500">{flowSummary.app_invoices} invoices · {flowSummary.app_payments} payments</p>
                </div>
              )}
              {flowSummary.ss_payments > 0 && (
                <div className="bg-slate-900/50 rounded p-2">
                  <p className="text-orange-400 font-medium">Fulfillment</p>
                  <p className="text-white font-mono">{cents(Math.abs(flowSummary.owner_draws_cents || 0))}</p>
                  <p className="text-slate-500">{flowSummary.ss_payments} payments</p>
                </div>
              )}
            </div>
            {(flowSummary.owner_draws_cents !== 0 || flowSummary.owner_contributions_cents !== 0) && (
              <div className="mt-2 flex gap-3 text-[11px]">
                {flowSummary.owner_draws_cents !== 0 && (
                  <span className="text-purple-400">Owner draws: <span className="font-mono text-red-400">{cents(Math.abs(flowSummary.owner_draws_cents))}</span></span>
                )}
                {flowSummary.owner_contributions_cents !== 0 && (
                  <span className="text-purple-400">Owner contributions: <span className="font-mono text-emerald-400">{cents(flowSummary.owner_contributions_cents)}</span></span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Bridge waterfall */}
        <div className="space-y-1.5 text-sm">
          <div className="py-1.5 border-b border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-slate-300">P&amp;L net profit <span className="text-[9px] bg-blue-900/50 text-blue-300 px-1 rounded ml-1">second-exact</span></span>
              <span className="font-mono text-white">{signed(recon.net_income_cents)}</span>
            </div>
            {(recon as any).boundary_prorate && (
              <p className="text-[10px] text-slate-500 mt-0.5">
                Pro-rated at the exact snapshot seconds: excludes {cents(Math.abs((recon as any).boundary_prorate.pre_t1_cents))} earned before the opening snapshot (prior window&apos;s profit) and {cents(Math.abs((recon as any).boundary_prorate.post_t2_cents))} after the closing snapshot (next window&apos;s).
              </p>
            )}
          </div>
          {recon.items.length === 0 && (
            <div className="py-1.5 text-xs text-slate-500 italic">No reconciling items — equity should equal profit exactly.</div>
          )}
          {recon.items.map(item => {
            const hasDetails = item.details && (
              (item.details.invoices && item.details.invoices.length > 0) ||
              (item.details.payments && item.details.payments.length > 0) ||
              (item.details.bank_txns && item.details.bank_txns.length > 0)
            );
            const isExpanded = expandedItems.has(item.key);

            return (
              <div key={item.key}>
                <div
                  className={`flex items-start justify-between py-1.5 group ${hasDetails ? 'cursor-pointer hover:bg-slate-800/30 rounded px-1 -mx-1' : ''}`}
                  onClick={() => hasDetails && toggleItem(item.key)}
                >
                  <div className="flex-1 pr-3">
                    <span className="text-slate-300">{item.label}</span>
                    {hasDetails && (
                      <span className="ml-1.5 text-[9px] text-slate-500">{isExpanded ? '▼' : '▶'}</span>
                    )}
                    <span className={`ml-2 text-[9px] uppercase px-1.5 py-0.5 rounded ${
                      item.kind === 'capital' ? 'bg-purple-900/40 text-purple-300'
                      : item.kind === 'timing' ? 'bg-blue-900/40 text-blue-300'
                      : 'bg-slate-700/50 text-slate-400'
                    }`}>{item.kind}</span>
                    {item.note && <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{item.note}</p>}
                  </div>
                  <span className={`font-mono ${item.amount_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{signed(item.amount_cents)}</span>
                </div>

                {/* Expanded detail panel */}
                {isExpanded && item.details && (
                  <div className="ml-4 mb-2 space-y-1">
                    {item.details.invoices && item.details.invoices.length > 0 && (
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 mt-1">Invoices</p>
                        <div className="space-y-0.5">
                          {item.details.invoices.map((d, i) => <DetailRow key={i} d={d} type="invoice" />)}
                        </div>
                      </div>
                    )}
                    {item.details.payments && item.details.payments.length > 0 && (
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 mt-1">Payments</p>
                        <div className="space-y-0.5">
                          {item.details.payments.map((d, i) => <DetailRow key={i} d={d} type="payment" />)}
                        </div>
                      </div>
                    )}
                    {item.details.bank_txns && item.details.bank_txns.length > 0 && (
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 mt-1">Bank Transactions</p>
                        <div className="space-y-0.5">
                          {item.details.bank_txns.map((d, i) => <DetailRow key={i} d={d} type="bank_txn" />)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex items-center justify-between py-1.5 border-t border-slate-800">
            <span className="text-slate-400">= Expected equity move</span>
            <span className="font-mono text-slate-300">{signed(expected)}</span>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-slate-400">Actual equity move</span>
            <span className="font-mono text-slate-300">{signed(recon.delta_equity_cents)}</span>
          </div>
          <div className={`flex items-center justify-between py-2 px-3 rounded-lg mt-1 ${matched ? 'bg-emerald-950/30' : 'bg-amber-950/30'}`}>
            <span className={`font-semibold ${matched ? 'text-emerald-300' : 'text-amber-300'}`}>
              {matched ? 'Unexplained (within tolerance)' : 'Unexplained residual'}
            </span>
            <span className={`font-mono font-bold ${matched ? 'text-emerald-400' : 'text-amber-400'}`}>{signed(recon.residual_cents)}</span>
          </div>
        </div>

        {/* Where to look, when flagged */}
        {!matched && recon.drivers.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-800">
            <p className="text-[11px] text-slate-400 mb-2">
              The residual likely lives in these balances (manual / bank-fed lines this period). Verify them against reality:
            </p>
            <div className="flex flex-wrap gap-2">
              {recon.drivers.map((d, i) => (
                <span key={i} className="text-[11px] bg-slate-800 rounded px-2 py-1 text-slate-300 font-mono">
                  {d.label} {signed(d.amount_cents)}
                </span>
              ))}
            </div>
            {recon.flows.owner_draws === 0 && recon.flows.owner_contributions === 0 && (
              <p className="text-[10px] text-slate-500 mt-2">
                Tip: if money was taken out or put in this period, categorize those bank transactions as "Owner Draw" / "Owner Contribution" and they'll move out of the residual.
              </p>
            )}
          </div>
        )}

        {recon.unmodeled_keys.length > 0 && (
          <p className="mt-3 text-[10px] text-amber-500/80">
            New balance lines not yet modeled: {recon.unmodeled_keys.join(', ')} — counted in residual.
          </p>
        )}

        {/* AI Investigator */}
        <div className="mt-4 pt-4 border-t border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-violet-300">🧠 AI Investigator (Claude Fable 5)</h3>
            <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                if (!recon?.t2_snapshot_id) return;
                if (!confirm('Block the end snapshot of this window?\n\nUse this after fixing data: the blocked snapshot is skipped, so when you save the CFO again, the reconciliation re-runs from this window\'s ORIGINAL start point to your fresh snapshot — instead of a tiny window from minutes ago.')) return;
                setRecomputing(true);
                try {
                  const r = await fetch('/api/cfo/reconcile', {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ snapshotId: recon.t2_snapshot_id, excluded: true }),
                  });
                  await r.json();
                  if (onRecompute) await onRecompute();
                } finally { setRecomputing(false); }
              }}
              disabled={recomputing || !recon?.t2_snapshot_id}
              title="Skip this window's end snapshot in the reconciliation chain — then re-save the CFO and the window re-runs from its original start to your fresh snapshot"
              className="px-3 py-1.5 bg-red-900/60 hover:bg-red-800/60 disabled:opacity-50 text-red-200 text-xs font-medium rounded-lg transition-colors"
            >
              🚫 Block end snapshot
            </button>
            <button
              onClick={async () => {
                if (!onRecompute) return;
                setRecomputing(true);
                try { await onRecompute(); } finally { setRecomputing(false); }
              }}
              disabled={recomputing || !onRecompute}
              title="Re-run this reconciliation after fixing data (payments, categories, balances) — updates the numbers above without a new snapshot"
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
            >
              {recomputing ? 'Recomputing…' : '↻ I fixed something — resubmit'}
            </button>
            <button
              onClick={runAiAnalysis}
              disabled={aiLoading}
              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
            >
              {aiLoading ? 'Scanning every record… (1-3 min)' : aiAnalysis ? 'Re-run deep analysis' : 'Run deep analysis'}
            </button>
            </div>
          </div>

          {evidenceList.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="text-emerald-400 font-medium">📎 Ground truth on file (auto-used by deep analysis — add more via Bulk Upload):</span>
              {evidenceList.map((ev: any) => (
                <span key={ev.id} className="bg-slate-800/70 text-slate-300 rounded px-1.5 py-0.5">
                  {ev.kind === 'bank_statement' ? '🏦' : '💳'} {ev.row_count} rows · {String(ev.min_ts || '').slice(0, 10)} → {String(ev.max_ts || '').slice(0, 10)}
                </span>
              ))}
            </div>
          )}

          {aiError && <p className="text-[11px] text-red-400 mb-2">{aiError}</p>}
          {aiLoading && (
            <p className="text-[11px] text-slate-500 animate-pulse">
              {evidenceList.length > 0
                ? `Tracing every dollar through ${evidenceList.length} submitted export${evidenceList.length > 1 ? 's' : ''} (payouts, reserves, bank landings) + all internal records between the exact snapshot timestamps…`
                : 'Reading snapshots, bank transactions, payment logs, P&L rows, activity + sync logs between the exact snapshot timestamps…'}
            </p>
          )}
          {aiAnalysis && !aiLoading && (
            <div className="space-y-3">
              <div className={`text-xs rounded-lg px-3 py-2 ${aiAnalysis.confidence === 'high' ? 'bg-emerald-950/40 text-emerald-200' : aiAnalysis.confidence === 'medium' ? 'bg-amber-950/40 text-amber-200' : 'bg-slate-800 text-slate-300'}`}>
                <span className="font-semibold">Verdict:</span> {aiAnalysis.verdict}
                <span className="ml-2 text-[10px] opacity-70">confidence: {aiAnalysis.confidence}</span>
              </div>
              {(aiAnalysis.causes || []).map((c: any, i: number) => (
                <div key={i} className="bg-slate-800/60 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white font-medium">{c.title}</span>
                    <span className={`font-mono font-bold ${c.amount_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{signed(c.amount_cents)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded ${c.category === 'data_bug' ? 'bg-red-900/50 text-red-300' : c.category === 'timing' ? 'bg-blue-900/50 text-blue-300' : c.category === 'capital' ? 'bg-purple-900/50 text-purple-300' : 'bg-slate-700 text-slate-300'}`}>{c.category}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 mt-1">{c.explanation}</p>
                  {(c.evidence || []).length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {c.evidence.map((e: string, j: number) => (
                        <li key={j} className="text-[10px] text-slate-500 font-mono">• {e}</li>
                      ))}
                    </ul>
                  )}
                  {c.fix && <p className="text-[11px] text-violet-300 mt-1">→ {c.fix}</p>}
                </div>
              ))}
              {typeof aiAnalysis.unexplained_remaining_cents === 'number' && Math.abs(aiAnalysis.unexplained_remaining_cents) > 100 && (
                <p className="text-[11px] text-amber-400">Still unexplained after analysis: {signed(aiAnalysis.unexplained_remaining_cents)}</p>
              )}
              {(aiAnalysis.recommended_actions || []).length > 0 && (
                <div className="text-[11px] text-slate-300">
                  <span className="text-slate-400 font-medium">Next steps:</span>
                  <ol className="list-decimal list-inside mt-0.5 space-y-0.5">
                    {aiAnalysis.recommended_actions.map((a: string, i: number) => <li key={i}>{a}</li>)}
                  </ol>
                </div>
              )}
              {aiAnalysis.raw_text && (
                <pre className="text-[10px] text-slate-400 whitespace-pre-wrap bg-slate-800/50 rounded p-2 max-h-64 overflow-auto">{aiAnalysis.raw_text}</pre>
              )}
              {aiMeta?.created_at && <p className="text-[9px] text-slate-600">{aiMeta.model || 'claude-fable-5'} · {aiMeta.created_at}</p>}
            </div>
          )}
          {!aiAnalysis && !aiLoading && !aiError && (
            <p className="text-[11px] text-slate-500">
              Scans the store&apos;s bank transactions, every log change, payments, and both snapshots from the exact second each was taken — and explains the residual line by line.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CFOContent() {
  const searchParams = useSearchParams();
  const storeId = searchParams.get('storeId') || '';

  const [tab, setTab] = useState<'overview' | 'store'>(storeId ? 'store' : 'overview');
  const [data, setData] = useState<CFOData | null>(null);
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [editingShopify, setEditingShopify] = useState(false);
  const [shopifyInput, setShopifyInput] = useState('');
  const [savingShopify, setSavingShopify] = useState(false);
  const [editingPayout, setEditingPayout] = useState(false);
  const [payoutInput, setPayoutInput] = useState('');
  const [savingPayout, setSavingPayout] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [snapshotSaved, setSnapshotSaved] = useState('');
  const [snapshots, setSnapshots] = useState<{ id: string; snapshot_date: string; assets_cents: number; liabilities_cents: number; equity_cents: number; created_at: string; excluded?: number }[]>([]);
  const [addingReserve, setAddingReserve] = useState(false);
  const [reserveAmountInput, setReserveAmountInput] = useState('');
  const [reserveHeldAtInput, setReserveHeldAtInput] = useState('');
  const [editingReserveId, setEditingReserveId] = useState<string | null>(null);
  const [savingReserve, setSavingReserve] = useState(false);
  const [addingCC, setAddingCC] = useState(false);
  const [ccNameInput, setCcNameInput] = useState('');
  const [ccAmountInput, setCcAmountInput] = useState('');
  const [editingCCId, setEditingCCId] = useState<string | null>(null);
  const [savingCC, setSavingCC] = useState(false);
  const [cfoOverrides, setCfoOverrides] = useState<Record<string, string>>({});
  const [editingOverride, setEditingOverride] = useState<string | null>(null);
  const [overrideInput, setOverrideInput] = useState('');
  const [recon, setRecon] = useState<ReconResult | null>(null);

  async function saveOverride(key: string, value: string) {
    await fetch('/api/cfo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, cfoOverride: { key, value } }),
    });
    setCfoOverrides(prev => {
      const next = { ...prev };
      if (value) next[key] = value; else delete next[key];
      return next;
    });
    setEditingOverride(null);
  }

  // Overview state
  const [overviewStores, setOverviewStores] = useState<OverviewStore[]>([]);
  const [overviewTotals, setOverviewTotals] = useState<OverviewTotals | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => setStores(d.stores || []));
  }, []);

  useEffect(() => {
    if (storeId) { setTab('store'); }
  }, [storeId]);

  useEffect(() => {
    if (tab === 'overview') loadOverview();
    else if (storeId) loadData();
    else { setData(null); setLoading(false); }
  }, [tab, storeId]);

  async function loadOverview() {
    setOverviewLoading(true);
    const res = await fetch('/api/cfo/overview');
    const d = await res.json();
    setOverviewStores(d.stores || []);
    setOverviewTotals(d.totals || null);
    setOverviewLoading(false);
  }

  async function loadData() {
    setLoading(true);
    const res = await fetch(`/api/cfo?storeId=${storeId}`);
    const d = await res.json();
    setData(d);
    setCfoOverrides(d.cfo_overrides || {});
    setShopifyInput(d.details?.shopify_balance_cents ? String(d.details.shopify_balance_cents / 100) : '');
    setPayoutInput(d.details?.shopify_payout_cents ? String(d.details.shopify_payout_cents / 100) : '');
    setSnapshots(d.snapshots || []);
    setLoading(false);
    // Load the latest reconciliation (recompute against the most recent snapshot so it reflects
    // any balances edited since it was last saved).
    fetch(`/api/cfo/reconcile?storeId=${storeId}&recompute=1`)
      .then(r => r.json())
      .then(rd => setRecon(rd.latest || null))
      .catch(() => setRecon(null));
  }

  async function saveShopifyBalance() {
    setSavingShopify(true);
    await fetch('/api/cfo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, shopifyBalanceCents: Math.round(parseFloat(shopifyInput || '0') * 100) }),
    });
    setEditingShopify(false);
    setSavingShopify(false);
    loadData();
  }

  async function saveShopifyPayout() {
    setSavingPayout(true);
    await fetch('/api/cfo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, shopifyPayoutCents: Math.round(parseFloat(payoutInput || '0') * 100) }),
    });
    setEditingPayout(false);
    setSavingPayout(false);
    loadData();
  }

  async function saveReserve(existingId?: string) {
    setSavingReserve(true);
    await fetch('/api/cfo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId,
        reserve: {
          id: existingId || undefined,
          amount_cents: Math.round(parseFloat(reserveAmountInput || '0') * 100),
          held_at: reserveHeldAtInput.trim(),
        },
      }),
    });
    setAddingReserve(false);
    setEditingReserveId(null);
    setReserveAmountInput('');
    setReserveHeldAtInput('');
    setSavingReserve(false);
    loadData();
  }

  async function deleteReserve(id: string) {
    await fetch('/api/cfo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, deleteReserveId: id }),
    });
    loadData();
  }

  async function saveManualCC(existingId?: string) {
    setSavingCC(true);
    await fetch('/api/cfo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId,
        manualCC: {
          id: existingId || undefined,
          card_name: ccNameInput.trim(),
          amount_owed_cents: Math.round(parseFloat(ccAmountInput || '0') * 100),
        },
      }),
    });
    setAddingCC(false);
    setEditingCCId(null);
    setCcNameInput('');
    setCcAmountInput('');
    setSavingCC(false);
    loadData();
  }

  async function deleteManualCC(id: string) {
    await fetch('/api/cfo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, deleteManualCCId: id }),
    });
    loadData();
  }

  async function saveSnapshot() {
    if (!data) return;
    setSavingSnapshot(true);
    setSnapshotSaved('');
    const res = await fetch('/api/cfo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId,
        assets_cents: data.assets.total_cents,
        liabilities_cents: data.liabilities.total_cents,
        equity_cents: data.equity_cents,
        data: { assets: data.assets, liabilities: data.liabilities, details: data.details },
      }),
    });
    const result = await res.json();
    setSavingSnapshot(false);
    if (result.success) {
      setSnapshotSaved(result.date);
      if (result.reconciliation) setRecon(result.reconciliation);
      loadData();
    }
  }

  const selectedStore = stores.find(s => s.id === storeId);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">CFO Dashboard</h1>
            <p className="text-sm text-slate-400 mt-1">
              {tab === 'overview' ? 'All Stores Overview' : selectedStore ? `${selectedStore.name} — Balance Sheet` : 'Select a store'}
            </p>
          </div>
          {tab === 'store' && <StoreSelector />}
        </div>
        {tab === 'store' && data && (
          <div className="flex items-center gap-3">
            {snapshotSaved && (
              <span className="text-xs text-emerald-400">Saved {snapshotSaved}</span>
            )}
            <button
              onClick={saveSnapshot}
              disabled={savingSnapshot}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              {savingSnapshot ? 'Saving...' : 'Save Snapshot'}
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-900 border border-slate-800 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('overview')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'overview' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          OVERVIEW CFO&apos;S
        </button>
        <button
          onClick={() => setTab('store')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'store' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          Store Detail
        </button>
      </div>

      {/* OVERVIEW TAB */}
      {tab === 'overview' ? (
        overviewLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" />
          </div>
        ) : (
          <>
            {/* Overview KPIs */}
            {overviewTotals && overviewTotals.store_count > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Stores with Snapshots</p>
                  <p className="text-2xl font-bold text-white">{overviewTotals.store_count}</p>
                </div>
                <div className="bg-slate-900 border border-emerald-900/50 rounded-xl p-5">
                  <p className="text-xs text-emerald-500 uppercase tracking-wider mb-2">Total Assets</p>
                  <p className="text-2xl font-bold text-emerald-400">{cents(overviewTotals.total_assets_cents)}</p>
                </div>
                <div className="bg-slate-900 border border-red-900/50 rounded-xl p-5">
                  <p className="text-xs text-red-500 uppercase tracking-wider mb-2">Total Liabilities</p>
                  <p className="text-2xl font-bold text-red-400">{cents(overviewTotals.total_liabilities_cents)}</p>
                </div>
                <div className={`bg-slate-900 border rounded-xl p-5 ${overviewTotals.total_equity_cents >= 0 ? 'border-blue-900/50' : 'border-orange-900/50'}`}>
                  <p className="text-xs text-blue-500 uppercase tracking-wider mb-2">Combined Equity</p>
                  <p className={`text-2xl font-bold ${overviewTotals.total_equity_cents >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
                    {cents(overviewTotals.total_equity_cents)}
                  </p>
                </div>
              </div>
            )}

            {/* All Stores Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-white">All Stores — Most Recent Snapshot</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                      <th className="text-left px-5 py-3">Store</th>
                      <th className="text-left px-5 py-3">Snapshot Date</th>
                      <th className="text-right px-5 py-3">Assets</th>
                      <th className="text-right px-5 py-3">Liabilities</th>
                      <th className="text-right px-5 py-3">Equity</th>
                      <th className="text-right px-5 py-3">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewStores.filter(s => s.has_snapshot).map(s => (
                      <tr key={s.store_id} className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer"
                        onClick={() => {
                          const url = new URL(window.location.href);
                          url.searchParams.set('storeId', s.store_id);
                          window.history.pushState({}, '', url.toString());
                          setTab('store');
                          window.dispatchEvent(new PopStateEvent('popstate'));
                          window.location.href = `/dashboard/cfo?storeId=${s.store_id}`;
                        }}
                      >
                        <td className="px-5 py-3 text-white font-medium">
                          <span className="inline-flex items-center gap-2">
                            {s.store_name}
                            {s.recon_status === 'flagged' && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300 uppercase tracking-wide"
                                title={s.recon_residual_cents !== null ? `Unexplained ${cents(s.recon_residual_cents)}` : 'Drift detected'}>
                                ⚠ Drift {s.recon_residual_cents !== null ? signed(s.recon_residual_cents) : ''}
                              </span>
                            )}
                            {s.recon_status === 'matched' && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 uppercase tracking-wide" title="CFO ties out to P&L">✓ Tied</span>
                            )}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-400 text-xs">
                          {s.snapshot_date}
                          {s.created_at && <span className="text-slate-600 ml-2">{s.created_at.slice(11, 16)}</span>}
                        </td>
                        <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(s.assets_cents)}</td>
                        <td className="px-5 py-3 text-right text-red-400 font-medium">{cents(s.liabilities_cents)}</td>
                        <td className={`px-5 py-3 text-right font-bold ${s.equity_cents >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
                          {cents(s.equity_cents)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {s.equity_change_cents !== null ? (
                            <span className={`text-xs font-medium ${s.equity_change_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {s.equity_change_cents >= 0 ? '+' : ''}{cents(s.equity_change_cents)}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {overviewStores.filter(s => !s.has_snapshot).length > 0 && (
                      <>
                        <tr>
                          <td colSpan={6} className="px-5 py-2 text-[10px] text-slate-600 uppercase tracking-wider bg-slate-800/20">No Snapshot Yet</td>
                        </tr>
                        {overviewStores.filter(s => !s.has_snapshot).map(s => (
                          <tr key={s.store_id} className="border-b border-slate-800/50">
                            <td className="px-5 py-3 text-slate-500">{s.store_name}</td>
                            <td className="px-5 py-3 text-slate-600 text-xs">—</td>
                            <td className="px-5 py-3 text-right text-slate-600">—</td>
                            <td className="px-5 py-3 text-right text-slate-600">—</td>
                            <td className="px-5 py-3 text-right text-slate-600">—</td>
                            <td className="px-5 py-3 text-right text-slate-600">—</td>
                          </tr>
                        ))}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      ) : !storeId ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
          <p className="text-slate-400">Select a store to view the balance sheet</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" />
        </div>
      ) : data ? (
        <>
          {/* Top-Level Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-slate-900 border border-emerald-900/50 rounded-xl p-5">
              <p className="text-xs text-emerald-500 uppercase tracking-wider mb-2">Total Assets</p>
              <p className="text-2xl font-bold text-emerald-400">{cents(data.assets.total_cents)}</p>
            </div>
            <div className="bg-slate-900 border border-red-900/50 rounded-xl p-5">
              <p className="text-xs text-red-500 uppercase tracking-wider mb-2">Total Liabilities</p>
              <p className="text-2xl font-bold text-red-400">{cents(data.liabilities.total_cents)}</p>
            </div>
            <div className={`bg-slate-900 border rounded-xl p-5 ${data.equity_cents >= 0 ? 'border-blue-900/50' : 'border-orange-900/50'}`}>
              <p className="text-xs text-blue-500 uppercase tracking-wider mb-2">Net Equity</p>
              <p className={`text-2xl font-bold ${data.equity_cents >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>{cents(data.equity_cents)}</p>
            </div>
          </div>

          {/* ASSETS SECTION */}
          <div className="mb-8">
            {(data.details.shopify_live as any)?.guard_warnings?.length > 0 && (
              <div className="mb-3 bg-amber-950/30 border border-amber-800/50 rounded-lg px-4 py-2 space-y-0.5">
                {(data.details.shopify_live as any).guard_warnings.map((w: string, i: number) => (
                  <p key={i} className="text-[11px] text-amber-300">🛡 {w}</p>
                ))}
              </div>
            )}
            <h2 className="text-lg font-bold text-emerald-400 mb-4 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500" />
              Assets
            </h2>
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="text-left px-5 py-3">Account</th>
                    <th className="text-left px-5 py-3">Details</th>
                    <th className="text-right px-5 py-3">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Bank Accounts */}
                  {data.details.bankAccounts.map(acc => (
                    <tr key={acc.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-white font-medium">{acc.institution_name}</td>
                      <td className="px-5 py-3 text-slate-400 text-xs">
                        {acc.account_name} ****{acc.last_four}
                        <span className="text-slate-600 ml-2">Updated {timeAgo(acc.balance_updated_at)}</span>
                        {acc.institution_name === 'Shopify Balance' && (
                          <button
                            onClick={async () => {
                              const v = window.prompt('New Main account balance (from Shopify Balance screen), e.g. 1505.61:');
                              if (!v) return;
                              const centsVal = Math.round(parseFloat(v) * 100);
                              if (!isFinite(centsVal)) return;
                              const r = await fetch('/api/cfo/anchor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId, balanceCents: centsVal }) });
                              const d = await r.json();
                              window.alert(d.error ? `Failed: ${d.error}` : `Reconciliation gate: ${d.message}`);
                              if (!d.error) window.location.reload();
                            }}
                            className="ml-2 text-blue-400 hover:text-blue-300 text-[10px]"
                          >
                            ↻ update via reconciliation gate
                          </button>
                        )}
                      </td>
                      <td className={`px-5 py-3 text-right font-medium ${acc.balance_available_cents < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{cents(acc.balance_available_cents)}</td>
                    </tr>
                  ))}
                  {data.details.bankAccounts.length === 0 && (
                    <tr className="border-b border-slate-800/50">
                      <td className="px-5 py-3 text-white font-medium">Bank Accounts</td>
                      <td className="px-5 py-3 text-slate-500 text-xs">No bank accounts connected</td>
                      <td className="px-5 py-3 text-right text-slate-500">$0.00</td>
                    </tr>
                  )}

                  {/* Shopify Balance */}
                  <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-medium">Shopify Balance</td>
                    <td className="px-5 py-3">
                      {data.details.shopify_live?.source === 'shopify_api' ? (
                        <span className="text-xs text-slate-400">
                          <span className="text-[9px] bg-emerald-900/60 text-emerald-300 px-1.5 py-0.5 rounded mr-2 font-semibold">● LIVE</span>
                          pending {cents(data.details.shopify_live.pending_balance_cents || 0)} + scheduled payouts {cents(data.details.shopify_live.scheduled_cents || 0)}
                        </span>
                      ) : editingShopify ? (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 text-xs">$</span>
                          <input type="number" step="0.01" value={shopifyInput}
                            onChange={e => setShopifyInput(e.target.value)}
                            className="w-32 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                          <button onClick={saveShopifyBalance} disabled={savingShopify}
                            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] rounded">Save</button>
                          <button onClick={() => setEditingShopify(false)} className="text-[10px] text-slate-500">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setEditingShopify(true)} className="text-xs text-blue-400 hover:text-blue-300">
                          Manual Input — Click to update
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(data.assets.cash_shopify_cents)}</td>
                  </tr>

                  {/* Shopify Payout */}
                  <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-medium">Shopify Payout</td>
                    <td className="px-5 py-3">
                      {data.details.shopify_live?.source === 'shopify_api' ? (
                        <span className="text-xs text-slate-400">
                          <span className="text-[9px] bg-emerald-900/60 text-emerald-300 px-1.5 py-0.5 rounded mr-2 font-semibold">● LIVE</span>
                          paid out, landing after {(data.details.shopify_live as any).anchor_date || 'today'} — payouts on/before that date are already inside the bank balance (never double-counted)
                        </span>
                      ) : editingPayout ? (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 text-xs">$</span>
                          <input type="number" step="0.01" value={payoutInput}
                            onChange={e => setPayoutInput(e.target.value)}
                            className="w-32 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                          <button onClick={saveShopifyPayout} disabled={savingPayout}
                            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] rounded">Save</button>
                          <button onClick={() => setEditingPayout(false)} className="text-[10px] text-slate-500">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setEditingPayout(true)} className="text-xs text-blue-400 hover:text-blue-300">
                          Manual Input — Click to update
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(data.assets.shopify_payout_cents)}</td>
                  </tr>

                  {/* Reserves — live single row when connected; manual rows otherwise */}
                  {data.details.shopify_live?.source === 'shopify_api' && (
                    <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-white font-medium">Reserves</td>
                      <td className="px-5 py-3">
                        <span className="text-xs text-slate-400">
                          <span className="text-[9px] bg-emerald-900/60 text-emerald-300 px-1.5 py-0.5 rounded mr-2 font-semibold">● LIVE</span>
                          Shopify holdback — net of all reserve events
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(data.assets.reserves_cents)}</td>
                    </tr>
                  )}
                  {data.details.shopify_live?.source !== 'shopify_api' && (data.details.reserves || []).map(r => (
                    editingReserveId === r.id ? (
                      <tr key={r.id} className="border-b border-slate-800/50 bg-slate-800/20">
                        <td className="px-5 py-3 text-white font-medium">Reserve</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <input type="text" placeholder="Held at (e.g. PayPal)" value={reserveHeldAtInput}
                              onChange={e => setReserveHeldAtInput(e.target.value)}
                              className="w-40 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                            <span className="text-slate-400 text-xs">$</span>
                            <input type="number" step="0.01" placeholder="Amount" value={reserveAmountInput}
                              onChange={e => setReserveAmountInput(e.target.value)}
                              className="w-28 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                            <button onClick={() => saveReserve(r.id)} disabled={savingReserve}
                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] rounded">Save</button>
                            <button onClick={() => { setEditingReserveId(null); setReserveAmountInput(''); setReserveHeldAtInput(''); }}
                              className="text-[10px] text-slate-500">Cancel</button>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(r.amount_cents)}</td>
                      </tr>
                    ) : (
                      <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                        <td className="px-5 py-3 text-white font-medium">Reserve</td>
                        <td className="px-5 py-3 text-slate-400 text-xs flex items-center gap-2">
                          Held at: <span className="text-white font-medium">{r.held_at}</span>
                          <button onClick={() => { setEditingReserveId(r.id); setReserveAmountInput(String(r.amount_cents / 100)); setReserveHeldAtInput(r.held_at); }}
                            className="text-blue-400 hover:text-blue-300 ml-2">Edit</button>
                          <button onClick={() => deleteReserve(r.id)}
                            className="text-red-400 hover:text-red-300">Del</button>
                        </td>
                        <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(r.amount_cents)}</td>
                      </tr>
                    )
                  ))}
                  {/* Add Reserve (manual stores only — live stores read reserves from the API) */}
                  {data.details.shopify_live?.source === 'shopify_api' ? null : addingReserve ? (
                    <tr className="border-b border-slate-800/50 bg-slate-800/20">
                      <td className="px-5 py-3 text-white font-medium">New Reserve</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <input type="text" placeholder="Held at (e.g. PayPal)" value={reserveHeldAtInput}
                            onChange={e => setReserveHeldAtInput(e.target.value)}
                            className="w-40 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                          <span className="text-slate-400 text-xs">$</span>
                          <input type="number" step="0.01" placeholder="Amount" value={reserveAmountInput}
                            onChange={e => setReserveAmountInput(e.target.value)}
                            className="w-28 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                          <button onClick={() => saveReserve()} disabled={savingReserve}
                            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] rounded">Save</button>
                          <button onClick={() => { setAddingReserve(false); setReserveAmountInput(''); setReserveHeldAtInput(''); }}
                            className="text-[10px] text-slate-500">Cancel</button>
                        </div>
                      </td>
                      <td className="px-5 py-3" />
                    </tr>
                  ) : (
                    <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3" colSpan={2}>
                        <button onClick={() => setAddingReserve(true)} className="text-xs text-blue-400 hover:text-blue-300">
                          + Add Reserve
                        </button>
                      </td>
                      <td className="px-5 py-3" />
                    </tr>
                  )}

                  {/* Inventory */}
                  <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-medium">Inventory</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      {editingOverride === 'inventory_details' ? (
                        <div className="flex items-center gap-2">
                          <input type="text" value={overrideInput} onChange={e => setOverrideInput(e.target.value)}
                            className="flex-1 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
                            autoFocus onKeyDown={e => e.key === 'Enter' && saveOverride('inventory_details', overrideInput)} />
                          <button onClick={() => saveOverride('inventory_details', overrideInput)} className="px-2 py-1 bg-blue-600 text-white text-[10px] rounded">Save</button>
                          <button onClick={() => saveOverride('inventory_details', '')} className="text-[10px] text-red-400">Clear</button>
                          <button onClick={() => setEditingOverride(null)} className="text-[10px] text-slate-500">Cancel</button>
                        </div>
                      ) : (
                        <span className="cursor-pointer hover:text-blue-400" onClick={() => { setEditingOverride('inventory_details'); setOverrideInput(cfoOverrides['inventory_details'] || ''); }}>
                          {cfoOverrides['inventory_details'] || `Unsold inventory at cost (cost basis: ${cents(data.details.inventory.cost_basis_cents)})`}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(data.assets.inventory_cents)}</td>
                  </tr>

                  {/* Loans Receivable */}
                  {data.assets.loans_receivable_cents > 0 && (
                    <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-white font-medium">Loans Receivable</td>
                      <td className="px-5 py-3 text-slate-400 text-xs">
                        Money lent out (total: {cents(data.details.loans.lent_total_cents)})
                      </td>
                      <td className="px-5 py-3 text-right text-emerald-400 font-medium">{cents(data.assets.loans_receivable_cents)}</td>
                    </tr>
                  )}

                  {/* Total */}
                  <tr className="bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-bold" colSpan={2}>Total Assets</td>
                    <td className="px-5 py-3 text-right text-emerald-400 font-bold text-base">{cents(data.assets.total_cents)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* LIABILITIES SECTION */}
          <div className="mb-8">
            <h2 className="text-lg font-bold text-red-400 mb-4 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500" />
              Liabilities
            </h2>
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="text-left px-5 py-3">Account</th>
                    <th className="text-left px-5 py-3">Details</th>
                    <th className="text-right px-5 py-3">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Current Unpaid Fulfillment Bill */}
                  <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-medium">Current Unpaid Fulfillment Bill</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      {editingOverride === 'fulfillment_details' ? (
                        <div className="flex items-center gap-2">
                          <input type="text" value={overrideInput} onChange={e => setOverrideInput(e.target.value)}
                            className="flex-1 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
                            placeholder="Custom details text..." autoFocus onKeyDown={e => e.key === 'Enter' && saveOverride('fulfillment_details', overrideInput)} />
                          <button onClick={() => saveOverride('fulfillment_details', overrideInput)} className="px-2 py-1 bg-blue-600 text-white text-[10px] rounded">Save</button>
                          <button onClick={() => saveOverride('fulfillment_details', '')} className="text-[10px] text-red-400">Clear</button>
                          <button onClick={() => setEditingOverride(null)} className="text-[10px] text-slate-500">Cancel</button>
                        </div>
                      ) : (
                        <span className="cursor-pointer hover:text-blue-400" onClick={() => { setEditingOverride('fulfillment_details'); setOverrideInput(cfoOverrides['fulfillment_details'] || ''); }}>
                          {cfoOverrides['fulfillment_details'] || 'ShipSourced balance owed'}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-red-400 font-medium">{cents(data.details.fulfillment.balance_cents)}</td>
                  </tr>
                  {/* Unfulfilled Orders Estimated Bill */}
                  <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-medium">Unfulfilled Orders Est. Fulfillment Bill</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      {editingOverride === 'unfulfilled_details' ? (
                        <div className="flex items-center gap-2">
                          <input type="text" value={overrideInput} onChange={e => setOverrideInput(e.target.value)}
                            className="flex-1 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
                            placeholder="Custom details text..." autoFocus onKeyDown={e => e.key === 'Enter' && saveOverride('unfulfilled_details', overrideInput)} />
                          <button onClick={() => saveOverride('unfulfilled_details', overrideInput)} className="px-2 py-1 bg-blue-600 text-white text-[10px] rounded">Save</button>
                          <button onClick={() => saveOverride('unfulfilled_details', '')} className="text-[10px] text-red-400">Clear</button>
                          <button onClick={() => setEditingOverride(null)} className="text-[10px] text-slate-500">Cancel</button>
                        </div>
                      ) : (
                        <span className="cursor-pointer hover:text-blue-400" onClick={() => { setEditingOverride('unfulfilled_details'); setOverrideInput(cfoOverrides['unfulfilled_details'] || ''); }}>
                          {cfoOverrides['unfulfilled_details'] || (<>
                            {data.details.fulfillment.total_unfulfilled} unfulfilled orders
                            {data.details.fulfillment.total_unfulfilled > 0 && (
                              <span className="ml-2 text-slate-500">
                                ({data.details.fulfillment.unfulfilled_with_estimate} have estimate @ avg {cents((data.details.fulfillment as any).avg_per_order_cents || 0)}/order
                                {(data.details.fulfillment as any).without_estimate > 0 && (
                                  <> + {(data.details.fulfillment as any).without_estimate} projected</>
                                )})
                              </span>
                            )}
                          </>)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-orange-400 font-medium">{cents(data.details.fulfillment.estimated_cents)}</td>
                  </tr>

                  {/* Ad Invoices Balance Due - Per Platform */}
                  {data.details.adSpend.platforms && Object.entries(data.details.adSpend.platforms).map(([platform, info]: [string, any]) => (
                    <tr key={platform} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-white font-medium flex items-center gap-2">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          platform === 'facebook' ? 'bg-blue-900/50 text-blue-400' : 'bg-green-900/50 text-green-400'
                        }`}>{platform === 'facebook' ? 'FB' : 'Google'}</span>
                        Ad Invoices
                      </td>
                      <td className="px-5 py-3 text-slate-400 text-xs">
                        Charged: {cents(info.charged)} — Paid: {cents(info.paid)}
                      </td>
                      <td className="px-5 py-3 text-right text-red-400 font-medium">{cents(Math.max(0, info.balance))}</td>
                    </tr>
                  ))}
                  {(!data.details.adSpend.platforms || Object.keys(data.details.adSpend.platforms).length === 0) && (
                  <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-medium">Ad Invoices (Balance Due)</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      Invoiced: {cents(data.details.adSpend.total_invoiced_cents)} - Paid: {cents(data.details.adSpend.total_paid_cents)}
                    </td>
                    <td className="px-5 py-3 text-right text-red-400 font-medium">{cents(data.liabilities.ad_spend_pending_cents)}</td>
                  </tr>
                  )}

                  {/* FB Pending (Unbilled) */}
                  {data.liabilities.fb_pending_balance_cents > 0 && (
                    <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-white font-medium">FB Pending (Unbilled)</td>
                      <td className="px-5 py-3 text-slate-400 text-xs">
                        {editingOverride === 'fb_pending_details' ? (
                          <div className="flex items-center gap-2">
                            <input type="text" value={overrideInput} onChange={e => setOverrideInput(e.target.value)}
                              className="flex-1 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
                              autoFocus onKeyDown={e => e.key === 'Enter' && saveOverride('fb_pending_details', overrideInput)} />
                            <button onClick={() => saveOverride('fb_pending_details', overrideInput)} className="px-2 py-1 bg-blue-600 text-white text-[10px] rounded">Save</button>
                            <button onClick={() => saveOverride('fb_pending_details', '')} className="text-[10px] text-red-400">Clear</button>
                            <button onClick={() => setEditingOverride(null)} className="text-[10px] text-slate-500">Cancel</button>
                          </div>
                        ) : (
                          <span className="cursor-pointer hover:text-blue-400" onClick={() => { setEditingOverride('fb_pending_details'); setOverrideInput(cfoOverrides['fb_pending_details'] || ''); }}>
                            {cfoOverrides['fb_pending_details'] || 'Spend not yet charged to card \u2014 live from Facebook API'}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right text-orange-400 font-medium">{cents(data.liabilities.fb_pending_balance_cents)}</td>
                    </tr>
                  )}

                  {/* App Invoices */}
                  <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-medium">App Invoices (Balance Due)</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      {editingOverride === 'app_invoices_details' ? (
                        <div className="flex items-center gap-2">
                          <input type="text" value={overrideInput} onChange={e => setOverrideInput(e.target.value)}
                            className="flex-1 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
                            autoFocus onKeyDown={e => e.key === 'Enter' && saveOverride('app_invoices_details', overrideInput)} />
                          <button onClick={() => saveOverride('app_invoices_details', overrideInput)} className="px-2 py-1 bg-blue-600 text-white text-[10px] rounded">Save</button>
                          <button onClick={() => saveOverride('app_invoices_details', '')} className="text-[10px] text-red-400">Clear</button>
                          <button onClick={() => setEditingOverride(null)} className="text-[10px] text-slate-500">Cancel</button>
                        </div>
                      ) : (
                        <span className="cursor-pointer hover:text-blue-400" onClick={() => { setEditingOverride('app_invoices_details'); setOverrideInput(cfoOverrides['app_invoices_details'] || ''); }}>
                          {cfoOverrides['app_invoices_details'] || (<>
                            Charged: {cents(data.details.appInvoices.total_charged_cents)} - Paid: {cents(data.details.appInvoices.total_paid_cents)}
                            {data.details.appInvoices.last_invoice && (
                              <span className="ml-2 text-slate-600">
                                Last: #{data.details.appInvoices.last_invoice.bill_number} on {data.details.appInvoices.last_invoice.date} ({cents(data.details.appInvoices.last_invoice.total_cents)})
                              </span>
                            )}
                          </>)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-red-400 font-medium">{cents(data.liabilities.app_invoices_due_cents)}</td>
                  </tr>

                  {/* Loans Payable */}
                  {data.liabilities.loans_payable_cents > 0 && (
                    <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-white font-medium">Loans Payable</td>
                      <td className="px-5 py-3 text-slate-400 text-xs">
                        Borrowed: {cents(data.details.loans.borrowed_total_cents)} — Remaining
                      </td>
                      <td className="px-5 py-3 text-right text-red-400 font-medium">{cents(data.liabilities.loans_payable_cents)}</td>
                    </tr>
                  )}

                  {/* Manual Credit Cards */}
                  {(data.details.manualCreditCards || []).map(cc => (
                    editingCCId === cc.id ? (
                    <tr key={cc.id} className="border-b border-slate-800/50">
                      <td className="px-5 py-3 text-white font-medium">Credit Card</td>
                      <td className="px-5 py-3">
                        <div className="flex gap-2 items-center">
                          <input type="text" placeholder="Card name (e.g. Amex Gold 1006)" value={ccNameInput}
                            onChange={e => setCcNameInput(e.target.value)}
                            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white w-48 focus:outline-none focus:border-red-500" />
                          <input type="number" step="0.01" placeholder="Amount owed" value={ccAmountInput}
                            onChange={e => setCcAmountInput(e.target.value)}
                            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white w-28 focus:outline-none focus:border-red-500" />
                          <button onClick={() => saveManualCC(cc.id)} disabled={savingCC}
                            className="text-xs text-emerald-400 hover:text-emerald-300">Save</button>
                          <button onClick={() => { setEditingCCId(null); setCcNameInput(''); setCcAmountInput(''); }}
                            className="text-xs text-slate-500 hover:text-slate-400">Cancel</button>
                        </div>
                      </td>
                      <td className="px-5 py-3" />
                    </tr>
                    ) : (
                    <tr key={cc.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-white font-medium">Credit Card</td>
                      <td className="px-5 py-3 text-slate-400 text-xs">
                        {cc.card_name}
                        <button onClick={() => { setEditingCCId(cc.id); setCcNameInput(cc.card_name); setCcAmountInput(String(cc.amount_owed_cents / 100)); }}
                          className="ml-2 text-blue-400 hover:text-blue-300">Edit</button>
                        <button onClick={() => deleteManualCC(cc.id)}
                          className="ml-2 text-red-400 hover:text-red-300">Delete</button>
                      </td>
                      <td className="px-5 py-3 text-right text-red-400 font-medium">{cents(cc.amount_owed_cents)}</td>
                    </tr>
                    )
                  ))}
                  {/* Add Credit Card */}
                  {addingCC ? (
                    <tr className="border-b border-slate-800/50">
                      <td className="px-5 py-3 text-white font-medium">New Credit Card</td>
                      <td className="px-5 py-3">
                        <div className="flex gap-2 items-center">
                          <input type="text" placeholder="Card name (e.g. Amex Gold 1006)" value={ccNameInput}
                            onChange={e => setCcNameInput(e.target.value)}
                            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white w-48 focus:outline-none focus:border-red-500" />
                          <input type="number" step="0.01" placeholder="Amount owed" value={ccAmountInput}
                            onChange={e => setCcAmountInput(e.target.value)}
                            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white w-28 focus:outline-none focus:border-red-500" />
                          <button onClick={() => saveManualCC()} disabled={savingCC}
                            className="text-xs text-emerald-400 hover:text-emerald-300">Save</button>
                          <button onClick={() => { setAddingCC(false); setCcNameInput(''); setCcAmountInput(''); }}
                            className="text-xs text-slate-500 hover:text-slate-400">Cancel</button>
                        </div>
                      </td>
                      <td className="px-5 py-3" />
                    </tr>
                  ) : (
                    <tr className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3" colSpan={2}>
                        <button onClick={() => setAddingCC(true)} className="text-xs text-blue-400 hover:text-blue-300">
                          + Add Credit Card</button>
                      </td>
                      <td className="px-5 py-3" />
                    </tr>
                  )}

                  {/* Total */}
                  <tr className="bg-slate-800/30">
                    <td className="px-5 py-3 text-white font-bold" colSpan={2}>Total Liabilities</td>
                    <td className="px-5 py-3 text-right text-red-400 font-bold text-base">{cents(data.liabilities.total_cents)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* EQUITY */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Net Equity (Assets - Liabilities)</h2>
                <p className="text-xs text-slate-400 mt-1">
                  {cents(data.assets.total_cents)} - {cents(data.liabilities.total_cents)}
                </p>
              </div>
              <p className={`text-3xl font-bold ${data.equity_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {cents(data.equity_cents)}
              </p>
            </div>
          </div>

          {/* RECONCILIATION — does the balance sheet tie out to the P&L? */}
          <ReconciliationPanel recon={recon} onRecompute={async () => {
            const r = await fetch(`/api/cfo/reconcile?storeId=${storeId}&recompute=1`);
            const rd = await r.json();
            setRecon(rd.latest || null);
          }} />

          {/* SNAPSHOT HISTORY */}
          {snapshots.length > 0 && (
            <div className="mt-8 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-white">Saved Snapshots</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                      <th className="text-left px-5 py-3">Date</th>
                      <th className="text-right px-5 py-3">Assets</th>
                      <th className="text-right px-5 py-3">Liabilities</th>
                      <th className="text-right px-5 py-3">Equity</th>
                      <th className="text-right px-5 py-3">Change</th>
                      <th className="text-right px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((snap, i) => {
                      // Blocked snapshots are invisible to the math: compare against the
                      // previous NON-blocked snapshot, and show no change on blocked rows.
                      const prev = snap.excluded ? undefined : snapshots.slice(i + 1).find(p => !p.excluded);
                      const change = prev ? snap.equity_cents - prev.equity_cents : 0;
                      return (
                        <tr key={snap.id} className={`border-b border-slate-800/50 hover:bg-slate-800/30 ${snap.excluded ? 'opacity-40' : ''}`}>
                          <td className="px-5 py-3 text-slate-300">{snap.snapshot_date}
                            <span className="text-[10px] text-slate-600 ml-2">{snap.created_at?.slice(11, 16)}</span>
                            {!!snap.excluded && <span className="ml-2 text-[9px] uppercase bg-red-900/50 text-red-300 rounded px-1.5 py-0.5">blocked</span>}
                          </td>
                          <td className="px-5 py-3 text-right text-emerald-400">{cents(snap.assets_cents)}</td>
                          <td className="px-5 py-3 text-right text-red-400">{cents(snap.liabilities_cents)}</td>
                          <td className={`px-5 py-3 text-right font-medium ${snap.equity_cents >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>{cents(snap.equity_cents)}</td>
                          <td className="px-5 py-3 text-right">
                            {prev ? (
                              <span className={`text-xs ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {change >= 0 ? '+' : ''}{cents(change)}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-600">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <button
                              onClick={async () => {
                                const blocking = !snap.excluded;
                                if (blocking && !confirm(`Block the ${snap.snapshot_date} ${snap.created_at?.slice(11, 16)} snapshot?\n\nIt will be skipped by the reconciliation chain — fix your data, then save a fresh snapshot and the window re-runs from the previous good snapshot.`)) return;
                                await fetch('/api/cfo/reconcile', {
                                  method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ snapshotId: snap.id, excluded: blocking }),
                                });
                                loadData();
                              }}
                              title={snap.excluded ? 'Unblock — include this snapshot in the reconciliation chain again' : 'Block — skip this snapshot so you can fix data and resubmit a fresh one'}
                              className={`text-xs px-2 py-1 rounded transition-colors ${snap.excluded ? 'text-emerald-400 hover:bg-emerald-900/30' : 'text-red-400 hover:bg-red-900/30'}`}
                            >
                              {snap.excluded ? '↩ Unblock' : '🚫 Block'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

export default function CFOPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    }>
      <CFOContent />
    </Suspense>
  );
}
