#!/usr/bin/env python3
"""Set display link Aurevia.com on all 20 CRO winner ads (v4 creatives)."""
import json, urllib.request, urllib.parse, time

TOKEN = open('/tmp/fbtoken.txt').read().strip()
API = 'https://graph.facebook.com/v24.0'
DST_ACT = 'act_2448686872317500'
DST_PAGE = '1123792807487479'
NEW_LINK = 'https://skinco-2904.myshopify.com/products/cyperus-rotundus-oil'
DISPLAY = 'Aurevia.com'

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

V = state['videos']; I = state['images']
# name -> (type, asset, copy_src) for ALL 20 ads
ALL_ADS = {
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
    'RO AD 4 - V2':      ('video', V['855566327307304'], 'AD 56'),
    'RO AD 2 - V2':      ('video', V['25292141673759754'], 'AD 56'),
    'DT - AD1 - V2':     ('video', V['1200739085469983'], 'AD 56'),
    'AD 56 - V2':        ('video', V['1367105244372403'], 'AD 56'),
    'AD 108 - V2':       ('video', V['2137679883659976'], 'AD 108'),
    'RO AD 2 - V3':      ('video', V['1587145352703008'], 'AD 56'),
    'RO AD 2 - V4':      ('video', V['4176001192730313'], 'AD 56'),
    'RO AD 2 - V5':      ('video', V['1662791734720523'], 'AD 56'),
    'DT - AD1 - V3':     ('video', V['1413393083824153'], 'AD 108'),
    'RO AD 4 - V3':      ('video', V['855566327307304'], 'AD 108'),
}

state.setdefault('creatives_v4', {})
for name, (ctype, asset, src) in ALL_ADS.items():
    c = copy[src]
    if name not in state['creatives_v4']:
        if ctype == 'video':
            thumb = api_get(asset, {'fields': 'picture'}).get('picture')
            spec = {'page_id': DST_PAGE, 'video_data': {
                'video_id': asset, 'image_url': thumb, 'message': c['message'], 'title': c['title'],
                'call_to_action': {'type': 'SHOP_NOW', 'value': {'link': NEW_LINK, 'link_caption': DISPLAY}}}}
        else:
            spec = {'page_id': DST_PAGE, 'link_data': {
                'image_hash': asset, 'link': NEW_LINK, 'message': c['message'], 'name': c['title'],
                'description': c.get('description', ''), 'caption': DISPLAY,
                'call_to_action': {'type': 'SHOP_NOW'}}}
        res = api_post(f'{DST_ACT}/adcreatives', {'name': f'{name} [Aurevia v4]', 'object_story_spec': json.dumps(spec)})
        state['creatives_v4'][name] = res['id']; save_state()
        print(f'creative v4: {name} -> {res["id"]}')
    api_post(state['ads'][name], {'creative': json.dumps({'creative_id': state['creatives_v4'][name]})})
    print(f'ad updated: {name}')
    time.sleep(2)

print('\nDONE — display link Aurevia.com on all 20 ads')
