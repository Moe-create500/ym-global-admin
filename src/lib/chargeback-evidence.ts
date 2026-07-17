import type DatabaseType from 'better-sqlite3';
import { getAllDwsScans, SSDwsScan } from './shipsourced';

// ── Chargeback shipment proof ────────────────────────────────────────────────
// The diagram flow: chargeback → is the order fulfilled? → does it have a DWS
// scan? → attach the strongest physical evidence available. A DWS hit proves
// the package physically existed, was weighed, measured and photographed at
// the warehouse — far stronger than a tracking number alone.

export interface ShipmentProof {
  fulfilled: boolean;
  trackingNumber: string | null;
  carrier: string | null;
  shippedDate: string | null;
  trackingUrl: string | null;
  dws: {
    scannedAt: string;
    machine: string | null;
    weightOz: number | null;
    declaredWeightOz: number | null;
    lengthIn: number | null;
    widthIn: number | null;
    heightIn: number | null;
    photoUrl: string | null;
  } | null;
  proofText: string;
  checks: string[];
}

// DWS externalOrderId arrives source-prefixed ("SHIPHERO-#82497") while the
// Shopify order name is "#82497" — compare on the part after the last '#'.
const normalizeOrderRef = (v: string | null | undefined) => {
  const s = String(v || '').trim().toLowerCase();
  const hash = s.lastIndexOf('#');
  return (hash >= 0 ? s.slice(hash + 1) : s).trim();
};

// DWS photo urls are relative to the ShipSourced host.
const SS_BASE = process.env.SHIPSOURCED_API_URL || 'https://shipsourcedcenter.com';
const absolutizePhoto = (u: string | null) => (u && u.startsWith('/') ? `${SS_BASE}${u}` : u);

/**
 * Gather physical shipment evidence for a live Shopify order object.
 * Reads the store's ShipSourced DWS feed; never writes anything.
 */
export async function gatherShipmentProof(
  db: DatabaseType.Database, storeId: string, order: any,
): Promise<ShipmentProof> {
  const checks: string[] = [];
  const fulfillment = order?.fulfillments?.[0] || null;
  const fulfilled = !!fulfillment || /fulfilled/i.test(order?.fulfillment_status || '');
  checks.push(fulfilled ? '✓ order is fulfilled' : '✗ order NOT fulfilled — consider refunding instead of fighting');

  const trackingNumber = fulfillment?.tracking_number || null;
  const carrier = fulfillment?.tracking_company || null;
  const shippedDate = (fulfillment?.created_at || '').slice(0, 10) || null;
  const trackingUrl = fulfillment?.tracking_url || null;
  checks.push(trackingNumber ? `✓ tracking ${trackingNumber} (${carrier || 'carrier unknown'})` : '✗ no tracking number on the order');

  // DWS lookup — bounded to scans from just before the order date onward
  let dwsScan: SSDwsScan | null = null;
  const store: any = db.prepare(
    'SELECT shipsourced_client_id, shipsourced_extra_client_ids FROM stores WHERE id = ?'
  ).get(storeId);
  const clientIds: string[] = [];
  if (store?.shipsourced_client_id) clientIds.push(store.shipsourced_client_id);
  try {
    const extras = JSON.parse(store?.shipsourced_extra_client_ids || '[]');
    if (Array.isArray(extras)) for (const id of extras) if (id && !clientIds.includes(id)) clientIds.push(id);
  } catch { /* extras optional */ }

  if (clientIds.length && fulfilled) {
    const since = order?.created_at
      ? new Date(new Date(order.created_at).getTime() - 2 * 86400000).toISOString().slice(0, 10)
      : undefined;
    const orderRef = normalizeOrderRef(order?.name);
    for (const cid of clientIds) {
      try {
        const scans = await getAllDwsScans(cid, since);
        dwsScan =
          scans.find(s => trackingNumber && s.trackingNumber === trackingNumber) ||
          scans.find(s => orderRef && normalizeOrderRef(s.externalOrderId) === orderRef) ||
          null;
        if (dwsScan) break;
      } catch (e) {
        checks.push(`⚠ DWS feed error for client ${cid.slice(0, 8)}…: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
      }
    }
    checks.push(dwsScan
      ? `✓ DWS scan found — actual ${dwsScan.dwsWeightOz ?? '?'}oz on ${dwsScan.dwsScannedAt.slice(0, 16)}${dwsScan.dwsPhotoUrl ? ', warehouse photo available' : ''}`
      : '○ no DWS scan matched — falling back to tracking-only evidence');
  } else if (!clientIds.length) {
    checks.push('○ store has no ShipSourced client linked — DWS unavailable');
  }

  // Evidence paragraph, strongest-first
  const parts: string[] = [];
  if (fulfilled && shippedDate) {
    parts.push(`The order was fulfilled and shipped on ${shippedDate}${carrier ? ` via ${carrier}` : ''}${trackingNumber ? `, tracking number ${trackingNumber}` : ''}${trackingUrl ? ` (${trackingUrl})` : ''}.`);
  }
  if (dwsScan) {
    const dims = [dwsScan.dwsLengthIn, dwsScan.dwsWidthIn, dwsScan.dwsHeightIn].every(v => v != null)
      ? `${dwsScan.dwsLengthIn}" x ${dwsScan.dwsWidthIn}" x ${dwsScan.dwsHeightIn}"` : null;
    parts.push(
      `Independent fulfillment-warehouse records confirm the physical package: it was weighed and scanned at the automated scale station${dwsScan.dwsMachine ? ` (${dwsScan.dwsMachine})` : ''} on ${dwsScan.dwsScannedAt.replace('T', ' ').slice(0, 16)} UTC` +
      `${dwsScan.dwsWeightOz != null ? `, recording an actual weight of ${dwsScan.dwsWeightOz} oz` : ''}${dims ? ` and dimensions ${dims}` : ''}.` +
      `${dwsScan.dwsPhotoUrl ? ` A photograph of the sealed package taken at scan time is available at: ${absolutizePhoto(dwsScan.dwsPhotoUrl)}` : ''}`
    );
  }

  return {
    fulfilled, trackingNumber, carrier, shippedDate, trackingUrl,
    dws: dwsScan ? {
      scannedAt: dwsScan.dwsScannedAt, machine: dwsScan.dwsMachine,
      weightOz: dwsScan.dwsWeightOz, declaredWeightOz: dwsScan.declaredWeightOz,
      lengthIn: dwsScan.dwsLengthIn, widthIn: dwsScan.dwsWidthIn, heightIn: dwsScan.dwsHeightIn,
      photoUrl: absolutizePhoto(dwsScan.dwsPhotoUrl),
    } : null,
    proofText: parts.join('\n\n'),
    checks,
  };
}
