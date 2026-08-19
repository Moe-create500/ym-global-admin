import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ensureTxnIntelTables, getPayPlan } from '@/lib/transactions-intel';
import { brainCached } from '@/lib/brain-cache';
import { getForwardCash } from '@/lib/forward-cash';
import { runIntegrityChecks, getRisks, getWhatChanged, takeBrainSnapshot } from '@/lib/brain-insights';
import { getSourceHealth } from '@/lib/source-registry';
import { getIncomingCash } from '@/lib/incoming-cash';

export const dynamic = 'force-dynamic';

// The Brain's command payload: state → verify → predict → risk → decide → why.
// Every number here is consumed from an authoritative lib — nothing invented.
function buildCommand(db: any) {
  const payPlan = brainCached('payplan', () => getPayPlan(db));
  const forward = getForwardCash(db, payPlan);
  const integrity = runIntegrityChecks(db, payPlan);
  const risks = getRisks(db, payPlan, forward);
  const changed = getWhatChanged(db);
  const trust = getSourceHealth(db);

  // Deterministic recommendation: the top risk's action, or the clear-skies note
  const top = risks[0];
  const recommendation = top
    ? { title: top.title, action: top.action, why: top.why, cents: top.cents, confidence: trust.trustworthy ? 'high' : 'reduced — some feeds stale' }
    : { title: 'No urgent risks', action: `Safe to deploy: YM $${(forward.ymgv.safeToDeployCents / 100).toFixed(0)} · SS $${(forward.shipsourced.safeToDeployCents / 100).toFixed(0)}`, why: 'no overdue statements, no shortfalls in the committed 14-day projection, no unlanded payments flagged', cents: 0, confidence: trust.trustworthy ? 'high' : 'reduced — some feeds stale' };

  return { payPlan: undefined, forward, integrity, risks: risks.slice(0, 6), changed, trust: { trustworthy: trust.trustworthy, badCount: trust.badCount, summary: trust.summary }, recommendation };
}

export async function GET() {
  const db = getDb();
  ensureTxnIntelTables(db);
  try { takeBrainSnapshot(db); } catch { /* snapshot is best-effort */ }
  return NextResponse.json(brainCached('brain:command', () => buildCommand(db)));
}

// Ask the Brain — deterministic intent matching over authoritative facts.
// No LLM in the money path: the answer is computed, never imagined.
export async function POST(req: NextRequest) {
  const db = getDb();
  ensureTxnIntelTables(db);
  const { question } = await req.json().catch(() => ({}));
  const q = String(question || '').toLowerCase();
  const fmt = (c: number) => `$${(Math.abs(c) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  const payPlan = brainCached('payplan', () => getPayPlan(db));
  const forward = getForwardCash(db, payPlan);
  const trust = getSourceHealth(db);
  const caveat = trust.trustworthy ? '' : ` ⚠ confidence reduced: ${trust.summary}`;

  // "can I spend/afford/order $X" → committed-scenario simulation (never touches live books)
  const spend = q.match(/can .*(spend|afford|order|buy|place|scale).*?\$?\s*([\d][\d,\.]*)\s*(k\b)?/);
  if (spend) {
    const amt = Math.round(parseFloat(spend[2].replace(/,/g, '')) * (spend[3] ? 1000 : 1) * 100);
    const co = /shipsourced|\bss\b/.test(q) ? 'shipsourced' : 'ymgv';
    const proj = forward[co];
    const lowAfter = proj.lowestCommitted14.cents - amt;
    const ok = lowAfter >= proj.floorCents;
    return NextResponse.json({
      answer: `${ok ? 'YES' : 'NO'} — spending ${fmt(amt)} today takes ${co === 'ymgv' ? 'YM' : 'ShipSourced'}'s worst committed 14-day cash point to ${lowAfter < 0 ? '−' : ''}${fmt(lowAfter)} on ${proj.lowestCommitted14.date} (floor ${fmt(proj.floorCents)}).${ok ? '' : ` Short by ${fmt(proj.floorCents - lowAfter)} against known obligations.`}${caveat}`,
      facts: { scenario: 'simulation only — live books untouched', amountCents: amt, company: co, lowestAfterCents: lowAfter, lowestDate: proj.lowestCommitted14.date, floorCents: proj.floorCents, assumptions: proj.assumptions },
    });
  }
  if (/where.*(money|cash)|cash position/.test(q)) {
    const c = forward.cashNow;
    const inc = getIncomingCash(db);
    return NextResponse.json({
      answer: `YM: ${fmt(c.ymgv.cashCents)} in banks (${fmt(c.ymgv.usableCents)} usable after pendings/in-flight). ShipSourced: ${fmt(c.shipsourced.cashCents)} in banks (${fmt(c.shipsourced.usableCents)} usable). At Shopify: ${fmt(inc.totals.atShopifyCents)} · held in reserve: ${fmt(inc.totals.reservesCents)} · landing ≤7d: ${fmt(inc.totals.upcoming7Cents)}.${caveat}`,
      facts: { cash: c, incoming: inc.totals },
    });
  }
  if (/who owes|owes what|owe/.test(q)) {
    const brands: any[] = db.prepare(`SELECT name, ss_net_owed_cents c FROM stores WHERE is_active = 1 AND ss_net_owed_cents > 0 AND name != 'ShipSourced' ORDER BY c DESC LIMIT 8`).all();
    const storeOwes = (payPlan.storePlans || []).filter((s: any) => s.owedTotal > 0).map((s: any) => `${s.store} ${fmt(s.owedTotal)}`).join(' · ');
    return NextResponse.json({
      answer: `On cards: ${storeOwes || 'nothing traced'}. Brands owe ShipSourced (fulfillment): ${brands.map(b => `${b.name} ${fmt(b.c)}`).join(' · ') || 'nothing'}.${caveat}`,
      facts: { cardShares: payPlan.storePlans, brandsOweSS: brands },
    });
  }
  if (/what.*(pay|due).*(week|today|now)|must.*pay/.test(q)) {
    const m = payPlan.meetStatement;
    const payroll = payPlan.payroll?.due7Cents || 0;
    return NextResponse.json({
      answer: `Overdue: ${fmt(m.overdueCents)} (${m.overdueCards.map((c: any) => '·' + c.last4).join(' ') || 'none'}). Due ≤7d: ${fmt(m.dueSoonCents)} (${m.dueSoonCards.map((c: any) => `·${c.last4} ${fmt(c.cents)} in ${c.daysToDue}d`).join(' · ') || 'none'}). Payroll ≤7d: ${fmt(payroll)}.${caveat}`,
      facts: { meetStatement: m, payrollDue7Cents: payroll },
    });
  }
  if (/risk/.test(q)) {
    const risks = getRisks(db, payPlan, forward).slice(0, 3);
    return NextResponse.json({
      answer: risks.length ? risks.map((r, i) => `#${i + 1} ${r.title} (${fmt(r.cents)}) — ${r.action}`).join('  |  ') + caveat : `No ranked risks right now.${caveat}`,
      facts: { risks },
    });
  }
  if (/chang/.test(q)) {
    const ch = getWhatChanged(db);
    return NextResponse.json({
      answer: ch.available && 'changes' in ch ? `Since ${ch.from}: ` + (ch.changes as any[]).map(c => `${c.metric} ${c.deltaCents > 0 ? '+' : '−'}${fmt(c.deltaCents)}`).join(' · ') : (ch as any).note,
      facts: ch,
    });
  }
  if (/trust|stale|reliab/.test(q)) {
    return NextResponse.json({ answer: trust.trustworthy ? 'All feeds current — numbers are live.' : `Reduced trust: ${trust.summary}`, facts: { sources: trust.summary, badCount: trust.badCount } });
  }
  return NextResponse.json({
    answer: 'I can answer: where is my money · who owes what · what must I pay this week · what are my risks · what changed · can I spend $X · can I trust the data. Ask one of those.',
    facts: null,
  });
}
