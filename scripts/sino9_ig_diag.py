#!/usr/bin/env python3
import json, urllib.request, urllib.parse, os
TOK = os.environ['TOK']; API = 'https://graph.facebook.com/v24.0'
ACT = 'act_1245466530397577'
OLD_PAGE = '874373115755446'      # PureBite (works)
NEW_PAGE = '1174991802365239'     # PureBite Supplements (IG error)

def g(path, params=None):
    params = dict(params or {}); params['access_token'] = TOK
    try:
        return json.load(urllib.request.urlopen(f'{API}/{path}?' + urllib.parse.urlencode(params)))
    except urllib.error.HTTPError as e:
        try: return {'error': json.loads(e.read().decode()).get('error', {}).get('message')}
        except Exception: return {'error': 'http ' + str(e.code)}

acct = g(ACT, {'fields': 'name,business'})
print('SINO9 ad account business:', acct.get('business'))
for label, pid in [('OLD PureBite', OLD_PAGE), ('NEW PureBite Supplements', pid := NEW_PAGE)]:
    p = g(pid, {'fields': 'name,connected_instagram_account,instagram_business_account'})
    print(f"{label} ({pid}):", json.dumps(p))
# what IG accounts can this ad account promote?
print('ad account promotable IG:', json.dumps(g(f'{ACT}/instagram_accounts', {'fields': 'id,username'})))
print('ad account connected page-backed IG via OLD page:', json.dumps(g(f'{OLD_PAGE}/page_backed_instagram_accounts', {'fields': 'id'})))
