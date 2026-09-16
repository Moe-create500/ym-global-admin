"""Accountant pass over every YM bank/card transaction.
Reads txns.json / ad_payments.json / shopify_invoices.json (exported read-only from prisma/dev.db),
proposes category + store + basis for each row, writes proposals.json. Nothing is written to the DB."""
import json, re, collections, datetime as dt
S = '/private/tmp/claude-501/-Users-mohamedinc/33206732-a669-4797-bf52-b4ede4be36e1/scratchpad'
T = json.load(open(f'{S}/txns.json'))
AP = json.load(open(f'{S}/ad_payments.json'))
SI = json.load(open(f'{S}/shopify_invoices.json'))

D = lambda s: dt.date.fromisoformat(s[:10])
NA = 'n/a (transfer / card payment)'; OVER = 'Overhead (YM Global)'; NEED = 'NEEDS ATTRIBUTION'; SS = 'ShipSourced'

# ── account → owning store (checking accounts are single-store; cards are shared) ──
ACCT_STORE = {}
for x in T: ACCT_STORE[x['account']] = x['account_store']
CARD_ACCTS = {x['account'] for x in T if x['account_type'] == 'credit'}
# Amex sub-card last4 → store, from fb_profiles.primary_card / fb_funding_cards / ad_payments evidence
CARD4_STORE = {'2761': 'Areya', '1654': 'Areya', '9215': 'Areya', '1014': 'Magvita', '7308': 'Magvita', '3304': 'Marroomi', '2819': 'Houthie',
               '2976': 'Purebite', '8211': 'SupplyLaundry', '7267': 'SupplyLaundry', '0448': 'SupplyLaundry', '1108': 'SupplyLaundry',
               '5606': 'Serevia', '1000': 'Eloa', '1022': 'Revivon'}
# Bank of America internal account numbers seen in transfer descriptions
CHK = {'7904': ('ShipSourced', 'TEMP SHIPSOURCED ·7904'), '2260': ('ShipSourced', 'Business Adv Relationship ·2260'), '5417': ('Revivon', 'Business Adv Fundamentals ·5417'),
       '7917': ('Revivon', 'REVIVON ·7917'), '2240': ('Marroomi', 'MARROOMI ·2240'), '8530': ('Areya', 'YM CASHFLOW 8530'), '4492': ('Magvita', 'Profits ·4492'),
       '8016': ('Magvita', 'STORE CASHFLOW ·8016'), '7881': ('Serevia', 'TEMP PRIME ENTERPRISE ·7881'), '7878': ('Areya', 'AREYA ·7878'), '5653': ('Purebite', 'PUREBITE ·5653'),
       '5666': ('NeeyahPure', 'NEEYAHPURE ·5666'), '7894': ('SupplyLaundry', 'AUREVIA ·7894'), '0512': ('card', 'CORP YM CREDIT LINE ·0512'), '9215': ('card', 'BoA ·9215'),
       '0775': ('card', 'YM CREDIT ·0775'), '4537': ('card', 'Atmos ·4537'), '7523': ('owner', 'external account "Hussein"'), '9321': ('owner', 'external account "bilal"')}

def key(desc):
    s = (desc or '').upper()
    s = re.sub(r'\b(DES|ID|INDN|CO ID|CCD|PPD|WEB|ARC|POS|CHECKCARD|PURCHASE|RECURRING|MOBILE|ONLINE)\b:?', ' ', s)
    s = re.sub(r'[*#|]', ' ', s); s = re.sub(r'\b[A-Z]*\d[A-Z0-9]*\b', ' ', s); s = re.sub(r'[^A-Z ]', ' ', s)
    return ' '.join([t for t in s.split() if len(t) >= 2][:3])

# ── invoice indexes (amount → list of invoices), consumed greedily by nearest date ──
def index(rows, amt_key, date_key):
    ix = collections.defaultdict(list)
    for r in rows: ix[r[amt_key]].append(r)
    return ix
used_ap, used_si = set(), set()
# invoices already referenced by an existing INVOICE_MATCH stay reserved for that row
for x in T:
    ev = x.get('cur_reason') or ''
AP_ix = index([a for a in AP if a['platform'] == 'facebook'], 'amount_cents', 'date')
GO_ix = index([a for a in AP if a['platform'] == 'google'], 'amount_cents', 'date')
SI_shop = index([i for i in SI if i['source'] != 'chargeflow'], 'total_cents', 'date')
SI_cf = index([i for i in SI if i['source'] == 'chargeflow' and i['total_cents'] > 0], 'total_cents', 'date')

FAMILY = collections.defaultdict(collections.Counter)   # bank account → Counter(card_last4) learned from unambiguous matches
def candidates(ix, used, amount, bank_date, lo, hi):
    bd = D(bank_date)
    return [c for c in ix.get(amount, []) if c['id'] not in used and lo <= (bd - D(c['date'])).days <= hi]
def take(ix, used, amount, bank_date, lo=-1, hi=8, card4=None, account=None, prefer_store=None):
    cands = candidates(ix, used, amount, bank_date, lo, hi)
    if not cands: return None, None
    bd = D(bank_date)
    stores = {c['store'] for c in cands}
    amb = None
    if len(stores) > 1:
        # same amount, several ad accounts: prefer the sub-card family this bank account is known to carry, then the existing pairing
        fam = FAMILY.get(account) or {}
        scored = [(fam.get((c.get('card_last4') or '')[-4:], 0), c) for c in cands]
        top = max(sc for sc, _ in scored)
        if top > 0:
            cands = [c for sc, c in scored if sc == top]
        elif prefer_store and any(c['store'] == prefer_store for c in cands):
            cands = [c for c in cands if c['store'] == prefer_store]
        if len({c['store'] for c in cands}) > 1: amb = sorted({c['store'] for c in cands})
    best = min(cands, key=lambda c: abs((bd - D(c['date'])).days))
    used.add(best['id']); return best, amb
# pass 1: learn card families from unambiguous Meta matches (unique amount within the window)
for x in T:
    if x['amount_cents'] >= 0 or not re.search(r'FACEBK|FACEBOOK', (x['description'] or '').upper()): continue
    c = candidates(AP_ix, set(), -x['amount_cents'], x['date'], -1, 10)
    if len(c) == 1 and c[0].get('card_last4'): FAMILY[x['account']][c[0]['card_last4'][-4:]] += 1
print('card families learned:', {k: dict(v.most_common(6)) for k, v in FAMILY.items()})

# ── merchant rule table: (regex on UPPER description, category, store-or-None, note) ──
R = [
 # money movement
 (r'ONLINE PAYMENT - THANK YOU|MOBILE PAYMENT - THANK YOU|ELECTRONIC PAYMENT RECEIVED|CUSTOMER SERVICE PAYMENT - THANK|ONLINE PAYMENT FROM CHK|ACH PMT|AMEX EPAYMENT|PAYMENT TO CRD|PAYMENT TO ACCT #(0512|9215|0775|4537)|RETRY PYMT|ACH HOLD AMERICAN EXPRESS|CHASE CREDIT CRD EPAY|PAYMENTS AND INVOICING PAYMENT TO CHASE|RAMP STATEMENT|ACH HOLD RAMP', 'Credit Card Payment', NA, None),
 (r'RETURNED CHECK/DECL|RETURN OF POSTED CHECK', 'Payment returned by bank', NA, 'a card payment bounced — the debt is still open'),
 (r'ONLINE BANKING TRANSFER (TO|FROM)|ONLINE TRANSFER (TO|FROM) CHK|MOBILE TRANSFER TO CHK|TRANSFER (TO|FROM) ACCT #|ONLINE BANKING TRANSFER CONF|BKOFAMERICA BC', 'Transfer (own accounts)', NA, None),
 (r'SHIPSOURCED DES:SHIPSOURCE|SMWMDC-SHIPSRCD', 'Fulfillment — ShipSourced invoice (3PL bill)', None, 'ShipSourced pulled its invoice from this store\'s account'),
 (r'ZELLE PAYMENT TO (SHIPSOURCED|YM|ZEN CHOICE|ZEN ESSENTIAL|SEENINNOVATIONS)|ZELLE PAYMENT FROM (SHIPSOURCED|ZEN CHOICE|YM)|ACH TRANSFER TO SHIPSOURCED|ACH TRANSFER TO BANK OF AMERICA|TRANSFER ZEN CHOICE LLC VIA WISE|ELVARIS DES:SHOPIFY|SHOPIFY PAYMENTS PAYOUT', 'Transfer (intercompany)', NA, None),
 (r'ZELLE PAYMENT TO (MOHAMED HUSSEIN|MUATH|SALEM HUSSEIN|MOHAMMED BAVANI)|ZELLE PAYMENT FROM (MOHAMED HUSSEIN|ZACKARY|YAZEED|AYDEN)|WIRE TYPE:BOOK OUT|ONLINE TRANSFER TO CHK 7523|TRANSFER TO CHK 9321|ZACKARY HUSSEIN DES:SENDER', 'Owner / partner draw or contribution', None, 'person-to-company movement — confirm who and why'),
 (r'LEHEB H ARAIM', 'Investor / loan repayment', None, 'transfer to LEHEB H ARAIM MD INC — matches the "ShipSourced Investor" manual liability'),
 # revenue-side inflows
 (r'STRIPE DES:TRANSFER|ACH CREDIT STRIPE|TRANSFER STRIPE, INC', 'Client payments (Stripe)', SS, None),
 (r'TIKTOK INC DES:PAYMENT', 'Marketplace payout (TikTok Shop)', 'Magvita', 'paid to Vitalchew LLC'),
 (r'ACH CREDIT AMAZON|AMAZON\.[A-Z0-9]+ DES:PAYMENTS', 'Marketplace payout (Amazon)', NEED, 'Amazon payout to Vitalchew — which Amazon store?'),
 (r'EBAY COM[A-Z0-9]* DES:PAYMENTS', 'Marketplace payout (eBay)', 'Vitaedge', None),
 (r'ACH CREDIT SHOPIFY|ANAVE DES:SHOPIFY|MICROFORMULAS', 'Shopify transfer (unconfigured store)', NEED, 'Shopify money from a store name not in YM (Anave / Microformulas) — confirm'),
 (r'AIRWALLEX', 'Platform payout (Airwallex)', NEED, 'unknown platform payout — confirm source'),
 (r'AMEX TRAVEL|STATEMENT CREDIT|RWD PROMO|PWP AMERICAN|PWP AMEXTRAVEL', 'Card rewards / statement credit', OVER, None),
 (r'REVERSAL YM GLOBAL', 'Reversal', NA, None),
 # ads
 (r'FACEBK|FACEBOOK|META PLATFORMS', 'Ad Spend (Meta)', None, None),
 (r'ADS[0-9]*CC@GOOGLE|GOOGLE \*ADS|GOOGLE ADS', 'Ad Spend (Google)', None, None),
 (r'TIKTOK ADS|TIKTOK INC\.|APLPAY TIKTOK', 'Ad Spend (TikTok)', None, None),
 (r'SNAP \*SNAP ADS', 'Ad Spend (Snap)', NEED, None),
 (r'X CORP\. PAID', 'Software / SaaS', OVER, None),
 # shopify / apps
 (r'SHOPIFY\* |SHOPIFY \* |PAYPAL \*SHOPIFY|SHOPIFY XXXXXXXXXX|SHOPIFY DES:|ACH HOLD SHOPIFY|SHOPIFY SHOPIFY', 'Shopify bill (plan / apps)', None, None),
 (r'CHARGEFLOW', 'Software — Chargeflow', None, None),
 # fulfilment / 3PL (ShipSourced)
 (r'USPS|SHIPPO|GOSHIP|BORDERBUDDY|\bUPS\b|FEDEX|DHL|USHIP|STAMPS\.COM|PIRATE ?SHIP', 'Fulfillment — carrier & labels', SS, None),
 (r'SHIPHERO|WWW\.RETELLAI|RETELLAI|WORKSPACE_SH|GOOGLE \*WORKSPACE_SH|DOCUSIGN|SHIPSENSE', 'Fulfillment — 3PL software', SS, None),
 (r'ESCOR GROUP|ESCOR GROU|LUCIDO PROPERTIES', 'Fulfillment — warehouse lease', SS, None),
 (r'ULINE|GRAINGER|MY CABLE MART|GLOBALE /LOGITECH|FASTSIGNS|VISTAPRINT|STICKER MULE|APLPAY THE UPS STORE|JC SALES', 'Fulfillment — packaging, supplies & equipment', SS, None),
 (r'ZELLE PAYMENT TO (PARJINDER|ARON|MIKE|ROCKY|SHIFA|ABDULLAH|DANIEL ESCAMILLA|MOE CRICKET|PHONE NUMBER)', 'Fulfillment — warehouse labor (Zelle)', SS, None),
 (r'ZELLE PAYMENT TO SHIPLOL|XE MONEY TRANSFER|PAYONEER', 'Fulfillment — China agent payment', None, None),
 (r'WISE US INC|WISE INC DES|ACH HOLD WISE|ACH TRANSFER TO WISE', 'Supplier / agent payment (Wise)', None, 'Wise does not show the recipient in the bank line — confirm who was paid'),
 (r'WIRE TYPE:INTL|WIRE TYPE:FX', 'Supplier wire (international)', None, 'international wire — confirm supplier and brand'),
 (r'WIRE TYPE:WIRE OUT', 'Wire out (domestic)', None, 'confirm recipient'),
 (r'ALIPAY|ALIBABA|1688|TAOBAO|GZ YOUYI|KPAY\*|WECHARGEHK|Z2U\.COM', 'Inventory / product purchase (China)', None, None),
 (r'EUROFINS', 'Product testing (lab)', NEED, 'lab test — which product?'),
 (r'GS1 US', 'Product barcodes (GS1)', NEED, 'UPC subscription — which brand?'),
 (r'AMAZON MKTP|AMZN MKTP|AMAZON MARK|AMAZON MARKETPLACE|AMAZON\.COM|WALMART|WAL-MART|WM SUPERCENTER|SAMS CLUB|TARGET|HOME DEPOT|OFFICEMAX|DOLLARTREE|BEST BUY|BESTBUYCOM|APLPAY APPLE STORE|MARSHALLS|FRED MEYER|WINCO|SAVEMART|CVS|COPPER MARKET|INTERNATIONAL MARKET|BULLDOG LIQUO', 'Purchases — supplies / equipment (needs a look)', NEED, 'retail purchase on a shared card — supplies, samples or personal?'),
 (r'4TE\*MY DEEN', 'Unknown large charge — needs a look', NEED, '$10,332 single charge on the ShipSourced Amex ·1001 — what is MY DEEN?'),
 (r'BT\*FRONTIER|IN \*CLEAN ENERGY|D30592834|PY \*MONZO', 'Unknown merchant — needs a look', NEED, None),
 (r'GDP=S&L TRUCK', 'Equipment / vehicle (needs a look)', NEED, '$4,212 truck-related purchase'),
 (r'EBAY O\*|EBAY\b', 'Marketplace purchase (eBay)', SS, 'eBay purchases on ·0775 were equipment for the warehouse'),
 # AI platforms
 (r'AMAZON PRIME', 'Software / SaaS', OVER, None),
 (r'OPENAI|CHATGPT|ANTHROPIC|CLAUDE\.AI|HIGGSFIELD|HEYGEN|ARCADS|CREATIFY|ADCREATIVE|EUKAAI|ELEVENLABS|RUNWAY|IDEOGRAM|SUNO|STARPOP|FAL FEATURES|MIDJOURNEY|PERPLEXITY|REPLICATE|KLING|PIKA|LUMA', 'AI platforms', OVER, None),
 # software / marketing tools
 (r'KLAVIYO', 'Software — email marketing', NEED, 'Klaviyo bills per store — which store?'),
 (r'TRIPLE WHALE|CLICKFUNNELS|HIGHLEVEL|KALODATA|KEEPA|HELIUM10|ADOBE|CANVA|CAPCUT|INTUIT|QBOOKS|CALENDLY|SUPABASE|MICROSOFT|GOOGLE\*GOOGLE ONE|GOOGLE ONE|CLOUD [A-Z0-9]+ G\.CO|APPLE\.COM/BIL|PAYPAL \*APPLE|WWW\.MAKE\.COM|GODADDY|IDENTITYIQ|MYSCOREIQ|MOONFLASH|TRYBE|GETLANDRA|GETHOOKD|TILLER|AP SCORE|NANONOBLE|AIMHNET|FO HO INFORMATION|LANNE TECH|COBALZ|MEDIAGLOBE|WWW\.FULFILL\.COM|SPRINGLY|SOCIALBOOSTING|HAHA INNOVATI|ELEVEN PERCENT', 'Software / SaaS', OVER, None),
 (r'WHOP\.COM', 'Software / community (Whop)', 'Purebite', None),
 (r'P\.SKOOL\.COM|DROPSHIPPING-MASTERS', 'Education / courses', OVER, None),
 (r'BACKSTAGE|IN \*VISUAL ARTISTRY|FIVERR|UPWORK', 'Marketing services / creators', NEED, 'creative or freelancer spend — which brand?'),
 (r'AUTHNET GATEWAY|M MERCHANT DES:MERCH', 'Payment processing fees', None, None),
 (r'SIMPLY BUSINESS', 'Insurance', OVER, None),
 (r'ROCKETLAW|LAWVEX|US PATENT TRADEMARK|CORPORATE FILINGS|WYOMING SECRETARY', 'Legal / government filings', OVER, None),
 (r'UNWIRED BROADBAND|CRICKET|NOW WIFI|HOLAFLY', 'Telecom / internet', OVER, None),
 (r'INTEREST CHARGE|LATE FEE|LATE PAYMENT FEE|MEMBERSHIP FEE|CASH EQUIVALENT FEE|FINANCE CHARGE|WIRE TRANSFER FEE|WIRE FEE|MONTHLY FEE|OVERDRAFT ITEM FEE|EXTERNAL TRANSFER FEE|RETURN PAYMENT FEE|ACH FEE|ANNUAL CARD FEE|DR ADJ REDIST', 'Bank fees & interest', None, None),
 (r'FRAUD DISPUTE|AMZ\*AMAZON PAYMENTS', 'Fraud reversal', NA, None),
 (r'ONLINE BANKING ADVANCE', 'Credit line advance', NA, None),
 (r'ZELLE (SCHEDULED )?PAYMENT TO ROYAL STAR', 'Rent (Royal Star LLC)', NEED, 'monthly Zelle to ROYAL STAR LLC from Serevia\'s account — office/warehouse lease?'),
 (r'UMRELIEF', 'Donation', OVER, None),
 # travel / meals / auto / personal
 (r'AIRLINES|AIRWAYS|AIR CANADA|AIRCANADA|SINGAPOREAIR|QANTAS|DELTA AIR|CATHAY|QATAR|MARRIOTT|SHERATON|HOLIDAY INN|HILTON|WYNDHAM|MIRA HONG KONG|FOUR SEASONS|BOOKING\.COM|EXPEDIA|AIRBNB|TURO|ENTERPRISE RENT|UBER|HUDSONNEWS|HUDSON ST|EXPEDIA\.COM|APLPAY UNITED|OMNIA CENTRAL|GZ HUAYUANJIU|SIERRA VISTA|ERACTOLL|FLASHPARKING|ACE PARKING|SMARTEC|DUTY ZERO|SAMA SAMA|JETPACGLO|WWW\.JETPAC', 'Travel', OVER, None),
 (r'DOORDASH|DD \*|TST\*|TST \*|APLPAY TST|COFFEE|COFFE|KUPPA JOY|DUTCH BROS|CHIPOTLE|TACO BELL|PIZZ|SUSHI|CHICKEN|WAFFLE|DENNY|APPLEBEES|TERIYAKI|THAI|KITCHEN|CAFE|GRILL|BISTR|BAGUETTE|CREAM|BASKIN|SWEETFROG|MENCHIE|CRUMBL|INSOMNIA|EGGSLUT|HASH BROWNS|BOBA|BURGER|BUR|WINGS|TACO|KABAB|FALAFEL|RESTAURA|EUREKA|SAIZON|HEIRLOOM|RUSSO|ANNESSO|NAMI JAPANESE|FLAME IT|HALAL|RICE BARN|OSAKA|HINO OISHI|KIKKU|KENJIS|STRADA|OTHERSIDE|NOURISH|WAGYU|PISMO|GRAN HAVANA|VILLAINS BREWING|BARBUSA|LA FONTANA|JAPONESSA|TRISARA|FAIRWAY|LIME LITE|RED CHICKZ|ROBERTITOS|IKES|HACHI|SUMMER KITCHEN|TABAC|MISSION COFFEE|BLUE BOTTLE|OLYMPIA|TAYLOR STREET|KINARA|CBTL|PEET|CUPPING ROOM|LOFTY|ALCHEMIST|TWO CITIES|MONKEY DOG|KINGDOM KAFE|BRKFST|RIGOBERTO|WABA|RAISING CANES|JACK IN|DAVES HOT|DAVESHOTCHICKEN|MAIN STR|QAMARIA|7-ELEVEN|ELEVEN|INSTACART|EDIBLE|BLOOMFLOWER|LINDT|WHISK|AMPERSAND|SHOPNGO|LOVING SEED|TASTE LA|FAT HUDSON|JOY THRU|CEDAR AND|FREYA|CU URBAN|LS NUTRISHOP|CIGARS|IRON OFFICE|SP THE IRON|ZIAFAT|THE CRAFT HOUSE|HOW WE ROLL|MENCH|PY \*|PY TWO|SEATGEEK|FANDANGO|BOATSETTER|GEORGE BROWN|GB3|LIFESTYLE FITNESS|GREAT CLIPS|BARNES & NOBLE|FRESNO STATE|312 FRESNO|D30592834', 'Meals, entertainment & personal', OVER, 'on a business card — reimburse or reclassify if personal'),
 (r'CHEVRON|SHELL|ARCO|GULF OIL|UNION 76|EXXONMOBIL|PURE GASOLINE|FAST N EZY|CREWS MAGIC|RIDE AND SHINE|SURF THRU|CAR WASH', 'Auto & fuel', OVER, None),
 (r'MAIL/TELEPHONE ORDER', 'Purchase (phone order) — needs a look', NEED, None),
 (r'ACCTVERIFY', 'Account verification (micro-deposit)', NA, None),
]
RX = [(re.compile(p), c, s, n) for p, c, s, n in R]

def rule(desc):
    u = (desc or '').upper()
    for rx, c, s, n in RX:
        if rx.search(u): return c, s, n
    return None

props = []
stats = collections.Counter()
for x in T:
    d = x['description'] or ''; u = d.upper(); amt = x['amount_cents']; acct = x['account']; acct_store = x['account_store']
    is_card = x['account_type'] == 'credit'; out = amt < 0
    cat = store = basis = note = None; conf = 0.9; inv = None
    r = rule(d)
    if r: cat, store, note = r

    # ── evidence-based matching first ──
    if cat == 'Ad Spend (Meta)' and out:
        m, amb = take(AP_ix, used_ap, -amt, x['date'], -1, 10, account=acct, prefer_store=x['cur_store'])
        if m:
            store = m['store']; inv = f"Meta invoice {m['date']} · card ····{m['card_last4'] or '?'} · {m['account_id'] or ''}"; basis = 'matched Meta ad invoice (amount + date + card family)'; conf = 0.98
            if amb: conf = 0.7; note = 'same amount billed to ' + ' / '.join(amb) + ' that day — picked nearest date; confirm'; basis = 'matched Meta invoice (ambiguous across ad accounts)'
        else:
            store = x['cur_store'] if x['cur_method'] in ('INVOICE_MATCH', 'MANUAL') and x['cur_store'] else NEED
            basis = 'kept existing invoice pairing' if store != NEED else 'no Meta invoice with this amount within 10 days'
            if store == NEED: conf = 0.5; note = 'Meta charge with no matching invoice — which ad account?'
    elif cat == 'Ad Spend (Meta)' and not out:
        cat = 'Ad refund (Meta)'; store = x['cur_store'] or NEED; basis = 'Meta credit'
    elif cat == 'Ad Spend (Google)' and out:
        m, amb = take(GO_ix, used_ap, -amt, x['date'], -1, 10, account=acct, prefer_store=x['cur_store'])
        if m: store = m['store']; inv = f"Google invoice {m['date']} · card ····{m['card_last4'] or '?'}"; basis = 'matched Google Ads invoice'; conf = 0.98
        else:
            store = x['cur_store'] if x['cur_store'] else NEED; basis = 'kept existing pairing' if x['cur_store'] else 'no Google invoice matched'
            if store == NEED: conf = 0.5
    elif cat == 'Ad Spend (TikTok)':
        store = x['cur_store'] or NEED; basis = 'existing pairing (TikTok has no invoice feed)' if x['cur_store'] else 'no TikTok invoice feed — which store?'
        if store == NEED: conf = 0.5
    elif cat == 'Shopify bill (plan / apps)' and out:
        idm = re.search(r'ID:([A-Z ]+?) INDN', u)
        if idm:
            nm = idm.group(1).strip().title()
            alias = {'Aurevia': 'SupplyLaundry', 'Apex Health': NEED, 'Revivon 20': 'Revivon', 'Neeyahpure': 'NeeyahPure'}
            store = alias.get(nm, nm); basis = f'Shopify Payments debit names the store "{nm}"'; cat = 'Shopify Payments debit (negative balance / chargeback pull)'
            if store == NEED: note = '"APEX HEALTH" is not a configured store — Apex Loom?'
        else:
            m, amb = take(SI_shop, used_si, -amt, x['date'], -1, 8, prefer_store=x['cur_store'])
            if m: store = m['store']; inv = f"Shopify bill {m['bill_number'] or ''} {m['date']} · {m['apps'] or 'plan'}"; basis = 'matched Shopify app/plan invoice (amount + date)'; conf = 0.97; cat = 'Shopify bill (apps)' if (m['apps'] or '').strip(',') else 'Shopify bill (plan / fees)'
            else:
                store = x['cur_store'] or (acct_store if not is_card else NEED); basis = 'kept existing pairing' if x['cur_store'] else ('checking account belongs to this store' if not is_card else 'no Shopify invoice with this amount')
                if store == NEED: conf = 0.5
    elif cat == 'Software — Chargeflow' and out:
        m, amb = take(SI_cf, used_si, -amt, x['date'], -1, 8, prefer_store=x['cur_store'])
        if m: store = m['store']; inv = f"Chargeflow bill {m['date']}"; basis = 'matched Chargeflow invoice (amount + date)'; conf = 0.97
        else: store = NEED; basis = 'no Chargeflow invoice with this amount'; conf = 0.5; note = 'Chargeflow bills per store'

    # ── manual verdicts stand ──
    if x['cur_method'] == 'MANUAL' and x['cur_store']:
        if store in (None, NEED): store = x['cur_store']; basis = 'manual pairing kept'
        if x['custom_category'] and not cat: cat = x['custom_category']
    if x['cur_method'] == 'MANUAL' and x['custom_category'] in ('Fraud Reversal', 'Owner Draw', 'Inventory', 'Fulfillment', 'Marroomi Facebook Ad Spend', 'Marroomi Email Marketing'):
        cat = {'Fraud Reversal': 'Fraud reversal', 'Owner Draw': 'Owner / partner draw or contribution', 'Inventory': 'Inventory / product purchase (China)', 'Fulfillment': 'Fulfillment — China agent payment', 'Marroomi Facebook Ad Spend': 'Ad Spend (Meta)', 'Marroomi Email Marketing': 'Software — email marketing'}[x['custom_category']]
        store = x['cur_store'] or store; basis = 'manual verdict kept'; conf = 1.0

    # ── payouts (inflows) ──
    if not out and x['cur_method'] == 'PAYOUT_MATCH':
        cat = 'Shopify payout'; store = x['cur_store']; basis = 'matched Shopify payout'; conf = 1.0
    if not out and cat is None and 'PAYOUT' in u:
        cat = 'Shopify payout'; store = x['cur_store'] or acct_store; basis = 'payout into the store\'s account'

    # ── fill the store from the account when the rule left it open ──
    if cat and store is None:
        if cat in ('Owner / partner draw or contribution',):
            store = acct_store or NEED; basis = 'from this store\'s account'
        elif cat.startswith('Fulfillment — ShipSourced invoice'):
            store = acct_store or NEED; basis = 'pulled from this store\'s account'
        elif cat in ('Investor / loan repayment',):
            store = acct_store; basis = 'paid from this store\'s account'
        elif cat.startswith('Fulfillment — China agent') or cat.startswith('Supplier') or cat.startswith('Inventory') or cat.startswith('Wire out') or cat == 'Payment processing fees' or cat == 'Bank fees & interest':
            if is_card and cat == 'Bank fees & interest':
                store = SS if acct in ('Business Gold Card ·1001', 'CORP Account - Atmos Rewards - 4537 ·4537') else OVER; basis = 'card fee on ' + ('ShipSourced\'s card' if store == SS else 'a holding card')
            elif is_card:
                store = SS if acct in ('Business Gold Card ·1001', 'CORP Account - Atmos Rewards - 4537 ·4537', 'YM CREDIT ·0775', 'CORP Account - Business Adv Unlimited Cash Rewards - 9215 ·9215') or (x['cur_store'] == SS) else (x['cur_store'] or NEED)
                basis = 'ShipSourced\'s card' if store == SS else ('existing pairing' if x['cur_store'] else 'shared card — brand unknown')
                if store == NEED: conf = 0.5; note = note or 'paid on a shared Amex — which brand was this for?'
            else:
                store = acct_store; basis = 'paid from this store\'s checking account'
                if cat == 'Bank fees & interest': store = acct_store or OVER
    if cat and store is None: store = x['cur_store'] or (acct_store if not is_card else OVER); basis = basis or ('existing pairing' if x['cur_store'] else 'account owner')

    # ── nothing matched a rule ──
    if cat is None:
        if x['cur_category'] and x['cur_store']:
            cat = x['cur_category']; store = x['cur_store']; basis = f"existing {x['cur_method']}"; conf = 0.8
        elif out:
            cat = 'Unclassified — needs a look'; store = acct_store if not is_card else NEED; basis = 'no rule matched'; conf = 0.3; note = f'merchant "{key(d)}"'
        else:
            cat = 'Unexplained deposit — needs a look'; store = acct_store or NEED; basis = 'no rule matched'; conf = 0.3

    # SS card purchases of supplies stay SS
    if cat.startswith('Purchases — supplies') and acct in ('YM CREDIT ·0775', 'CORP Account - Business Adv Unlimited Cash Rewards - 9215 ·9215', 'Business Gold Card ·1001', 'CORP Account - Atmos Rewards - 4537 ·4537'):
        store = SS; basis = 'ShipSourced\'s card — warehouse supplies'; conf = 0.8; note = None
    if cat.startswith('Fulfillment') and store is None: store = SS
    if cat.startswith('Fulfillment — carrier') and acct_store and not is_card and acct_store != SS: store = acct_store; basis = 'paid from this store\'s account (own shipping)'
    # transfers: describe the counterparty account
    if cat in ('Transfer (own accounts)',):
        mm = re.search(r'(CHK|ACCT #|CRD) ?(\d{4})', u)
        if mm and mm.group(2) in CHK:
            who = CHK[mm.group(2)]
            note = f'{"to" if out else "from"} {who[1]}'
            if who[0] == 'owner': cat = 'Owner / partner draw or contribution'; store = acct_store; note = f'external account {who[1]} — confirm'
            elif who[0] == 'card': cat = 'Credit Card Payment'; note = f'payment to {who[1]}'
    if cat == 'Transfer (intercompany)' and 'ZEN CHOICE' in u: note = 'Zen Choice LLC = Zenchoice (Walmart) / Revivon entity'
    if cat == 'Transfer (intercompany)' and 'ZEN ESSENTIAL' in u: note = 'to the Zen Essential Amazon store'
    if cat == 'Transfer (intercompany)' and 'SEENINNOVATIONS' in u: note = 'Seeninnovations LLC = Serevia\'s entity'

    changed = (store != (x['cur_store'] or None)) if store not in (NA,) else False
    props.append({**{k: x[k] for k in ('id', 'date', 'description', 'amount_cents', 'account', 'account_type', 'account_store', 'cur_category', 'cur_store', 'cur_method', 'status')},
                  'cat': cat, 'store': store, 'basis': basis, 'note': note, 'invoice': inv, 'conf': round(conf, 2), 'changed': changed, 'merchant': key(d)})
    stats[cat] += 1

json.dump(props, open(f'{S}/proposals.json', 'w'))
out = [p for p in props if p['amount_cents'] < 0]
print('rows', len(props), '| outflows', len(out))
print('store NEED', sum(1 for p in out if p['store'] == NEED), '$%.0f' % (sum(-p['amount_cents'] for p in out if p['store'] == NEED) / 100))
print('unclassified', sum(1 for p in out if p['cat'].startswith('Unclassified')), '| unexplained deposits', sum(1 for p in props if p['cat'].startswith('Unexplained')))
print('changed store (outflows)', sum(1 for p in out if p['changed']))
print('\nBY CATEGORY (outflows):')
c = collections.defaultdict(lambda: [0, 0])
for p in out: c[p['cat']][0] += 1; c[p['cat']][1] += -p['amount_cents']
for k, v in sorted(c.items(), key=lambda kv: -kv[1][1]): print(f'  {k[:58]:58} {v[0]:5} ${v[1]/100:>12,.0f}')
print('\nBY STORE (outflows, excl. transfers/card payments):')
c = collections.defaultdict(lambda: [0, 0])
for p in out:
    if p['store'] != NA: c[p['store']][0] += 1; c[p['store']][1] += -p['amount_cents']
for k, v in sorted(c.items(), key=lambda kv: -kv[1][1]): print(f'  {str(k)[:30]:30} {v[0]:5} ${v[1]/100:>12,.0f}')
print('\nUNCLASSIFIED merchants:'); u = collections.Counter(p['merchant'] for p in out if p['cat'].startswith('Unclassified')); print(u.most_common(40))
print('\nNEED zelle:', collections.Counter(p['description'][:40] for p in out if p['store']==NEED and 'ZELLE' in p['description'].upper()).most_common(8))
mv = collections.defaultdict(int)
for p in out:
    if p['changed'] and p['store'] not in (NA,): mv[(p['cur_store'] or '—') + ' → ' + str(p['store'])] += -p['amount_cents']
print('\nSTORE MOVES (cur → proposed) by $:'); [print(f'  {k:48} ${v/100:>12,.0f}') for k, v in sorted(mv.items(), key=lambda kv: -kv[1])[:30]]
amb_n = sum(1 for p in out if p['basis'] and 'ambiguous' in p['basis']); print('\nambiguous Meta/Google matches:', amb_n, '$%.0f' % (sum(-p['amount_cents'] for p in out if p['basis'] and 'ambiguous' in p['basis'])/100))
mm = collections.defaultdict(int)
for p in out:
    if p['cur_store']=='Magvita' and p['store']=='Marroomi': mm[(p['account'], (p['invoice'] or '')[-20:])] += -p['amount_cents']
print('Magvita→Marroomi by (bank account, ad account):'); [print('  ', k, '$%.0f' % (v/100)) for k, v in sorted(mm.items(), key=lambda kv:-kv[1])[:8]]
print('\nNEED merchants:'); u = collections.defaultdict(int)
for p in out:
    if p['store'] == NEED: u[p['merchant']] += -p['amount_cents']
print(sorted(u.items(), key=lambda kv: -kv[1])[:40])
