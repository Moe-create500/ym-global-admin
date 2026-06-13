#!/usr/bin/env python3
"""Fetch creatives for winning ads from SINO2 CRO campaign."""
import json, urllib.request, urllib.parse, sys

TOKEN = open('/tmp/fbtoken.txt').read().strip()
AD_IDS = [
    '120240168890490651',  # RO AD 4
    '120240168890470651',  # RO AD 2
    '120243394996310651',  # DT - AD1
    '120241779679210651',  # AD 56
    '120241116626600651',  # RO AD 14 - Copy 2
    '120241720604720651',  # PIC AD 11 - Copy
    '120243741787220651',  # AD 108
    '120243966985320651',  # Native Ads 4
    '120244581133190651',  # Native Ads 15
    '120243966985310651',  # Native Ads 6
]

fields = 'id,name,creative{id,object_story_spec,video_id,image_url,thumbnail_url,object_type,effective_object_story_id,asset_feed_spec}'
url = 'https://graph.facebook.com/v24.0/?' + urllib.parse.urlencode({
    'ids': ','.join(AD_IDS),
    'fields': fields,
    'access_token': TOKEN,
})
data = json.load(urllib.request.urlopen(url))
json.dump(data, open('/tmp/winning_creatives.json', 'w'), indent=1)

for ad_id in AD_IDS:
    ad = data.get(ad_id, {})
    c = ad.get('creative', {})
    spec = c.get('object_story_spec', {})
    vd = spec.get('video_data', {})
    ld = spec.get('link_data', {})
    print(f"--- {ad.get('name')} ({ad_id})")
    print(f"  creative_id: {c.get('id')}, type: {c.get('object_type')}")
    print(f"  page_id: {spec.get('page_id')}, insta: {spec.get('instagram_actor_id')}")
    if c.get('asset_feed_spec'):
        print(f"  HAS asset_feed_spec (flexible/dynamic creative)")
    if vd:
        cta = vd.get('call_to_action', {})
        print(f"  VIDEO id={vd.get('video_id')}, cta={cta.get('type')}, link={cta.get('value', {}).get('link')}")
        print(f"  title={vd.get('title', '')[:70]}")
        print(f"  msg={vd.get('message', '')[:100]}")
    if ld:
        print(f"  LINK img_hash={ld.get('image_hash')}, link={ld.get('link')}, cta={ld.get('call_to_action', {}).get('type')}")
        print(f"  name={ld.get('name', '')[:70]}")
        print(f"  msg={ld.get('message', '')[:100]}")
    print()
