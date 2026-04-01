'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';

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

interface SkuGap {
  sku: string;
  min_date: string;
  max_date: string;
  order_count: number;
}

interface InvProduct {
  product_name: string;
  sku: string | null;
  total_purchased: number;
  total_cost_cents: number;
  avg_cost_cents: number;
  total_sold: number;
  remaining: number;
  asset_value_cents: number;
}

interface InvSummary {
  total_asset_value_cents: number;
  total_cost_basis_cents: number;
  total_sold_value_cents: number;
  product_count: number;
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

export default function AmazonStoreDetailPage() {
  const params = useParams();
  const router = useRouter();
  const storeId = params.id as string;

  const [store, setStore] = useState<Store | null>(null);
  const [activeTab, setActiveTab] = useState<'pnl' | 'orders' | 'fulfillment' | 'inventory'>('pnl');

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
  const [ordersDateRange, setOrdersDateRange] = useState({ from: '', to: '' });
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  // Fulfillment state
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
  const [skuGaps, setSkuGaps] = useState<SkuGap[]>([]);

  // Inventory state
  const [invProducts, setInvProducts] = useState<InvProduct[]>([]);
  const [invSummary, setInvSummary] = useState<InvSummary | null>(null);
  const [invLoading, setInvLoading] = useState(false);

  useEffect(() => { loadStore(); }, [storeId]);
  useEffect(() => { loadPnl(); }, [storeId, period, dateRange]);

  useEffect(() => {
    if (activeTab === 'orders') loadOrders();
    if (activeTab === 'fulfillment') { loadPricingRules(); loadMissingOrders(); }
    if (activeTab === 'inventory') loadInventory();
  }, [activeTab]);

  useEffect(() => { if (activeTab === 'orders') loadOrders(); }, [ordersPage, ordersSearch, ordersDateRange]);
  useEffect(() => { if (activeTab === 'fulfillment') loadMissingOrders(); }, [missingPage]);

  async function loadStore() {
    const res = await fetch(`/api/stores/${storeId}`);
    const data = await res.json();
    if (data.store) {
      setStore(data.store);
    } else {
      router.push('/amazon/stores');
    }
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

  async function loadOrders() {
    setOrdersLoading(true);
    const p = new URLSearchParams({ storeId, page: String(ordersPage), limit: '50' });
    if (ordersSearch) p.set('search', ordersSearch);
    if (ordersDateRange.from) p.set('from', ordersDateRange.from);
    if (ordersDateRange.to) p.set('to', ordersDateRange.to);
    const res = await fetch(`/api/orders?${p}`);
    const data = await res.json();
    setOrders(data.orders || []);
    setOrdersTotal(data.total || 0);
    setOrdersTotalPages(data.totalPages || 0);
    setOrdersSummary(data.summary || { totalRevenue: 0, totalOrders: 0, totalRefunded: 0, totalCharges: 0 });
    setOrdersLoading(false);
  }

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

  async function loadInventory() {
    setInvLoading(true);
    const res = await fetch(`/api/stores/${storeId}/inventory`);
    const data = await res.json();
    setInvProducts(data.products || []);
    setInvSummary(data.summary || null);
    setInvLoading(false);
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
    }
  }

  if (!store) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-400" />
      </div>
    );
  }

  const tabs = [
    { key: 'pnl' as const, label: 'P&L' },
    { key: 'orders' as const, label: 'Orders' },
    { key: 'fulfillment' as const, label: 'Fulfillment' },
    { key: 'inventory' as const, label: 'Inventory' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <button onClick={() => router.push('/amazon/stores')} className="text-xs text-slate-500 hover:text-slate-300 mb-1 flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            All Stores
          </button>
          <h1 className="text-2xl font-bold text-white">{store.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-orange-900/40 text-orange-400 border border-orange-800">Amazon</span>
            {store.shipsourced_client_id && (
              <span className="text-xs text-slate-500">SS: {store.shipsourced_client_id}</span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 bg-slate-900 rounded-xl p-1 w-fit border border-slate-800">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
              activeTab === tab.key ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* P&L Tab */}
      {activeTab === 'pnl' && (
        <>
          {/* Period + Date Controls */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex bg-slate-800 rounded-lg p-0.5">
              {(['daily', 'weekly', 'monthly'] as const).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${period === p ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
            <input type="date" value={dateRange.from} onChange={e => setDateRange({ ...dateRange, from: e.target.value })}
              className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 focus:outline-none focus:border-orange-500" />
            <span className="text-slate-500 text-xs">to</span>
            <input type="date" value={dateRange.to} onChange={e => setDateRange({ ...dateRange, to: e.target.value })}
              className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 focus:outline-none focus:border-orange-500" />
          </div>

          {/* Totals */}
          {totals && (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
              {[
                { label: 'Revenue', value: cents(totals.revenue_cents), color: 'text-white' },
                { label: 'Fulfillment', value: cents(totals.shipping_cents), color: 'text-orange-400' },
                { label: 'Ad Spend', value: cents(totals.ad_spend_cents), color: 'text-orange-400' },
                { label: 'Net Profit', value: cents(totals.net_profit_cents), color: totals.net_profit_cents >= 0 ? 'text-emerald-400' : 'text-red-400' },
                { label: 'Margin', value: pct(totals.margin_pct), color: totals.margin_pct >= 20 ? 'text-emerald-400' : totals.margin_pct >= 10 ? 'text-yellow-400' : 'text-red-400' },
                { label: 'Orders', value: totals.order_count.toLocaleString(), color: 'text-orange-400' },
              ].map(k => (
                <div key={k.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{k.label}</p>
                  <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* P&L Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="text-left px-4 py-2">Period</th>
                    <th className="text-right px-4 py-2">Revenue</th>
                    <th className="text-right px-4 py-2">Fulfillment</th>
                    <th className="text-right px-4 py-2">Ad Spend</th>
                    <th className="text-right px-4 py-2">Fees</th>
                    <th className="text-right px-4 py-2">Profit</th>
                    <th className="text-right px-4 py-2">Margin</th>
                    <th className="text-right px-4 py-2">Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.period} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-4 py-2 text-white font-medium text-xs">{row.period}</td>
                      <td className="px-4 py-2 text-right text-white">{cents(row.revenue_cents)}</td>
                      <td className="px-4 py-2 text-right text-orange-400">{cents(row.shipping_cents)}</td>
                      <td className="px-4 py-2 text-right text-orange-400">{cents(row.ad_spend_cents)}</td>
                      <td className="px-4 py-2 text-right text-slate-400">{cents(row.shopify_fees_cents + row.other_costs_cents)}</td>
                      <td className={`px-4 py-2 text-right font-medium ${row.net_profit_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{cents(row.net_profit_cents)}</td>
                      <td className={`px-4 py-2 text-right ${row.margin_pct >= 20 ? 'text-emerald-400' : row.margin_pct >= 10 ? 'text-yellow-400' : 'text-red-400'}`}>{pct(row.margin_pct)}</td>
                      <td className="px-4 py-2 text-right text-slate-400">{row.order_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && !loading && (
              <p className="px-4 py-6 text-xs text-slate-500 text-center">No P&L data for this period.</p>
            )}
          </div>
        </>
      )}

      {/* Orders Tab */}
      {activeTab === 'orders' && (
        <>
          <div className="flex items-center gap-3 mb-4">
            <input type="text" placeholder="Search orders..." value={ordersSearch}
              onChange={e => { setOrdersSearch(e.target.value); setOrdersPage(1); }}
              className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white w-64 focus:outline-none focus:border-orange-500" />
            <input type="date" value={ordersDateRange.from} onChange={e => { setOrdersDateRange({ ...ordersDateRange, from: e.target.value }); setOrdersPage(1); }}
              className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 focus:outline-none focus:border-orange-500" />
            <span className="text-slate-500 text-xs">to</span>
            <input type="date" value={ordersDateRange.to} onChange={e => { setOrdersDateRange({ ...ordersDateRange, to: e.target.value }); setOrdersPage(1); }}
              className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 focus:outline-none focus:border-orange-500" />
          </div>

          {/* Summary */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Total Revenue', value: cents(ordersSummary.totalRevenue), color: 'text-white' },
              { label: 'Total Orders', value: ordersSummary.totalOrders.toLocaleString(), color: 'text-orange-400' },
              { label: 'Total Refunded', value: cents(ordersSummary.totalRefunded), color: 'text-red-400' },
              { label: 'SS Charges', value: cents(ordersSummary.totalCharges), color: 'text-yellow-400' },
            ].map(k => (
              <div key={k.label} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <p className="text-[10px] text-slate-500 uppercase">{k.label}</p>
                <p className={`text-sm font-bold ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>

          {ordersLoading ? (
            <div className="flex items-center justify-center h-24">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-400" />
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                      <th className="text-left px-4 py-2">Order</th>
                      <th className="text-left px-4 py-2">Date</th>
                      <th className="text-left px-4 py-2">Status</th>
                      <th className="text-right px-4 py-2">Total</th>
                      <th className="text-right px-4 py-2">Items</th>
                      <th className="text-right px-4 py-2">SS Charge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(order => {
                      const badge = statusBadge(order.financial_status);
                      return (
                        <tr key={order.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer"
                          onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}>
                          <td className="px-4 py-2 text-orange-400 font-medium text-xs">{order.order_name}</td>
                          <td className="px-4 py-2 text-slate-400 text-xs">{order.order_date}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex px-2 py-0.5 text-[10px] rounded border ${badge.cls}`}>{badge.text}</span>
                          </td>
                          <td className="px-4 py-2 text-right text-white text-xs">{cents(order.total_cents)}</td>
                          <td className="px-4 py-2 text-right text-slate-400 text-xs">{order.line_item_count}</td>
                          <td className="px-4 py-2 text-right text-yellow-400 text-xs">
                            {order.ss_charge_cents > 0 ? cents(order.ss_charge_cents) : '-'}
                            {order.ss_charge_is_estimate === 1 && <span className="text-slate-600 ml-1">est</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {orders.length === 0 && (
                <p className="px-4 py-6 text-xs text-slate-500 text-center">No orders found.</p>
              )}
              {ordersTotalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
                  <p className="text-xs text-slate-500">
                    Showing {((ordersPage - 1) * 50) + 1}-{Math.min(ordersPage * 50, ordersTotal)} of {ordersTotal}
                  </p>
                  <div className="flex gap-1">
                    <button disabled={ordersPage <= 1} onClick={() => setOrdersPage(p => p - 1)}
                      className="px-3 py-1 text-xs text-slate-400 hover:text-white border border-slate-700 rounded disabled:opacity-30">Previous</button>
                    <button disabled={ordersPage >= ordersTotalPages} onClick={() => setOrdersPage(p => p + 1)}
                      className="px-3 py-1 text-xs text-slate-400 hover:text-white border border-slate-700 rounded disabled:opacity-30">Next</button>
                  </div>
                </div>
              )}
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
              <button onClick={handleApplyPricing} disabled={applyingPricing || pricingRules.length === 0}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors">
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
                  {pricingRules.map(rule => (
                    <tr key={rule.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-4 py-2 font-mono text-xs text-orange-400">{rule.sku}</td>
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
                      <input type="text" placeholder="SKU or product name" value={newRule.sku} onChange={e => setNewRule({ ...newRule, sku: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-orange-500" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="text" placeholder="Label" value={newRule.label} onChange={e => setNewRule({ ...newRule, label: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-orange-500" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="number" step="0.01" placeholder="$0.00" value={newRule.baseCharge} onChange={e => setNewRule({ ...newRule, baseCharge: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white text-right focus:outline-none focus:border-orange-500" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="number" step="0.01" placeholder="$0.00" value={newRule.extraCharge} onChange={e => setNewRule({ ...newRule, extraCharge: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white text-right focus:outline-none focus:border-orange-500" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="number" min="1" placeholder="1" value={newRule.extraAfter} onChange={e => setNewRule({ ...newRule, extraAfter: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-white text-right focus:outline-none focus:border-orange-500" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="date" value={newRule.from} onChange={e => setNewRule({ ...newRule, from: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 focus:outline-none focus:border-orange-500" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="date" value={newRule.to} onChange={e => setNewRule({ ...newRule, to: e.target.value })}
                        className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 focus:outline-none focus:border-orange-500" />
                    </td>
                    <td className="px-4 py-2">
                      <button onClick={handleAddRule} disabled={savingRule || !newRule.sku || !newRule.from}
                        className="px-3 py-1 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-xs font-medium rounded transition-colors">
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

          {/* SKUs Missing Pricing */}
          {skuGaps.length > 0 && (
            <div className="bg-slate-900 border border-orange-800/40 rounded-xl overflow-hidden mb-6">
              <div className="px-4 py-3 border-b border-slate-800">
                <h3 className="text-sm font-medium text-orange-400">SKUs Without Pricing <span className="text-slate-500 font-normal">({skuGaps.length} SKUs)</span></h3>
                <p className="text-[10px] text-slate-500 mt-0.5">Click a row to pre-fill the add form.</p>
              </div>
              <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                      <th className="text-left px-4 py-2">SKU</th>
                      <th className="text-right px-4 py-2">Orders</th>
                      <th className="text-left px-4 py-2">From</th>
                      <th className="text-left px-4 py-2">To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skuGaps.map(gap => (
                      <tr key={gap.sku} onClick={() => setNewRule({ ...newRule, sku: gap.sku, from: gap.min_date, to: gap.max_date })}
                        className="border-b border-slate-800/50 hover:bg-orange-900/10 cursor-pointer transition-colors">
                        <td className="px-4 py-2 font-mono text-xs text-orange-300 max-w-[300px] truncate">{gap.sku}</td>
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

          {/* Missing Orders */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800">
              <h3 className="text-sm font-medium text-white">Orders Missing Fulfillment Price <span className="text-slate-500 font-normal">({missingTotal})</span></h3>
            </div>
            {missingLoading ? (
              <div className="flex items-center justify-center h-24">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-400" />
              </div>
            ) : missingOrders.length === 0 ? (
              <p className="px-4 py-6 text-xs text-slate-500 text-center">All orders have fulfillment pricing.</p>
            ) : (
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
                    {missingOrders.map(order => {
                      let lineItems: { name: string; qty: number; sku: string }[] = [];
                      try { lineItems = order.line_items ? JSON.parse(order.line_items) : []; } catch {}
                      const skus = lineItems.map(li => li.sku).filter(Boolean).join(', ');
                      return (
                        <tr key={order.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="px-4 py-2 text-orange-400 font-medium text-xs">{order.order_name}</td>
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
            )}
          </div>
        </>
      )}

      {/* Inventory Tab */}
      {activeTab === 'inventory' && (
        <>
          {invSummary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { label: 'Asset Value', value: cents(invSummary.total_asset_value_cents), color: 'text-emerald-400' },
                { label: 'Cost Basis', value: cents(invSummary.total_cost_basis_cents), color: 'text-white' },
                { label: 'Sold Value', value: cents(invSummary.total_sold_value_cents), color: 'text-orange-400' },
                { label: 'Products', value: invSummary.product_count.toString(), color: 'text-slate-300' },
              ].map(k => (
                <div key={k.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{k.label}</p>
                  <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                </div>
              ))}
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="text-left px-4 py-2">Product</th>
                    <th className="text-left px-4 py-2">SKU</th>
                    <th className="text-right px-4 py-2">Purchased</th>
                    <th className="text-right px-4 py-2">Sold</th>
                    <th className="text-right px-4 py-2">Remaining</th>
                    <th className="text-right px-4 py-2">Avg Cost</th>
                    <th className="text-right px-4 py-2">Asset Value</th>
                  </tr>
                </thead>
                <tbody>
                  {invProducts.map((p, i) => (
                    <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="px-4 py-2 text-white text-xs">{p.product_name}</td>
                      <td className="px-4 py-2 text-slate-400 font-mono text-xs">{p.sku || '-'}</td>
                      <td className="px-4 py-2 text-right text-slate-400 text-xs">{p.total_purchased}</td>
                      <td className="px-4 py-2 text-right text-slate-400 text-xs">{p.total_sold}</td>
                      <td className="px-4 py-2 text-right text-white text-xs">{p.remaining}</td>
                      <td className="px-4 py-2 text-right text-slate-400 text-xs">{cents(p.avg_cost_cents)}</td>
                      <td className="px-4 py-2 text-right text-emerald-400 text-xs">{cents(p.asset_value_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {invProducts.length === 0 && !invLoading && (
              <p className="px-4 py-6 text-xs text-slate-500 text-center">No inventory data.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
