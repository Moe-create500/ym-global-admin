'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Store {
  id: string;
  name: string;
  shopify_domain: string | null;
  shipsourced_client_id: string | null;
  shipsourced_client_name: string | null;
  shopify_monthly_plan_cents: number;
  notes: string | null;
  ss_charges_pending_cents: number;
  ss_total_paid_cents: number;
  ss_net_owed_cents: number;
}

interface PnlRow {
  period: string;
  revenue_cents: number;
  cogs_cents: number;
  shipping_cents: number;
  pick_pack_cents: number;
  packaging_cents: number;
  ad_spend_cents: number;
  shopify_fees_cents: number;
  other_costs_cents: number;
  chargeback_cents: number;
  app_costs_cents: number;
  net_profit_cents: number;
  order_count: number;
  margin_pct: number;
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
  chargeback_cents: number;
  app_costs_cents: number;
  net_profit_cents: number;
  order_count: number;
  margin_pct: number;
}

interface Chargeback {
  id: string;
  order_number: string | null;
  chargeback_date: string;
  amount_cents: number;
  reason: string | null;
  status: string;
  chargeflow_fee_cents: number;
  notes: string | null;
  source: string;
}

interface ChargebackSummary {
  total: number;
  open_count: number;
  won_count: number;
  lost_count: number;
  total_cents: number;
  lost_cents: number;
  won_cents: number;
  total_fee_cents: number;
  win_rate: number;
}

interface Order {
  id: string;
  order_number: string;
  order_name: string;
  created_at_shopify: string;
  order_date: string;
  financial_status: string | null;
  fulfillment_status: string | null;
  total_cents: number;
  subtotal_cents: number;
  shipping_cents: number;
  taxes_cents: number;
  discount_cents: number;
  refunded_cents: number;
  net_revenue_cents: number;
  line_items: string | null;
  line_item_count: number;
  customer_email: string | null;
  ss_charge_cents: number;
  ss_charge_is_estimate: number;
}

function cents(amount: number): string {
  return (amount / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function statusBadge(status: string | null): { text: string; cls: string } {
  switch (status) {
    case 'paid': return { text: 'Paid', cls: 'bg-emerald-900/40 text-emerald-400 border-emerald-800' };
    case 'refunded': return { text: 'Refunded', cls: 'bg-red-900/40 text-red-400 border-red-800' };
    case 'partially_refunded': return { text: 'Partial Refund', cls: 'bg-yellow-900/40 text-yellow-400 border-yellow-800' };
    case 'pending': return { text: 'Pending', cls: 'bg-slate-800 text-slate-400 border-slate-700' };
    case 'voided': return { text: 'Voided', cls: 'bg-slate-800 text-slate-500 border-slate-700' };
    default: return { text: status || 'Unknown', cls: 'bg-slate-800 text-slate-400 border-slate-700' };
  }
}

export default function StoreDetailPage() {
  const params = useParams();
  const router = useRouter();
  const storeId = params.id as string;

  const [store, setStore] = useState<Store | null>(null);
  const [ssCharges, setSsCharges] = useState({ billed_cents: 0, balance_cents: 0, charged_cents: 0, estimated_cents: 0, total_cents: 0 });
  const [activeTab, setActiveTab] = useState<'pnl' | 'orders' | 'fulfillment' | 'chargebacks' | 'inventory'>('pnl');

  // Chargebacks state
  const [chargebacks, setChargebacks] = useState<Chargeback[]>([]);
  const [cbSummary, setCbSummary] = useState<ChargebackSummary | null>(null);
  const [cbLoading, setCbLoading] = useState(false);
  const [cbOrderNum, setCbOrderNum] = useState('');
  const [cbDate, setCbDate] = useState('');
  const [cbAmount, setCbAmount] = useState('');
  const [cbReason, setCbReason] = useState('');
  const [cbAdding, setCbAdding] = useState(false);
  const [cbSyncing, setCbSyncing] = useState(false);
  const [cbSyncResult, setCbSyncResult] = useState<{ imported: number; updated: number; total: number } | null>(null);

  // P&L state
  const [rows, setRows] = useState<PnlRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [loading, setLoading] = useState(true);

  // Orders state
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersTotalPages, setOrdersTotalPages] = useState(0);
  const [ordersSummary, setOrdersSummary] = useState({ totalRevenue: 0, totalOrders: 0, totalRefunded: 0, totalCharges: 0 });
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersSearch, setOrdersSearch] = useState('');
  const [ordersSource, setOrdersSource] = useState('');
  const [ordersStatus, setOrdersStatus] = useState('');
  const [ordersDateRange, setOrdersDateRange] = useState({ from: '', to: '' });
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  // Import state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; updated: number; skipped: number; total: number; recalculated?: number } | null>(null);
  const [pullingSS, setPullingSS] = useState(false);
  const [pullSSResult, setPullSSResult] = useState<{ imported: number; updated: number; total: number; skusImported?: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fulfillment state
  interface SkuPricingRule {
    id: string;
    sku: string;
    label: string;
    base_charge_cents: number;
    extra_unit_charge_cents: number;
    extra_unit_after: number;
    effective_from: string;
    effective_to: string | null;
  }
  const [pricingRules, setPricingRules] = useState<SkuPricingRule[]>([]);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [missingOrders, setMissingOrders] = useState<Order[]>([]);
  const [missingTotal, setMissingTotal] = useState(0);
  const [missingPage, setMissingPage] = useState(1);
  const [missingTotalPages, setMissingTotalPages] = useState(0);
  const [missingLoading, setMissingLoading] = useState(false);
  const [applyingPricing, setApplyingPricing] = useState(false);
  const [applyResult, setApplyResult] = useState<{ updated: number; skipped: number; total: number } | null>(null);
  const [newRule, setNewRule] = useState({ sku: '', label: '', baseCharge: '', extraCharge: '', extraAfter: '1', from: '', to: '' });
  const [savingRule, setSavingRule] = useState(false);
  interface SkuGap { sku: string; product_name: string; min_date: string; max_date: string; order_count: number; }
  const [skuGaps, setSkuGaps] = useState<SkuGap[]>([]);

  // SS Payments state
  interface SSPayment { id: string; amount_cents: number; date: string; note: string | null; source: string; }
  const [ssPayments, setSsPayments] = useState<SSPayment[]>([]);
  const [ssTotalPaid, setSsTotalPaid] = useState(0);
  const [ssPayForm, setSsPayForm] = useState({ amount: '', date: '', note: '' });
  const [ssPayAdding, setSsPayAdding] = useState(false);
  const [ssPayShowForm, setSsPayShowForm] = useState(false);

  // Inventory state
  interface InvProduct { product_name: string; sku: string | null; total_purchased: number; total_cost_cents: number; avg_cost_cents: number; total_sold: number; remaining: number; asset_value_cents: number; }
  interface InvSummary { total_asset_value_cents: number; total_cost_basis_cents: number; total_sold_value_cents: number; product_count: number; }
  const [invProducts, setInvProducts] = useState<InvProduct[]>([]);
  const [invSummary, setInvSummary] = useState<InvSummary | null>(null);
  const [invLoading, setInvLoading] = useState(false);
  const [invForm, setInvForm] = useState({ sku: '', productName: '', qty: '', costPerUnit: '', purchaseDate: '', supplier: '', note: '' });
  const [invAdding, setInvAdding] = useState(false);
  const [invShowForm, setInvShowForm] = useState(false);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', shopifyDomain: '', shopifyAccessToken: '', shipsourcedClientId: '', shopifyMonthlyPlanCents: '' });
  const [saving, setSaving] = useState(false);
  const [autoSynced, setAutoSynced] = useState(false);

  useEffect(() => { loadStore(); }, [storeId]);
  useEffect(() => { loadPnl(); }, [storeId, period, dateRange]);

  useEffect(() => {
    if (autoSynced) return;
    fetch('/api/sync/auto', { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.synced) loadPnl();
        setAutoSynced(true);
      })
      .catch(() => setAutoSynced(true));
  }, [autoSynced]);

  // Load orders when tab switches or filters change
  useEffect(() => {
    if (activeTab === 'orders') loadOrders();
  }, [activeTab, ordersPage, ordersSearch, ordersSource, ordersStatus, ordersDateRange]);

  // Load fulfillment data when tab switches
  useEffect(() => {
    if (activeTab === 'fulfillment') { loadPricingRules(); loadMissingOrders(); }
  }, [activeTab, missingPage]);

  // Load chargebacks when tab switches
  useEffect(() => {
    if (activeTab === 'chargebacks') loadChargebacks();
  }, [activeTab]);

  async function loadStore() {
    const res = await fetch(`/api/stores/${storeId}`);
    if (!res.ok) { router.push('/dashboard/stores'); return; }
    const data = await res.json();
    setStore(data.store);
    if (data.ssCharges) setSsCharges(data.ssCharges);
    setEditForm({
      name: data.store.name || '',
      shopifyDomain: data.store.shopify_domain || '',
      shopifyAccessToken: data.store.shopify_access_token || '',
      shipsourcedClientId: data.store.shipsourced_client_id || '',
      shopifyMonthlyPlanCents: data.store.shopify_monthly_plan_cents ? String(data.store.shopify_monthly_plan_cents / 100) : '',
    });
    loadSSPayments();
  }

  async function loadSSPayments() {
    const res = await fetch(`/api/stores/${storeId}/ss-payments`);
    const data = await res.json();
    setSsPayments(data.payments || []);
    setSsTotalPaid(data.total_paid_cents || 0);
  }

  async function addSSPayment(e: React.FormEvent) {
    e.preventDefault();
    setSsPayAdding(true);
    await fetch(`/api/stores/${storeId}/ss-payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ssPayForm),
    });
    setSsPayForm({ amount: '', date: '', note: '' });
    setSsPayShowForm(false);
    setSsPayAdding(false);
    loadStore();
  }

  async function deleteSSPayment(paymentId: string) {
    await fetch(`/api/stores/${storeId}/ss-payments?paymentId=${paymentId}`, { method: 'DELETE' });
    loadStore();
  }

  async function loadInventory() {
    setInvLoading(true);
    const res = await fetch(`/api/stores/${storeId}/inventory`);
    const data = await res.json();
    setInvProducts(data.products || []);
    setInvSummary(data.summary || null);
    setInvLoading(false);
  }

  async function addInventory(e: React.FormEvent) {
    e.preventDefault();
    setInvAdding(true);
    await fetch(`/api/stores/${storeId}/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invForm),
    });
    setInvForm({ sku: '', productName: '', qty: '', costPerUnit: '', purchaseDate: '', supplier: '', note: '' });
    setInvShowForm(false);
    setInvAdding(false);
    loadInventory();
  }

  async function deleteInventory(purchaseId: string) {
    await fetch(`/api/stores/${storeId}/inventory?purchaseId=${purchaseId}`, { method: 'DELETE' });
    loadInventory();
  }

  async function loadPnl() {
    setLoading(true);
    const p = new URLSearchParams({ storeId, period });
    if (dateRange.from) p.set('from', dateRange.from);
    if (dateRange.to) p.set('to', dateRange.to);
    const res = await fetch(`/api/pnl?${p}`);
    const data = await res.json();
    setRows(data.rows || []);
    setTotals(data.totals || null);
    setLoading(false);
  }

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    const p = new URLSearchParams({ storeId, page: String(ordersPage), limit: '50' });
    if (ordersSearch) p.set('search', ordersSearch);
    if (ordersSource === 'missing_charge') {
      p.set('missingCharge', '1');
    } else if (ordersSource) {
      p.set('source', ordersSource);
    }
    if (ordersStatus) p.set('status', ordersStatus);
    if (ordersDateRange.from) p.set('from', ordersDateRange.from);
    if (ordersDateRange.to) p.set('to', ordersDateRange.to);
    const res = await fetch(`/api/orders?${p}`);
    const data = await res.json();
    setOrders(data.orders || []);
    setOrdersTotal(data.total || 0);
    setOrdersTotalPages(data.totalPages || 0);
    setOrdersSummary(data.summary || { totalRevenue: 0, totalOrders: 0, totalRefunded: 0, totalCharges: 0 });
    setOrdersLoading(false);
  }, [storeId, ordersPage, ordersSearch, ordersSource, ordersStatus, ordersDateRange]);

  async function loadPricingRules() {
    setPricingLoading(true);
    const res = await fetch(`/api/sku-pricing?storeId=${storeId}&gaps=1`);
    const data = await res.json();
    setPricingRules(data.rules || []);
    setSkuGaps(data.gaps || []);
    setPricingLoading(false);
  }

  async function loadMissingOrders() {
    setMissingLoading(true);
    const p = new URLSearchParams({ storeId, page: String(missingPage), limit: '50', missingCharge: '1' });
    const res = await fetch(`/api/orders?${p}`);
    const data = await res.json();
    setMissingOrders(data.orders || []);
    setMissingTotal(data.total || 0);
    setMissingTotalPages(data.totalPages || 0);
    setMissingLoading(false);
  }

  async function loadChargebacks() {
    setCbLoading(true);
    const res = await fetch(`/api/chargebacks?storeId=${storeId}`);
    const data = await res.json();
    setChargebacks(data.chargebacks || []);
    setCbSummary(data.summary || null);
    setCbLoading(false);
  }

  async function handleAddChargeback(e: React.FormEvent) {
    e.preventDefault();
    if (!cbDate || !cbAmount) return;
    setCbAdding(true);
    await fetch('/api/chargebacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId, orderNumber: cbOrderNum || null,
        chargebackDate: cbDate,
        amountCents: Math.round(parseFloat(cbAmount) * 100),
        reason: cbReason || null,
      }),
    });
    setCbAdding(false);
    setCbOrderNum(''); setCbDate(''); setCbAmount(''); setCbReason('');
    loadChargebacks();
    loadPnl();
  }

  async function handleCbStatus(id: string, status: string) {
    await fetch('/api/chargebacks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    loadChargebacks();
    loadPnl();
  }

  async function handleDeleteCb(id: string) {
    if (!confirm('Delete this chargeback?')) return;
    await fetch(`/api/chargebacks?id=${id}`, { method: 'DELETE' });
    loadChargebacks();
    loadPnl();
  }

  async function handleSyncChargeflow() {
    setCbSyncing(true);
    setCbSyncResult(null);
    const res = await fetch('/api/chargebacks/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId }),
    });
    const data = await res.json();
    setCbSyncing(false);
    if (data.success) {
      setCbSyncResult(data);
      loadChargebacks();
      loadPnl();
    }
  }

  async function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    if (!newRule.sku || !newRule.from) return;
    setSavingRule(true);
    await fetch('/api/sku-pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId,
        sku: newRule.sku,
        label: newRule.label,
        baseChargeCents: Math.round(parseFloat(newRule.baseCharge || '0') * 100),
        extraUnitChargeCents: Math.round(parseFloat(newRule.extraCharge || '0') * 100),
        extraUnitAfter: parseInt(newRule.extraAfter || '1') || 1,
        effectiveFrom: newRule.from,
        effectiveTo: newRule.to || null,
      }),
    });
    setSavingRule(false);
    setNewRule({ sku: '', label: '', baseCharge: '', extraCharge: '', extraAfter: '1', from: '', to: '' });
    loadPricingRules();
  }

  async function handleDeleteRule(id: string) {
    await fetch(`/api/sku-pricing?id=${id}`, { method: 'DELETE' });
    loadPricingRules();
  }

  async function handleApplyPricing() {
    setApplyingPricing(true);
    setApplyResult(null);
    const res = await fetch('/api/orders/apply-pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId }),
    });
    const data = await res.json();
    setApplyingPricing(false);
    if (data.success) {
      setApplyResult(data);
      loadMissingOrders();
      loadPnl();
      if (activeTab === 'orders' || ordersTotal > 0) loadOrders();
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch(`/api/stores/${storeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editForm.name,
        shopifyDomain: editForm.shopifyDomain || null,
        shopifyAccessToken: editForm.shopifyAccessToken || null,
        shipsourcedClientId: editForm.shipsourcedClientId || null,
        shopifyMonthlyPlanCents: editForm.shopifyMonthlyPlanCents ? parseInt(editForm.shopifyMonthlyPlanCents) * 100 : 0,
      }),
    });
    setEditing(false);
    setSaving(false);
    loadStore();
  }

  async function handleDelete() {
    if (!confirm('Deactivate this store? It will be hidden from the dashboard.')) return;
    await fetch(`/api/stores/${storeId}`, { method: 'DELETE' });
    router.push('/dashboard/stores');
  }

  async function handleCSVImport(file: File) {
    setImporting(true);
    setImportResult(null);
    const text = await file.text();
    const res = await fetch('/api/orders/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId, csvText: text }),
    });
    const data = await res.json();
    setImporting(false);
    if (data.success) {
      setImportResult(data);
      loadOrders();
      loadPnl(); // Refresh P&L since revenue was recalculated
    }
  }

  async function handlePullShipSourced() {
    setPullingSS(true);
    setPullSSResult(null);
    const res = await fetch('/api/orders/pull-shipsourced', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId }),
    });
    const data = await res.json();
    setPullingSS(false);
    if (data.success) {
      setPullSSResult(data);
      loadOrders();
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
      handleCSVImport(file);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleCSVImport(file);
    e.target.value = '';
  }

  if (!store) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
        <Link href="/dashboard/stores" className="hover:text-slate-300">Stores</Link>
        <span>/</span>
        <span className="text-slate-300">{store.name}</span>
      </div>

      {/* Store Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{store.name}</h1>
          {store.shopify_domain && (
            <p className="text-sm text-slate-400 mt-1">{store.shopify_domain}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(!editing)}
            className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 rounded-lg transition-colors"
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 rounded-lg transition-colors"
          >
            Deactivate
          </button>
        </div>
      </div>

      {/* Edit Form */}
      {editing && (
        <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Store Name</label>
              <input
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Shopify Domain</label>
              <input
                type="text"
                value={editForm.shopifyDomain}
                onChange={(e) => setEditForm({ ...editForm, shopifyDomain: e.target.value })}
                placeholder="store.myshopify.com"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Shopify Access Token</label>
              <input
                type="password"
                value={editForm.shopifyAccessToken}
                onChange={(e) => setEditForm({ ...editForm, shopifyAccessToken: e.target.value })}
                placeholder="shpat_..."
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
              <p className="text-[10px] text-slate-600 mt-1">Settings &gt; Apps &gt; Develop apps &gt; Create app &gt; read_orders scope</p>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">ShipSourced Client ID</label>
              <input
                type="text"
                value={editForm.shipsourcedClientId}
                onChange={(e) => setEditForm({ ...editForm, shipsourcedClientId: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Shopify Monthly Plan ($)</label>
              <input
                type="number"
                value={editForm.shopifyMonthlyPlanCents}
                onChange={(e) => setEditForm({ ...editForm, shopifyMonthlyPlanCents: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}

      {/* Totals Summary */}
      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Revenue', value: cents(totals.revenue_cents || 0), color: 'text-white' },
            { label: 'Fulfillment', value: cents(totals.shipping_cents || 0), color: 'text-slate-300' },
            { label: 'Ad Spend', value: cents(totals.ad_spend_cents || 0), color: 'text-orange-400', link: `/dashboard/ads/payments?storeId=${store.id}` },
            { label: 'Shopify Fees', value: cents(totals.shopify_fees_cents || 0), color: 'text-purple-400' },
            { label: 'App Costs', value: cents(totals.app_costs_cents || 0), color: 'text-violet-400', link: `/dashboard/app-invoices?storeId=${store.id}` },
            { label: 'Chargebacks', value: cents(totals.chargeback_cents || 0), color: 'text-red-400' },
            { label: 'Net Profit', value: cents(totals.net_profit_cents || 0), color: (totals.net_profit_cents || 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
            { label: 'Margin', value: pct(totals.margin_pct || 0), color: (totals.margin_pct || 0) >= 20 ? 'text-emerald-400' : 'text-yellow-400' },
            { label: 'Orders', value: (totals.order_count || 0).toLocaleString(), color: 'text-blue-400' },
          ].map((kpi) => (
            kpi.link ? (
              <Link key={kpi.label} href={kpi.link} className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-slate-600 transition-colors">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{kpi.label}</p>
                <p className={`text-lg font-bold ${kpi.color}`}>{kpi.value}</p>
              </Link>
            ) : (
              <div key={kpi.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{kpi.label}</p>
                <p className={`text-lg font-bold ${kpi.color}`}>{kpi.value}</p>
              </div>
            )
          ))}
        </div>
      )}

      {/* ShipSourced Balance */}
      {store.shipsourced_client_id && (ssCharges.total_cents > 0 || ssTotalPaid > 0) && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-slate-500 uppercase tracking-wider">ShipSourced Balance</p>
            <button
              onClick={() => setSsPayShowForm(!ssPayShowForm)}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              {ssPayShowForm ? 'Cancel' : '+ Add Payment'}
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div>
              <p className="text-[10px] text-slate-500">SS Balance (Billed)</p>
              <p className="text-sm font-semibold text-white">{cents(ssCharges.billed_cents)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500">Payments Made</p>
              <p className="text-sm font-semibold text-emerald-400">{cents(ssTotalPaid)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500">Estimated (Pending)</p>
              <p className="text-sm font-semibold text-yellow-400">{cents(ssCharges.estimated_cents)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500">Total Owed (Billed + Est. - Paid)</p>
              <p className="text-sm font-semibold text-orange-400">{cents(ssCharges.billed_cents + ssCharges.estimated_cents - ssTotalPaid)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500">Balance Owed</p>
              <p className={`text-sm font-semibold ${ssCharges.balance_cents > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {cents(ssCharges.balance_cents)}
              </p>
            </div>
          </div>

          {/* Add Payment Form */}
          {ssPayShowForm && (
            <form onSubmit={addSSPayment} className="mt-4 pt-4 border-t border-slate-800 flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-[10px] text-slate-500 mb-1">Amount ($)</label>
                <input type="number" step="0.01" required value={ssPayForm.amount}
                  onChange={e => setSsPayForm({ ...ssPayForm, amount: e.target.value })}
                  className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                  placeholder="0.00" />
              </div>
              <div className="flex-1">
                <label className="block text-[10px] text-slate-500 mb-1">Date</label>
                <input type="date" required value={ssPayForm.date}
                  onChange={e => setSsPayForm({ ...ssPayForm, date: e.target.value })}
                  className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div className="flex-1">
                <label className="block text-[10px] text-slate-500 mb-1">Note</label>
                <input type="text" value={ssPayForm.note}
                  onChange={e => setSsPayForm({ ...ssPayForm, note: e.target.value })}
                  className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                  placeholder="Optional" />
              </div>
              <button type="submit" disabled={ssPayAdding}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                {ssPayAdding ? 'Adding...' : 'Add'}
              </button>
            </form>
          )}

          {/* Payments List */}
          {ssPayments.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-800">
              <p className="text-[10px] text-slate-500 uppercase mb-2">Payment History</p>
              <div className="space-y-1.5">
                {ssPayments.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400 text-xs">{p.date}</span>
                      <span className="text-emerald-400 font-medium">{cents(p.amount_cents)}</span>
                      {p.note && <span className="text-slate-500 text-xs">{p.note}</span>}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.source === 'manual' ? 'bg-blue-900/30 text-blue-400' : 'bg-slate-800 text-slate-400'}`}>
                        {p.source}
                      </span>
                    </div>
                    {p.source === 'manual' && (
                      <button onClick={() => deleteSSPayment(p.id)} className="text-[10px] text-red-400 hover:text-red-300">
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex bg-slate-900 border border-slate-800 rounded-lg overflow-hidden mb-4">
        {([
          { key: 'pnl' as const, label: 'P&L' },
          { key: 'orders' as const, label: 'Orders' },
          { key: 'fulfillment' as const, label: 'Fulfillment' },
          { key: 'chargebacks' as const, label: 'Chargebacks' },
          { key: 'inventory' as const, label: 'Inventory' },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); if (tab.key === 'inventory') loadInventory(); }}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === tab.key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* P&L Tab */}
      {activeTab === 'pnl' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
              {(['daily', 'weekly', 'monthly'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize ${
                    period === p ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <input
              type="date"
              value={dateRange.from}
              onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
              className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-blue-500"
            />
            <span className="text-slate-500 text-xs">to</span>
            <input
              type="date"
              value={dateRange.to}
              onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
              className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-blue-500"
            />
            {(dateRange.from || dateRange.to) && (
              <button
                onClick={() => setDateRange({ from: '', to: '' })}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                Clear
              </button>
            )}
          </div>

          {/* P&L Table */}
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" />
            </div>
          ) : rows.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-slate-400">No P&L data for this period</p>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                      <th className="text-left px-4 py-3">Period</th>
                      <th className="text-right px-4 py-3">Revenue</th>
                      <th className="text-right px-4 py-3">Fulfillment</th>
                      <th className="text-right px-4 py-3">Ad Spend</th>
                      <th className="text-right px-4 py-3">Shopify Fees</th>
                      <th className="text-right px-4 py-3">App Costs</th>
                      <th className="text-right px-4 py-3">Chargebacks</th>
                      <th className="text-right px-4 py-3">Profit</th>
                      <th className="text-right px-4 py-3">Margin</th>
                      <th className="text-right px-4 py-3">Orders</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.period} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                        <td className="px-4 py-3 text-slate-300">{row.period}</td>
                        <td className="px-4 py-3 text-right text-white font-medium">{cents(row.revenue_cents || 0)}</td>
                        <td className="px-4 py-3 text-right text-slate-400">{cents(row.shipping_cents || 0)}</td>
                        <td className="px-4 py-3 text-right text-orange-400">{cents(row.ad_spend_cents || 0)}</td>
                        <td className="px-4 py-3 text-right text-purple-400">{cents(row.shopify_fees_cents || 0)}</td>
                        <td className="px-4 py-3 text-right text-violet-400">{(row.app_costs_cents || 0) > 0 ? cents(row.app_costs_cents) : '-'}</td>
                        <td className="px-4 py-3 text-right text-red-400">{(row.chargeback_cents || 0) > 0 ? cents(row.chargeback_cents) : '-'}</td>
                        <td className={`px-4 py-3 text-right font-medium ${(row.net_profit_cents || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {cents(row.net_profit_cents || 0)}
                        </td>
                        <td className={`px-4 py-3 text-right ${(row.margin_pct || 0) >= 20 ? 'text-emerald-400' : (row.margin_pct || 0) >= 10 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {pct(row.margin_pct || 0)}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-400">{(row.order_count || 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Orders Tab */}
      {activeTab === 'orders' && (
        <>
          {/* CSV Import Zone */}
          <div
            className={`border-2 border-dashed rounded-xl p-6 mb-4 text-center cursor-pointer transition-colors ${
              dragging ? 'border-blue-500 bg-blue-950/20' : 'border-slate-700 hover:border-slate-600'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileSelect}
            />
            {importing ? (
              <div className="flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400" />
                <span className="text-sm text-slate-400">Importing orders...</span>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                Drop Shopify Orders CSV here or <span className="text-blue-400">click to browse</span>
              </p>
            )}
          </div>

          {/* Pull from ShipSourced */}
          {store.shipsourced_client_id && (
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={handlePullShipSourced}
                disabled={pullingSS}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-sm font-medium text-slate-300 border border-slate-700 rounded-lg transition-colors"
              >
                {pullingSS ? 'Pulling...' : 'Pull ShipSourced Orders'}
              </button>
              {pullSSResult && (
                <span className="text-xs text-emerald-400">
                  {pullSSResult.imported} new, {pullSSResult.updated} updated of {pullSSResult.total}
                  {pullSSResult.skusImported ? ` · ${pullSSResult.skusImported} SKUs synced` : ''}
                </span>
              )}
            </div>
          )}

          {importResult && (
            <div className="bg-emerald-900/20 border border-emerald-800 rounded-lg px-4 py-2 mb-4 text-sm text-emerald-400">
              Imported {importResult.imported} new, updated {importResult.updated}, skipped {importResult.skipped} of {importResult.total} orders.{importResult.recalculated ? ` Recalculated ${importResult.recalculated} days of P&L.` : ''}
            </div>
          )}

          {/* Orders Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <p className="text-[10px] text-slate-500 uppercase">Total Orders</p>
              <p className="text-lg font-bold text-white">{ordersSummary.totalOrders.toLocaleString()}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <p className="text-[10px] text-slate-500 uppercase">Total Revenue</p>
              <p className="text-lg font-bold text-white">{cents(ordersSummary.totalRevenue)}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <p className="text-[10px] text-slate-500 uppercase">SS Charges</p>
              <p className="text-lg font-bold text-orange-400">{cents(ordersSummary.totalCharges)}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <p className="text-[10px] text-slate-500 uppercase">Total Refunded</p>
              <p className="text-lg font-bold text-red-400">{cents(ordersSummary.totalRefunded)}</p>
            </div>
          </div>

          {/* Source Tabs */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg overflow-hidden mb-4">
            {([
              { value: '', label: 'All Orders' },
              { value: 'csv_import', label: 'Shopify CSV' },
              { value: 'shipsourced', label: 'ShipSourced' },
              { value: 'missing_charge', label: 'Missing SS Charge' },
            ] as const).map((tab) => (
              <button
                key={tab.value}
                onClick={() => { setOrdersSource(tab.value); setOrdersPage(1); }}
                className={`px-4 py-1.5 text-xs font-medium ${
                  ordersSource === tab.value ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Orders Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <input
              type="text"
              placeholder="Search order #, email..."
              value={ordersSearch}
              onChange={(e) => { setOrdersSearch(e.target.value); setOrdersPage(1); }}
              className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-blue-500 w-48"
            />
            <select
              value={ordersStatus}
              onChange={(e) => { setOrdersStatus(e.target.value); setOrdersPage(1); }}
              className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-blue-500"
            >
              <option value="">All Statuses</option>
              <option value="paid">Paid</option>
              <option value="refunded">Refunded</option>
              <option value="partially_refunded">Partially Refunded</option>
              <option value="pending">Pending</option>
              <option value="voided">Voided</option>
            </select>
            <input
              type="date"
              value={ordersDateRange.from}
              onChange={(e) => { setOrdersDateRange({ ...ordersDateRange, from: e.target.value }); setOrdersPage(1); }}
              className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-blue-500"
            />
            <span className="text-slate-500 text-xs">to</span>
            <input
              type="date"
              value={ordersDateRange.to}
              onChange={(e) => { setOrdersDateRange({ ...ordersDateRange, to: e.target.value }); setOrdersPage(1); }}
              className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-blue-500"
            />
            {(ordersSearch || ordersStatus || ordersDateRange.from || ordersDateRange.to) && (
              <button
                onClick={() => { setOrdersSearch(''); setOrdersStatus(''); setOrdersDateRange({ from: '', to: '' }); setOrdersPage(1); setOrdersSource(''); }}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                Clear
              </button>
            )}
          </div>

          {/* Orders Table */}
          {ordersLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" />
            </div>
          ) : orders.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-slate-400">{ordersTotal === 0 ? 'No orders imported yet. Upload a Shopify orders CSV to get started.' : 'No orders match your filters.'}</p>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                      <th className="text-left px-4 py-3">Order</th>
                      <th className="text-left px-4 py-3">Date</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-right px-4 py-3">Items</th>
                      <th className="text-right px-4 py-3">Total</th>
                      <th className="text-right px-4 py-3">SS Charge</th>
                      <th className="text-right px-4 py-3">Refund</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => {
                      const badge = statusBadge(order.financial_status);
                      const isExpanded = expandedOrder === order.id;
                      let lineItems: { name: string; qty: number; priceCents: number; sku: string }[] = [];
                      try { lineItems = order.line_items ? JSON.parse(order.line_items) : []; } catch {}

                      const skuSummary = lineItems.map(li => `${li.qty}x ${li.name || li.sku}`).join(', ');

                      return (
                        <>
                        <tr key={order.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer" onClick={() => setExpandedOrder(isExpanded ? null : order.id)}>
                          <td className="px-4 py-3">
                            <span className="text-blue-400 font-medium">{order.order_name}</span>
                            {skuSummary && (
                              <p className="text-[10px] text-slate-500 mt-0.5 max-w-[250px] truncate">{skuSummary}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-400">{order.order_date}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 text-[10px] font-medium rounded border ${badge.cls}`}>
                              {badge.text}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-400">{order.line_item_count}</td>
                          <td className="px-4 py-3 text-right text-white font-medium">{cents(order.total_cents)}</td>
                          <td className="px-4 py-3 text-right">
                            {order.ss_charge_cents > 0 ? (
                              <span className={order.ss_charge_is_estimate ? 'text-yellow-400' : 'text-orange-400'}>
                                {cents(order.ss_charge_cents)}
                                {order.ss_charge_is_estimate ? <span className="text-[9px] ml-0.5">est</span> : ''}
                              </span>
                            ) : <span className="text-slate-600">-</span>}
                          </td>
                          <td className="px-4 py-3 text-right text-red-400">{order.refunded_cents > 0 ? cents(order.refunded_cents) : '-'}</td>
                        </tr>
                        {isExpanded && lineItems.length > 0 && (
                          <tr key={`${order.id}-items`} className="bg-slate-800/20">
                            <td colSpan={7} className="px-6 py-3">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-slate-500">
                                    <th className="text-left pb-1">SKU</th>
                                    <th className="text-left pb-1">Product</th>
                                    <th className="text-right pb-1">Qty</th>
                                    <th className="text-right pb-1">Price</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lineItems.map((li, idx) => (
                                    <tr key={idx} className="text-slate-400">
                                      <td className="py-0.5 font-mono text-[10px] text-slate-500">{li.sku || '-'}</td>
                                      <td className="py-0.5">{li.name}</td>
                                      <td className="py-0.5 text-right">{li.qty}</td>
                                      <td className="py-0.5 text-right">{li.priceCents ? cents(li.priceCents) : '-'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
                <p className="text-xs text-slate-500">
                  Showing {((ordersPage - 1) * 50) + 1}-{Math.min(ordersPage * 50, ordersTotal)} of {ordersTotal.toLocaleString()}
                </p>
                <div className="flex gap-1">
                  <button
                    disabled={ordersPage <= 1}
                    onClick={() => setOrdersPage(p => p - 1)}
                    className="px-3 py-1 text-xs text-slate-400 hover:text-white border border-slate-700 rounded disabled:opacity-30 disabled:hover:text-slate-400"
                  >
                    Previous
                  </button>
                  <button
                    disabled={ordersPage >= ordersTotalPages}
                    onClick={() => setOrdersPage(p => p + 1)}
                    className="px-3 py-1 text-xs text-slate-400 hover:text-white border border-slate-700 rounded disabled:opacity-30 disabled:hover:text-slate-400"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Fulfillment Tab */}
      {activeTab === 'fulfillment' && (
        <>
          {/* SKU Pricing Rules */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-6">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <h3 className="text-sm font-medium text-white">SKU Pricing Rules</h3>
              <button
                onClick={handleApplyPricing}
                disabled={applyingPricing || pricingRules.length === 0}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {applyingPricing ? 'Applying...' : 'Apply to Orders'}
              </button>
            </div>

            {applyResult && (
              <div className="px-4 py-2 bg-emerald-900/20 border-b border-emerald-800 text-xs text-emerald-400">
                Updated {applyResult.updated} orders, skipped {applyResult.skipped} of {applyResult.total}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="text-left px-4 py-2">SKU / Product Name</th>
                    <th className="text-left px-4 py-2">Label</th>
                    <th className="text-right px-4 py-2">Base Charge</th>
                    <th className="text-right px-4 py-2">Extra Unit</th>
                    <th className="text-right px-4 py-2">Extra After</th>
                    <th className="text-left px-4 py-2">From</th>
                    <th className="text-left px-4 py-2">To</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {pricingRules.map((rule) => (
                    <tr key={rule.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-4 py-2 font-mono text-xs text-blue-400">{rule.sku}</td>
                      <td className="px-4 py-2 text-slate-300 text-xs">{rule.label || '-'}</td>
                      <td className="px-4 py-2 text-right text-white">{cents(rule.base_charge_cents)}</td>
                      <td className="px-4 py-2 text-right text-slate-400">{cents(rule.extra_unit_charge_cents)}</td>
                      <td className="px-4 py-2 text-right text-slate-400">{rule.extra_unit_after}</td>
                      <td className="px-4 py-2 text-slate-400 text-xs">{rule.effective_from}</td>
                      <td className="px-4 py-2 text-slate-400 text-xs">{rule.effective_to || 'ongoing'}</td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => handleDeleteRule(rule.id)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                      </td>
                    </tr>
                  ))}
                  {/* Add Rule Row */}
                  <tr className="border-t border-slate-700">
                    <td className="px-4 py-2">
                      <input type="text" placeholder="SKU or product name" value={newRule.sku} onChange={(e) => setNewRule({ ...newRule, sku: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="text" placeholder="Label" value={newRule.label} onChange={(e) => setNewRule({ ...newRule, label: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="number" step="0.01" placeholder="$0.00" value={newRule.baseCharge} onChange={(e) => setNewRule({ ...newRule, baseCharge: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white text-right focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="number" step="0.01" placeholder="$0.00" value={newRule.extraCharge} onChange={(e) => setNewRule({ ...newRule, extraCharge: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white text-right focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="number" min="1" placeholder="1" value={newRule.extraAfter} onChange={(e) => setNewRule({ ...newRule, extraAfter: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white text-right focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="date" value={newRule.from} onChange={(e) => setNewRule({ ...newRule, from: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="date" value={newRule.to} onChange={(e) => setNewRule({ ...newRule, to: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="px-4 py-2">
                      <button onClick={handleAddRule} disabled={savingRule || !newRule.sku || !newRule.from}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium rounded transition-colors">
                        {savingRule ? '...' : 'Add'}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {pricingRules.length === 0 && !pricingLoading && (
              <p className="px-4 py-4 text-xs text-slate-500 text-center">No pricing rules yet. Add one above.</p>
            )}
          </div>

          {/* SKUs Missing Pricing Coverage */}
          {skuGaps.length > 0 && (
            <div className="bg-slate-900 border border-orange-800/40 rounded-xl overflow-hidden mb-6">
              <div className="px-4 py-3 border-b border-slate-800">
                <h3 className="text-sm font-medium text-orange-400">SKUs Without Pricing <span className="text-slate-500 font-normal">({skuGaps.length} SKUs)</span></h3>
                <p className="text-[10px] text-slate-500 mt-0.5">These SKUs have orders on dates not covered by any pricing rule. Click a row to pre-fill the add form.</p>
              </div>
              <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                      <th className="text-left px-4 py-2">SKU / Product Name</th>
                      <th className="text-right px-4 py-2">Uncovered Orders</th>
                      <th className="text-left px-4 py-2">From</th>
                      <th className="text-left px-4 py-2">To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skuGaps.map((gap) => (
                      <tr
                        key={gap.sku}
                        onClick={() => setNewRule({ ...newRule, sku: gap.sku, from: gap.min_date, to: gap.max_date })}
                        className="border-b border-slate-800/50 hover:bg-orange-900/10 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-2 max-w-[350px]">
                          <div className="text-xs text-orange-300 font-mono truncate">{gap.sku}</div>
                          {gap.product_name && gap.product_name !== gap.sku && (
                            <div className="text-[10px] text-slate-400 truncate mt-0.5">{gap.product_name}</div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right text-white text-xs">{gap.order_count}</td>
                        <td className="px-4 py-2 text-slate-400 text-xs">{gap.min_date}</td>
                        <td className="px-4 py-2 text-slate-400 text-xs">{gap.max_date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Orders Missing Pricing */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800">
              <h3 className="text-sm font-medium text-white">Orders Missing Fulfillment Price <span className="text-slate-500 font-normal">({missingTotal})</span></h3>
            </div>

            {missingLoading ? (
              <div className="flex items-center justify-center h-24">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400" />
              </div>
            ) : missingOrders.length === 0 ? (
              <p className="px-4 py-6 text-xs text-slate-500 text-center">All orders have fulfillment pricing.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                        <th className="text-left px-4 py-2">Order</th>
                        <th className="text-left px-4 py-2">Date</th>
                        <th className="text-left px-4 py-2">SKUs</th>
                        <th className="text-right px-4 py-2">Items</th>
                        <th className="text-right px-4 py-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {missingOrders.map((order) => {
                        let lineItems: { name: string; qty: number; sku: string }[] = [];
                        try { lineItems = order.line_items ? JSON.parse(order.line_items) : []; } catch {}
                        const skus = lineItems.map(li => li.sku).filter(Boolean).join(', ');
                        return (
                          <tr key={order.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                            <td className="px-4 py-2 text-blue-400 font-medium text-xs">{order.order_name}</td>
                            <td className="px-4 py-2 text-slate-400 text-xs">{order.order_date}</td>
                            <td className="px-4 py-2 text-slate-500 font-mono text-[10px] max-w-[200px] truncate">{skus || '-'}</td>
                            <td className="px-4 py-2 text-right text-slate-400 text-xs">{order.line_item_count}</td>
                            <td className="px-4 py-2 text-right text-white text-xs">{cents(order.total_cents)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {missingTotalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
                    <p className="text-xs text-slate-500">
                      Showing {((missingPage - 1) * 50) + 1}-{Math.min(missingPage * 50, missingTotal)} of {missingTotal}
                    </p>
                    <div className="flex gap-1">
                      <button disabled={missingPage <= 1} onClick={() => setMissingPage(p => p - 1)}
                        className="px-3 py-1 text-xs text-slate-400 hover:text-white border border-slate-700 rounded disabled:opacity-30">Previous</button>
                      <button disabled={missingPage >= missingTotalPages} onClick={() => setMissingPage(p => p + 1)}
                        className="px-3 py-1 text-xs text-slate-400 hover:text-white border border-slate-700 rounded disabled:opacity-30">Next</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Chargebacks Tab */}
      {activeTab === 'chargebacks' && (
        <>
          {/* Chargeback KPIs */}
          {cbSummary && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
              {[
                { label: 'Total', value: cbSummary.total, color: 'text-white' },
                { label: 'Open', value: cbSummary.open_count, color: 'text-yellow-400' },
                { label: 'Won', value: cbSummary.won_count, color: 'text-emerald-400' },
                { label: 'Lost', value: cbSummary.lost_count, color: 'text-red-400' },
                { label: 'Net Loss', value: cents(cbSummary.lost_cents || 0), color: 'text-red-400' },
                { label: 'Win Rate', value: `${(cbSummary.win_rate || 0).toFixed(1)}%`, color: (cbSummary.win_rate || 0) >= 50 ? 'text-emerald-400' : 'text-yellow-400' },
              ].map((kpi) => (
                <div key={kpi.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{kpi.label}</p>
                  <p className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Sync + Add */}
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={handleSyncChargeflow}
              disabled={cbSyncing}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {cbSyncing ? 'Syncing...' : 'Sync Chargeflow'}
            </button>
            {cbSyncResult && (
              <span className="text-xs text-emerald-400">
                {cbSyncResult.imported} imported, {cbSyncResult.updated} updated of {cbSyncResult.total}
              </span>
            )}
          </div>

          {/* Chargebacks Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800">
              <h3 className="text-sm font-medium text-white">Chargebacks & Disputes</h3>
            </div>

            {cbLoading ? (
              <div className="flex items-center justify-center h-24">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                      <th className="text-left px-4 py-2">Date</th>
                      <th className="text-left px-4 py-2">Order #</th>
                      <th className="text-right px-4 py-2">Amount</th>
                      <th className="text-left px-4 py-2">Reason</th>
                      <th className="text-left px-4 py-2">Status</th>
                      <th className="text-right px-4 py-2">CF Fee</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {chargebacks.map((cb) => (
                      <tr key={cb.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                        <td className="px-4 py-2 text-slate-300 text-xs">{cb.chargeback_date}</td>
                        <td className="px-4 py-2 text-blue-400 text-xs font-medium">{cb.order_number || '-'}</td>
                        <td className="px-4 py-2 text-right text-white font-medium">{cents(cb.amount_cents)}</td>
                        <td className="px-4 py-2 text-slate-400 text-xs max-w-[150px] truncate">{cb.reason || '-'}</td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1">
                            {(['open', 'won', 'lost'] as const).map((s) => (
                              <button
                                key={s}
                                onClick={() => handleCbStatus(cb.id, s)}
                                className={`px-2 py-0.5 text-[10px] font-medium rounded border transition-colors ${
                                  cb.status === s
                                    ? s === 'won' ? 'bg-emerald-900/40 text-emerald-400 border-emerald-800'
                                      : s === 'lost' ? 'bg-red-900/40 text-red-400 border-red-800'
                                      : 'bg-yellow-900/40 text-yellow-400 border-yellow-800'
                                    : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'
                                }`}
                              >
                                {s.charAt(0).toUpperCase() + s.slice(1)}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right text-slate-500 text-xs">{cb.chargeflow_fee_cents > 0 ? cents(cb.chargeflow_fee_cents) : '-'}</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => handleDeleteCb(cb.id)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                        </td>
                      </tr>
                    ))}
                    {/* Add Chargeback Row */}
                    <tr className="border-t border-slate-700">
                      <td className="px-4 py-2">
                        <input type="date" value={cbDate} onChange={(e) => setCbDate(e.target.value)}
                          className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 focus:outline-none focus:border-blue-500" />
                      </td>
                      <td className="px-4 py-2">
                        <input type="text" placeholder="Order #" value={cbOrderNum} onChange={(e) => setCbOrderNum(e.target.value)}
                          className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" step="0.01" placeholder="$0.00" value={cbAmount} onChange={(e) => setCbAmount(e.target.value)}
                          className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white text-right focus:outline-none focus:border-blue-500" />
                      </td>
                      <td className="px-4 py-2">
                        <input type="text" placeholder="Reason" value={cbReason} onChange={(e) => setCbReason(e.target.value)}
                          className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-blue-500" />
                      </td>
                      <td className="px-4 py-2" colSpan={2}>
                        <span className="text-[10px] text-slate-500">Defaults to Open</span>
                      </td>
                      <td className="px-4 py-2">
                        <button onClick={handleAddChargeback} disabled={cbAdding || !cbDate || !cbAmount}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium rounded transition-colors">
                          {cbAdding ? '...' : 'Add'}
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {chargebacks.length === 0 && !cbLoading && (
              <p className="px-4 py-4 text-xs text-slate-500 text-center">No chargebacks recorded. Add one above.</p>
            )}
          </div>
        </>
      )}

      {/* Inventory Tab */}
      {activeTab === 'inventory' && (
        <>
          {/* Inventory KPIs */}
          {invSummary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Inventory Asset Value', value: cents(invSummary.total_asset_value_cents), color: 'text-white' },
                { label: 'Total Invested', value: cents(invSummary.total_cost_basis_cents), color: 'text-blue-400' },
                { label: 'Cost of Goods Sold', value: cents(invSummary.total_sold_value_cents), color: 'text-emerald-400' },
                { label: 'Products Tracked', value: invSummary.product_count, color: 'text-slate-400' },
              ].map((kpi) => (
                <div key={kpi.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{kpi.label}</p>
                  <p className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Add Purchase Button */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Inventory by Product</h2>
            <button
              onClick={() => setInvShowForm(!invShowForm)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {invShowForm ? 'Cancel' : '+ Add Purchase'}
            </button>
          </div>

          {/* Add Purchase Form */}
          {invShowForm && (
            <form onSubmit={addInventory} className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
              <h3 className="text-sm font-semibold text-white mb-4">Record Inventory Purchase</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Product Name *</label>
                  <input type="text" required value={invForm.productName}
                    onChange={e => setInvForm({ ...invForm, productName: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                    placeholder="e.g. Kids Detox Gummies" />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">SKU</label>
                  <input type="text" value={invForm.sku}
                    onChange={e => setInvForm({ ...invForm, sku: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                    placeholder="Shopify variant ID" />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Quantity *</label>
                  <input type="number" required value={invForm.qty}
                    onChange={e => setInvForm({ ...invForm, qty: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                    placeholder="500" />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Cost Per Unit ($) *</label>
                  <input type="number" step="0.01" required value={invForm.costPerUnit}
                    onChange={e => setInvForm({ ...invForm, costPerUnit: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                    placeholder="2.50" />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Purchase Date *</label>
                  <input type="date" required value={invForm.purchaseDate}
                    onChange={e => setInvForm({ ...invForm, purchaseDate: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Supplier</label>
                  <input type="text" value={invForm.supplier}
                    onChange={e => setInvForm({ ...invForm, supplier: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                    placeholder="e.g. China factory" />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Note</label>
                  <input type="text" value={invForm.note}
                    onChange={e => setInvForm({ ...invForm, note: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
                    placeholder="Optional" />
                </div>
                <div className="flex items-end">
                  <button type="submit" disabled={invAdding}
                    className="w-full px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                    {invAdding ? 'Adding...' : `Add (${invForm.qty && invForm.costPerUnit ? '$' + (parseFloat(invForm.qty || '0') * parseFloat(invForm.costPerUnit || '0')).toFixed(2) + ' total' : '...'})`}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Inventory Table */}
          {invLoading ? (
            <div className="flex items-center justify-center h-24">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400" />
            </div>
          ) : invProducts.length > 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                      <th className="text-left px-4 py-3">Product</th>
                      <th className="text-left px-4 py-3">SKU</th>
                      <th className="text-right px-4 py-3">Purchased</th>
                      <th className="text-right px-4 py-3">Sold</th>
                      <th className="text-right px-4 py-3">Remaining</th>
                      <th className="text-right px-4 py-3">Avg Cost</th>
                      <th className="text-right px-4 py-3">Total Invested</th>
                      <th className="text-right px-4 py-3">Asset Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invProducts.map((p, i) => (
                      <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                        <td className="px-4 py-3 text-white font-medium">{p.product_name}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs font-mono">{p.sku || '-'}</td>
                        <td className="px-4 py-3 text-right text-slate-300">{p.total_purchased.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-emerald-400">{p.total_sold.toLocaleString()}</td>
                        <td className={`px-4 py-3 text-right font-medium ${p.remaining <= 0 ? 'text-red-400' : 'text-white'}`}>
                          {p.remaining.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-400">{cents(p.avg_cost_cents)}</td>
                        <td className="px-4 py-3 text-right text-blue-400">{cents(p.total_cost_cents)}</td>
                        <td className="px-4 py-3 text-right text-white font-medium">{cents(p.asset_value_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-slate-400 mb-2">No inventory purchases recorded</p>
              <p className="text-xs text-slate-500">Click "+ Add Purchase" to start tracking inventory</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
