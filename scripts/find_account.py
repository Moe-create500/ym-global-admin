#!/usr/bin/env python3
import json
d = json.load(open('/tmp/allaccts.json'))
if 'error' in d:
    print('ERR:', d['error']['message']); raise SystemExit
accts = d.get('data', [])
print(f'{len(accts)} ad accounts accessible:\n')
kw = ('ship', 'sourced', '3pl')
hits = []
for a in accts:
    nm = a.get('name', '')
    is_hit = any(k in nm.lower() for k in kw)
    if is_hit: hits.append(a)
    flag = '   <<< MATCH' if is_hit else ''
    print(f"  act_{a.get('account_id',''):<18} status={a.get('account_status')} spent=${int(a.get('amount_spent',0))/100:>10,.0f}  {nm}{flag}")
print('\n--- ShipSourced matches ---')
print('\n'.join(f"  act_{h['account_id']}  {h['name']}" for h in hits) if hits else '  none found by name')
