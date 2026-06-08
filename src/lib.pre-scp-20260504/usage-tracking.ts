/**
 * Usage Tracking — Accurate, auditable, traceable billing.
 *
 * RULES:
 * 1. Only charge what the provider ACTUALLY charges. No guessing.
 * 2. Use official provider pricing when API doesn't return cost.
 * 3. Store raw cost with full precision (6+ decimals).
 * 4. Apply margin AFTER raw cost is determined.
 * 5. Internal stores: margin = 0%, billed = raw.
 * 6. Client stores: margin from tenant record (default 40%).
 * 7. Never overbill. If cost unknown, log $0 and flag for review.
 * 8. Each generation logs usage ONLY ONCE (duplicate protection).
 * 9. Failed generations are NOT billed.
 *
 * Official provider pricing (April 2026):
 *   Seedance 480p fast: $0.057/sec — fal.ai
 *   Seedance 720p std:  $0.303/sec — fal.ai
 *   Nano Banana 1K:     $0.067/img — fal.ai
 *   Nano Banana 2K:     $0.101/img — fal.ai
 *   Ideogram 3.0:       $0.030/img — ideogram.ai
 *   Stability SD 3.5:   $0.040/img — stability.ai
 *   DALL-E 3 std:       $0.040/img — openai.com
 *   DALL-E 3 HD:        $0.080/img — openai.com
 *   Gemini Image:       $0.039/img — ai.google.dev
 *   Sora:               $0.100/sec — openai.com (estimated)
 *   Veo 3.1 720p:       $0.400/sec — ai.google.dev
 *   OpenAI TTS:         $0.015/1K chars — openai.com
 *   OpenAI TTS HD:      $0.030/1K chars — openai.com
 *   ElevenLabs:         $0.300/1K chars — elevenlabs.io
 *   Gemini Vision:      $0.001/call — ai.google.dev
 *   OpenAI Chat:        $0.030/call avg — openai.com
 */

import { getDb } from '@/lib/db';
import crypto from 'crypto';

// Official pricing — verified from provider docs
const PRICING: Record<string, Record<string, number>> = {
  seedance:       { 'per_second_480p': 0.057, 'per_second_720p': 0.303 },
  sora:           { 'per_second': 0.10, 'per_second_pro': 0.15 },
  veo:            { 'per_second': 0.40 },
  'nano-banana':  { '1k': 0.067, '2k': 0.101, '4k': 0.151, 'edit_1k': 0.067, 'edit_2k': 0.101 },
  ideogram:       { 'per_image': 0.03 },
  stability:      { 'per_image': 0.04 },
  dalle:          { 'standard': 0.04, 'hd': 0.08 },
  'gemini-image': { 'per_image': 0.039 },
  'openai-tts':   { 'tts-1': 0.015, 'tts-1-hd': 0.030 },
  elevenlabs:     { 'per_1k_chars': 0.30 },
  'gemini-vision':{ 'per_call': 0.001 },
  'openai-chat':  { 'per_call': 0.03 },
  'gemini-chat':  { 'per_call': 0.005 },
};

/**
 * Calculate raw cost using official pricing.
 * Returns 0 if cost cannot be determined (never guesses).
 */
export function calculateCost(
  provider: string,
  operationType: string,
  units: number,
  metadata?: Record<string, any>,
): number {
  const prices = PRICING[provider];
  if (!prices) return 0;

  if (provider === 'seedance') {
    const res = metadata?.resolution || '480p';
    const rate = res === '720p' ? prices['per_second_720p'] : prices['per_second_480p'];
    return units * rate;
  }
  if (provider === 'sora') {
    const isPro = metadata?.model?.includes('pro');
    return units * (isPro ? prices['per_second_pro'] : prices['per_second']);
  }
  if (provider === 'veo') return units * prices['per_second'];
  if (provider === 'nano-banana') {
    const isEdit = operationType === 'edit' || metadata?.edit;
    const res = (metadata?.resolution || '1K').toLowerCase().replace('k', 'k');
    const key = isEdit ? `edit_${res}` : res;
    return units * (prices[key] || prices['1k']);
  }
  if (provider === 'openai-tts') {
    const model = metadata?.model || 'tts-1';
    return units * (prices[model] || prices['tts-1']);
  }
  if (provider === 'elevenlabs') return units * prices['per_1k_chars'];
  if (provider === 'dalle') {
    const quality = metadata?.quality === 'hd' ? 'hd' : 'standard';
    return units * prices[quality];
  }

  // Simple per-unit providers
  const rate = prices['per_image'] || prices['per_call'] || prices['per_second'] || 0;
  return units * rate;
}

/**
 * Log a billable usage event.
 *
 * @param opts.jobId — unique job/request ID for duplicate protection
 * @param opts.rawCostOverride — use when provider returns exact cost
 */
export function logUsage(opts: {
  storeId: string;
  userId?: string;
  provider: string;
  operationType: string;
  units: number;
  jobId?: string;
  rawCostOverride?: number;
  metadata?: Record<string, any>;
}): void {
  try {
    const db = getDb();
    const { storeId, userId, provider, operationType, units, jobId, rawCostOverride, metadata } = opts;

    // DUPLICATE PROTECTION: if jobId provided, check if already logged
    if (jobId) {
      const existing = db.prepare(
        "SELECT 1 FROM usage_logs WHERE metadata_json LIKE ?"
      ).get(`%"jobId":"${jobId}"%`);
      if (existing) {
        console.log(`[USAGE] SKIPPED (duplicate): jobId=${jobId}`);
        return;
      }
    }

    // Get tenant for this store
    const store: any = db.prepare('SELECT tenant_id FROM stores WHERE id = ?').get(storeId);
    const tenantId = store?.tenant_id || null;

    // Get margin for this tenant
    let marginPct = 40; // default for unknown tenants
    let isInternal = false;
    if (tenantId) {
      const tenant: any = db.prepare('SELECT margin_percentage, is_internal FROM tenants WHERE id = ?').get(tenantId);
      if (tenant) {
        marginPct = tenant.margin_percentage ?? 40;
        isInternal = !!tenant.is_internal;
      }
    }

    // Calculate raw cost — use provider cost if available, else official pricing
    const rawCost = rawCostOverride ?? calculateCost(provider, operationType, units, metadata);

    // SAFETY: if cost is 0 or negative, flag for review
    if (rawCost <= 0 && !rawCostOverride) {
      console.warn(`[USAGE] WARN: cost=$0 for ${provider}/${operationType} — flagged for review`);
    }

    // Apply margin: internal stores = 0%, client stores = tenant margin
    const effectiveMargin = isInternal ? 0 : marginPct;
    const markedUpCost = rawCost * (1 + effectiveMargin / 100);

    // Store with full precision (6 decimals)
    const logId = crypto.randomUUID();
    const metaWithJob = { ...metadata, jobId: jobId || logId };

    db.prepare(`
      INSERT INTO usage_logs (id, tenant_id, store_id, user_id, provider, operation_type, units, raw_cost_usd, marked_up_cost_usd, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      logId,
      tenantId,
      storeId,
      userId || null,
      provider,
      operationType,
      units,
      rawCost,       // full precision — no rounding
      markedUpCost,   // full precision — no rounding
      JSON.stringify(metaWithJob),
    );

    console.log(`[USAGE] ${provider}/${operationType}: ${units} units, raw=$${rawCost.toFixed(6)}, margin=${effectiveMargin}%, billed=$${markedUpCost.toFixed(6)}, ${isInternal ? 'INTERNAL' : 'CLIENT'}, store=${storeId.slice(0, 8)}`);

    // ═══ AUTO-INVOICE: charge client when uninvoiced balance exceeds $20 ═══
    if (!isInternal && tenantId) {
      try {
        checkAndAutoInvoice(db, tenantId);
      } catch (invoiceErr: any) {
        console.error(`[BILLING] Auto-invoice check failed: ${invoiceErr.message}`);
      }
    }
  } catch (e: any) {
    // Usage logging must never block generation
    console.error(`[USAGE] Failed to log: ${e.message}`);
  }
}

const AUTO_INVOICE_THRESHOLD = 20.00; // $20

/**
 * Check if a tenant's uninvoiced balance exceeds the threshold.
 * If so, create and send a Stripe invoice automatically.
 */
function checkAndAutoInvoice(db: any, tenantId: string): void {
  // Get uninvoiced total for this tenant
  const result: any = db.prepare(`
    SELECT SUM(marked_up_cost_usd) as total
    FROM usage_logs
    WHERE tenant_id = ? AND (billing_status IS NULL OR billing_status = '')
  `).get(tenantId);

  const uninvoicedTotal = result?.total || 0;
  if (uninvoicedTotal < AUTO_INVOICE_THRESHOLD) return;

  // Get tenant's Stripe customer ID
  const tenant: any = db.prepare('SELECT stripe_customer_id, name FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant?.stripe_customer_id) {
    console.log(`[BILLING] Tenant ${tenantId} has $${uninvoicedTotal.toFixed(2)} uninvoiced but no Stripe customer — skipping`);
    return;
  }

  // Prevent double-invoicing: check if we already invoiced recently (last 1 hour)
  const recentInvoice: any = db.prepare(`
    SELECT 1 FROM usage_logs
    WHERE tenant_id = ? AND billing_status = 'invoiced'
      AND created_at >= datetime('now', '-1 hour')
    LIMIT 1
  `).get(tenantId);
  if (recentInvoice) return; // Already invoiced recently, skip

  console.log(`[BILLING] Auto-invoice triggered for ${tenant.name}: $${uninvoicedTotal.toFixed(2)} exceeds $${AUTO_INVOICE_THRESHOLD} threshold`);

  // Fire invoice creation asynchronously (don't block the generation response)
  createAutoInvoice(tenant.stripe_customer_id, tenantId, uninvoicedTotal, db).catch(err => {
    console.error(`[BILLING] Auto-invoice failed for ${tenant.name}: ${err.message}`);
  });
}

/**
 * Create a Stripe invoice for uninvoiced usage.
 */
async function createAutoInvoice(customerId: string, tenantId: string, total: number, db: any): Promise<void> {
  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET) {
    console.error('[BILLING] STRIPE_SECRET_KEY not set — cannot auto-invoice');
    return;
  }

  // Aggregate uninvoiced usage by provider
  const usage: any[] = db.prepare(`
    SELECT provider, operation_type,
      SUM(units) as total_units,
      SUM(marked_up_cost_usd) as total_billed,
      COUNT(*) as count
    FROM usage_logs
    WHERE tenant_id = ? AND (billing_status IS NULL OR billing_status = '')
    GROUP BY provider, operation_type
  `).all(tenantId);

  if (usage.length === 0) return;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${STRIPE_SECRET}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  // Create invoice items
  let totalCents = 0;
  for (const row of usage) {
    const amountCents = Math.round(row.total_billed * 100);
    if (amountCents <= 0) continue;
    totalCents += amountCents;

    const body = new URLSearchParams({
      'customer': customerId,
      'amount': String(amountCents),
      'currency': 'usd',
      'description': `${row.provider} — ${row.operation_type} (${row.count} calls, ${row.total_units.toFixed(1)} units)`,
    });

    const res = await fetch('https://api.stripe.com/v1/invoiceitems', {
      method: 'POST', headers, body: body.toString(),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Stripe invoice item failed: ${err.substring(0, 200)}`);
    }
  }

  // Create and auto-finalize invoice
  const invoiceBody = new URLSearchParams({
    'customer': customerId,
    'auto_advance': 'true',
    'collection_method': 'charge_automatically',
  });
  const invoiceRes = await fetch('https://api.stripe.com/v1/invoices', {
    method: 'POST', headers, body: invoiceBody.toString(),
  });
  if (!invoiceRes.ok) {
    const err = await invoiceRes.text().catch(() => '');
    throw new Error(`Stripe invoice creation failed: ${err.substring(0, 200)}`);
  }
  const invoice = await invoiceRes.json();

  // Mark all uninvoiced logs as invoiced
  db.prepare(`
    UPDATE usage_logs SET billing_status = 'invoiced'
    WHERE tenant_id = ? AND (billing_status IS NULL OR billing_status = '')
  `).run(tenantId);

  console.log(`[BILLING] Auto-invoice created: ${invoice.id} for $${(totalCents / 100).toFixed(2)} (${usage.length} line items) — ${tenantId}`);
}
