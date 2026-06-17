#!/usr/bin/env python3
import json, urllib.request, urllib.parse, os
TOK = os.environ['TOK']; API = 'https://graph.facebook.com/v24.0'
CAMPS = {'UK': ('120245701255160218', 'GB'), 'AU': ('120245700891500218', 'AU')}

def g(path, params=None):
    params = dict(params or {}); params['access_token'] = TOK
    return json.load(urllib.request.urlopen(f'{API}/{path}?' + urllib.parse.urlencode(params)))

issues = []
for label, (cid, want_country) in CAMPS.items():
    c = g(cid, {'fields': 'name,status,objective,daily_budget,bid_strategy,adsets.fields(name,status,daily_budget,daily_min_spend_target,optimization_goal,promoted_object,targeting,ads.fields(id,status,effective_status).limit(10))'})
    bud = int(c.get('daily_budget', 0)) / 100
    print('=' * 60)
    print(f"{label}: {c['name']}")
    print(f"  {c['status']} | {c['objective']} | CBO ${bud}/day | {c.get('bid_strategy')}")
    if c['status'] != 'PAUSED': issues.append(f"{label} campaign is {c['status']} (expected PAUSED)")
    if int(c.get('daily_budget', 0)) != 10000: issues.append(f"{label} budget ${bud} (expected $100)")
    total_ads = 0
    for a in c.get('adsets', {}).get('data', []):
        ads = a.get('ads', {}).get('data', []); total_ads += len(ads)
        t = a.get('targeting', {}); po = a.get('promoted_object', {})
        countries = t.get('geo_locations', {}).get('countries')
        mn = a.get('daily_min_spend_target'); db = a.get('daily_budget')
        approved = sum(1 for ad in ads if ad.get('effective_status') in ('ACTIVE', 'PENDING_REVIEW', 'IN_PROCESS'))
        print(f"  {a['name']}: {a['status']} | min=${int(mn)/100 if mn else 0} own_bud={db or 'none'} | geo={countries} | px={po.get('pixel_id')}/{po.get('custom_event_type')} | {len(ads)} ads")
        if countries != [want_country]: issues.append(f"{label}/{a['name']}: geo {countries} (expected [{want_country}])")
        if not mn or int(mn) != 2000: issues.append(f"{label}/{a['name']}: min ${int(mn)/100 if mn else 0} (expected $20)")
        if db: issues.append(f"{label}/{a['name']}: has own budget under CBO")
        if len(ads) != 5: issues.append(f"{label}/{a['name']}: {len(ads)} ads (expected 5)")
    print(f"  total ads: {total_ads} (expected 15)")
    if total_ads != 15: issues.append(f"{label}: {total_ads} ads total (expected 15)")

print('\n=== ISSUES ===')
print('  none — both campaigns correct' if not issues else '\n'.join('  ✗ ' + i for i in issues))
