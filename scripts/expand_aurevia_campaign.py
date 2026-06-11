#!/usr/bin/env python3
"""Rebrand copy to Aurevia + expand campaign to 4 ad sets / 20 ads (new sets video-only)."""
import json, urllib.request, urllib.parse, time

TOKEN = open('/tmp/fbtoken.txt').read().strip()
API = 'https://graph.facebook.com/v24.0'
DST_ACT = 'act_2448686872317500'
DST_PAGE = '1123792807487479'
PIXEL_ID = '976892338681167'
NEW_LINK = 'https://skinco-2904.myshopify.com/products/cyperus-rotundus-oil'

state = json.load(open('/tmp/migrate_state.json'))
copy = json.load(open('/tmp/winner_copy.json'))

def rebrand(text):
    return (text.replace('NeeyahPure™', 'Aurevia™')
                .replace('NeeyahPureTM', 'Aurevia™')
                .replace('NeeyahPure', 'Aurevia'))

for k in copy:
    for f in ('message', 'title', 'description'):
        copy[k][f] = rebrand(copy[k][f])

def save_state():
    json.dump(state, open('/tmp/migrate_state.json', 'w'), indent=1)

def api_get(path, params=None):
    params = dict(params or {}); params['access_token'] = TOKEN
    return json.load(urllib.request.urlopen(f'{API}/{path}?' + urllib.parse.urlencode(params)))

def api_post(path, params, retries=4):
    params = dict(params); params['access_token'] = TOKEN
    data = urllib.parse.urlencode(params).encode()
    for i in range(retries):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(f'{API}/{path}', data=data)))
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            err = json.loads(body).get('error', {})
            if err.get('code') in (17, 4, 32, 613) and i < retries - 1:
                wait = 60 * (i + 1)
                print(f'  rate limited, waiting {wait}s...'); time.sleep(wait); continue
            raise RuntimeError(f'POST {path}: {body[:500]}')

def make_creative(label, ctype, asset, copy_src):
    c = copy[copy_src]
    if ctype == 'video':
        thumb = api_get(asset, {'fields': 'picture'}).get('picture')
        spec = {'page_id': DST_PAGE, 'video_data': {
            'video_id': asset, 'image_url': thumb, 'message': c['message'], 'title': c['title'],
            'call_to_action': {'type': 'SHOP_NOW', 'value': {'link': NEW_LINK}}}}
    else:
        spec = {'page_id': DST_PAGE, 'link_data': {
            'image_hash': asset, 'link': NEW_LINK, 'message': c['message'], 'name': c['title'],
            'description': c.get('description', ''), 'call_to_action': {'type': 'SHOP_NOW'}}}
    res = api_post(f'{DST_ACT}/adcreatives', {'name': f'{label} [Aurevia]', 'object_story_spec': json.dumps(spec)})
    return res['id']

V = state['videos']; I = state['images']

# ── 1. Rebrand the 10 existing ads (new creatives, swap onto ads) ──
EXISTING = {
    'RO AD 4':           ('video', V['855566327307304'], 'AD 56'),
    'RO AD 2':           ('video', V['25292141673759754'], 'AD 56'),
    'DT - AD1':          ('video', V['1200739085469983'], 'AD 56'),
    'AD 56':             ('video', V['1367105244372403'], 'AD 56'),
    'RO AD 14 - Copy 2': ('image', I['8e99a4eaf63bb5d0795db789d145175f'], 'Native Ads 4'),
    'PIC AD 11 - Copy':  ('image', I['7ac41ab90d5c77349f6faaca3f3257f5'], 'PIC AD 11 - Copy'),
    'AD 108':            ('video', V['2137679883659976'], 'AD 108'),
    'Native Ads 4':      ('image', I['bb0e2419e3a0e4c7176d1bfeb7515907'], 'Native Ads 4'),
    'Native Ads 15':     ('image', I['0d3f8f0a2e12887b13be903f2c0cc92a'], 'Native Ads 4'),
    'Native Ads 6':      ('image', I['dba2131695f04122994c2b7b3a37d69e'], 'Native Ads 6'),
}
state.setdefault('creatives_v3', {})
for name, (ctype, asset, src) in EXISTING.items():
    if name not in state['creatives_v3']:
        cid = make_creative(name, ctype, asset, src)
        state['creatives_v3'][name] = cid; save_state()
        print(f'rebranded creative: {name} -> {cid}')
    api_post(state['ads'][name], {'creative': json.dumps({'creative_id': state['creatives_v3'][name]})})
    print(f'ad updated: {name}')
    time.sleep(2)

# ── 2. Two new VIDEO-ONLY ad sets ──
targeting = json.dumps({'geo_locations': {'countries': ['US', 'GB', 'CA', 'AU']}, 'age_min': 18})
for i in (3, 4):
    key = f'adset{i}'
    if key not in state['adsets']:
        res = api_post(f'{DST_ACT}/adsets', {
            'name': f'CRO Winners {i}',
            'campaign_id': state['campaign_id'],
            'status': 'ACTIVE',
            'billing_event': 'IMPRESSIONS',
            'optimization_goal': 'OFFSITE_CONVERSIONS',
            'promoted_object': json.dumps({'pixel_id': PIXEL_ID, 'custom_event_type': 'PURCHASE'}),
            'targeting': targeting,
            'daily_min_spend_target': '2000',
        })
        state['adsets'][key] = res['id']; save_state()
    print(f'Ad set {i}: {state["adsets"][key]}')

# ── 3. 10 new video ads (5 per new ad set) ──
NEW_ADS = {
    'adset3': [
        ('RO AD 4 - V2',  V['855566327307304'],   'AD 56'),
        ('RO AD 2 - V2',  V['25292141673759754'], 'AD 56'),
        ('DT - AD1 - V2', V['1200739085469983'],  'AD 56'),
        ('AD 56 - V2',    V['1367105244372403'],  'AD 56'),
        ('AD 108 - V2',   V['2137679883659976'],  'AD 108'),
    ],
    'adset4': [
        ('RO AD 2 - V3',  V['1587145352703008'],  'AD 56'),
        ('RO AD 2 - V4',  V['4176001192730313'],  'AD 56'),
        ('RO AD 2 - V5',  V['1662791734720523'],  'AD 56'),
        ('DT - AD1 - V3', V['1413393083824153'],  'AD 108'),
        ('RO AD 4 - V3',  V['855566327307304'],   'AD 108'),
    ],
}
for adset_key, ads in NEW_ADS.items():
    for name, vid, src in ads:
        if name in state['ads']:
            print(f'exists: {name}'); continue
        if name not in state['creatives_v3']:
            cid = make_creative(name, 'video', vid, src)
            state['creatives_v3'][name] = cid; save_state()
            print(f'creative: {name} -> {cid}')
        res = api_post(f'{DST_ACT}/ads', {
            'name': name,
            'adset_id': state['adsets'][adset_key],
            'creative': json.dumps({'creative_id': state['creatives_v3'][name]}),
            'status': 'ACTIVE',
        })
        state['ads'][name] = res['id']; save_state()
        print(f'ad: {name} -> {res["id"]}')
        time.sleep(2)

print('\nDONE — 4 ad sets x 5 ads = 20 ads, all Aurevia-branded')
