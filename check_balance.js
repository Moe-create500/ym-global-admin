const Database = require('better-sqlite3');
const db = new Database('prisma/dev.db');
const storeId = 'e08a4c43-43a2-4892-8233-087c39beb86c';

const charges = db.prepare(`
  SELECT payment_method, card_last4, SUM(total_cents) as charged
  FROM shopify_invoices
  WHERE store_id = ? AND payment_method IS NOT NULL AND payment_method != ''
    AND NOT (source = 'chargeflow' AND (payment_method LIKE '%shopify%' OR payment_method LIKE '%Shopify%'))
  GROUP BY payment_method, card_last4
`).all(storeId);

const payments = db.prepare(`
  SELECT card_last4, SUM(amount_cents) as paid
  FROM card_payments_log WHERE store_id = ? AND category = 'app'
  GROUP BY card_last4
`).all(storeId);

let totalCharged = 0, totalPaid = 0;
charges.forEach(c => { totalCharged += c.charged; console.log('Charge:', c.payment_method, c.card_last4, '$' + (c.charged/100)); });
payments.forEach(p => { totalPaid += p.paid; console.log('Paid:', p.card_last4, '$' + (p.paid/100)); });
console.log('Balance Due (app invoices page):', '$' + ((totalCharged - totalPaid)/100));

// What CFO currently calculates
const cfoCharged = db.prepare('SELECT COALESCE(SUM(total_cents), 0) as t FROM shopify_invoices WHERE store_id = ?').get(storeId);
const cfoPaid = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) as t FROM card_payments_log WHERE store_id = ? AND category = 'app'").get(storeId);
console.log('CFO charged (all invoices):', '$' + (cfoCharged.t/100));
console.log('CFO paid:', '$' + (cfoPaid.t/100));
console.log('CFO balance:', '$' + ((cfoCharged.t - cfoPaid.t)/100));
