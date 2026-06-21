#!/usr/bin/env python3
"""Convert MAGSKINNY campaign to CBO $100 and create 2 ad sets (MagSkinny pixel, US).
Ads are added later once the landing URL + copy are provided."""
import json, urllib.request, urllib.parse, os
TOK = os.environ['TOK']; API = 'https://graph.facebook.com/v24.0'
ACT = 'act_2448686872317500'
CAMP = '120251551454610547'
PIXEL = '1027610363157741'   # MagSkinny

def post(path, params):
    params = dict(params); params['access_token'] = TOK
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request(f'{API}/{path}', data=urllib.parse.urlencode(params).encode())))
    except urllib.error.HTTPError as e:
        try: return {'error': json.loads(e.read().decode()).get('error', {})}
        except Exception: return {'error': {'message': 'http ' + str(e.code)}}

def g(path, params=None):
    params = dict(params or {}); params['access_token'] = TOK
    return json.load(urllib.request.urlopen(f'{API}/{path}?' + urllib.parse.urlencode(params)))

def em(r): return r.get('error', {}).get('error_user_msg') or r.get('error', {}).get('message') or json.dumps(r)[:200]

# 1. Convert to CBO $100 (keep PAUSED so it can't auto-launch)
r = post(CAMP, {'daily_budget': '10000', 'bid_strategy': 'LOWEST_COST_WITHOUT_CAP', 'status': 'PAUSED'})
print('CBO $100 set:', r.get('success') and 'OK' or em(r))

# 2. Two ad sets (CBO -> no own budget), US, MagSkinny pixel -> Purchase
targeting = json.dumps({'geo_locations': {'countries': ['US']}, 'age_min': 18, 'age_max': 65})
for n in (1, 2):
    a = post(f'{ACT}/adsets', {
        'name': f'MAGSKINNY | Set {n}', 'campaign_id': CAMP, 'status': 'ACTIVE',
        'billing_event': 'IMPRESSIONS', 'optimization_goal': 'OFFSITE_CONVERSIONS',
        'promoted_object': json.dumps({'pixel_id': PIXEL, 'custom_event_type': 'PURCHASE'}),
        'targeting': targeting})
    print(f'Set {n} ->', a.get('id') or 'ERR: ' + em(a))

# verify
c = g(CAMP, {'fields': 'name,status,daily_budget,bid_strategy,adsets.fields(name,status,daily_min_spend_target,targeting,promoted_object)'})
print(f"\nCAMPAIGN: {c['name']} | {c['status']} | CBO ${int(c.get('daily_budget',0))/100}/day | {c.get('bid_strategy')}")
for a in c.get('adsets', {}).get('data', []):
    t = a.get('targeting', {}); po = a.get('promoted_object', {})
    print(f"  {a['name']}: {a['status']} | geo={t.get('geo_locations',{}).get('countries')} | pixel={po.get('pixel_id')}/{po.get('custom_event_type')}")
