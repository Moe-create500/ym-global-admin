#!/usr/bin/env python3
"""Find the active SINO9 campaign and rank its ads by lifetime performance."""
import json, urllib.request, urllib.parse, os
TOK = os.environ['TOK']; API = 'https://graph.facebook.com/v24.0'
ACT = 'act_1245466530397577'

def g(path, params=None):
    params = dict(params or {}); params['access_token'] = TOK
    return json.load(urllib.request.urlopen(f'{API}/{path}?' + urllib.parse.urlencode(params)))

camps = g(f'{ACT}/campaigns', {'fields': 'id,name,status,effective_status,objective,daily_budget', 'limit': '80'})
print('=== CAMPAIGNS ON SINO9 ===')
active = []
for c in camps.get('data', []):
    es = c.get('effective_status')
    mark = '  <<< ACTIVE' if es == 'ACTIVE' else ''
    bud = int(c.get('daily_budget', 0)) / 100 if c.get('daily_budget') else 0
    print(f"{es:<22} {c.get('objective','')[:18]:<18} ${bud:>6}/d  {c['name'][:46]}{mark}")
    if es == 'ACTIVE':
        active.append(c)

print()
for c in active:
    print(f"=== BEST ADS in ACTIVE campaign: {c['name']} ({c['id']}) ===")
    ins = g(f"{c['id']}/insights", {
        'level': 'ad', 'fields': 'ad_id,ad_name,spend,impressions,clicks,actions,action_values,purchase_roas',
        'date_preset': 'maximum', 'limit': '200'})
    rows = []
    for r in ins.get('data', []):
        p = v = 0.0
        for a in r.get('actions', []):
            if a['action_type'] == 'purchase': p = int(a['value'])
        for a in r.get('action_values', []):
            if a['action_type'] == 'purchase': v = float(a['value'])
        roas = float(r.get('purchase_roas', [{}])[0].get('value', 0)) if r.get('purchase_roas') else 0
        rows.append((r['ad_id'], r.get('ad_name', ''), float(r.get('spend', 0)), int(r.get('impressions', 0)), p, v, roas))
    # rank by revenue desc, then purchases
    rows.sort(key=lambda x: (-x[5], -x[4], -x[2]))
    print(f"{'AD ID':<20}{'NAME':<26}{'SPEND':>10}{'PURCH':>6}{'REV':>10}{'ROAS':>7}")
    for ad_id, nm, s, im, p, v, roas in rows[:20]:
        print(f"{ad_id:<20}{nm[:26]:<26}{('$'+format(s,'.0f')):>10}{p:>6}{('$'+format(v,'.0f')):>10}{roas:>7.2f}")
    print(f"... {len(rows)} ads total in this campaign")
