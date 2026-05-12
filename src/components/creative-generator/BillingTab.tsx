'use client';

import { useEffect, useState } from 'react';

export interface BillingTabProps {
  storeFilter: string;
}

export function BillingTab({ storeFilter }: BillingTabProps) {
  const [billingData, setBillingData] = useState<any>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingError, setBillingError] = useState('');

  useEffect(() => {
    setBillingLoading(true);
    setBillingError('');
    // Fetch tenant list, then find the tenant for the selected store
    fetch('/api/billing')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.tenants?.length > 0) {
          // If a store is selected, find its tenant. Otherwise use the first tenant.
          let tenant = d.tenants[0];
          if (storeFilter && d.tenants.length > 1) {
            // Fetch store to get tenant_id
            return fetch(`/api/stores`).then(r => r.json()).then(sd => {
              const store = (sd.stores || []).find((s: any) => s.id === storeFilter);
              if (store?.tenant_id) {
                const match = d.tenants.find((t: any) => t.id === store.tenant_id);
                if (match) tenant = match;
              }
              return fetch(`/api/billing?tenantId=${tenant.id}&admin=1`).then(r => r.json());
            });
          }
          return fetch(`/api/billing?tenantId=${tenant.id}&admin=1`).then(r => r.json());
        }
        setBillingData({ noTenant: true });
        setBillingLoading(false);
        return null;
      })
      .then(d => { if (d) { setBillingData(d); setBillingLoading(false); } })
      .catch(e => { setBillingError(e.message); setBillingLoading(false); });
  }, [storeFilter]);

  const handleSetupCard = async () => {
    if (!billingData?.tenant?.id) return;
    const res = await fetch('/api/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setup-card', tenantId: billingData.tenant.id }),
    });
    const data = await res.json();
    if (data.success && data.sessionUrl) {
      window.location.href = data.sessionUrl;
    } else {
      alert(data.error || 'Failed to start card setup');
    }
  };

  if (billingLoading) {
    return <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-400 mx-auto mb-3" />
      <p className="text-slate-400">Loading billing...</p>
    </div>;
  }

  if (billingData?.noTenant) {
    return <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
      <p className="text-slate-400">No billing tenant configured for your account.</p>
    </div>;
  }

  const summary = billingData?.summary;
  const tenant = billingData?.tenant;
  const payment = billingData?.paymentStatus;
  const isAdmin = billingData?.isAdmin;

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-white">{tenant?.name || 'Billing'}</h3>
            <p className="text-xs text-slate-400 mt-1">Current billing period</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-green-400">${(summary?.currentPeriodBilled || 0).toFixed(2)}</p>
            <p className="text-[10px] text-slate-500">your usage this month</p>
          </div>
        </div>
        {isAdmin && summary?.currentPeriodRaw != null && (
          <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-800">
            <div><p className="text-[10px] text-slate-500 uppercase">Raw API Cost</p><p className="text-sm font-semibold text-slate-300">${summary.currentPeriodRaw.toFixed(2)}</p></div>
            <div><p className="text-[10px] text-slate-500 uppercase">Client Billed</p><p className="text-sm font-semibold text-green-400">${summary.currentPeriodBilled.toFixed(2)}</p></div>
            <div><p className="text-[10px] text-slate-500 uppercase">Margin Earned</p><p className="text-sm font-semibold text-emerald-400">${summary.currentPeriodMargin.toFixed(2)}</p></div>
          </div>
        )}
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h4 className="text-sm font-semibold text-white mb-3">Payment Method</h4>
        <div className="bg-slate-800/50 rounded-lg px-4 py-3 mb-4">
          <p className="text-xs text-slate-300 leading-relaxed">You are billed automatically when your usage reaches <span className="text-white font-semibold">$20</span>. Your card on file will be charged for creative generation usage (video and image ads). All charges are based on actual usage — you only pay for what you generate.</p>
        </div>
        {payment?.hasPaymentMethod ? (
          <div className="flex items-center gap-3">
            <div className="px-3 py-2 bg-slate-800 rounded-lg">
              <p className="text-sm text-white font-medium">{payment.brand?.toUpperCase()} **** {payment.last4}</p>
              <p className="text-[10px] text-slate-500">Expires {payment.expMonth}/{payment.expYear}</p>
            </div>
            <button onClick={handleSetupCard} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs rounded-lg border border-slate-700">Update Card</button>
          </div>
        ) : (
          <div>
            <p className="text-xs text-slate-400 mb-3">No payment method on file.</p>
            <button onClick={handleSetupCard} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg">Add Card</button>
          </div>
        )}
      </div>
      {summary?.byProvider?.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h4 className="text-sm font-semibold text-white mb-3">Usage by Provider</h4>
          <div className="space-y-2">
            {summary.byProvider.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400 uppercase">{p.provider}</span>
                  <span className="text-xs text-slate-400">{p.count} call{p.count !== 1 ? 's' : ''}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-white">${(p.billed || 0).toFixed(2)}</p>
                  {isAdmin && p.raw != null && <p className="text-[9px] text-slate-500">cost: ${(p.raw).toFixed(2)}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {summary?.byStore?.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h4 className="text-sm font-semibold text-white mb-3">Usage by Store</h4>
          <div className="space-y-2">
            {summary.byStore.map((s: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                <span className="text-sm text-white">{s.storeName || s.storeId}</span>
                <p className="text-sm font-semibold text-white">${(s.billed || 0).toFixed(2)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {(!summary?.byProvider || summary.byProvider.length === 0) && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-slate-400">No usage this month yet. Generate some creatives to see billing data.</p>
        </div>
      )}
    </div>
  );
}
