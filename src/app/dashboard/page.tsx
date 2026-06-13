'use client';

import { useEffect, useState, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import StoreSelector from '@/components/StoreSelector';

interface Store {
  id: string;
  name: string;
  shopify_domain: string | null;
  shipsourced_client_id: string | null;
  last_synced_at: string | null;
  auto_sync: number;
  mtd_revenue: number | null;
  mtd_profit: number | null;
  mtd_orders: number | null;
  mtd_ad_spend: number | null;
  platform: string;
  fb_connected: number;
  chargeflow_connected: number;
  invoices_verified: number;
}

interface Alert {
  id: string;
  store_id: string;
  store_name: string;
  note: string;
  category: string;
}

interface Totals {
  revenue_cents: number;
  cogs_cents: number;
  shipping_cents: number;
  pick_pack_cents: number;
  packaging_cents: number;
  ad_spend_cents: number;
  shopify_fees_cents: number;
  other_costs_cents: number;
  net_profit_cents: number;
  order_count: number;
  margin_pct: number;
}

interface PnlRow {
  period: string;
  revenue_cents: number;
  ad_spend_cents: number;
  net_profit_cents: number;
  order_count: number;
  margin_pct: number;
}

interface SparkPoint { date: string; rev: number; profit: number }

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function centsCompact(amount: number): string {
  const abs = Math.abs(amount / 100);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
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

function syncStatus(lastSynced: string | null): { color: string; label: string } {
  if (!lastSynced) return { color: 'bg-slate-600', label: 'Not synced' };
  const d = new Date(lastSynced + 'Z');
  const hours = (Date.now() - d.getTime()) / 3600000;
  if (hours < 1) return { color: 'bg-emerald-500', label: 'Synced' };
  if (hours < 6) return { color: 'bg-yellow-500', label: 'Stale' };
  return { color: 'bg-red-500', label: 'Outdated' };
}

// SVG Sparkline for store cards
function Sparkline({ data, width = 80, height = 24, color = '#60a5fa' }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
}

// SVG area chart for main trend
function TrendChart({ rows }: { rows: PnlRow[] }) {
  if (rows.length < 2) return <div className="text-slate-500 text-sm text-center py-8">Not enough data for chart</div>;

  const sorted = [...rows].reverse(); // oldest first
  const W = 700, H = 200, PAD = 40, PADR = 60;
  const chartW = W - PAD - PADR;
  const chartH = H - 50;

  const revs = sorted.map(r => r.revenue_cents || 0);
  const profits = sorted.map(r => r.net_profit_cents || 0);
  const allVals = [...revs, ...profits];
  const maxVal = Math.max(...allVals, 1);
  const minVal = Math.min(...allVals, 0);
  const range = maxVal - minVal || 1;

  function yPos(v: number) { return 20 + chartH - ((v - minVal) / range) * chartH; }
  function xPos(i: number) { return PAD + (i / (sorted.length - 1)) * chartW; }

  const revLine = sorted.map((_, i) => `${xPos(i)},${yPos(revs[i])}`).join(' ');
  const profitLine = sorted.map((_, i) => `${xPos(i)},${yPos(profits[i])}`).join(' ');

  // Area fill for revenue
  const revArea = `${xPos(0)},${yPos(0)} ${revLine} ${xPos(sorted.length - 1)},${yPos(0)}`;

  // Zero line
  const zeroY = yPos(0);

  // Y-axis labels
  const yLabels = [maxVal, maxVal * 0.5 + minVal * 0.5, minVal].filter((v, i, a) => i === 0 || v !== a[i - 1]);

  // X-axis labels (show ~5 dates)
  const step = Math.max(1, Math.floor(sorted.length / 5));
  const xLabels = sorted.filter((_, i) => i % step === 0 || i === sorted.length - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* Grid lines */}
      {yLabels.map((v, i) => (
        <g key={i}>
          <line x1={PAD} y1={yPos(v)} x2={W - PADR} y2={yPos(v)} stroke="#334155" strokeWidth="0.5" />
          <text x={W - PADR + 5} y={yPos(v) + 4} fill="#64748b" fontSize="9" fontFamily="monospace">{centsCompact(v)}</text>
        </g>
      ))}
      {/* Zero line */}
      {minVal < 0 && <line x1={PAD} y1={zeroY} x2={W - PADR} y2={zeroY} stroke="#475569" strokeWidth="1" strokeDasharray="4,4" />}
      {/* Revenue area */}
      <polygon points={revArea} fill="url(#revGradient)" opacity="0.15" />
      {/* Revenue line */}
      <polyline fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" points={revLine} />
      {/* Profit line */}
      <polyline fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" strokeDasharray="4,2" points={profitLine} />
      {/* X labels */}
      {xLabels.map((row, i) => {
        const idx = sorted.indexOf(row);
        return <text key={i} x={xPos(idx)} y={H - 5} fill="#64748b" fontSize="9" textAnchor="middle" fontFamily="monospace">{row.period.slice(5)}</text>;
      })}
      {/* Legend */}
      <line x1={PAD} y1={H - 18} x2={PAD + 15} y2={H - 18} stroke="#3b82f6" strokeWidth="2" />
      <text x={PAD + 19} y={H - 14} fill="#94a3b8" fontSize="9">Revenue</text>
      <line x1={PAD + 75} y1={H - 18} x2={PAD + 90} y2={H - 18} stroke="#10b981" strokeWidth="2" strokeDasharray="4,2" />
      <text x={PAD + 94} y={H - 14} fill="#94a3b8" fontSize="9">Profit</text>
      {/* Gradient def */}
      <defs>
        <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Comparison badge
function CompareBadge({ current, previous, invert = false }: { current: number; previous: number; invert?: boolean }) {
  if (!previous || previous === 0) return null;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  const isPositive = invert ? change <= 0 : change >= 0;
  const arrow = change >= 0 ? '\u2191' : '\u2193';
  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ml-2 ${
      isPositive ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/40 text-red-400'
    }`}>
      {arrow} {Math.abs(change).toFixed(1)}%
    </span>
  );
}

type SortKey = 'name' | 'revenue' | 'profit' | 'margin' | 'orders' | 'roas';

function DashboardContent() {
  const searchParams = useSearchParams();
  const storeId = searchParams.get('storeId') || '';

  const [stores, setStores] = useState<Store[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [sparklines, setSparklines] = useState<Record<string, SparkPoint[]>>({});
  const [totals, setTotals] = useState<Totals | null>(null);
  const [prevTotals, setPrevTotals] = useState<Totals | null>(null);
  const [rows, setRows] = useState<PnlRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoSynced, setAutoSynced] = useState(false);
  const [range, setRange] = useState<'daily' | 'yesterday' | 'monthly' | 'yearly'>('monthly');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('revenue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function getPacificDate(offset = 0): string {
    const now = new Date();
    const pacific = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    pacific.setDate(pacific.getDate() + offset);
    const y = pacific.getFullYear();
    const m = String(pacific.getMonth() + 1).padStart(2, '0');
    const d = String(pacific.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getRangeFrom(r: string): string {
    const today = getPacificDate();
    const y = today.slice(0, 4);
    const m = today.slice(5, 7);
    if (r === 'daily') return today;
    if (r === 'yesterday') return getPacificDate(-1);
    if (r === 'yearly') return `${y}-01-01`;
    return `${y}-${m}-01`;
  }

  function getPrevRange(r: string): { from: string; to: string } {
    const today = getPacificDate();
    const y = parseInt(today.slice(0, 4));
    const m = parseInt(today.slice(5, 7));
    const d = parseInt(today.slice(8, 10));
    if (r === 'daily') {
      const prev = getPacificDate(-1);
      return { from: prev, to: prev };
    }
    if (r === 'yesterday') {
      const dayBefore = getPacificDate(-2);
      return { from: dayBefore, to: dayBefore };
    }
    if (r === 'yearly') {
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    }
    // monthly: same day range in previous month
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    const pmStr = String(pm).padStart(2, '0');
    const prevDayMax = new Date(py, pm, 0).getDate();
    const prevDay = Math.min(d, prevDayMax);
    return { from: `${py}-${pmStr}-01`, to: `${py}-${pmStr}-${String(prevDay).padStart(2, '0')}` };
  }

  const rangeLabel = range === 'daily' ? 'Today' : range === 'yesterday' ? 'Yesterday' : range === 'monthly' ? 'MTD' : 'YTD';
  const prevLabel = range === 'daily' ? 'yesterday' : range === 'yesterday' ? '2 days ago' : range === 'monthly' ? 'last month' : 'last year';

  useEffect(() => {
    loadData();
    if (!autoSynced) {
      fetch('/api/sync/auto', { method: 'POST' })
        .then(r => r.json())
        .then(data => {
          if (data.synced) {
            setSyncResult(`Auto-synced ${data.recordsSynced} records from ${data.staleStores} store(s)`);
            loadData();
          }
          setAutoSynced(true);
        })
        .catch(() => setAutoSynced(true));
    }
  }, [storeId, range]);

  // Near-real-time revenue: fast today-only Shopify sync on load + every 90s while
  // the dashboard is open. Decoupled from the heavy /api/sync/auto path so today's
  // numbers stay fresh without waiting for the 30-min background sync.
  useEffect(() => {
    let cancelled = false;
    const url = storeId ? `/api/sync/today?storeId=${storeId}` : '/api/sync/today';
    const tick = async () => {
      try {
        const res = await fetch(url, { method: 'POST' });
        const d = await res.json();
        if (!cancelled && d.synced > 0) loadData({ silent: true });
      } catch {}
    };
    tick(); // immediate refresh on load / store / range change
    const interval = setInterval(tick, 90000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [storeId, range]);

  async function loadData(opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true);
    const from = getRangeFrom(range);
    const prev = getPrevRange(range);
    const pnlParams = new URLSearchParams({ period: 'daily', from });
    if (range === 'yesterday') pnlParams.set('to', from);
    if (storeId) pnlParams.set('storeId', storeId); else pnlParams.set('visibleOnly', '1');

    const prevPnlParams = new URLSearchParams({ period: 'daily', from: prev.from, to: prev.to });
    if (storeId) prevPnlParams.set('storeId', storeId); else prevPnlParams.set('visibleOnly', '1');

    // Also fetch last 30 days for the chart
    const chartFrom = getPacificDate(-29);
    const chartParams = new URLSearchParams({ period: 'daily', from: chartFrom });
    if (storeId) chartParams.set('storeId', storeId); else chartParams.set('visibleOnly', '1');

    const storesRange = range === 'daily' ? 'daily' : range === 'yesterday' ? 'yesterday' : range === 'yearly' ? 'yearly' : 'monthly';

    const [storesRes, pnlRes, prevPnlRes, chartRes] = await Promise.all([
      fetch(`/api/stores?range=${storesRange}`),
      fetch(`/api/pnl?${pnlParams}`),
      fetch(`/api/pnl?${prevPnlParams}`),
      fetch(`/api/pnl?${chartParams}`),
    ]);
    const storesData = await storesRes.json();
    const pnlData = await pnlRes.json();
    const prevPnlData = await prevPnlRes.json();
    const chartData = await chartRes.json();

    setStores(storesData.stores || []);
    setAlerts(storesData.alerts || []);
    setSparklines(storesData.sparklines || {});
    setTotals(pnlData.totals || null);
    setPrevTotals(prevPnlData.totals || null);
    setRows((chartData.rows || []).slice(0, 30));
    setLoading(false);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    const url = storeId ? `/api/sync/shipsourced?storeId=${storeId}` : '/api/sync/shipsourced';
    const todayUrl = storeId ? `/api/sync/today?storeId=${storeId}` : '/api/sync/today';
    // Refresh today's Shopify revenue in parallel — the ShipSourced sync above does not
    // re-pull Shopify revenue for a single store, so this is what makes "Sync" update it.
    const [res] = await Promise.all([
      fetch(url, { method: 'POST' }),
      fetch(todayUrl, { method: 'POST' }).catch(() => null),
    ]);
    const data = await res.json();
    if (data.success || data.synced > 0) {
      setSyncResult(`Synced ${data.synced} records${data.storesProcessed ? ` from ${data.storesProcessed} stores` : ''}`);
      loadData();
    } else {
      setSyncResult(data.message || data.error || 'Sync completed');
    }
    setSyncing(false);
  }

  // Sort & filter stores
  const visibleStores = stores.filter(s => !(s as any).dashboard_hidden && s.platform === 'shopify');
  const filteredStores = useMemo(() => {
    let list = storeId ? stores.filter(s => s.id === storeId) : visibleStores;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      let av: number, bv: number;
      switch (sortBy) {
        case 'name': return sortDir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
        case 'revenue': av = a.mtd_revenue || 0; bv = b.mtd_revenue || 0; break;
        case 'profit': av = a.mtd_profit || 0; bv = b.mtd_profit || 0; break;
        case 'orders': av = a.mtd_orders || 0; bv = b.mtd_orders || 0; break;
        case 'roas':
          av = (a.mtd_ad_spend || 0) > 0 ? (a.mtd_revenue || 0) / (a.mtd_ad_spend || 1) : 0;
          bv = (b.mtd_ad_spend || 0) > 0 ? (b.mtd_revenue || 0) / (b.mtd_ad_spend || 1) : 0;
          break;
        case 'margin':
          av = (a.mtd_revenue || 0) > 0 ? (a.mtd_profit || 0) / (a.mtd_revenue || 1) : -999;
          bv = (b.mtd_revenue || 0) > 0 ? (b.mtd_profit || 0) / (b.mtd_revenue || 1) : -999;
          break;
        default: av = 0; bv = 0;
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [stores, storeId, search, sortBy, sortDir, visibleStores]);

  function toggleSort(key: SortKey) {
    if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('desc'); }
  }

  // Detect anomalies
  const anomalies = useMemo(() => {
    const issues: { store: string; msg: string; severity: 'warn' | 'critical' }[] = [];
    for (const s of visibleStores) {
      const rev = s.mtd_revenue || 0;
      const profit = s.mtd_profit || 0;
      const adSpend = s.mtd_ad_spend || 0;
      const margin = rev > 0 ? (profit / rev) * 100 : 0;
      if (rev > 10000 && margin < -50) issues.push({ store: s.name, msg: `Margin at ${margin.toFixed(0)}% — bleeding cash`, severity: 'critical' });
      else if (rev > 5000 && margin < -20) issues.push({ store: s.name, msg: `Negative margin ${margin.toFixed(0)}%`, severity: 'warn' });
      if (adSpend > rev * 2 && adSpend > 5000) issues.push({ store: s.name, msg: `Ad spend (${centsCompact(adSpend)}) is ${(adSpend / (rev || 1)).toFixed(1)}x revenue`, severity: 'critical' });
      const spark = sparklines[s.id];
      if (spark && spark.length >= 3) {
        const recent = spark.slice(-2).reduce((s, p) => s + p.rev, 0) / 2;
        const older = spark.slice(0, -2).reduce((s, p) => s + p.rev, 0) / Math.max(1, spark.length - 2);
        if (older > 5000 && recent < older * 0.3) issues.push({ store: s.name, msg: `Revenue dropped ${((1 - recent / older) * 100).toFixed(0)}% vs prior days`, severity: 'warn' });
      }
    }
    return issues;
  }, [visibleStores, sparklines]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }

  const roas = (totals?.ad_spend_cents || 0) > 0 ? (totals?.revenue_cents || 0) / (totals?.ad_spend_cents || 1) : 0;
  const prevRoas = (prevTotals?.ad_spend_cents || 0) > 0 ? (prevTotals?.revenue_cents || 0) / (prevTotals?.ad_spend_cents || 1) : 0;

  const kpis = [
    { label: 'Revenue', value: cents(totals?.revenue_cents || 0), prev: prevTotals?.revenue_cents || 0, current: totals?.revenue_cents || 0, color: 'text-white' },
    { label: 'Ad Spend', value: cents(totals?.ad_spend_cents || 0), prev: prevTotals?.ad_spend_cents || 0, current: totals?.ad_spend_cents || 0, color: 'text-orange-400', invert: true },
    { label: 'Net Profit', value: cents(totals?.net_profit_cents || 0), prev: prevTotals?.net_profit_cents || 0, current: totals?.net_profit_cents || 0, color: (totals?.net_profit_cents || 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'ROAS', value: `${roas.toFixed(2)}x`, prev: prevRoas, current: roas, color: roas >= 2 ? 'text-emerald-400' : roas >= 1 ? 'text-yellow-400' : 'text-red-400', raw: true },
    { label: 'Margin', value: pct(totals?.margin_pct || 0), prev: prevTotals?.margin_pct || 0, current: totals?.margin_pct || 0, color: (totals?.margin_pct || 0) >= 20 ? 'text-emerald-400' : (totals?.margin_pct || 0) >= 10 ? 'text-yellow-400' : 'text-red-400', raw: true },
    { label: 'Orders', value: (totals?.order_count || 0).toLocaleString(), prev: prevTotals?.order_count || 0, current: totals?.order_count || 0, color: 'text-blue-400' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="text-sm text-slate-400 mt-1">
              {storeId ? filteredStores[0]?.name || 'Store' : 'All stores'}
            </p>
          </div>
          <StoreSelector />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-800 rounded-lg p-0.5">
            {(['daily', 'yesterday', 'monthly', 'yearly'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  range === r ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {r === 'daily' ? 'Today' : r === 'yesterday' ? 'Yesterday' : r === 'monthly' ? 'MTD' : 'YTD'}
              </button>
            ))}
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            {syncing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            Sync
          </button>
        </div>
      </div>

      {syncResult && (
        <div className="mb-4 px-4 py-3 bg-blue-900/30 border border-blue-800 rounded-lg text-sm text-blue-300">
          {syncResult}
        </div>
      )}

      {/* Anomaly Alerts */}
      {anomalies.length > 0 && (
        <div className="mb-6 space-y-2">
          {anomalies.map((a, i) => (
            <div key={i} className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${
              a.severity === 'critical'
                ? 'bg-red-900/20 border-red-800/50'
                : 'bg-amber-900/20 border-amber-800/50'
            }`}>
              <span className={`mt-0.5 text-sm ${a.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`}>
                {a.severity === 'critical' ? '!!' : '!'}
              </span>
              <div>
                <span className={`text-sm font-medium ${a.severity === 'critical' ? 'text-red-300' : 'text-amber-300'}`}>{a.store}:</span>
                <span className={`text-sm ml-1.5 ${a.severity === 'critical' ? 'text-red-200/80' : 'text-amber-200/80'}`}>{a.msg}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Action Required Alerts */}
      {alerts.filter(a => !stores.find(s => s.id === a.store_id)).length > 0 && (
        <div className="mb-6 space-y-2">
          {alerts.filter(a => !stores.find(s => s.id === a.store_id)).map((alert) => (
            <div key={alert.id} className="flex items-start gap-3 px-4 py-3 bg-amber-900/20 border border-amber-800/50 rounded-lg">
              <span className="text-amber-400 mt-0.5 text-sm">!</span>
              <div>
                <span className="text-sm font-medium text-amber-300">{alert.store_name}:</span>
                <span className="text-sm text-amber-200/80 ml-1.5">{alert.note}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{kpi.label}</p>
            <p className={`text-lg font-bold ${kpi.color}`}>
              {kpi.value}
              {kpi.prev !== undefined && kpi.prev !== 0 && (
                <CompareBadge
                  current={(kpi as any).raw ? kpi.current : kpi.current}
                  previous={(kpi as any).raw ? kpi.prev : kpi.prev}
                  invert={(kpi as any).invert}
                />
              )}
            </p>
            {kpi.prev !== undefined && kpi.prev !== 0 && !((kpi as any).raw) && (
              <p className="text-[10px] text-slate-500 mt-1">vs {prevLabel}: {cents(kpi.prev)}</p>
            )}
          </div>
        ))}
      </div>

      {/* Trend Chart */}
      {rows.length >= 2 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-white mb-3">30-Day Trend</h2>
          <TrendChart rows={rows} />
        </div>
      )}

      {/* Cost Breakdown */}
      {totals && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-white mb-4">Cost Breakdown ({rangeLabel})</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {[
              { label: 'Fulfillment', value: (totals.cogs_cents || 0) + (totals.shipping_cents || 0) },
              { label: 'Ad Spend', value: totals.ad_spend_cents },
              { label: 'Platform Fees', value: totals.shopify_fees_cents },
              { label: 'Other Costs', value: totals.other_costs_cents },
              { label: 'Total Costs', value: (totals.cogs_cents || 0) + (totals.shipping_cents || 0) + (totals.ad_spend_cents || 0) + (totals.shopify_fees_cents || 0) + (totals.other_costs_cents || 0) },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-xs text-slate-500 mb-0.5">{item.label}</p>
                <p className={`text-sm font-semibold ${item.label === 'Total Costs' ? 'text-orange-400' : 'text-slate-300'}`}>{cents(item.value || 0)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-Store Summary */}
      {!storeId && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-white">Stores ({rangeLabel})</h2>
              <span className="text-xs text-slate-500">{filteredStores.length} stores</span>
            </div>
            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="relative">
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-36 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-600"
                />
              </div>
              {/* Sort buttons */}
              <div className="flex bg-slate-800 rounded-lg p-0.5 gap-0.5">
                {([['revenue', 'Rev'], ['profit', 'Profit'], ['roas', 'ROAS'], ['margin', '%'], ['orders', '#']] as [SortKey, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => toggleSort(key)}
                    className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                      sortBy === key ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-white'
                    }`}
                  >
                    {label} {sortBy === key && (sortDir === 'desc' ? '\u2193' : '\u2191')}
                  </button>
                ))}
              </div>
              <Link href="/dashboard/stores" className="text-xs text-blue-400 hover:text-blue-300">
                View All
              </Link>
            </div>
          </div>
          {filteredStores.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-slate-400 mb-3">{search ? 'No stores match your search' : 'No stores configured yet'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredStores.map((store) => {
                const margin = (store.mtd_revenue || 0) > 0
                  ? ((store.mtd_profit || 0) / (store.mtd_revenue || 1)) * 100
                  : 0;
                const storeRoas = (store.mtd_ad_spend || 0) > 0
                  ? (store.mtd_revenue || 0) / (store.mtd_ad_spend || 1)
                  : 0;
                const sync = syncStatus(store.last_synced_at);
                const spark = sparklines[store.id] || [];
                const sparkRevData = spark.map(p => p.rev);
                const sparkColor = margin >= 0 ? '#10b981' : '#ef4444';
                return (
                  <Link
                    key={store.id}
                    href={`/dashboard/stores/${store.id}`}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-white">{store.name}</h3>
                      </div>
                      <div className="flex items-center gap-2">
                        {sparkRevData.length >= 2 && <Sparkline data={sparkRevData} color={sparkColor} />}
                        {store.shipsourced_client_id && (
                          <div className="flex items-center gap-1.5">
                            <div className={`w-2 h-2 rounded-full ${sync.color}`} />
                            <span className="text-[10px] text-slate-500">{timeAgo(store.last_synced_at)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase">Revenue</p>
                        <p className="text-sm font-semibold text-white">{centsCompact(store.mtd_revenue || 0)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase">Profit</p>
                        <p className={`text-sm font-semibold ${(store.mtd_profit || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {centsCompact(store.mtd_profit || 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase">ROAS</p>
                        <p className={`text-sm font-semibold ${storeRoas >= 2 ? 'text-emerald-400' : storeRoas >= 1 ? 'text-yellow-400' : storeRoas > 0 ? 'text-red-400' : 'text-slate-500'}`}>
                          {storeRoas > 0 ? `${storeRoas.toFixed(1)}x` : '--'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase">Margin</p>
                        <p className={`text-sm font-semibold ${margin >= 20 ? 'text-emerald-400' : margin >= 10 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {pct(margin)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">
                        {(store.mtd_orders || 0).toLocaleString()} orders {range === 'daily' ? 'today' : range === 'yesterday' ? 'yesterday' : range === 'monthly' ? 'this month' : 'this year'}
                        {(store.mtd_ad_spend || 0) > 0 && <> &middot; {centsCompact(store.mtd_ad_spend || 0)} ad spend</>}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded ${
                        store.fb_connected ? 'bg-emerald-900/40 text-emerald-400' : 'bg-slate-800 text-slate-500'
                      }`}>
                        {store.fb_connected ? '\u2713' : '\u2717'} FB
                      </span>
                      <span className={`inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded ${
                        store.chargeflow_connected ? 'bg-emerald-900/40 text-emerald-400' : 'bg-slate-800 text-slate-500'
                      }`}>
                        {store.chargeflow_connected ? '\u2713' : '\u2717'} Chargeflow
                      </span>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          fetch('/api/stores', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ storeId: store.id, invoices_verified: !store.invoices_verified }),
                          }).then(() => loadData());
                        }}
                        className={`inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded transition-colors ${
                          store.invoices_verified ? 'bg-emerald-900/40 text-emerald-400' : 'bg-slate-800 text-slate-500 hover:bg-slate-700'
                        }`}
                      >
                        {store.invoices_verified ? '\u2713' : '\u2717'} Invoices
                      </button>
                    </div>
                    {alerts.filter(a => a.store_id === store.id).map((alert) => (
                      <div key={alert.id} className="mt-2 px-2 py-1.5 bg-amber-900/20 border border-amber-800/40 rounded text-[10px] text-amber-300/80 leading-tight">
                        {alert.note}
                      </div>
                    ))}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Recent Daily P&L Table */}
      {rows.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-white">Last 30 Days</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                  <th className="text-left px-5 py-3">Date</th>
                  <th className="text-right px-5 py-3">Revenue</th>
                  <th className="text-right px-5 py-3">Ad Spend</th>
                  <th className="text-right px-5 py-3">ROAS</th>
                  <th className="text-right px-5 py-3">Profit</th>
                  <th className="text-right px-5 py-3">Margin</th>
                  <th className="text-right px-5 py-3">Orders</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const rowRoas = (row.ad_spend_cents || 0) > 0 ? (row.revenue_cents || 0) / (row.ad_spend_cents || 1) : 0;
                  return (
                    <tr key={row.period} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-5 py-3 text-slate-300">{row.period}</td>
                      <td className="px-5 py-3 text-right text-white font-medium">{cents(row.revenue_cents || 0)}</td>
                      <td className="px-5 py-3 text-right text-orange-400">{cents(row.ad_spend_cents || 0)}</td>
                      <td className={`px-5 py-3 text-right ${rowRoas >= 2 ? 'text-emerald-400' : rowRoas >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {rowRoas > 0 ? `${rowRoas.toFixed(2)}x` : '--'}
                      </td>
                      <td className={`px-5 py-3 text-right font-medium ${(row.net_profit_cents || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {cents(row.net_profit_cents || 0)}
                      </td>
                      <td className={`px-5 py-3 text-right ${(row.margin_pct || 0) >= 20 ? 'text-emerald-400' : (row.margin_pct || 0) >= 10 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {pct(row.margin_pct || 0)}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-400">{(row.order_count || 0).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
