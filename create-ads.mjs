import fs from 'fs';

const token = fs.readFileSync('/tmp/fb_token.txt', 'utf8').trim();
const acct = 'act_1245466530397577';
const pageId = '874373115755446';
const adSetId = '120240320118370218';

const ads = [
  { hash: '6074b1c71cd5539a26bd66ed877e1b18', name: 'Summer Sale Beach' },
  { hash: '3caa1c9bd03cef91623d9bf634fd2b9f', name: 'Summer Glow Beach' },
  { hash: 'eff01fd974779d89f6ccbdc554007dd1', name: 'POV Glow Routine' },
  { hash: 'b734b052dc643d3136485d6d39c8e76f', name: 'Beauty Bundle Elegant' },
  { hash: 'f2a78e09b258a6e14c3bbdf66d4ede2b', name: 'Beauty Bundle Model' },
];

const adCopy = `Summer is the perfect time to refresh your wellness routine.

The PureBite\u2122 Beauty Bundle combines carefully selected supplements designed to support your everyday beauty routine \u2014 including nutrients commonly used for hair, skin, and overall glow support.

For a limited time, enjoy our Early Summer Beauty Sale and save 50% OFF the bundle.

Stock up during this limited-time offer while supplies last.

Shop now:
shoppurebite.com`;

const headline = 'PureBite\u2122 Beauty Bundle \u2014 50% OFF';

for (let i = 0; i < ads.length; i++) {
  const ad = ads[i];
  console.log('[' + (i + 1) + '/5] Creating: ' + ad.name);

  const spec = {
    page_id: pageId,
    link_data: {
      image_hash: ad.hash,
      link: 'https://shoppurebite.com',
      message: adCopy,
      name: headline,
      call_to_action: { type: 'SHOP_NOW' },
    },
  };

  const creativeParams = new URLSearchParams();
  creativeParams.append('name', ad.name + ' - Creative');
  creativeParams.append('object_story_spec', JSON.stringify(spec));
  creativeParams.append('access_token', token);

  const cRes = await fetch('https://graph.facebook.com/v24.0/' + acct + '/adcreatives', {
    method: 'POST',
    body: creativeParams,
  });
  const cData = await cRes.json();

  if (cData.error) {
    console.log('  Creative ERROR: ' + cData.error.message);
    continue;
  }
  console.log('  Creative: ' + cData.id);

  const adParams = new URLSearchParams();
  adParams.append('name', ad.name);
  adParams.append('adset_id', adSetId);
  adParams.append('creative', JSON.stringify({ creative_id: cData.id }));
  adParams.append('status', 'PAUSED');
  adParams.append('access_token', token);

  const aRes = await fetch('https://graph.facebook.com/v24.0/' + acct + '/ads', {
    method: 'POST',
    body: adParams,
  });
  const aData = await aRes.json();

  if (aData.error) {
    console.log('  Ad ERROR: ' + aData.error.message);
    continue;
  }
  console.log('  Ad: ' + aData.id);
  console.log('');
}

console.log('Done! All 5 ads created as PAUSED in BROAD 3/26 ad set.');
