// Theme-level setup for launched products:
//  1. a clean `product.launch` template — the store's main product section
//    (gallery + buy box) only, with custom-liquid junk dropped and none of the
//    old-product content sections that themes accumulate
//  2. the FB pixel installed in theme.liquid — many themes strip <script>
//    from product descriptions, so the lander embed alone isn't reliable
// Both are idempotent and non-destructive: the default template and other
// products are never touched.

import type Database from 'better-sqlite3';
import { shopifyGet, shopifyMutate } from '@/lib/shopify-sync';

async function getMainThemeId(db: Database.Database, storeId: string, now: number): Promise<number | null> {
  try {
    const d = await shopifyGet(db, storeId, 'themes.json', now);
    return (d.themes || []).find((t: any) => t.role === 'main')?.id || null;
  } catch { return null; }
}

async function getAsset(db: Database.Database, storeId: string, themeId: number, key: string, now: number): Promise<string | null> {
  try {
    const d = await shopifyGet(db, storeId, `themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(key)}`, now);
    return d?.asset?.value ?? null;
  } catch { return null; }
}

// Custom-liquid scrubbing is CONDITIONAL. Two theme classes exist:
//  · native themes (Revivon-class): real title/price/buy_buttons blocks, with
//    the OLD product's content hardcoded in custom-liquid blocks — scrub them
//    or launched products show the previous product's title/copy.
//  · composite themes (Horizon-class): everything renders through opaque
//    _product-* blocks — scrubbing removes the buy box entirely. Keep intact.
function collectBlockTypes(node: any, out: string[] = []): string[] {
  const blocks = node?.blocks;
  if (blocks && typeof blocks === 'object') {
    for (const b of Object.values<any>(blocks)) {
      out.push(String(b?.type || ''));
      collectBlockTypes(b, out);
    }
  }
  return out;
}

function dropCustomLiquid(node: any): number {
  let dropped = 0;
  const blocks = node?.blocks;
  if (blocks && typeof blocks === 'object') {
    for (const bid of Object.keys(blocks)) {
      dropped += dropCustomLiquid(blocks[bid]);
      if (/custom[-_]?liquid/i.test(String(blocks[bid]?.type || ''))) {
        delete blocks[bid];
        dropped++;
      }
    }
    if (Array.isArray(node.block_order)) node.block_order = node.block_order.filter((b: string) => blocks[b]);
  }
  return dropped;
}

/** Ensure templates/product.launch.json exists. Returns the template suffix to
 *  set on launched products, or null when the theme can't support it. */
export async function ensureCleanProductTemplate(db: Database.Database, storeId: string, now: number): Promise<{ suffix: string | null; note: string }> {
  const themeId = await getMainThemeId(db, storeId, now);
  if (!themeId) return { suffix: null, note: 'no main theme found' };
  if (await getAsset(db, storeId, themeId, 'templates/product.launch.json', now)) {
    return { suffix: 'launch', note: 'clean launch template already exists' };
  }
  const raw = await getAsset(db, storeId, themeId, 'templates/product.json', now);
  if (!raw) return { suffix: null, note: 'vintage theme (no JSON product template) — default template used' };
  let tpl: any;
  try { tpl = JSON.parse(raw); } catch { return { suffix: null, note: 'product.json unparseable — default template used' }; }
  const mainKey = (tpl.order || []).find((k: string) => k.toLowerCase().includes('main'))
    || Object.keys(tpl.sections || {}).find(k => String(tpl.sections[k]?.type || '').toLowerCase().includes('main'));
  if (!mainKey || !tpl.sections?.[mainKey]) return { suffix: null, note: 'could not identify the main product section' };
  const mainSec = JSON.parse(JSON.stringify(tpl.sections[mainKey]));
  const types = collectBlockTypes(mainSec);
  const hasNativeBlocks = types.includes('title') && types.some(t => /buy/.test(t));
  const dropped = hasNativeBlocks ? dropCustomLiquid(mainSec) : 0;
  const clean: any = { sections: { [mainKey]: mainSec }, order: [mainKey] };

  // Some themes (e.g. Horizon) never render {{ product.description }} in the
  // product template — the generated lander would be invisible. If the main
  // section has no description block, add a custom-liquid section that renders
  // it full-width below the buy box.
  let landerNote = '';
  const rendersDescription = /"type"\s*:\s*"[^"]*description[^"]*"/i.test(JSON.stringify(mainSec));
  if (!rendersDescription) {
    const clSection = await getAsset(db, storeId, themeId, 'sections/custom-liquid.liquid', now);
    if (clSection) {
      const settingId = (/"id"\s*:\s*"(custom_liquid|liquid|code)"/.exec(clSection) || [])[1] || 'custom_liquid';
      clean.sections.ym_lander = {
        type: 'custom-liquid',
        settings: { [settingId]: '<div class="page-width" style="padding:0 20px;">{{ product.description }}</div>' },
      };
      clean.order.push('ym_lander');
      landerNote = ', lander render section added (theme lacks a description block)';
    } else {
      landerNote = ', WARNING: theme has no description block and no custom-liquid section — lander may not render';
    }
  }

  await shopifyMutate(db, storeId, 'PUT', `themes/${themeId}/assets.json`, {
    asset: { key: 'templates/product.launch.json', value: JSON.stringify(clean, null, 2) },
  }, now);
  const excluded = (tpl.order || []).filter((k: string) => k !== mainKey).length;
  return { suffix: 'launch', note: `created launch template (${excluded} old sections excluded${dropped ? `, ${dropped} custom-liquid blocks dropped` : ''}${landerNote})` };
}

/** VERIFY the lander actually renders on the live page — block-type heuristics
 *  lie (a theme can define a description block it never renders). Fetches the
 *  page, looks for the lander marker in visible DOM (not inside <script>), and
 *  if missing, forces a custom-liquid render section into the launch template. */
export async function ensureLanderRenders(db: Database.Database, storeId: string, landingUrl: string, now: number): Promise<string> {
  const fetchPage = async (): Promise<string> => {
    try {
      const res = await fetch(`${landingUrl}${landingUrl.includes('?') ? '&' : '?'}v=${now}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      return res.ok ? await res.text() : '';
    } catch { return ''; }
  };
  const visible = (h: string): boolean => {
    const i = h.indexOf('id="ym-lander"');
    if (i < 0) return false;
    const before = h.slice(0, i);
    return before.lastIndexOf('<script') <= before.lastIndexOf('</script>');
  };
  if (visible(await fetchPage())) return 'lander verified visible on the live page';

  const themeId = await getMainThemeId(db, storeId, now);
  if (!themeId) return '⚠ lander NOT visible; no main theme to fix';
  const raw = await getAsset(db, storeId, themeId, 'templates/product.launch.json', now);
  if (!raw) return '⚠ lander NOT visible; product is not on the launch template (vintage theme?) — fix manually';
  let tpl: any;
  try { tpl = JSON.parse(raw); } catch { return '⚠ lander NOT visible; launch template unparseable'; }
  if (!tpl.sections?.ym_lander) {
    const clSection = await getAsset(db, storeId, themeId, 'sections/custom-liquid.liquid', now);
    if (!clSection) return '⚠ lander NOT visible; theme has no custom-liquid section — fix manually';
    const settingId = (/"id"\s*:\s*"(custom_liquid|liquid|code)"/.exec(clSection) || [])[1] || 'custom_liquid';
    tpl.sections.ym_lander = {
      type: 'custom-liquid',
      settings: { [settingId]: '<div class="page-width" style="padding:0 20px;">{{ product.description }}</div>' },
    };
    tpl.order = [...(tpl.order || []), 'ym_lander'];
    await shopifyMutate(db, storeId, 'PUT', `themes/${themeId}/assets.json`, {
      asset: { key: 'templates/product.launch.json', value: JSON.stringify(tpl, null, 2) },
    }, now);
  }
  await new Promise(r => setTimeout(r, 5000));
  return visible(await fetchPage())
    ? 'lander was invisible — render section added, now verified visible'
    : '⚠ render section added but lander still not visible — check the theme manually';
}

/** Install the FB pixel base code in theme.liquid so it fires on EVERY page.
 *  Skips if any pixel is already loaded there (no double PageViews). */
export async function ensurePixelInTheme(db: Database.Database, storeId: string, pixelId: string, now: number): Promise<string> {
  const themeId = await getMainThemeId(db, storeId, now);
  if (!themeId) return 'no main theme — pixel not installed in theme';
  const liquid = await getAsset(db, storeId, themeId, 'layout/theme.liquid', now);
  if (!liquid) return 'theme.liquid unreadable — pixel not installed in theme';
  if (liquid.includes(`'${pixelId}'`)) return 'pixel already installed in theme';
  if (liquid.includes('connect.facebook.net')) return 'theme already loads a pixel — left untouched';
  if (!liquid.includes('</head>')) return 'no </head> in theme.liquid — pixel not installed';
  const snippet = `\n<!-- ym-global pixel -->\n<script>\n!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');\nfbq('init', '${pixelId}');\nfbq('track', 'PageView');\n</script>\n<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1"/></noscript>\n<!-- /ym-global pixel -->\n`;
  await shopifyMutate(db, storeId, 'PUT', `themes/${themeId}/assets.json`, {
    asset: { key: 'layout/theme.liquid', value: liquid.replace('</head>', `${snippet}</head>`) },
  }, now);
  return 'pixel installed in theme.liquid — fires storewide';
}
