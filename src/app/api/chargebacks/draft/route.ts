import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { shopifyGet, shopifyMutate } from '@/lib/shopify-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Render {{variable}} placeholders against the dispute/order context. */
function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
}

// POST /api/chargebacks/draft { chargebackId, workflowId?, dryRun? }
// Pulls the live dispute + order from Shopify, gathers shipment proof
// (fulfillment + tracking + DWS warehouse scan), renders the playbook's
// evidence templates with real order data, and saves the draft onto the
// dispute via the Dispute Evidence API. NEVER submits — review + final
// submit stay human. dryRun gathers and returns everything without writing
// anything anywhere (no playbook required).
export async function POST(req: NextRequest) {
  const { chargebackId, workflowId, dryRun } = await req.json();
  if (!chargebackId) return NextResponse.json({ error: 'chargebackId required' }, { status: 400 });

  const db = getDb();
  const cb: any = db.prepare('SELECT * FROM chargebacks WHERE id = ?').get(chargebackId);
  if (!cb) return NextResponse.json({ error: 'Chargeback not found' }, { status: 404 });
  if (cb.source !== 'shopify_api' || !cb.dispute_id) {
    return NextResponse.json({ error: 'Drafting works only for Shopify Payments disputes' }, { status: 400 });
  }

  const wfId = workflowId || cb.response_workflow_id;
  if (!wfId && !dryRun) return NextResponse.json({ error: 'Pick a playbook first' }, { status: 400 });
  const wf: any = wfId ? db.prepare('SELECT * FROM cb_response_workflows WHERE id = ?').get(wfId) : null;
  if (wfId && !wf) return NextResponse.json({ error: 'Playbook not found' }, { status: 404 });

  let tpl: any = {};
  try { tpl = wf?.template_json ? JSON.parse(wf.template_json) : {}; } catch { /* empty template */ }

  const store: any = db.prepare('SELECT id, name FROM stores WHERE id = ?').get(cb.store_id);
  const nowMs = Date.now();

  try {
    // 1) Live dispute → order id + current evidence state
    const disputeRes = await shopifyGet(db, cb.store_id, `shopify_payments/disputes/${cb.dispute_id}.json`, nowMs);
    const dispute = disputeRes?.dispute;
    if (!dispute) return NextResponse.json({ error: 'Dispute not found on Shopify' }, { status: 404 });
    if (dispute.status && !/needs_response|under_review/i.test(dispute.status)) {
      return NextResponse.json({ error: `Dispute is ${dispute.status} — nothing to respond to` }, { status: 400 });
    }

    // 2) Live order → customer, line items, fulfillment tracking
    let order: any = null;
    if (dispute.order_id) {
      const orderRes = await shopifyGet(db, cb.store_id, `orders/${dispute.order_id}.json`, nowMs);
      order = orderRes?.order || null;
    }
    const fulfillment = order?.fulfillments?.[0] || null;
    const customer = order?.customer || null;
    const lineItems = (order?.line_items || [])
      .map((li: any) => `${li.quantity}x ${li.title} — $${li.price}`)
      .join('; ');

    // Diagram steps 2-3: fulfilled? → DWS scan? → strongest physical proof
    const { gatherShipmentProof } = await import('@/lib/chargeback-evidence');
    const proof = await gatherShipmentProof(db, cb.store_id, order);

    const vars: Record<string, string> = {
      store_name: store?.name || '',
      order_number: order?.name || cb.order_number || '',
      order_date: (order?.created_at || '').slice(0, 10),
      amount: `$${((cb.amount_cents || 0) / 100).toFixed(2)}`,
      reason: cb.reason || '',
      customer_name: customer ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() : '',
      customer_email: customer?.email || order?.email || '',
      tracking_number: fulfillment?.tracking_number || '',
      carrier: fulfillment?.tracking_company || '',
      shipping_date: (fulfillment?.created_at || '').slice(0, 10),
      tracking_url: fulfillment?.tracking_url || '',
      line_items: lineItems,
      shipping_address: order?.shipping_address
        ? `${order.shipping_address.address1 || ''}, ${order.shipping_address.city || ''}, ${order.shipping_address.province_code || ''} ${order.shipping_address.zip || ''}`.trim()
        : '',
    };

    // 3) Render only the fields the playbook defines
    const evidence: any = {};
    const drafted: Record<string, string> = {};
    for (const field of ['uncategorized_text', 'product_description', 'refund_refusal_explanation', 'cancellation_rebuttal', 'access_activity_log'] as const) {
      const t = (tpl[field] || '').trim();
      if (!t) continue;
      const rendered = render(t, vars).trim();
      if (rendered) { evidence[field] = rendered; drafted[field] = rendered; }
    }
    if (customer?.email || order?.email) evidence.customer_email_address = customer?.email || order?.email;
    if (customer?.first_name) evidence.customer_first_name = customer.first_name;
    if (customer?.last_name) evidence.customer_last_name = customer.last_name;

    // Diagram step 4: shipment date, carrier, tracking as first-class evidence
    // fields, and the DWS warehouse proof appended to the narrative.
    if (proof.shippedDate) evidence.shipping_date = proof.shippedDate;
    if (proof.carrier) evidence.shipping_carrier = proof.carrier;
    if (proof.trackingNumber) evidence.shipping_tracking_number = proof.trackingNumber;
    if (proof.proofText) {
      evidence.uncategorized_text = [evidence.uncategorized_text, proof.proofText].filter(Boolean).join('\n\n');
      drafted.uncategorized_text = evidence.uncategorized_text;
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        dispute: { id: cb.dispute_id, status: dispute.status, reason: cb.reason, amount: vars.amount },
        checks: proof.checks,
        dws: proof.dws,
        evidence,
        vars,
        note: 'DRY RUN — nothing was saved to Shopify or the database.',
      });
    }

    if (Object.keys(drafted).length === 0) {
      return NextResponse.json({ error: 'Playbook has no templates configured — edit it in Defense Workflows first' }, { status: 400 });
    }

    // 4) Save the draft on the dispute (submit_evidence deliberately absent)
    await shopifyMutate(db, cb.store_id, 'PUT',
      `shopify_payments/disputes/${cb.dispute_id}/dispute_evidences.json`,
      { dispute_evidence: evidence }, nowMs);

    // 5) Track locally: playbook tagged, work started
    db.prepare(`UPDATE chargebacks SET response_workflow_id = ?, workflow_status = CASE WHEN workflow_status IN ('new') THEN 'responding' ELSE workflow_status END,
      handled_at = COALESCE(handled_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`).run(wfId, chargebackId);

    return NextResponse.json({
      success: true,
      drafted,
      files_checklist: tpl.files || [],
      note: 'Draft saved on the dispute in Shopify. Review, attach files, and submit there.',
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (/403|access denied|scope/i.test(msg)) {
      return NextResponse.json({
        error: 'The store\'s custom app is missing the write_shopify_payments_dispute_evidences scope. Enable it in the app config, then retry.',
      }, { status: 403 });
    }
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 });
  }
}
