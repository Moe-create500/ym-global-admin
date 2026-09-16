/** Merchant identity for recurring-charge detection.
 *
 *  Bank descriptions for the same vendor drift constantly: "OPENAI *CHATGPT",
 *  "OPENAI CHATGPT SUBSSAN FRANCISCO", "OPENAI*CHATGPT SUBSCRIPTION",
 *  "KLAVIYO INC. SOFTWARBOSTON". The key strips reference codes, ACH
 *  metadata (DES:/ID:/INDN:), entity suffixes, cities/states and truncated
 *  location fragments, then keeps the distinctive leading token(s). It is a
 *  deliberately coarse identity — amount tiers and intervals split it into
 *  separate subscriptions afterwards (see detect.ts). */

const ACH_META = /\b(DES|ID|INDN|CO ID|CCD|PPD|WEB|PMT INFO|CONF#|CONFIRMATION#?)\b:?\S*/gi;
const NOISE = new Set([
  'INC', 'LLC', 'LTD', 'CORP', 'CO', 'COM', 'WWW', 'HTTP', 'HTTPS', 'THE',
  'SUBSCRIPTION', 'SUBSCR', 'SUBS', 'SCHEDULED', 'CONF', 'MONTHLY', 'ANNUAL', 'PAYMENT', 'PAYMENTS', 'BILL', 'BILLING', 'ONLINE', 'PURCHASE', 'RECURRING', 'AUTOPAY', 'MEMBERSHIP', 'RENEWAL', 'PLAN', 'PRO', 'PLUS', 'TEAM', 'BUSINESS',
  'USA', 'US', 'CA', 'NY', 'DE', 'WA', 'TX', 'FL', 'MA', 'IL', 'GA', 'CO', 'AZ', 'NV', 'OR', 'UT', 'GB', 'SG', 'HK', 'CH', 'IE', 'AU', 'NL', 'FR', 'CANADA', 'UK',
  'SAN', 'FRANCISCO', 'MOUNTAIN', 'VIEW', 'MENLO', 'PARK', 'NEW', 'YORK', 'LOS', 'ANGELES', 'SEATTLE', 'DALLAS', 'BOSTON', 'MIAMI', 'LONDON', 'DUBLIN', 'SINGAPORE', 'KENT', 'CLOVIS', 'FRESNO', 'WILMINGTON', 'AUSTIN', 'COLUMBUS', 'PHOENIX', 'DENVER', 'CHICAGO', 'HOUSTON', 'ATLANTA', 'PORTLAND', 'EAGLE', 'DERRY', 'ALEXANDRIA',
]);
/** Leading tokens that are payment rails or generic prefixes, not the vendor. */
const RAIL_PREFIX = new Set(['ZELLE', 'SCHEDULED', 'APLPAY', 'APPLE', 'PAYPAL', 'PP', 'SQ', 'TST', 'SP', 'PWP', 'AMZN', 'AMAZON', 'GOOGLE', 'MSFT', 'MICROSOFT', 'FB', 'META', 'SHOPIFY', 'STRIPE', 'CHECKCARD', 'DEBIT', 'POS', 'PURCHASE', 'RECURRING', 'RENEWAL', 'MEMBERSHIP']);
/** Known multi-word vendors whose second word is part of the name. */
const TWO_WORD = new Set(['TRIPLE WHALE', 'SIMPLY BUSINESS', 'HOME DEPOT', 'UNWIRED BROADBAND', 'ESCOR GROUP', 'KEEPA PRICE', 'SHIPSENSE GROUP', 'ROYAL STAR', 'ALASKA AIRLINES', 'UNITED AIRLINES', 'INTUIT QUICKBOOKS', 'GOOGLE WORKSPACE', 'GOOGLE CLOUD', 'AMAZON PRIME', 'AMAZON WEB', 'MICROSOFT AZURE', 'ADOBE CREATIVE', 'FAL FEATURES', 'X CORP']);

export interface MerchantKey { key: string; display: string; tokens: string[] }

export function merchantKey(description: string | null | undefined): MerchantKey | null {
  let s = String(description || '').toUpperCase();
  s = s.replace(ACH_META, ' ');
  s = s.replace(/[*#|]/g, ' ');
  s = s.replace(/\b[A-Z]*\d[A-Z0-9]*\b/g, ' ');       // any token with a digit: refs, dates, order ids, masks
  s = s.replace(/[^A-Z ]/g, ' ');
  let toks = s.split(/\s+/).filter(t => t.length >= 2 && !NOISE.has(t));
  // drop truncated location fragments glued to a word: "SOFTWARBOSTON" → keep "SOFTWAR"? No — drop the token when it ends with a known city
  toks = toks.map(t => { for (const city of ['BOSTON', 'FRANCISCO', 'DALLAS', 'FRESNO', 'ANGELES', 'PHOENIX', 'LAUDERDALE', 'GUANGZHOU', 'SHANGHAI']) if (t.length > city.length && t.endsWith(city)) return t.slice(0, -city.length); return t; })
             .filter(t => t.length >= 3);
  if (!toks.length) return null;
  let i = 0;
  while (i < toks.length - 1 && RAIL_PREFIX.has(toks[i]) && toks[i] !== toks[i + 1]) i++;
  const first = toks[i];
  if (!first) return null;
  const two = toks[i + 1] ? `${first} ${toks[i + 1]}` : first;
  const key = TWO_WORD.has(two) || first.length < 4 ? two : first;
  const display = key.split(' ').map(w => w[0] + w.slice(1).toLowerCase()).join(' ');
  return { key, display, tokens: toks.slice(i, i + 3) };
}

/** Charges that are money moving or a non-subscription category by nature. */
export const NEVER_SUBSCRIPTION = /FACEBK|FACEBOOK|@GOOGLE\.COM|GOOGLE \*ADS|ADS\d|TIKTOK|ONLINE PAYMENT|ACH PMT|PAYMENT TO CRD|EPAYMENT|AMERICAN EXPRESS DES|CREDIT CRD|PAYMENT TO CHASE|TRANSFER|WIRE TYPE|WIRE FEE|WISE US|WISE INC|XE MONEY|ALIBABA|1688\.COM|ALIPAY|PAYONEER|SHOPIFY PAYMENTS PAYOUT|PAYOUT|FRAUD DISPUTE|RETURNED CHECK|INTEREST CHARGE|FINANCE CHARGE|LATE FEE|CASH EQUIVALENT|CASH ADVANCE|ANNUAL CARD FEE|USPS|SHIPPO|GOSHIP|UPS\b|FEDEX|DHL|USHIP|WALMART|WAL MART|COSTCO|TARGET|HOME DEPOT|LOWES|AMAZON MKTP|AMZN MKTP|AMAZON MARKETPLACE|AMZ\*AMAZON|DOORDASH|UBER|LYFT|TURO|AIRLINES|HOTEL|HILTON|SHERATON|MARRIOTT|BOOKING\.COM|AIRBNB|BOATSETTER|CHEVRON|SHELL|76 |ARCO|PIZZER|BISTR|CAFE|COFFEE|GRILL|RESTAURANT|TST\*|KUPPA|DUTCH BROS|7-ELEVEN|STARBUCKS|GREAT CLIPS|LINDT|THE MIRA|MEMBERSHIP FEE|RENEWAL MEMBERSHIP|DOORDAS|HOLIDAY INN|PWP AMERICAN|JACK IN THE|SAMS CLUB|SAM'S|SNAP INC|SNAPCHAT|TRANSFER TO SHIPSOURCED|SHIPSOURCED HOLDER|SHOPIFY\*|SHOPIFY DES|SHOPIFY XXXX|^SHOPIFY |CHARGEFLOW|GRAINGER|ULINE/i;
/* Recurring BILLS (rent, lease, utilities, 3PL software, contractors paid by
   Zelle/ACH) are deliberately NOT excluded — the interval and amount tests
   decide whether they are recurring, and variable ones surface as Needs Review. */
