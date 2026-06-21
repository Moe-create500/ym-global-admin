#!/usr/bin/env python3
"""Create 9 video ads (3 per ad set) for the LIP PUMP campaign under the LIPO page.
Clickbait Buy-1-Get-1-Free copy. Campaign stays PAUSED; ad sets + ads set ACTIVE so the
whole thing launches with a single campaign toggle."""
import json, urllib.request, urllib.parse, os, time

TOK = os.environ['TOK']
API = 'https://graph.facebook.com/v24.0'
ACT = 'act_2448686872317500'
PAGE = '1190438270813259'           # LIPO
LINK = 'https://liposhopper.com/products/lipo-lip-pumper'

# 3 videos per ad set, in the order uploaded
SETS = {
    '120251500852810547': ['1504526021370938', '1270351921837593', '1036424655473588'],
    '120251500863200547': ['1811412016876408', '26615175868159564', '1631164767965547'],
    '120251500867410547': ['2244113986346601', '994186183539698', '1352262437082180'],
}

# Clickbait + BOGO copy, rotated across the 9 ads
VARIANTS = [
    {'headline': 'Buy 1 Get 1 FREE 💋',
     'primary': "I tried the LIPO Lip Pumper and I'm OBSESSED 😍 Fuller, plumper lips in SECONDS — no filler, no needles, no pain. And right now it's BUY 1 GET 1 FREE 🎁 Everyone keeps asking what I did to my lips 👀 Grab yours before they sell out 👇"},
    {'headline': 'Fuller Lips in Seconds 💋 BOGO',
     'primary': "POV: you finally found the lip pump that ACTUALLY works 💋 Plumper lips in seconds, zero filler. Today only it's BUY 1 GET 1 FREE — keep one, gift one 🎁 Don't say I didn't warn you 👇"},
    {'headline': 'Her Lips Went Viral 💋 (BOGO)',
     'primary': "Why is NOBODY talking about this?? 😮 Instantly fuller, plumper lips — no injections, no filler, no cap. And it's literally BUY 1 GET 1 FREE right now 🎁 This is your sign to try it 👇"},
]

def api_get(path, params=None):
    params = dict(params or {}); params['access_token'] = TOK
    return json.load(urllib.request.urlopen(f'{API}/{path}?' + urllib.parse.urlencode(params)))

def api_post(path, params):
    params = dict(params); params['access_token'] = TOK
    data = urllib.parse.urlencode(params).encode('utf-8')
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request(f'{API}/{path}', data=data)))
    except urllib.error.HTTPError as e:
        try:
            return {'error': json.loads(e.read().decode()).get('error', {})}
        except Exception:
            return {'error': {'message': 'http ' + str(e.code)}}

def wait_ready(vid, tries=40):
    """Wait for FB to finish processing the video, return its thumbnail URL."""
    pic = None
    for _ in range(tries):
        st = api_get(vid, {'fields': 'status,picture'})
        pic = st.get('picture') or pic
        if st.get('status', {}).get('video_status') == 'ready':
            return pic
        time.sleep(8)
    return pic

results = []
n = 0
for adset, vids in SETS.items():
    for vid in vids:
        v = VARIANTS[n % 3]; n += 1
        thumb = wait_ready(vid)
        spec = {
            'page_id': PAGE,
            'video_data': {
                'video_id': vid,
                'image_url': thumb,
                'message': v['primary'],
                'title': v['headline'],
                'call_to_action': {'type': 'SHOP_NOW', 'value': {'link': LINK}},
            },
        }
        cr = api_post(f'{ACT}/adcreatives', {'name': f'LIP PUMP creative {n}', 'object_story_spec': json.dumps(spec)})
        if 'id' not in cr:
            results.append(f'ad {n} vid={vid} CREATIVE ERR: {json.dumps(cr.get("error"))[:300]}')
            continue
        ad = api_post(f'{ACT}/ads', {
            'name': f'LIP PUMP {n}', 'adset_id': adset,
            'creative': json.dumps({'creative_id': cr['id']}), 'status': 'ACTIVE',
        })
        if 'id' not in ad:
            results.append(f'ad {n} vid={vid} AD ERR: {json.dumps(ad.get("error"))[:300]}')
        else:
            results.append(f'ad {n} -> {ad["id"]} (set {adset}, vid {vid}, "{v["headline"]}")')
        time.sleep(1)

# Activate the 3 ad sets (campaign stays PAUSED → one toggle launches everything)
created = sum(1 for r in results if ' -> ' in r)
if created == 9:
    for adset in SETS:
        api_post(adset, {'status': 'ACTIVE'})
    print('ad sets set ACTIVE (campaign still PAUSED)')
else:
    print(f'Only {created}/9 ads created — leaving ad sets PAUSED, review errors below')

for r in results:
    print(r)
