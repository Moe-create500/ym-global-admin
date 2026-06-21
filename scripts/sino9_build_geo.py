#!/usr/bin/env python3
"""Replicate SINO9 Beauty Bundle winners into new UK and AU campaigns.
Each: CBO $100/day, 3 ad sets ($20 min spend), same 5 top-revenue winners per set.
Reuses existing creative IDs (same videos/copy/page/link). Campaigns PAUSED;
ad sets + ads ACTIVE so each launches with a single campaign toggle."""
import json, urllib.request, urllib.parse, os, time
TOK = os.environ['TOK']; API = 'https://graph.facebook.com/v24.0'
ACT = 'act_1245466530397577'
PIXEL = '2177526242983223'
# top 5 by revenue: BB AD 55, BB PIC AD 3, BB AD 40, BB AD 15, BB AD 68
CREATIVES = ['1690202215663899', '984674554003865', '1121714291024849', '2266031713926574', '955778777166046']
GEOS = [('UK', 'GB')]  # AU already built; retrying UK only

def post(path, params):
    params = dict(params); params['access_token'] = TOK
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request(f'{API}/{path}', data=urllib.parse.urlencode(params).encode())))
    except urllib.error.HTTPError as e:
        try: return {'error': json.loads(e.read().decode()).get('error', {})}
        except Exception: return {'error': {'message': 'http ' + str(e.code)}}

def errmsg(r): return r.get('error', {}).get('error_user_msg') or r.get('error', {}).get('message') or str(r)

summary = []
for label, country in GEOS:
    camp = {}
    for attempt in range(4):  # transient "retry later" errors are common
        camp = post(f'{ACT}/campaigns', {
            'name': f'AO | CBO - {label} - BEAUTY BUNDLE - 6/17',
            'objective': 'OUTCOME_SALES', 'status': 'PAUSED', 'special_ad_categories': '[]',
            'daily_budget': '10000', 'bid_strategy': 'LOWEST_COST_WITHOUT_CAP'})
        if 'id' in camp: break
        print(f'{label} campaign attempt {attempt+1} failed: {errmsg(camp)} — retrying in 15s')
        time.sleep(15)
    if 'id' not in camp:
        print(f'{label} CAMPAIGN ERR: {errmsg(camp)}'); continue
    cid = camp['id']
    print(f'{label} campaign -> {cid}  (CBO $100/day, PAUSED)')
    targeting = json.dumps({'geo_locations': {'countries': [country]}, 'age_min': 18, 'age_max': 65})
    set_ids = []
    for s in (1, 2, 3):
        aset = post(f'{ACT}/adsets', {
            'name': f'{label} | Set {s}', 'campaign_id': cid, 'status': 'ACTIVE',
            'billing_event': 'IMPRESSIONS', 'optimization_goal': 'OFFSITE_CONVERSIONS',
            'daily_min_spend_target': '2000',
            'promoted_object': json.dumps({'pixel_id': PIXEL, 'custom_event_type': 'PURCHASE'}),
            'targeting': targeting})
        if 'id' not in aset:
            print(f'  {label} Set {s} ADSET ERR: {errmsg(aset)}'); continue
        asid = aset['id']; set_ids.append(asid); cnt = 0
        for ci, cr in enumerate(CREATIVES, 1):
            ad = post(f'{ACT}/ads', {
                'name': f'{label} S{s} ad{ci}', 'adset_id': asid,
                'creative': json.dumps({'creative_id': cr}), 'status': 'ACTIVE'})
            if 'id' in ad: cnt += 1
            else: print(f'    ad err (creative {cr}): {errmsg(ad)}')
            time.sleep(0.4)
        print(f'  {label} Set {s} ({asid}): {cnt}/5 ads')
    summary.append((label, cid, len(set_ids)))

print('\n=== SUMMARY ===')
for label, cid, nsets in summary:
    print(f'{label}: campaign {cid}, {nsets} ad sets')
