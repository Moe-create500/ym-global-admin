#!/usr/bin/env python3
"""Full audit of the LIP PUMP campaign — flag anything misconfigured."""
import json, urllib.request, urllib.parse, os
TOK = os.environ['TOK']; API = 'https://graph.facebook.com/v24.0'
CAMP = '120251500294640547'
EXPECT_PAGE = '1190438270813259'        # LIPO
EXPECT_LINK = 'https://liposhopper.com/products/lipo-lip-pumper'
EXPECT_PIXEL = '4400648833508005'       # Lip Pump

def g(path, params=None):
    params = dict(params or {}); params['access_token'] = TOK
    return json.load(urllib.request.urlopen(f'{API}/{path}?' + urllib.parse.urlencode(params)))

issues, oks = [], []

# ── Campaign ──
c = g(CAMP, {'fields': 'name,status,objective,daily_budget,lifetime_budget,bid_strategy,special_ad_categories'})
print('=' * 64)
print('CAMPAIGN:', c['name'])
print(f"  status={c['status']} objective={c['objective']} CBO=${int(c.get('daily_budget',0))/100}/day bid={c.get('bid_strategy')} special={c.get('special_ad_categories')}")
if c['objective'] != 'OUTCOME_SALES': issues.append(f"objective is {c['objective']}, expected OUTCOME_SALES")
if not c.get('daily_budget'): issues.append("no campaign-level (CBO) budget set")
elif int(c['daily_budget']) != 20000: issues.append(f"CBO budget is ${int(c['daily_budget'])/100}, expected $200")
else: oks.append("CBO budget = $200/day")
if c['status'] != 'PAUSED': issues.append(f"campaign status is {c['status']} — will SPEND (expected PAUSED until launch)")
else: oks.append("campaign PAUSED (won't spend until you launch)")
if c.get('special_ad_categories'): issues.append(f"special_ad_categories set: {c['special_ad_categories']}")

# ── Pixel ──
px = g(EXPECT_PIXEL, {'fields': 'name,last_fired_time,is_unavailable'})
print(f"PIXEL: {px.get('name')} | last_fired={px.get('last_fired_time')} | unavailable={px.get('is_unavailable')}")
if px.get('is_unavailable'): issues.append("Lip Pump pixel is unavailable")
if not px.get('last_fired_time'): issues.append("Lip Pump pixel has NEVER fired (tracking may be broken)")
else: oks.append("pixel firing")

# ── Ad sets + ads ──
asets = g(f'{CAMP}/adsets', {'fields': 'name,status,daily_budget,daily_min_spend_target,optimization_goal,billing_event,promoted_object,targeting,ads.fields(name,status,effective_status,creative).limit(10)'})
seen_videos, ad_count = [], 0
for a in asets['data']:
    t = a.get('targeting', {}); po = a.get('promoted_object', {})
    countries = t.get('geo_locations', {}).get('countries')
    mn = a.get('daily_min_spend_target'); db = a.get('daily_budget')
    print('-' * 64)
    print(f"AD SET: {a['name']} | {a['status']}")
    print(f"  budget: own={db or 'none(CBO)'} min_spend=${int(mn)/100 if mn else 0} | opt={a.get('optimization_goal')} billing={a.get('billing_event')}")
    print(f"  geo={countries} age={t.get('age_min')}-{t.get('age_max') or '65+'} | pixel={po.get('pixel_id')}/{po.get('custom_event_type')}")
    if db: issues.append(f"{a['name']}: still has own budget ${int(db)/100} under CBO")
    if not mn or int(mn) != 1000: issues.append(f"{a['name']}: min_spend is {mn}, expected $10")
    if countries != ['US']: issues.append(f"{a['name']}: targeting {countries}, expected ['US']")
    if po.get('pixel_id') != EXPECT_PIXEL: issues.append(f"{a['name']}: pixel {po.get('pixel_id')}, expected {EXPECT_PIXEL}")
    if po.get('custom_event_type') != 'PURCHASE': issues.append(f"{a['name']}: event {po.get('custom_event_type')}, expected PURCHASE")
    if a.get('optimization_goal') != 'OFFSITE_CONVERSIONS': issues.append(f"{a['name']}: opt {a.get('optimization_goal')}")
    ads = a.get('ads', {}).get('data', [])
    if len(ads) != 3: issues.append(f"{a['name']}: has {len(ads)} ads, expected 3")
    for ad in ads:
        ad_count += 1
        cr = g(ad['creative']['id'], {'fields': 'object_story_spec,effective_object_story_id'})
        spec = cr.get('object_story_spec', {})
        vd = spec.get('video_data', {})
        page = spec.get('page_id'); vid = vd.get('video_id')
        cta = vd.get('call_to_action', {}); link = cta.get('value', {}).get('link')
        title = vd.get('title', ''); msg = vd.get('message', '')
        seen_videos.append(vid)
        flags = []
        if page != EXPECT_PAGE: flags.append(f"PAGE={page}!=LIPO")
        if link != EXPECT_LINK: flags.append(f"LINK={link}")
        if cta.get('type') != 'SHOP_NOW': flags.append(f"CTA={cta.get('type')}")
        if not vid: flags.append("NO VIDEO")
        if not title: flags.append("NO HEADLINE")
        if not msg: flags.append("NO PRIMARY TEXT")
        status = f"{ad['status']}/{ad.get('effective_status')}"
        print(f"    {ad['name']}: {status} | vid={vid} | hl=\"{title[:32]}\" | {('OK' if not flags else '!!! '+'; '.join(flags))}")
        if flags: issues.extend([f"{ad['name']}: {f}" for f in flags])
        if ad.get('effective_status') == 'DISAPPROVED': issues.append(f"{ad['name']}: DISAPPROVED")

# ── Cross-checks ──
print('=' * 64)
print(f"Total ads: {ad_count} (expected 9)")
if ad_count != 9: issues.append(f"{ad_count} ads total, expected 9")
dupes = [v for v in set(seen_videos) if seen_videos.count(v) > 1]
if dupes: issues.append(f"duplicate videos across ads: {dupes}")
else: oks.append(f"{len(set(seen_videos))} unique videos, no duplicates")
if len(set(seen_videos)) != 9: issues.append(f"only {len(set(seen_videos))} unique videos (expected 9)")

print('\n--- OK ---'); [print('  ✓', o) for o in oks]
print('\n--- ISSUES ---')
print('  none — everything checks out' if not issues else '\n'.join('  ✗ ' + i for i in issues))
EOF
