#!/usr/bin/env python3
"""List campaigns (status, budget, lifetime spend/ROAS) for an ad account given in $ACT."""
import json, urllib.request, urllib.parse, os
TOK = os.environ['TOK']; API = 'https://graph.facebook.com/v24.0'
ACT = os.environ['ACT']

def g(path, params=None):
    params = dict(params or {}); params['access_token'] = TOK
    return json.load(urllib.request.urlopen(f'{API}/{path}?' + urllib.parse.urlencode(params)))

acct = g(ACT, {'fields': 'name,account_status,amount_spent,currency,balance'})
print(f"ACCOUNT: {acct.get('name')} ({ACT}) | status={acct.get('account_status')} | lifetime_spent=${int(acct.get('amount_spent',0))/100:,.0f} {acct.get('currency','')}")
print('=' * 70)

camps = g(f'{ACT}/campaigns', {'fields': 'id,name,status,effective_status,objective,daily_budget,lifetime_budget', 'limit': '100'})
rows = camps.get('data', [])
if not rows:
    print('No campaigns.'); raise SystemExit
# lifetime spend per campaign
for c in sorted(rows, key=lambda x: 0 if x.get('effective_status') == 'ACTIVE' else 1):
    ins = g(f"{c['id']}/insights", {'fields': 'spend,purchase_roas', 'date_preset': 'maximum'}).get('data', [])
    spend = float(ins[0]['spend']) if ins else 0
    roas = float(ins[0].get('purchase_roas', [{}])[0].get('value', 0)) if ins and ins[0].get('purchase_roas') else 0
    bud = int(c.get('daily_budget', 0)) / 100 if c.get('daily_budget') else (int(c.get('lifetime_budget', 0)) / 100 if c.get('lifetime_budget') else 0)
    btype = 'CBO' if c.get('daily_budget') or c.get('lifetime_budget') else 'ABO'
    mark = '  <<< ACTIVE' if c.get('effective_status') == 'ACTIVE' else ''
    print(f"{c.get('effective_status',''):<14} {c.get('objective','')[:14]:<14} {btype} ${bud:>6}/d  spend=${spend:>8,.0f}  ROAS={roas:>4.2f}  {c['name'][:40]}{mark}")
