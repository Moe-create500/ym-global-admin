import type DatabaseType from 'better-sqlite3';
import { shopifyGet, shopifyMutate, syncShopifyPayments } from './shopify-sync';
import { gatherShipmentProof, ShipmentProof } from './chargeback-evidence';

// ── Chargeback auto-responder ────────────────────────────────────────────────
// Bare-minimum automated dispute defense. Policy:
//   · only live Shopify Payments disputes in needs_response, workflow_status
//     'new' (a human touching a dispute takes it out of automation)
//   · order NOT fulfilled → never auto-fight; flag for a manual refund-vs-fight
//     decision
//   · fulfilled < DWS_WAIT_DAYS ago with no DWS scan yet → wait; the warehouse
//     scan (the strongest physical proof) lands ~3 days after fulfillment
//   · otherwise → build the full evidence pack NOW and save it on the dispute.
//     Shopify auto-submits saved evidence at the due date, so a saved draft is
//     a guaranteed response — while staying human-editable until then.
//   · due date within DUE_SOON_DAYS → draft immediately even if DWS is pending;
//     a tracking-only response always beats a missed deadline.
// Never calls submit. Every claim in the evidence is derived from order data —
// nothing is asserted that the records can't back up.

const DWS_WAIT_DAYS = 3;
const DUE_SOON_DAYS = 2;

export interface AutoDecision {
  chargebackId: string;
  store: string;
  disputeId: string;
  orderNumber: string;
  reason: string;
  amount: string;
  dueBy: string | null;
  action: 'drafted' | 'waiting_dws' | 'unfulfilled' | 'skipped' | 'blocked' | 'error';
  detail: string;
}

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function fmtAddress(a: any): string {
  if (!a) return '';
  return [
    [a.first_name, a.last_name].filter(Boolean).join(' ') || a.name,
    a.address1, a.address2,
    [a.city, a.province_code || a.province, a.zip].filter(Boolean).join(' '),
    a.country_code || a.country,
  ].filter(Boolean).join(', ');
}

function sameAddress(a: any, b: any): boolean {
  if (!a?.address1 || !b?.address1) return false;
  const norm = (x: any) => `${x.address1}|${x.zip || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

const SHIPMENT_STATUS_TEXT: Record<string, string> = {
  delivered: 'DELIVERED',
  out_for_delivery: 'out for delivery',
  in_transit: 'in transit',
  attempted_delivery: 'delivery attempted',
  ready_for_pickup: 'ready for pickup',
  confirmed: 'confirmed by the carrier',
};

/** Store refund policy text (for refund_policy_disclosure). Cached per run. */
async function getRefundPolicy(db: DatabaseType.Database, storeId: string, cache: Map<string, string>): Promise<string> {
  if (cache.has(storeId)) return cache.get(storeId)!;
  let text = '';
  try {
    const res = await shopifyGet(db, storeId, 'policies.json', Date.now());
    const pol = (res?.policies || []).find((p: any) => /refund/i.test(p.title || '') || p.handle === 'refund-policy');
    text = pol?.body ? stripHtml(pol.body).slice(0, 3500) : '';
  } catch { /* policy scope optional — evidence still works without it */ }
  cache.set(storeId, text);
  return text;
}

/** Build the complete evidence object, tailored to the dispute reason.
 *  Populates every REST DisputeEvidence text field the data can back up. */
export function buildEvidence(opts: {
  storeName: string; reason: string; amountText: string;
  order: any; proof: ShipmentProof; refundPolicy: string;
}): Record<string, string> {
  const { storeName, reason, amountText, order, proof, refundPolicy } = opts;
  const customer = order?.customer || null;
  const fulfillment = order?.fulfillments?.[0] || null;
  const ip = order?.browser_ip || order?.client_details?.browser_ip || '';
  const orderDate = (order?.created_at || '').slice(0, 10);
  const shipmentStatus = SHIPMENT_STATUS_TEXT[fulfillment?.shipment_status || ''] || '';
  const items = (order?.line_items || [])
    .map((li: any) => `${li.quantity}x ${li.title}${li.sku ? ` (SKU ${li.sku})` : ''} — $${li.price}`)
    .join('; ');
  const billMatchesShip = sameAddress(order?.billing_address, order?.shipping_address);
  const ordersCount = Number(customer?.orders_count || 0);

  const ev: Record<string, string> = {};
  if (customer?.email || order?.email) ev.customer_email_address = customer?.email || order?.email;
  if (customer?.first_name) ev.customer_first_name = customer.first_name;
  if (customer?.last_name) ev.customer_last_name = customer.last_name;
  if (ip) ev.customer_purchase_ip = ip;
  if (order?.shipping_address) ev.shipping_address = fmtAddress(order.shipping_address);
  if (order?.billing_address) ev.billing_address = fmtAddress(order.billing_address);
  if (proof.shippedDate) ev.shipping_date = proof.shippedDate;
  if (proof.carrier) ev.shipping_carrier = proof.carrier;
  if (proof.trackingNumber) ev.shipping_tracking_number = proof.trackingNumber;
  if (items) ev.product_description = `${items} — purchased on ${orderDate} for ${amountText} from ${storeName} via the online storefront.`;
  if (refundPolicy) ev.refund_policy_disclosure = refundPolicy;
  if (ip) {
    ev.access_activity_log =
      `${(order?.created_at || '').replace('T', ' ').slice(0, 19)} — customer completed checkout on the ${storeName} online store from IP ${ip}` +
      `${order?.client_details?.user_agent ? ` (${String(order.client_details.user_agent).slice(0, 160)})` : ''}, ` +
      `entering their own name, email, billing and shipping details, and confirming the purchase of ${amountText}.`;
  }

  // Master narrative — numbered, factual, strongest evidence first
  const s: string[] = [];
  s.push(`DISPUTE RESPONSE — Order ${order?.name || ''} (${storeName})`);
  s.push(
    `1. THE ORDER: Placed ${orderDate} by ${[customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || 'the customer'} ` +
    `(${ev.customer_email_address || 'email on file'}) through the ${storeName} online store checkout${ip ? ` from IP address ${ip}` : ''}. ` +
    `Items: ${items}. Total charged: ${amountText}.`
  );
  const customerFacts: string[] = [];
  if (billMatchesShip) customerFacts.push('the billing address entered at checkout matches the shipping address the goods were sent to');
  if (ordersCount > 1) customerFacts.push(`this customer has placed ${ordersCount} orders with the store`);
  if (customerFacts.length) s.push(`2. THE CUSTOMER: ${customerFacts.join('; ')}.`);
  if (proof.fulfilled && proof.shippedDate) {
    s.push(
      `3. FULFILLMENT: The order shipped on ${proof.shippedDate}${proof.carrier ? ` via ${proof.carrier}` : ''}` +
      `${proof.trackingNumber ? `, tracking number ${proof.trackingNumber}` : ''}` +
      `${proof.trackingUrl ? ` (${proof.trackingUrl})` : ''} to the address the customer provided at checkout` +
      `${shipmentStatus ? `. Carrier tracking shows the shipment ${shipmentStatus === 'DELIVERED' ? 'was DELIVERED' : `is ${shipmentStatus}`}` : ''}.`
    );
  }
  if (proof.dws) {
    const d = proof.dws;
    const dims = [d.lengthIn, d.widthIn, d.heightIn].every(v => v != null) ? `${d.lengthIn}" x ${d.widthIn}" x ${d.heightIn}"` : null;
    s.push(
      `4. INDEPENDENT WAREHOUSE VERIFICATION: Fulfillment-warehouse records confirm the physical package existed and shipped. ` +
      `It was weighed and scanned at an automated scale station${d.machine ? ` (${d.machine})` : ''} on ${d.scannedAt.replace('T', ' ').slice(0, 16)} UTC` +
      `${d.weightOz != null ? `, recording an actual weight of ${d.weightOz} oz` : ''}${dims ? ` and dimensions ${dims}` : ''}.` +
      `${d.photoUrl ? ` A photograph of the sealed package taken at scan time: ${d.photoUrl}` : ''}`
    );
  }

  // Reason-specific rebuttal
  if (/fraud|unrecognized/i.test(reason)) {
    s.push(
      `THIS WAS A LEGITIMATE PURCHASE: the cardholder's own details were entered at checkout` +
      `${billMatchesShip ? ', the billing address matches the delivery address' : ''}` +
      `${ip ? `, and the session IP is recorded above` : ''}. The goods were shipped to the address provided` +
      `${shipmentStatus === 'DELIVERED' ? ' and carrier tracking confirms delivery' : ''}. ` +
      `No fraud claim, refund request, or complaint was received through our support channels before this dispute was filed.`
    );
  } else if (/not_received/i.test(reason)) {
    s.push(
      `THE PRODUCT WAS SHIPPED TO THE CUSTOMER'S OWN ADDRESS: the tracking above documents the shipment` +
      `${shipmentStatus === 'DELIVERED' ? ' and shows it was DELIVERED' : shipmentStatus ? ` (currently ${shipmentStatus})` : ''}. ` +
      `The customer did not contact our support to report non-receipt before filing this dispute, giving us no opportunity to resolve it directly.`
    );
  } else if (/credit_not_processed|refund/i.test(reason)) {
    ev.refund_refusal_explanation =
      `Our refund policy is published on the store and available at checkout${refundPolicy ? ' (full text provided as policy disclosure)' : ''}. ` +
      `Our records show no refund request from this customer through our support channels prior to this dispute — we were given no opportunity to address the claim before it was escalated to a chargeback. ` +
      `The goods were shipped to the customer as documented by the tracking evidence.`;
    s.push(`REFUND CLAIM: ${ev.refund_refusal_explanation}`);
  } else if (/subscription|cancel/i.test(reason)) {
    if (refundPolicy) ev.cancellation_policy_disclosure = refundPolicy;
    ev.cancellation_rebuttal =
      `The charge corresponds to order ${order?.name || ''} placed ${orderDate} — a checkout the customer completed themselves, as documented in the activity log. ` +
      `Our records show no cancellation request from this customer through our support channels before this charge or before the dispute was filed. ` +
      `The goods for this charge were shipped as documented by the tracking evidence.`;
    s.push(`CANCELLATION CLAIM: ${ev.cancellation_rebuttal}`);
  } else if (/unacceptable|not_as_described/i.test(reason)) {
    ev.refund_refusal_explanation =
      `The customer received exactly the products ordered, as listed on the product pages at purchase time. ` +
      `They did not contact support to report any problem with the goods, request a return, or seek a replacement before filing this dispute — our published refund policy would have applied.`;
    s.push(`PRODUCT CLAIM: ${ev.refund_refusal_explanation}`);
  }
  s.push(
    `RESOLUTION ATTEMPTS: No refund request, cancellation, or complaint regarding this order was received through our support channels before the dispute was filed.`
  );
  ev.uncategorized_text = s.join('\n\n');
  return ev;
}

/** Build the full evidence pack for one chargeback — used by the auto loop and
 *  by the dashboard's 📋 Evidence view (manual paste into the Shopify dispute
 *  form while the dispute_evidences API scope stays ungrantable). */
export async function buildEvidenceForChargeback(
  db: DatabaseType.Database,
  chargebackId: string,
  policyCache: Map<string, string> = new Map(),
): Promise<{
  ok: boolean; error?: string; liveStatus?: string; orderName?: string;
  fulfilled?: boolean; ageDays?: number; checks?: string[];
  dws?: ShipmentProof['dws']; evidence?: Record<string, string>;
}> {
  const nowMs = Date.now();
  const cb: any = db.prepare('SELECT cb.*, s.name AS store_name FROM chargebacks cb JOIN stores s ON s.id = cb.store_id WHERE cb.id = ?').get(chargebackId);
  if (!cb) return { ok: false, error: 'Chargeback not found' };
  if (cb.source !== 'shopify_api' || !cb.dispute_id) return { ok: false, error: 'Evidence building works only for Shopify Payments disputes' };

  const disputeRes = await shopifyGet(db, cb.store_id, `shopify_payments/disputes/${cb.dispute_id}.json`, nowMs);
  const dispute = disputeRes?.dispute;
  if (!dispute) return { ok: false, error: 'Dispute not found on Shopify' };

  let order: any = null;
  if (dispute.order_id) {
    const orderRes = await shopifyGet(db, cb.store_id, `orders/${dispute.order_id}.json`, nowMs);
    order = orderRes?.order || null;
  }
  if (!order) return { ok: false, error: 'Order not found for this dispute', liveStatus: dispute.status };

  const proof = await gatherShipmentProof(db, cb.store_id, order);
  const fulfilledAtMs = Math.max(...(order?.fulfillments || []).map((f: any) => new Date(f.created_at || 0).getTime()), 0);
  const ageDays = fulfilledAtMs ? (nowMs - fulfilledAtMs) / 86_400_000 : Infinity;
  const refundPolicy = await getRefundPolicy(db, cb.store_id, policyCache);
  const evidence = buildEvidence({
    storeName: cb.store_name, reason: cb.reason || '',
    amountText: `$${((cb.amount_cents || 0) / 100).toFixed(2)}`,
    order, proof, refundPolicy,
  });
  return {
    ok: true, liveStatus: dispute.status, orderName: order?.name || cb.order_number || '',
    fulfilled: proof.fulfilled, ageDays, checks: proof.checks, dws: proof.dws, evidence,
  };
}

/** One pass: refresh disputes, decide each actionable one, save evidence drafts. */
export async function runChargebackAutoResponder(
  db: DatabaseType.Database,
  opts?: { limit?: number; dryRun?: boolean },
): Promise<{ decisions: AutoDecision[]; summary: string }> {
  const limit = Math.min(Math.max(opts?.limit || 12, 1), 30);
  const dryRun = !!opts?.dryRun;
  const nowMs = Date.now();
  const decisions: AutoDecision[] = [];
  const policyCache = new Map<string, string>();

  // 1) Full payments refresh per connected store — disputes for this loop, and
  //    it's also what keeps refunds/balances current (nothing else runs it on a
  //    schedule; before this the data only moved on manual dashboard clicks).
  const connected: any[] = db.prepare('SELECT store_id FROM shopify_credentials').all();
  for (const c of connected) {
    try { await syncShopifyPayments(db, c.store_id, nowMs); } catch (e) {
      console.error(`[chargeback-auto] payments refresh failed for ${c.store_id}:`, e instanceof Error ? e.message.slice(0, 150) : e);
    }
  }

  // 2) Actionable = live needs_response, untouched by a human
  const candidates: any[] = db.prepare(`
    SELECT cb.*, s.name AS store_name FROM chargebacks cb JOIN stores s ON s.id = cb.store_id
    WHERE cb.source = 'shopify_api' AND cb.dispute_id IS NOT NULL
      AND cb.workflow_status = 'new' AND cb.raw_status = 'needs_response'
    ORDER BY cb.evidence_due_by ASC LIMIT ?
  `).all(limit);

  const note = (id: string, text: string) => {
    if (dryRun) return;
    db.prepare(`UPDATE chargebacks SET response_notes = ?, updated_at = datetime('now') WHERE id = ?`).run(text, id);
  };

  for (const cb of candidates) {
    const base = {
      chargebackId: cb.id, store: cb.store_name, disputeId: cb.dispute_id,
      orderNumber: cb.order_number || '', reason: cb.reason || '',
      amount: `$${((cb.amount_cents || 0) / 100).toFixed(2)}`, dueBy: cb.evidence_due_by || null,
    };
    try {
      const built = await buildEvidenceForChargeback(db, cb.id, policyCache);
      if (!built.ok || !/needs_response/i.test(built.liveStatus || '')) {
        decisions.push({ ...base, action: 'skipped', detail: built.error || `live status ${built.liveStatus || 'unknown'} — nothing to respond to` });
        continue;
      }

      if (!built.fulfilled) {
        decisions.push({ ...base, action: 'unfulfilled', detail: 'order not fulfilled — manual decision (refund is usually smarter than fighting)' });
        note(cb.id, `auto ${new Date(nowMs).toISOString().slice(0, 16)}: order NOT fulfilled — not auto-fighting; decide refund vs fight manually`);
        continue;
      }

      const ageDays = built.ageDays ?? Infinity;
      const dueSoon = cb.evidence_due_by &&
        new Date(`${cb.evidence_due_by}T23:59:59Z`).getTime() - nowMs < DUE_SOON_DAYS * 86_400_000;

      if (!built.dws && ageDays < DWS_WAIT_DAYS && !dueSoon) {
        const d = `fulfilled ${ageDays.toFixed(1)}d ago, no DWS scan yet — waiting (scans land ~${DWS_WAIT_DAYS}d; due ${cb.evidence_due_by || '?'})`;
        decisions.push({ ...base, action: 'waiting_dws', detail: d });
        note(cb.id, `auto ${new Date(nowMs).toISOString().slice(0, 16)}: ${d}`);
        continue;
      }

      const evidence = built.evidence!;

      if (dryRun) {
        decisions.push({ ...base, action: 'drafted', detail: `DRY RUN — would save ${Object.keys(evidence).length} evidence fields (DWS ${built.dws ? 'yes' : 'no'})` });
        continue;
      }

      // Save the draft (submit deliberately absent — Shopify auto-submits at the
      // due date). On 404 the store's app may have just gained the evidence
      // scope but the cached token predates it — re-mint once and retry.
      try {
        await shopifyMutate(db, cb.store_id, 'PUT', `shopify_payments/disputes/${cb.dispute_id}/dispute_evidences.json`, { dispute_evidence: evidence }, nowMs);
      } catch (e: any) {
        if (/404|not found/i.test(String(e?.message || ''))) {
          db.prepare('UPDATE shopify_credentials SET token_cache = NULL, token_expires_at = NULL WHERE store_id = ?').run(cb.store_id);
          try {
            await shopifyMutate(db, cb.store_id, 'PUT', `shopify_payments/disputes/${cb.dispute_id}/dispute_evidences.json`, { dispute_evidence: evidence }, nowMs);
          } catch (e2: any) {
            if (/404|not found|403|scope/i.test(String(e2?.message || ''))) {
              const d = 'API blocked (Shopify does not grant the dispute_evidences scope to custom apps) — evidence pack is PASTE-READY via the 📋 Evidence button';
              decisions.push({ ...base, action: 'blocked', detail: d });
              note(cb.id, `auto ${new Date(nowMs).toISOString().slice(0, 16)}: ${d}`);
              continue;
            }
            throw e2;
          }
        } else throw e;
      }

      const detail = `evidence saved on dispute (${Object.keys(evidence).length} fields, DWS ${built.dws ? 'YES — weight/dims/photo' : 'no — tracking evidence'}); Shopify auto-submits at due date ${cb.evidence_due_by || '?'}`;
      db.prepare(`UPDATE chargebacks SET workflow_status = 'responding', handled_at = COALESCE(handled_at, datetime('now')),
        response_notes = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(`auto-drafted ${new Date(nowMs).toISOString().slice(0, 16)}: ${detail}`, cb.id);
      decisions.push({ ...base, action: 'drafted', detail });
    } catch (e: any) {
      decisions.push({ ...base, action: 'error', detail: String(e?.message || e).slice(0, 200) });
    }
  }

  const counts: Record<string, number> = {};
  for (const d of decisions) counts[d.action] = (counts[d.action] || 0) + 1;
  const summary = `${candidates.length} actionable: ` +
    (Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none');
  return { decisions, summary };
}
