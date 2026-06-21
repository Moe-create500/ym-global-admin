#!/usr/bin/env python3
"""Rebuild the 5 SINO9 winner creatives under the PureBite Supplements page and swap them
onto all 30 ads in the UK + AU campaigns. Creatives are immutable, so this makes new ones
(same video/image, copy, link, CTA) under the new page, then repoints each ad."""
import json, urllib.request, urllib.parse, os, time, re
TOK = os.environ['TOK']; API = 'https://graph.facebook.com/v24.0'
ACT = 'act_1245466530397577'
NEW_PAGE = '1174991802365239'   # PureBite Supplements
OLD = ['1690202215663899', '984674554003865', '1121714291024849', '2266031713926574', '955778777166046']
CAMPS = ['120245701255160218', '120245700891500218']  # UK, AU

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

def errmsg(r): return r.get('error', {}).get('error_user_msg') or r.get('error', {}).get('message') or json.dumps(r)[:200]

def strip(o):
    """Recursively drop read-only fields FB rejects on create."""
    if isinstance(o, dict):
        return {k: strip(v) for k, v in o.items() if k not in ('adlabels', 'id', 'asset_customization_rules')}
    if isinstance(o, list):
        return [strip(x) for x in o]
    return o

def vthumb(vid):
    try: return g(vid, {'fields': 'picture'}).get('picture')
    except Exception: return None

def fix_video_thumb(vd):
    """FB rejects both image_url and image_hash together — keep hash, drop url."""
    if not vd: return
    if vd.get('image_hash') and vd.get('image_url'):
        del vd['image_url']
    elif not vd.get('image_hash') and not vd.get('image_url'):
        t = vthumb(vd.get('video_id'))
        if t: vd['image_url'] = t

# Resolve a page-backed Instagram actor for the new page (fixes "ad account has no access
# to this Instagram account" — page-backed IG is always usable by the page's ad accounts).
IG_ACTOR = None
try:
    pbia = g(f'{NEW_PAGE}/page_backed_instagram_accounts', {'fields': 'id'}).get('data', [])
    if pbia:
        IG_ACTOR = pbia[0]['id']
    else:
        r = post(f'{NEW_PAGE}/page_backed_instagram_accounts', {})
        IG_ACTOR = r.get('id')
    print(f"page-backed IG actor: {IG_ACTOR or 'none (' + errmsg(r if not pbia else {}) + ')'}")
except Exception as e:
    print('page-backed IG lookup failed:', str(e)[:160])

# ── 1. Rebuild creatives under the new page ──
newmap = {}
for oc in OLD:
    c = g(oc, {'fields': 'name,object_story_spec,asset_feed_spec'})
    spec = json.loads(json.dumps(c.get('object_story_spec', {})))
    spec['page_id'] = NEW_PAGE
    spec.pop('instagram_actor_id', None)
    if IG_ACTOR:
        spec['instagram_actor_id'] = IG_ACTOR
    fix_video_thumb(spec.get('video_data'))
    payload = {'name': (c.get('name', 'BB winner')[:90]) + ' [PBSupp]', 'object_story_spec': json.dumps(spec)}
    afs = c.get('asset_feed_spec')
    if afs:
        afs = strip(json.loads(json.dumps(afs)))
        for v in afs.get('videos', []):
            v.pop('thumbnail_hash', None)
            if not v.get('thumbnail_url') and not v.get('image_hash'):
                t = vthumb(v.get('video_id'))
                if t: v['thumbnail_url'] = t
        payload['asset_feed_spec'] = json.dumps(afs)
    r = post(f'{ACT}/adcreatives', payload)
    newmap[oc] = r.get('id')
    print(f"creative {oc} -> {r.get('id') or 'ERR: ' + errmsg(r)}")

if not all(newmap.values()):
    print('\nNOT all creatives rebuilt — aborting swap so nothing is half-changed.')
    raise SystemExit(1)

# Map ad-name suffix (ad1..ad5) -> new creative
idx_to_new = {i + 1: newmap[OLD[i]] for i in range(5)}

# ── 2. Swap creative on every ad in both campaigns ──
print('\n--- swapping ads ---')
swapped = 0
for camp in CAMPS:
    ads = g(f'{camp}/ads', {'fields': 'id,name', 'limit': '50'})
    for ad in ads.get('data', []):
        m = re.search(r'ad(\d+)$', ad['name'])
        if not m:
            print(f"  ?? can't parse {ad['name']}"); continue
        newc = idx_to_new[int(m.group(1))]
        r = post(ad['id'], {'creative': json.dumps({'creative_id': newc})})
        if r.get('success') or 'id' in r:
            swapped += 1
        else:
            print(f"  swap ERR {ad['name']}: {errmsg(r)}")
        time.sleep(0.3)
print(f"\nswapped {swapped}/30 ads to PureBite Supplements page ({NEW_PAGE})")
