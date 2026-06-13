#!/usr/bin/env python3
"""Migrate winning ads from SINO2 CRO campaign to Aurvia account.

Creates: 1 CBO campaign ($150/day, PAUSED) + 2 ad sets ($20 min each, US/GB/CA/AU,
Cyperus Rotundus pixel) + 10 ads (5 per ad set) with re-uploaded assets.
"""
import json, urllib.request, urllib.parse, time, sys, os

TOKEN = open('/tmp/fbtoken.txt').read().strip()
API = 'https://graph.facebook.com/v24.0'
SRC_ACT = 'act_1154387179563315'   # SINO2
DST_ACT = 'act_2448686872317500'   # Aurvia
DST_PAGE = '1123792807487479'      # Aurevia page
PIXEL_ID = '976892338681167'       # Cyperus Rotundus
NEW_LINK = 'https://aureviafit.com/products/cyperus-rotundus-oil'
CAMPAIGN_NAME = 'AO | CBO | T4 - [CRO WINNERS] - 6/11'

ADSET_1 = ['RO AD 4', 'RO AD 2', 'DT - AD1', 'AD 56', 'RO AD 14 - Copy 2']
ADSET_2 = ['PIC AD 11 - Copy', 'AD 108', 'Native Ads 4', 'Native Ads 15', 'Native Ads 6']

state_file = '/tmp/migrate_state.json'
state = json.load(open(state_file)) if os.path.exists(state_file) else {
    'videos': {}, 'images': {}, 'campaign_id': None, 'adsets': {}, 'creatives': {}, 'ads': {}
}

def save_state():
    json.dump(state, open(state_file, 'w'), indent=1)

def api_get(path, params=None, retries=4):
    params = dict(params or {})
    params['access_token'] = TOKEN
    url = f'{API}/{path}?' + urllib.parse.urlencode(params)
    for i in range(retries):
        try:
            return json.load(urllib.request.urlopen(url))
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            err = json.loads(body).get('error', {})
            if err.get('code') in (17, 4, 32, 613) and i < retries - 1:
                wait = 60 * (i + 1)
                print(f'  rate limited, waiting {wait}s...'); time.sleep(wait); continue
            raise RuntimeError(f'GET {path}: {body[:300]}')

def api_post(path, params, retries=4):
    params = dict(params)
    params['access_token'] = TOKEN
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

def collect_assets(creatives):
    video_ids, image_hashes = set(), set()
    for ad in creatives.values():
        c = ad.get('creative', {})
        spec = c.get('object_story_spec', {})
        vd = spec.get('video_data', {})
        if vd.get('video_id'): video_ids.add(vd['video_id'])
        ld = spec.get('link_data', {})
        if ld.get('image_hash'): image_hashes.add(ld['image_hash'])
        afs = c.get('asset_feed_spec', {})
        for v in afs.get('videos', []):
            if v.get('video_id'): video_ids.add(v['video_id'])
        for im in afs.get('images', []):
            if im.get('hash'): image_hashes.add(im['hash'])
    return video_ids, image_hashes

_page_tokens = None
def get_page_tokens():
    global _page_tokens
    if _page_tokens is None:
        res = api_get('me/accounts', {'fields': 'id,name,access_token', 'limit': '100'})
        _page_tokens = {p['id']: p['access_token'] for p in res.get('data', [])}
        print(f'  loaded {len(_page_tokens)} page tokens')
    return _page_tokens

def get_video_source(vid):
    info = api_get(vid, {'fields': 'source,title'})
    if info.get('source'): return info['source'], info.get('title')
    for pid, ptoken in get_page_tokens().items():
        try:
            url = f'{API}/{vid}?' + urllib.parse.urlencode({'fields': 'source,title', 'access_token': ptoken})
            info = json.load(urllib.request.urlopen(url))
            if info.get('source'): return info['source'], info.get('title')
        except Exception:
            continue
    return None, None

def migrate_video(vid):
    if vid in state['videos']: return state['videos'][vid]
    print(f'  video {vid}: fetching source...')
    src, title = get_video_source(vid)
    info = {'title': title}
    if not src:
        raise RuntimeError(f'No source URL for video {vid} (may need page token)')
    print(f'  video {vid}: uploading to {DST_ACT} via file_url...')
    res = api_post(f'{DST_ACT}/advideos', {'file_url': src, 'name': info.get('title') or f'migrated_{vid}'})
    new_id = res['id']
    state['videos'][vid] = new_id
    save_state()
    print(f'  video {vid} -> {new_id}')
    return new_id

def migrate_image(h):
    if h in state['images']: return state['images'][h]
    print(f'  image {h}: fetching url...')
    res = api_get(f'{SRC_ACT}/adimages', {'hashes': json.dumps([h]), 'fields': 'url,permalink_url'})
    items = res.get('data', [])
    if not items: raise RuntimeError(f'Image {h} not found in source account')
    url = items[0]['url']
    res2 = api_post(f'{DST_ACT}/adimages', {'copy_from': json.dumps({'source_account_id': SRC_ACT.replace('act_',''), 'hash': h})})
    new_hash = list(res2['images'].values())[0]['hash']
    state['images'][h] = new_hash
    save_state()
    print(f'  image {h} -> {new_hash}')
    return new_hash

def remap_creative(ad_name, creative):
    """Build a new creative payload from the old one."""
    spec = json.loads(json.dumps(creative.get('object_story_spec', {})))
    afs = json.loads(json.dumps(creative.get('asset_feed_spec', {}))) if creative.get('asset_feed_spec') else None

    spec['page_id'] = DST_PAGE
    spec.pop('instagram_actor_id', None)

    vd = spec.get('video_data')
    if vd:
        if vd.get('video_id'): vd['video_id'] = state['videos'][vd['video_id']]
        if vd.get('image_hash'): vd['image_hash'] = state['images'].get(vd['image_hash'], vd['image_hash'])
        cta = vd.get('call_to_action', {})
        if cta.get('value', {}).get('link'): cta['value']['link'] = NEW_LINK
    ld = spec.get('link_data')
    if ld:
        if ld.get('image_hash'): ld['image_hash'] = state['images'][ld['image_hash']]
        if ld.get('link'): ld['link'] = NEW_LINK
        cta = ld.get('call_to_action', {})
        if cta.get('value', {}).get('link'): cta['value']['link'] = NEW_LINK

    payload = {'name': f'{ad_name} [migrated]', 'object_story_spec': json.dumps(spec)}

    if afs:
        for v in afs.get('videos', []):
            if v.get('video_id'): v['video_id'] = state['videos'][v['video_id']]
            v.pop('thumbnail_hash', None)
        for im in afs.get('images', []):
            if im.get('hash'): im['hash'] = state['images'][im['hash']]
        for l in afs.get('link_urls', []):
            if l.get('website_url'): l['website_url'] = NEW_LINK
            if l.get('display_url'): l['display_url'] = 'aureviafit.com'
        afs.pop('id', None)
        payload['asset_feed_spec'] = json.dumps(afs)

    return payload

def main():
    creatives = json.load(open('/tmp/winning_creatives.json'))
    by_name = {ad['name']: ad for ad in creatives.values()}

    # 1. Migrate assets
    video_ids, image_hashes = collect_assets(creatives)
    print(f'Assets to migrate: {len(video_ids)} videos, {len(image_hashes)} images')
    for h in sorted(image_hashes): migrate_image(h)
    for v in sorted(video_ids): migrate_video(v)

    # 2. Wait for videos to be ready
    print('Waiting for video processing...')
    for old, new in state['videos'].items():
        for _ in range(30):
            st = api_get(new, {'fields': 'status'})
            if st.get('status', {}).get('video_status') == 'ready': break
            time.sleep(10)
        print(f'  {new}: {st.get("status", {}).get("video_status")}')

    # 3. Campaign
    if not state['campaign_id']:
        res = api_post(f'{DST_ACT}/campaigns', {
            'name': CAMPAIGN_NAME,
            'objective': 'OUTCOME_SALES',
            'status': 'PAUSED',
            'special_ad_categories': '[]',
            'daily_budget': '15000',
            'bid_strategy': 'LOWEST_COST_WITHOUT_CAP',
        })
        state['campaign_id'] = res['id']
        save_state()
    print(f'Campaign: {state["campaign_id"]}')

    # 4. Ad sets
    targeting = json.dumps({
        'geo_locations': {'countries': ['US', 'GB', 'CA', 'AU']},
        'age_min': 18,
    })
    for i, label in enumerate(['Winners 1', 'Winners 2'], 1):
        key = f'adset{i}'
        if key not in state['adsets']:
            res = api_post(f'{DST_ACT}/adsets', {
                'name': f'CRO {label}',
                'campaign_id': state['campaign_id'],
                'status': 'ACTIVE',
                'billing_event': 'IMPRESSIONS',
                'optimization_goal': 'OFFSITE_CONVERSIONS',
                'promoted_object': json.dumps({'pixel_id': PIXEL_ID, 'custom_event_type': 'PURCHASE'}),
                'targeting': targeting,
                'daily_min_spend_target': '2000',
            })
            state['adsets'][key] = res['id']
            save_state()
        print(f'Ad set {i}: {state["adsets"][key]}')

    # 5. Creatives + ads
    for adset_key, names in (('adset1', ADSET_1), ('adset2', ADSET_2)):
        for name in names:
            if name in state['ads']:
                print(f'Ad exists: {name} -> {state["ads"][name]}')
                continue
            ad = by_name[name]
            if name not in state['creatives']:
                payload = remap_creative(name, ad['creative'])
                res = api_post(f'{DST_ACT}/adcreatives', payload)
                state['creatives'][name] = res['id']
                save_state()
                print(f'Creative: {name} -> {res["id"]}')
            res = api_post(f'{DST_ACT}/ads', {
                'name': name,
                'adset_id': state['adsets'][adset_key],
                'creative': json.dumps({'creative_id': state['creatives'][name]}),
                'status': 'ACTIVE',
            })
            state['ads'][name] = res['id']
            save_state()
            print(f'Ad: {name} -> {res["id"]}')
            time.sleep(2)

    print('\nDONE')
    print(f'Campaign {state["campaign_id"]} (PAUSED) — flip to ACTIVE in Ads Manager to launch.')

if __name__ == '__main__':
    main()
