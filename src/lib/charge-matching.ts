import type DatabaseType from 'better-sqlite3';
import { getCardAliasMap } from './funding-cards';

/** Which card charge paid which invoice.
 *
 *  Meta, Google and Shopify bill an invoice; the money leaves as a charge on a
 *  credit card. This links the two so every invoice can say "✓ on ··1009" —
 *  and so an invoice with NO charge is a real finding (declined card, billed
 *  but never collected) rather than a gap in our own matching.
 *
 *  The old engine that did this lived in `transactions-intel.ts` and went with
 *  the Brain teardown (26ad7f3, 2026-09-09), which is why every ad payment
 *  after that date reads "NO CARD CHARGE" while the charge sits on the card.
 *  This is the narrow replacement: it links invoices to charges and nothing
 *  else — no classification, no transfer pairing, no store attribution
 *  rewriting. Rows it writes keep whatever `class`/`store_id` they already had.
 *
 *  Calibrated on the 1,649 links the old engine left behind:
 *    · every matched charge names its platform in the description (1,441 fb,
 *      208 google) — so the merchant is required, not merely preferred
 *    · lag invoice→charge: 79% same day, 12% next day, tail to +8, a few at −2
 *    · the invoice's card mask agrees outright 45% of the time; the rest
 *      resolve through the funding-card alias map (··2976 → Platinum ··1009,
 *      ··1014 → ··1006, ··1654 → ··9215 …), never by mask string alone. */

export const LAG_MIN = -3;
export const LAG_MAX = 10;

export type InvoiceKind = 'ad_payment' | 'shopify_invoice';

export interface InvoiceRow { id: string; store_id: string | null; date: string; card_last4: string | null; amount_cents: number; platform?: string | null }
export interface ChargeRow { id: string; date: string; amount_cents: number; description: string; account_id: string; last_four: string | null }

const MERCHANT: Record<string, RegExp> = {
  facebook: /FACEBK|FACEBOOK|META PLATFORMS/i,
  google: /GOOGLE/i,
  shopify: /SHOPIFY/i,
};
/** Google bills ads and non-ads (Workspace, One, Cloud) on the same cards. */
const GOOGLE_ADS = /ADS/i;

export function chargeNamesPlatform(description: string, platform: string): boolean {
  const rx = MERCHANT[platform];
  if (!rx || !rx.test(description)) return false;
  if (platform === 'google') return GOOGLE_ADS.test(description);
  return true;
}

const dayNum = (d: string) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000);
export const lagDays = (invoiceDate: string, chargeDate: string) => dayNum(chargeDate) - dayNum(invoiceDate);

/** How typical this lag is, from the learned distribution. 0 = outside the window. */
export function lagScore(lag: number): number {
  if (lag < LAG_MIN || lag > LAG_MAX) return 0;
  if (lag === 0) return 1;
  if (lag === 1) return 0.8;
  if (lag < 0) return 0.45;
  if (lag <= 3) return 0.6;
  if (lag <= 6) return 0.45;
  return 0.3;
}

export type CardVerdict = 'match' | 'match_via_alias' | 'unknown' | 'partial';

/** Does the invoice's funding card correspond to the account the charge hit? */
export function cardVerdict(invoiceCard: string | null, charge: ChargeRow, alias: Map<string, string[]>): CardVerdict {
  if (!invoiceCard) return 'partial';
  if (charge.last_four && invoiceCard === charge.last_four) return 'match';
  const accounts = alias.get(invoiceCard);
  if (accounts && accounts.includes(charge.account_id)) return 'match_via_alias';
  return 'unknown';
}

export interface Scored { charge: ChargeRow; score: number; lag: number; card: CardVerdict }

export function scoreCandidate(inv: InvoiceRow, charge: ChargeRow, alias: Map<string, string[]>): Scored | null {
  const lag = lagDays(inv.date, charge.date);
  const ls = lagScore(lag);
  if (ls === 0) return null;
  const card = cardVerdict(inv.card_last4, charge, alias);
  // A charge on a card the invoice says it did NOT use is not this invoice's
  // charge, however well the date fits — two brands billing the same amount on
  // the same day is exactly the case this has to get right.
  if (card === 'unknown') return null;
  const bonus = card === 'match' ? 0.35 : card === 'match_via_alias' ? 0.3 : 0;
  return { charge, score: Math.min(1, ls * 0.65 + bonus), lag, card };
}

export interface MatchDecision { invoice: InvoiceRow; best: Scored | null; accepted: boolean; reason: string; candidates: number; runnerUp: number | null }

/** Pick the charge for one invoice out of the candidate charges at that amount. */
export function decide(inv: InvoiceRow, charges: ChargeRow[], alias: Map<string, string[]>): MatchDecision {
  const platform = inv.platform || 'shopify';
  const scored = charges
    .filter(c => Math.abs(c.amount_cents) === Math.abs(inv.amount_cents))
    .filter(c => chargeNamesPlatform(c.description, platform))
    .map(c => scoreCandidate(inv, c, alias))
    .filter((x): x is Scored => x !== null)
    .sort((a, b) => b.score - a.score || Math.abs(a.lag) - Math.abs(b.lag));

  if (!scored.length) return { invoice: inv, best: null, accepted: false, reason: 'no charge at this amount on a card this invoice could have used', candidates: 0, runnerUp: null };

  const best = scored[0];
  const runnerUp = scored[1] ? scored[1].score : null;
  // Uniqueness is itself evidence: one charge at this exact amount, on this
  // card, inside the window — there is nothing else it could be.
  if (scored.length === 1) {
    const floor = best.card === 'partial' ? 0.55 : 0.85;
    return { invoice: inv, best, accepted: Math.max(best.score, floor) >= 0.55, reason: 'only candidate', candidates: 1, runnerUp: null };
  }
  const margin = best.score - (runnerUp ?? 0);
  if (best.score >= 0.4 && margin >= 0.12) return { invoice: inv, best, accepted: true, reason: 'clear best of several', candidates: scored.length, runnerUp };
  return { invoice: inv, best, accepted: false, reason: 'two charges fit equally — needs a human', candidates: scored.length, runnerUp };
}

export interface MatchResult { considered: number; linked: number; ambiguous: number; unmatched: number; byKind: Record<string, number> }

/** Link recent invoices to the charges that paid them. Idempotent: an invoice
 *  that already has a link is left alone, and a charge already spent on another
 *  invoice is not offered twice. Only the entity columns are written — the
 *  classifier owns `class` and `store_id`. */
export function matchInvoicesToCharges(db: DatabaseType.Database, opts: { days?: number; dryRun?: boolean } = {}): MatchResult {
  const days = opts.days ?? 60;
  const since = new Date(Date.now() - (days + LAG_MAX) * 86400000).toISOString().slice(0, 10);
  const alias = getCardAliasMap(db);
  const res: MatchResult = { considered: 0, linked: 0, ambiguous: 0, unmatched: 0, byKind: {} };

  const charges: ChargeRow[] = db.prepare(`
    SELECT t.id, t.date, t.amount_cents, COALESCE(t.description, '') AS description,
           a.id AS account_id, a.last_four
    FROM bank_transactions t
    JOIN bank_accounts a ON a.id = t.bank_account_id
    WHERE a.account_type = 'credit' AND a.status = 'active' AND t.date >= ?`).all(since) as any[];

  // A charge already attributed to an invoice is spent.
  const taken = new Set<string>(
    (db.prepare(`SELECT txn_id FROM txn_links WHERE entity_id IS NOT NULL AND entity_type IN ('ad_payment','shopify_invoice')`).all() as any[]).map(r => r.txn_id)
  );
  const byAmount = new Map<number, ChargeRow[]>();
  for (const c of charges) {
    if (taken.has(c.id)) continue;
    const k = Math.abs(c.amount_cents);
    const list = byAmount.get(k); if (list) list.push(c); else byAmount.set(k, [c]);
  }

  const invoices: { kind: InvoiceKind; row: InvoiceRow }[] = [
    ...(db.prepare(`SELECT id, store_id, date, card_last4, amount_cents, platform FROM ad_payments
                    WHERE date >= ? AND NOT EXISTS (SELECT 1 FROM txn_links l WHERE l.entity_type = 'ad_payment' AND l.entity_id = ad_payments.id)`).all(since) as any[])
      .map(row => ({ kind: 'ad_payment' as const, row })),
    ...(db.prepare(`SELECT id, store_id, date, card_last4, total_cents AS amount_cents, 'shopify' AS platform FROM shopify_invoices
                    WHERE date >= ? AND NOT EXISTS (SELECT 1 FROM txn_links l WHERE l.entity_type = 'shopify_invoice' AND l.entity_id = shopify_invoices.id)`).all(since) as any[])
      .map(row => ({ kind: 'shopify_invoice' as const, row })),
  ];
  // Oldest first: an older invoice has first claim on an older charge.
  invoices.sort((a, b) => a.row.date.localeCompare(b.row.date));

  const upsert = db.prepare(`
    INSERT INTO txn_links (txn_id, entity_type, entity_id, match_score, match_evidence, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(txn_id) DO UPDATE SET
      entity_type = excluded.entity_type, entity_id = excluded.entity_id,
      match_score = excluded.match_score, match_evidence = excluded.match_evidence,
      updated_at = datetime('now')`);

  const apply = db.transaction(() => {
    for (const { kind, row } of invoices) {
      if (!row.amount_cents) continue;
      res.considered++;
      const pool = (byAmount.get(Math.abs(row.amount_cents)) || []).filter(c => !taken.has(c.id));
      const d = decide(row, pool, alias);
      if (!d.accepted || !d.best) { if (d.candidates > 1) res.ambiguous++; else res.unmatched++; continue; }
      taken.add(d.best.charge.id);
      res.linked++; res.byKind[kind] = (res.byKind[kind] || 0) + 1;
      if (opts.dryRun) continue;
      upsert.run(d.best.charge.id, kind, row.id, Math.round(d.best.score * 100) / 100, JSON.stringify({
        invoiceDate: row.date, txnDate: d.best.charge.date, lagDays: d.best.lag,
        card: d.best.card, candidates: d.candidates, reason: d.reason, matcher: 'charge-matching@1',
      }));
    }
  });
  apply();
  return res;
}
