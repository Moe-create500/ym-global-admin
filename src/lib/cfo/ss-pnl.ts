import type DatabaseType from 'better-sqlite3';
import { getSsPnl, type SSPnlResponse } from '../shipsourced';
import { ledgerCosts, type SsLedgerCost, type SsLine, SS_LINE_LABEL } from './ss-costs';

/** ShipSourced P&L by fulfilment centre, end to end:
 *    revenue + direct costs  ← ShipSourced billing (per warehouse, from its API)
 *    operating costs          ← YM's ledger rows paired to ShipSourced, classified by line × centre
 *  Shared ledger costs are allocated to CA / CN by billed-revenue share for the
 *  period (rule shown on the page; totals preserved: CA + CN + unallocated =
 *  ledger total). When the ShipSourced feed is unavailable, revenue and direct
 *  costs are `null` (unknown), never zero, and the P&L is marked partial. */

export interface CenterPnl {
  center: 'CA' | 'CN';
  revenueCents: number | null;
  directCents: number | null;         // ShipSourced-recorded label + product + service + packaging cost
  grossCents: number | null;
  carrierInvoiceCents: number | null; // settled carrier invoices for this lane (informational — the true carrier bill)
  opexDirectCents: number;            // ledger rows classified to this centre
  opexSharedCents: number;            // allocated share of 'shared' rows
  opexCents: number;
  netCents: number | null;
  charges: number;
  noWarehouse: number;
  revenueLines: Record<string, number>;
  directLines: Record<string, number>;
  opexLines: { line: SsLine; label: string; directCents: number; sharedCents: number }[];
}

export interface SsPnl {
  period: { from: string; to: string };
  source: { shipsourced: 'live' | 'unavailable'; reason?: string; asOf?: string };
  centers: CenterPnl[];
  unknownRegion: { revenueCents: number; directCents: number; charges: number } | null;
  shared: { totalCents: number; allocation: { CA: number; CN: number }; basis: string };
  ledger: { totalCents: number; rows: number; needsReviewCents: number; cells: SsLedgerCost[] };
  combined: { revenueCents: number | null; directCents: number | null; opexCents: number; netCents: number | null };
}

export function composePnl(feed: SSPnlResponse | null, ledger: ReturnType<typeof ledgerCosts>, period: { from: string; to: string }, reason?: string): SsPnl {
  const byRegion = new Map((feed?.regions || []).map(r => [r.region, r]));
  const rev = (r: string) => byRegion.get(r)?.revenue.total ?? null;
  const revCA = rev('US'), revCN = rev('CN');
  const known = feed != null;
  // Allocation of shared ledger costs: billed-revenue share; if no revenue data, split 50/50 and say so.
  const totalRev = (revCA || 0) + (revCN || 0);
  const shareCA = known && totalRev > 0 ? (revCA || 0) / totalRev : 0.5;
  const basis = known && totalRev > 0 ? `by billed revenue share (CA ${(shareCA * 100).toFixed(0)}% / CN ${((1 - shareCA) * 100).toFixed(0)}%)` : 'ShipSourced revenue unavailable — shared costs split 50/50 until it is';
  const sharedCells = ledger.cells.filter(c => c.center === 'shared');
  const sharedTotal = sharedCells.reduce((s, c) => s + c.cents, 0);
  const allocCA = Math.round(sharedTotal * shareCA), allocCN = sharedTotal - allocCA;
  const carrier = (lane: string) => feed ? feed.carrierInvoices.filter(c => c.lane === lane).reduce((s, c) => s + c.usdCents + c.managerFeeCents - c.creditsCents, 0) : null;

  const center = (id: 'CA' | 'CN', region: string, alloc: number, share: number): CenterPnl => {
    const r = byRegion.get(region);
    const direct = ledger.cells.filter(c => c.center === id);
    const opexDirect = direct.reduce((s, c) => s + c.cents, 0);
    const lines = new Map<SsLine, { directCents: number; sharedCents: number }>();
    for (const c of direct) { const l = lines.get(c.line) || { directCents: 0, sharedCents: 0 }; l.directCents += c.cents; lines.set(c.line, l); }
    for (const c of sharedCells) { const l = lines.get(c.line) || { directCents: 0, sharedCents: 0 }; l.sharedCents += Math.round(c.cents * share); lines.set(c.line, l); }
    const revenue = r ? r.revenue.total : (known ? 0 : null);
    const directCost = r ? r.direct.total : (known ? 0 : null);
    const gross = revenue == null || directCost == null ? null : revenue - directCost;
    return {
      center: id, revenueCents: revenue, directCents: directCost, grossCents: gross, carrierInvoiceCents: carrier(id === 'CA' ? 'US' : 'CN'),
      opexDirectCents: opexDirect, opexSharedCents: alloc, opexCents: opexDirect + alloc,
      netCents: gross == null ? null : gross - opexDirect - alloc,
      charges: r?.charges || 0, noWarehouse: r?.noWarehouse || 0,
      revenueLines: r ? { shipping: r.revenue.shipping, chinaFee: r.revenue.chinaFee, managerFee: r.revenue.managerFee, pickPack: r.revenue.pickPack, packaging: r.revenue.packaging, ...Object.fromEntries(Object.entries(r.revenue.service).map(([k, v]) => [`service:${k}`, v])) } : {},
      directLines: r ? { labelCost: r.direct.labelCost, productCost: r.direct.productCost, serviceCost: r.direct.serviceCost, packagingCost: r.direct.packagingCost } : {},
      opexLines: [...lines.entries()].map(([line, v]) => ({ line, label: SS_LINE_LABEL[line], ...v })).sort((a, b) => (b.directCents + b.sharedCents) - (a.directCents + a.sharedCents)),
    };
  };
  const ca = center('CA', 'US', allocCA, shareCA), cn = center('CN', 'CN', allocCN, 1 - shareCA);
  const unk = byRegion.get('unknown');
  const sum = (a: number | null, b: number | null) => a == null || b == null ? null : a + b;
  return {
    period, source: feed ? { shipsourced: 'live', asOf: feed.asOf } : { shipsourced: 'unavailable', reason },
    centers: [ca, cn],
    unknownRegion: unk ? { revenueCents: unk.revenue.total, directCents: unk.direct.total, charges: unk.charges } : null,
    shared: { totalCents: sharedTotal, allocation: { CA: allocCA, CN: allocCN }, basis },
    ledger: { totalCents: ledger.total, rows: ledger.rows, needsReviewCents: ledger.needsReviewCents, cells: ledger.cells },
    combined: { revenueCents: sum(sum(ca.revenueCents, cn.revenueCents), unk ? unk.revenue.total : 0), directCents: sum(sum(ca.directCents, cn.directCents), unk ? unk.direct.total : 0), opexCents: ledger.total, netCents: sum(sum(ca.netCents, cn.netCents), unk ? unk.revenue.total - unk.direct.total : 0) },
  };
}

export async function getShipSourcedPnl(db: DatabaseType.Database, from: string, to: string): Promise<SsPnl> {
  const ss: any = db.prepare("SELECT id FROM stores WHERE name = 'ShipSourced'").get();
  const ledger = ss ? ledgerCosts(db, ss.id, from, to) : { cells: [], total: 0, needsReviewCents: 0, rows: 0 };
  let feed: SSPnlResponse | null = null, reason: string | undefined;
  if (!process.env.SHIPSOURCED_API_TOKEN) reason = 'SHIPSOURCED_API_TOKEN not set';
  else {
    try { feed = await getSsPnl(from, to); }
    catch (e: any) { const m = String(e?.message || e); reason = / 40[134]:|error 40[134]/.test(m) ? 'ShipSourced does not serve this feed yet — the P&L feed is on the PR branch, not deployed' : m.slice(0, 140); }
  }
  return composePnl(feed, ledger, { from, to }, reason);
}
