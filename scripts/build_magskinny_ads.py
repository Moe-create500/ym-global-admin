#!/usr/bin/env python3
"""Create the 5 MagSkinny video ads (3 in Set 1, 2 in Set 2) under the LIPO page.
Clickbait copy, Shop Now -> liposhopper magnesium skinny mix. Campaign stays PAUSED;
ad sets + ads ACTIVE for a one-toggle launch."""
import json, urllib.request, urllib.parse, os, time
TOK = os.environ['TOK']; API = 'https://graph.facebook.com/v24.0'
ACT = 'act_2448686872317500'
PAGE = '1190438270813259'   # LIPO
LINK = 'https://liposhopper.com/products/lipo-magnesium-8-1-skinny-mix'

SETS = {
    '120251551607440547': ['2081425399446877', '3612135048937378', '1528031115526708'],  # Set 1: 3
    '120251551607890547': ['2440601693111655', '2254875961983841'],                       # Set 2: 2
}
VARIANTS = [
    {'headline': 'The 8-in-1 Skinny Mix 🍹',
     'primary': "I cannot believe what this magnesium mix did to my bloat 😱 8 benefits in ONE scoop — debloat, fewer cravings, deeper sleep, calmer mood. I drink it every night and wake up feeling amazing 🍹 Tap to try it 👇"},
    {'headline': 'Debloat By Morning? 😱',
     'primary': "POV: you finally found the magnesium mix everyone's obsessed with 🍹 The Lipo 8-in-1 Skinny Mix helps you debloat, curb cravings, and sleep deeper — no pills, just one tasty scoop a day 👇"},
    {'headline': 'Why Is Everyone Drinking This? 👀',
     'primary': "This is your sign to try the 8-in-1 Skinny Mix 🍹 Magnesium that helps you debloat, crush late-night cravings, and sleep like a baby — all in one scoop. It sold out twice 🤍 Tap to see why 👇"},
]

def g(path, params=None):
    params = dict(params or {}); params['access_token'] = TOK
    return json.load(urllib.request.urlopen(f'{API}/{path}?' + urllib.parse.urlencode(params)))

def post(path, params):
    params = dict(params); params['access_token'] = TOK
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request(f'{API}/{path}', data=urllib.parse.urlencode(params).encode())))
    except urllib.error.HTTPError as e:
        try: return {'error': json.loads(e.read().decode()).get('error', {})}
        except Exception: return {'error': {'message': 'http ' + str(e.code)}}

def em(r): return r.get('error', {}).get('error_user_msg') or r.get('error', {}).get('message') or json.dumps(r)[:200]

def wait_ready(vid, tries=40):
    pic = None
    for _ in range(tries):
        st = g(vid, {'fields': 'status,picture'})
        pic = st.get('picture') or pic
        if st.get('status', {}).get('video_status') == 'ready':
            return pic
        time.sleep(8)
    return pic

results, n = [], 0
for adset, vids in SETS.items():
    for vid in vids:
        v = VARIANTS[n % 3]; n += 1
        thumb = wait_ready(vid)
        spec = {'page_id': PAGE, 'video_data': {
            'video_id': vid, 'image_url': thumb, 'message': v['primary'], 'title': v['headline'],
            'call_to_action': {'type': 'SHOP_NOW', 'value': {'link': LINK}}}}
        cr = post(f'{ACT}/adcreatives', {'name': f'MAGSKINNY creative {n}', 'object_story_spec': json.dumps(spec)})
        if 'id' not in cr:
            results.append(f'ad {n} vid={vid} CREATIVE ERR: {em(cr)}'); continue
        ad = post(f'{ACT}/ads', {'name': f'MAGSKINNY {n}', 'adset_id': adset,
                                 'creative': json.dumps({'creative_id': cr['id']}), 'status': 'ACTIVE'})
        results.append(f'ad {n} -> {ad.get("id") or "ERR: " + em(ad)} (set {adset}, vid {vid}, "{v["headline"]}")')
        time.sleep(1)

created = sum(1 for r in results if ' -> ' in r and 'ERR' not in r)
print(f'{created}/5 ads created')
for r in results: print(r)
