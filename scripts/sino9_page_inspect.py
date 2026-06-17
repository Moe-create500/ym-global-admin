#!/usr/bin/env python3
"""Find the Purebite Supplements page and dump the 5 winning creatives' specs."""
import json, urllib.request, urllib.parse, os
TOK = os.environ['TOK']; API = 'https://graph.facebook.com/v24.0'
CREATIVES = ['1690202215663899', '984674554003865', '1121714291024849', '2266031713926574', '955778777166046']

def g(path, params=None):
    params = dict(params or {}); params['access_token'] = TOK
    return json.load(urllib.request.urlopen(f'{API}/{path}?' + urllib.parse.urlencode(params)))

print('=== pages matching purebite/supplement ===')
seen = {}
for ep in ['me/accounts']:
    d = g(ep, {'fields': 'id,name', 'limit': '200'})
    for p in d.get('data', []):
        if 'purebite' in p['name'].lower() or 'supplement' in p['name'].lower():
            seen[p['id']] = p['name']
# also business-owned
try:
    biz = g('me/businesses', {'fields': 'id,name'}).get('data', [])
    for b in biz:
        for ep in ['owned_pages', 'client_pages']:
            d = g(f"{b['id']}/{ep}", {'fields': 'id,name', 'limit': '200'})
            for p in d.get('data', []):
                if 'purebite' in p['name'].lower() or 'supplement' in p['name'].lower():
                    seen[p['id']] = p['name'] + f" (biz {b['name']}/{ep})"
except Exception as e:
    print('biz lookup note:', e)
for pid, nm in seen.items():
    print(f"  {pid}  {nm}")

print('\n=== winning creative specs ===')
for cr in CREATIVES:
    c = g(cr, {'fields': 'name,object_story_spec,effective_object_story_id,asset_feed_spec'})
    spec = c.get('object_story_spec', {})
    vd = spec.get('video_data', {}); ld = spec.get('link_data', {})
    print(f"--- creative {cr} ({c.get('name')})")
    print(f"    page={spec.get('page_id')} insta={spec.get('instagram_actor_id')} story={c.get('effective_object_story_id')}")
    if vd:
        cta = vd.get('call_to_action', {})
        print(f"    VIDEO id={vd.get('video_id')} thumb={'yes' if vd.get('image_url') or vd.get('image_hash') else 'no'} cta={cta.get('type')} link={cta.get('value',{}).get('link')}")
        print(f"    title={(vd.get('title') or '')[:60]!r}")
        print(f"    msg={(vd.get('message') or '')[:80]!r}")
    if ld:
        print(f"    LINK img_hash={ld.get('image_hash')} link={ld.get('link')} cta={ld.get('call_to_action',{}).get('type')}")
        print(f"    name={(ld.get('name') or '')[:60]!r} msg={(ld.get('message') or '')[:80]!r}")
    if c.get('asset_feed_spec'):
        print(f"    HAS asset_feed_spec (flexible)")
