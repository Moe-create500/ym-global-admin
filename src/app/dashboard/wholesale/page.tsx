'use client';

import { useState, useEffect, useCallback } from 'react';

interface WsRequest {
  id: string; business_name: string; contact_name: string; email: string; phone: string;
  items: { title: string; qty: number }[]; total_tubs: number;
  delivery_method: 'ups' | 'freight' | 'pickup'; pickup_slot: string | null;
  address: string; notes: string; status: string;
  shipping_cents: number | null; draft_order_id: string | null; created_at: string;
}

const METHOD_LABEL: Record<string, string> = {
  ups: '📦 UPS (boxes)', freight: '🛻 Freight (pallet)', pickup: '🏬 Pickup 10AM–1PM',
};
const STATUS_COLOR: Record<string, string> = {
  new: 'bg-blue-900/50 text-blue-300', quoted: 'bg-amber-900/50 text-amber-300',
  invoiced: 'bg-violet-900/50 text-violet-300', paid: 'bg-emerald-900/50 text-emerald-300',
  fulfilled: 'bg-emerald-900/70 text-emerald-400', cancelled: 'bg-slate-800 text-slate-500',
};

export default function WholesalePage() {
  const [requests, setRequests] = useState<WsRequest[]>([]);
  const [msg, setMsg] = useState('');
  const [shipInput, setShipInput] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    fetch('/api/wholesale').then(r => r.json()).then(d => setRequests(d.requests || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  async function act(id: string, body: any) {
    setBusy(id); setMsg('');
    const res = await fetch('/api/wholesale', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    });
    const d = await res.json();
    if (!res.ok) setMsg(d.error || 'failed');
    else if (d.draftOrderId) setMsg(`Invoice sent — draft order ${d.draftOrderId}${d.missing?.length ? ` (unmatched: ${d.missing.join(', ')})` : ''}`);
    setBusy(''); load();
  }

  const inputCls = 'bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500';

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Wholesale Desk</h1>
      <p className="text-sm text-slate-400 mb-5">
        Flow: request arrives → set shipping (UPS cost or trucking quote; pickup is free) → Create invoice → customer pays → fulfill.
        Pallet orders (48+ tubs) can never select UPS; pickup slots are enforced to 10AM–1PM business days.
      </p>
      {msg && <div className="mb-4 bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-4 py-2">{msg}</div>}

      {requests.length === 0 ? (
        <p className="text-slate-500 text-sm py-12 text-center">No wholesale requests yet — they'll appear here the moment the storefront form is submitted.</p>
      ) : (
        <div className="space-y-3">
          {requests.map(r => (
            <div key={r.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_COLOR[r.status] || ''}`}>{r.status}</span>
                <span className="text-sm text-white font-medium">{r.business_name || r.contact_name || r.email}</span>
                <span className="text-xs text-slate-400">{METHOD_LABEL[r.delivery_method]}</span>
                {r.pickup_slot && <span className="text-xs text-amber-300">slot: {r.pickup_slot}</span>}
                <span className="text-xs text-slate-500 ml-auto">{r.created_at}</span>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-slate-400">{r.email}{r.phone ? ` · ${r.phone}` : ''}</p>
                  {r.address && <p className="text-xs text-slate-500">{r.address}</p>}
                  <p className="text-sm text-slate-200 mt-1.5">
                    {r.items.map(i => `${i.qty}× ${i.title}`).join(' · ')}
                    <span className="text-slate-400"> — {r.total_tubs} tubs total</span>
                  </p>
                  {r.notes && <p className="text-xs text-slate-500 mt-1">"{r.notes}"</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2 justify-end">
                  {r.delivery_method !== 'pickup' && !r.draft_order_id && (
                    <>
                      <input placeholder={r.delivery_method === 'freight' ? 'Trucking quote $' : 'UPS cost $'}
                        value={shipInput[r.id] ?? (r.shipping_cents ? (r.shipping_cents / 100).toString() : '')}
                        onChange={e => setShipInput({ ...shipInput, [r.id]: e.target.value })}
                        className={`${inputCls} w-36`} />
                      <button onClick={() => act(r.id, { action: 'set_shipping', shippingCents: Math.round(parseFloat(shipInput[r.id] || '0') * 100) })}
                        disabled={busy === r.id}
                        className="text-xs bg-slate-800 border border-slate-700 hover:border-blue-500 text-slate-200 rounded-lg px-3 py-1.5">
                        Save quote
                      </button>
                    </>
                  )}
                  {!r.draft_order_id ? (
                    <button onClick={() => act(r.id, { action: 'create_draft_order' })} disabled={busy === r.id}
                      className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-lg px-3 py-1.5">
                      {busy === r.id ? '…' : '📧 Create + send invoice'}
                    </button>
                  ) : (
                    <span className="text-xs text-emerald-400">invoice: draft #{r.draft_order_id}</span>
                  )}
                  {['invoiced', 'paid'].includes(r.status) && (
                    <button onClick={() => act(r.id, { action: 'set_status', status: r.status === 'invoiced' ? 'paid' : 'fulfilled' })}
                      className="text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg px-3 py-1.5">
                      Mark {r.status === 'invoiced' ? 'paid' : 'fulfilled'}
                    </button>
                  )}
                  {r.status !== 'cancelled' && r.status !== 'fulfilled' && (
                    <button onClick={() => act(r.id, { action: 'set_status', status: 'cancelled' })}
                      className="text-xs text-red-400 hover:text-red-300 px-2">cancel</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
