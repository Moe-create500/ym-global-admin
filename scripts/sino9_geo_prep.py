#!/usr/bin/env python3
"""Gather the 5 winning ads' creative IDs + the source ad set template (pixel/opt/billing)
so the new UK/AU campaigns replicate the winners exactly."""
import json, urllib.request, urllib.parse, os
TOK = os.environ['TOK']; API = 'https://graph.facebook.com/v24.0'
SRC_CAMP = '120240320118360218'
WINNERS = {
    'BB AD 55': '120240585378290218',
    'BB PIC AD 3': '120240335124730218',
    'BB AD 40': '120240329324560218',
    'BB AD 15': '120240329324660218',
    'BB AD 68': '120241370341340218',
}

def g(path, params=None):
    params = dict(params or {}); params['access_token'] = TOK
    return json.load(urllib.request.urlopen(f'{API}/{path}?' + urllib.parse.urlencode(params)))

print('=== WINNER CREATIVE IDs + destination check ===')
for nm, ad_id in WINNERS.items():
    a = g(ad_id, {'fields': 'name,creative{id,object_story_spec,effective_object_story_id}'})
    cr = a.get('creative', {})
    spec = cr.get('object_story_spec', {})
    vd = spec.get('video_data', {}); ld = spec.get('link_data', {})
    link = vd.get('call_to_action', {}).get('value', {}).get('link') or ld.get('link') or '(story-based)'
    kind = 'VIDEO' if vd else ('IMAGE' if ld else 'OTHER/story')
    print(f"{nm}: creative_id={cr.get('id')} | {kind} | page={spec.get('page_id')} | link={link}")

print('\n=== SOURCE AD SET TEMPLATE (to replicate) ===')
asets = g(f'{SRC_CAMP}/adsets', {'fields': 'name,optimization_goal,billing_event,promoted_object,targeting', 'limit': '5'})
a = asets['data'][0]
po = a.get('promoted_object', {}); t = a.get('targeting', {})
print(f"opt_goal={a.get('optimization_goal')} | billing={a.get('billing_event')}")
print(f"pixel={po.get('pixel_id')} | event={po.get('custom_event_type')}")
print(f"current geo={t.get('geo_locations',{}).get('countries')} | age={t.get('age_min')}-{t.get('age_max')}")
print(f"(all {len(asets['data'])} source ad sets listed; using first as template)")
