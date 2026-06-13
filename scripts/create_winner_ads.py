#!/usr/bin/env python3
"""Create standard creatives + ads in Aurvia for the 10 migrated winners."""
import json, urllib.request, urllib.parse, time, os

TOKEN = open('/tmp/fbtoken.txt').read().strip()
API = 'https://graph.facebook.com/v24.0'
DST_ACT = 'act_2448686872317500'
DST_PAGE = '1123792807487479'
NEW_LINK = 'https://aureviafit.com/products/cyperus-rotundus-oil'

state = json.load(open('/tmp/migrate_state.json'))
copy = json.load(open('/tmp/winner_copy.json'))

# winner -> (type, new_asset_id_or_hash, copy_source)
ADS = {
    'RO AD 4':           ('video', state['videos']['855566327307304'], 'AD 56'),
    'RO AD 2':           ('video', state['videos']['25292141673759754'], 'AD 56'),
    'DT - AD1':          ('video', state['videos']['1200739085469983'], 'AD 56'),
    'AD 56':             ('video', state['videos']['1367105244372403'], 'AD 56'),
    'RO AD 14 - Copy 2': ('image', state['images']['8e99a4eaf63bb5d0795db789d145175f'], 'Native Ads 4'),
    'PIC AD 11 - Copy':  ('image', state['images']['7ac41ab90d5c77349f6faaca3f3257f5'], 'PIC AD 11 - Copy'),
    'AD 108':            ('video', state['videos']['2137679883659976'], 'AD 108'),
    'Native Ads 4':      ('image', state['images']['bb0e2419e3a0e4c7176d1bfeb7515907'], 'Native Ads 4'),
    'Native Ads 15':     ('image', state['images']['0d3f8f0a2e12887b13be903f2c0cc92a'], 'Native Ads 4'),
    'Native Ads 6':      ('image', state['images']['dba2131695f04122994c2b7b3a37d69e'], 'Native Ads 6'),
}
ADSET_1 = ['RO AD 4', 'RO AD 2', 'DT - AD1', 'AD 56', 'RO AD 14 - Copy 2']
ADSET_2 = ['PIC AD 11 - Copy', 'AD 108', 'Native Ads 4', 'Native Ads 15', 'Native Ads 6']

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

def build_creative(name):
    ctype, asset, copy_src = ADS[name]
    c = copy[copy_src]
    msg, title = c['message'], c['title']
    if ctype == 'video':
        thumb = api_get(asset, {'fields': 'picture'}).get('picture')
        spec = {
            'page_id': DST_PAGE,
            'video_data': {
                'video_id': asset,
                'image_url': thumb,
                'message': msg,
                'title': title,
                'call_to_action': {'type': 'SHOP_NOW', 'value': {'link': NEW_LINK}},
            },
        }
    else:
        spec = {
            'page_id': DST_PAGE,
            'link_data': {
                'image_hash': asset,
                'link': NEW_LINK,
                'message': msg,
                'name': title,
                'description': c.get('description', ''),
                'call_to_action': {'type': 'SHOP_NOW'},
            },
        }
    return {'name': f'{name} [CRO winner]', 'object_story_spec': json.dumps(spec)}

for adset_key, names in (('adset1', ADSET_1), ('adset2', ADSET_2)):
    for name in names:
        if name in state.get('ads', {}):
            print(f'exists: {name} -> {state["ads"][name]}'); continue
        if name not in state.setdefault('creatives', {}):
            res = api_post(f'{DST_ACT}/adcreatives', build_creative(name))
            state['creatives'][name] = res['id']; save_state()
            print(f'creative: {name} -> {res["id"]}')
        res = api_post(f'{DST_ACT}/ads', {
            'name': name,
            'adset_id': state['adsets'][adset_key],
            'creative': json.dumps({'creative_id': state['creatives'][name]}),
            'status': 'ACTIVE',
        })
        state.setdefault('ads', {})[name] = res['id']; save_state()
        print(f'ad: {name} -> {res["id"]}')
        time.sleep(2)

print('\nDONE — campaign', state['campaign_id'], '(PAUSED)')
