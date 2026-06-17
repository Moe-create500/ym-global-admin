#!/usr/bin/env python3
"""Swap the 5 MagSkinny ads to super-clickbait copy (rebuild creatives, repoint ads)."""
import json, urllib.request, urllib.parse, os, time
TOK = os.environ['TOK']; API = 'https://graph.facebook.com/v24.0'
ACT = 'act_2448686872317500'; PAGE = '1190438270813259'
LINK = 'https://liposhopper.com/products/lipo-magnesium-8-1-skinny-mix'

# (ad_id, video_id, variant_index) — same rotation as the original build
ADS = [
    ('120251551941910547', '2081425399446877', 0),
    ('120251551943200547', '3612135048937378', 1),
    ('120251551945520547', '1528031115526708', 2),
    ('120251551948010547', '2440601693111655', 0),
    ('120251551949250547', '2254875961983841', 1),
]
VARIANTS = [
    {'headline': 'Buy 1 Get 1 FREE 🍹',
     'primary': "Okay I'm SCREAMING 😱 7 nights of this magnesium mix and my bloat is just… GONE?? 🍹 8-in-1 — debloats, kills cravings, knocks me out by 10pm, flat + glowing by morning. And RIGHT NOW it's BUY 1 GET 1 FREE 🎁 Why did nobody tell me sooner?! Tap before it sells out AGAIN 👇"},
    {'headline': 'BOGO FREE 😱 Bloat = GONE',
     'primary': "POV: you found the drink that broke the internet 🍹 One scoop = debloated, zero late-night cravings, deepest sleep of your life. Today only it's BUY 1 GET 1 FREE 🎁 keep one, gift one. Run, don't walk 👇"},
    {'headline': 'Buy 1 Get 1 FREE 👀 Why?!',
     'primary': "This is your sign 🛑 I tried the 8-in-1 Skinny Mix as a joke… now I'm OBSESSED 🍹 Debloat overnight, crush cravings, sleep like a baby — one scoop does it all. And it's literally BUY 1 GET 1 FREE right now 🎁 Sold out TWICE for a reason. Tap before it's gone 👇"},
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

for ad_id, vid, vi in ADS:
    v = VARIANTS[vi]
    thumb = g(vid, {'fields': 'picture'}).get('picture')
    spec = {'page_id': PAGE, 'video_data': {
        'video_id': vid, 'image_url': thumb, 'message': v['primary'], 'title': v['headline'],
        'call_to_action': {'type': 'SHOP_NOW', 'value': {'link': LINK}}}}
    cr = post(f'{ACT}/adcreatives', {'name': f'MAGSKINNY clickbait {ad_id[-4:]}', 'object_story_spec': json.dumps(spec)})
    if 'id' not in cr:
        print(f'{ad_id} CREATIVE ERR: {em(cr)}'); continue
    upd = post(ad_id, {'creative': json.dumps({'creative_id': cr['id']})})
    print(f'{ad_id} -> {"OK" if (upd.get("success") or "id" in upd) else "ERR: " + em(upd)}  "{v["headline"]}"')
    time.sleep(0.5)
print('done')
