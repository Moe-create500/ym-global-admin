const Database = require('better-sqlite3');
const { getBillingCharges, getFundingSource } = require('./src/lib/facebook');
const crypto = require('crypto');

async function main() {
  const db = new Database('prisma/dev.db');
  const profile = db.prepare("SELECT * FROM fb_profiles WHERE profile_name = 'SINO' AND is_active = 1").get();
  
  if (!profile) { console.log('Profile not found'); return; }
  console.log('Syncing invoices for', profile.profile_name, profile.ad_account_id);

  // Pull billing charges going back further
  const from = '2024-01-01';
  const charges = await getBillingCharges(profile.ad_account_id, profile.access_token, from);
  console.log('Charges from API:', charges.length);

  let fundingSource;
  try {
    fundingSource = await getFundingSource(profile.ad_account_id, profile.access_token);
  } catch(e) { console.log('Funding source error:', e.message); }

  const paymentMethod = fundingSource?.display_string || '';
  const cardMatch = paymentMethod.match(/(\d{4})\s*$/);
  const cardLast4 = cardMatch ? cardMatch[1] : '';

  let imported = 0;
  for (const charge of charges) {
    const existing = db.prepare('SELECT id FROM ad_payments WHERE transaction_id = ?').get(charge.transaction_id);
    if (existing) continue;
    db.prepare(`
      INSERT INTO ad_payments (id, store_id, platform, date, transaction_id, payment_method, card_last4, amount_cents, currency, status, account_id)
      VALUES (?, ?, 'facebook', ?, ?, ?, ?, ?, ?, 'paid', ?)
    `).run(crypto.randomUUID(), profile.store_id, charge.date,
      charge.transaction_id, paymentMethod, cardLast4,
      charge.amount_cents, charge.currency, profile.ad_account_id);
    imported++;
  }
  console.log('Imported:', imported, 'new invoices');
  
  const total = db.prepare('SELECT COUNT(*) as cnt FROM ad_payments WHERE store_id = ?').get(profile.store_id);
  console.log('Total invoices now:', total.cnt);
}
main().catch(e => console.error(e));
