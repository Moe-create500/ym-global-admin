const Database = require('better-sqlite3');
const crypto = require('crypto');
const db = new Database('prisma/dev.db');
const store = db.prepare("SELECT id, chargeflow_api_key FROM stores WHERE name = 'Marroomi'").get();

const CF_BASE = 'https://api.chargeflow.io/public/2025-04-01';

async function getDisputes(apiKey, page, limit) {
  const res = await fetch(`${CF_BASE}/disputes?offset=${page}&limit=${limit}`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) throw new Error(`CF error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  let page = 1;
  let total = 0;
  let imported = 0;
  while (true) {
    const data = await getDisputes(store.chargeflow_api_key, page, 100);
    console.log('Page', page, ':', data.disputes?.length, 'disputes, total:', data.pagination?.totalCount);
    if (!data.disputes || data.disputes.length === 0) break;

    for (const d of data.disputes) {
      const chargebackDate = d.created_at.substring(0, 10);
      const amountCents = Math.round(d.amount * 100);
      const status = d.status === 'won' ? 'won' : d.status === 'lost' ? 'lost' : 'open';
      const existing = db.prepare('SELECT id FROM chargebacks WHERE store_id = ? AND dispute_id = ?').get(store.id, d.id);
      if (!existing) {
        db.prepare(`INSERT INTO chargebacks (id, store_id, dispute_id, order_number, chargeback_date, amount_cents, reason, status, source, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'chargeflow', ?)`).run(
          crypto.randomUUID(), store.id, d.id, d.order || null, chargebackDate, amountCents, d.reason || null, status, d.stage || null);
        imported++;
      }
      total++;
    }
    if (total >= data.pagination.totalCount) break;
    page++;
  }
  console.log('Done. Total:', total, 'Imported:', imported);
}
main().catch(e => console.error('FAILED:', e.message));
