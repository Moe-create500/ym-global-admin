#!/usr/bin/env python3
"""Create MagSkinny pixel (business-level + assign to account) and a paused Sales campaign
shell on the Aurevia ad account."""
import json, urllib.request, urllib.parse, os
TOK = os.environ['TOK']; API = 'https://graph.facebook.com/v24.0'
ACT = 'act_2448686872317500'      # Aurevia (Aurvia profile)
BIZ = '1137621311226896'          # Zonara business

def post(path, params):
    params = dict(params); params['access_token'] = TOK
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request(f'{API}/{path}', data=urllib.parse.urlencode(params).encode())))
    except urllib.error.HTTPError as e:
        try: return {'error': json.loads(e.read().decode()).get('error', {})}
        except Exception: return {'error': {'message': 'http ' + str(e.code)}}

def g(path, params=None):
    params = dict(params or {}); params['access_token'] = TOK
    return json.load(urllib.request.urlopen(f'{API}/{path}?' + urllib.parse.urlencode(params)))

def em(r): return r.get('error', {}).get('error_user_msg') or r.get('error', {}).get('message') or json.dumps(r)[:200]

# 1. Pixel at business level
px = post(f'{BIZ}/adspixels', {'name': 'MagSkinny'})
pid = px.get('id')
print('PIXEL MagSkinny ->', pid or 'ERR: ' + em(px))

# 2. Assign pixel to the ad account
if pid:
    a = post(f'{pid}/shared_accounts', {'business': BIZ, 'account_id': ACT.replace('act_', '')})
    print('  assign to ad account:', a.get('success') and 'OK' or em(a))

# 3. Sales campaign shell (PAUSED, ABO/no-budget — convertible to CBO when budget is given)
camp = post(f'{ACT}/campaigns', {
    'name': 'MAGSKINNY | Sales - 6/17', 'objective': 'OUTCOME_SALES', 'status': 'PAUSED',
    'special_ad_categories': '[]', 'is_adset_budget_sharing_enabled': 'false'})
print('CAMPAIGN ->', camp.get('id') or 'ERR: ' + em(camp))

# 4. Verify pixel shows on the account
if pid:
    pics = g(f'{ACT}/adspixels', {'fields': 'id,name'})
    on = any(p['id'] == pid for p in pics.get('data', []))
    print('pixel visible on ad account:', 'YES' if on else 'NO (may need a moment)')
