#!/usr/bin/env python3
"""Enumerate all businesses + their owned/client ad accounts to find a ShipSourced account."""
import json, urllib.request, urllib.parse, os
TOK = os.environ['TOK']; API = 'https://graph.facebook.com/v24.0'

def g(path, params=None):
    params = dict(params or {}); params['access_token'] = TOK
    try:
        return json.load(urllib.request.urlopen(f'{API}/{path}?' + urllib.parse.urlencode(params)))
    except urllib.error.HTTPError as e:
        try: return {'error': json.loads(e.read().decode()).get('error', {}).get('message')}
        except Exception: return {'error': 'http ' + str(e.code)}

biz = g('me/businesses', {'fields': 'id,name', 'limit': '100'}).get('data', [])
print(f'{len(biz)} businesses:')
all_accts = []
for b in biz:
    print(f"\n=== {b['name']} ({b['id']}) ===")
    for ep in ['owned_ad_accounts', 'client_ad_accounts']:
        r = g(f"{b['id']}/{ep}", {'fields': 'account_id,name,amount_spent', 'limit': '200'})
        if 'error' in r:
            print(f"  {ep}: {r['error'][:60]}"); continue
        for a in r.get('data', []):
            nm = a.get('name', '')
            all_accts.append((a.get('account_id'), nm, b['name']))
            mark = '  <<< MATCH' if any(k in nm.lower() for k in ('ship', 'sourced', '3pl')) else ''
            print(f"  [{ep[:5]}] act_{a.get('account_id'):<18} ${int(a.get('amount_spent',0))/100:>9,.0f}  {nm}{mark}")

print('\n=== ShipSourced matches across all businesses ===')
hits = [a for a in all_accts if any(k in (a[1] or '').lower() for k in ('ship', 'sourced', '3pl'))]
print('\n'.join(f"  act_{h[0]}  {h[1]}  (biz: {h[2]})" for h in hits) if hits else '  NONE found by name')
