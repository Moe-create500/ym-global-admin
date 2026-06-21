import json, urllib.request, urllib.parse, os
TOK = os.environ['TOK']; API = 'https://graph.facebook.com/v24.0'
CAMP = '120251551454610547'
EXPECT_PAGE = '1190438270813259'; EXPECT_LINK = 'https://liposhopper.com/products/lipo-magnesium-8-1-skinny-mix'
EXPECT_PIXEL = '1027610363157741'
def g(path, params=None):
    params = dict(params or {}); params['access_token'] = TOK
    return json.load(urllib.request.urlopen(f'{API}/{path}?' + urllib.parse.urlencode(params)))
issues = []
c = g(CAMP, {'fields': 'name,status,objective,daily_budget,bid_strategy,adsets.fields(name,status,promoted_object,targeting,ads.fields(id,name,status,effective_status,creative))'})
print(f"CAMPAIGN: {c['name']} | {c['status']} | {c['objective']} | CBO ${int(c.get('daily_budget',0))/100}/day")
if c['status'] != 'PAUSED': issues.append(f"campaign is {c['status']} (expected PAUSED)")
if int(c.get('daily_budget', 0)) != 10000: issues.append("budget != $100")
total = 0
for a in c.get('adsets', {}).get('data', []):
    ads = a.get('ads', {}).get('data', []); total += len(ads)
    t = a.get('targeting', {}); po = a.get('promoted_object', {})
    print(f"  {a['name']}: {a['status']} | geo={t.get('geo_locations',{}).get('countries')} | px={po.get('pixel_id')}/{po.get('custom_event_type')} | {len(ads)} ads")
    if po.get('pixel_id') != EXPECT_PIXEL: issues.append(f"{a['name']}: wrong pixel")
    for ad in ads:
        cr = g(ad['creative']['id'], {'fields': 'object_story_spec'})
        vd = cr.get('object_story_spec', {}).get('video_data', {})
        page = cr.get('object_story_spec', {}).get('page_id')
        link = vd.get('call_to_action', {}).get('value', {}).get('link')
        ok = (page == EXPECT_PAGE and link == EXPECT_LINK and vd.get('video_id'))
        print(f"    {ad['name']}: {ad['status']}/{ad.get('effective_status')} | page={'LIPO' if page==EXPECT_PAGE else page} | link={'OK' if link==EXPECT_LINK else link} | {'OK' if ok else 'CHECK'}")
        if page != EXPECT_PAGE: issues.append(f"{ad['name']}: page {page} != LIPO")
        if link != EXPECT_LINK: issues.append(f"{ad['name']}: link {link}")
print(f"total ads: {total}")
if total != 5: issues.append(f"{total} ads (expected 5)")
print('\nISSUES:', 'none — all correct' if not issues else '\n  ✗ ' + '\n  ✗ '.join(issues))
