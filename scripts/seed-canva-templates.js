// Run on server: node scripts/seed-canva-templates.js
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'prisma', 'dev.db'));

// Clear old seeded templates
db.exec("DELETE FROM creative_templates WHERE type = 'image'");

const templates = [
  // === BENEFIT / FEATURE LAYOUTS ===
  { file: '1.png', name: 'Hook + 3 Benefits + Reviews', desc: 'Bold hook text top, 3 benefit icons in a row, star reviews + product image bottom', category: 'benefits' },
  { file: '2.png', name: 'Hero Image + 4 Benefits', desc: 'Large hero/lifestyle image top half, hook text center, 4 benefits with icons and descriptions below, small product image bottom', category: 'benefits' },
  { file: '3.png', name: 'Split — Image Left, 4 Benefits Right', desc: 'Large lifestyle image left half, 4 vertical benefits with icons on the right, product image bottom-right', category: 'benefits' },
  { file: '4.png', name: 'Hook + Image Left, 4 Benefits Right', desc: 'Bold hook text top, large image left, 4 benefit icons stacked right, product bottom', category: 'benefits' },
  { file: '16.png', name: '4 Benefits Grid + CTA', desc: 'Hook text top, 4 product benefits in a 2x2 grid with lines connecting to center product, CTA at bottom', category: 'benefits' },
  { file: '22.png', name: 'Ingredient Breakdown Zigzag', desc: 'Hook text top, 4 ingredients with benefits in alternating zigzag pill shapes, CTA bottom', category: 'benefits' },

  // === PRODUCT SPOTLIGHT ===
  { file: '7.png', name: 'Sale Pouch — 35% Off', desc: 'Discount text top, large "SALE" repeated background, product pouch center, CTA button bottom', category: 'sale' },
  { file: '8.png', name: 'Dark Product + Benefits Bar', desc: 'Black background, 3 benefit labels top bar, product image right side, bold hook text bottom-left, tagline + urgency text', category: 'spotlight' },
  { file: '10.png', name: 'Hook + Product + 2 Benefits + CTA', desc: 'Bold hook text top, product pouch center with 2 benefit callout bubbles, CTA button bottom', category: 'spotlight' },
  { file: '13.png', name: '3 Things Product Does', desc: 'Italic headline "3 things your product does for this problem", product half-visible right, 3 benefit lines with dots pointing to product', category: 'spotlight' },
  { file: '14.png', name: 'Product Anatomy — 4 Callouts', desc: 'Hook text top, full product center, 4 benefit callouts with lines pointing to different parts of the product', category: 'spotlight' },
  { file: '15.png', name: 'Pedestal Product — 3 Benefits', desc: 'Adjective headline top, product on wooden pedestal with plant leaves, 3 benefit arrows with icons, Shop Now CTA', category: 'spotlight' },
  { file: '19.png', name: 'Trust Data Not Labels', desc: 'Hand holding pill + hand holding bottle, "Trust Data Not Labels" split text, benefit callouts pointing to product', category: 'spotlight' },
  { file: '20.png', name: 'Pill + Bottle Blank Canvas', desc: 'Clean photo of hands with pill and white bottle, no text overlay — use as base image', category: 'photo' },
  { file: '21.png', name: 'Product Circle — 5 Benefits', desc: 'Product bottle on grass background, 5 benefits circling around the product, CTA bottom', category: 'spotlight' },

  // === HOOK + PRODUCT + TEXT ===
  { file: '9.png', name: 'Dark Bold Hook + Benefits + Tagline', desc: 'Black background, 3 benefits top bar, large product image right, massive bold hook text bottom-left, tagline + urgency', category: 'hook' },
  { file: '11.png', name: 'Phone Sale Mock — IG Post', desc: 'Phone showing Instagram post of product, "SALE" repeated text background, BUY NOW CTA', category: 'sale' },
  { file: '12.png', name: 'Lifestyle Hair — Hook + Tagline', desc: 'Blurred lifestyle hair photo background, bold hook text overlay left, tagline below, star reviews bottom', category: 'lifestyle' },
  { file: '17.png', name: 'Real Product Example — Benefit Arrows', desc: 'E45 moisturizer product photo with hook text, 3 benefit arrows pointing at product, LEARN MORE CTA', category: 'spotlight' },
  { file: '18.png', name: 'Problem Solver — Skincare Collection', desc: '"How your product solves this problem" headline, 3 problem-solved lines, collection of skincare products below, LEARN MORE CTA', category: 'benefits' },
  { file: '26.png', name: 'Real Product — Benefits + Coffee', desc: 'Real product photo (collagen burn + coffee), hook headline top, 3 benefit callouts right side, Try Today CTA', category: 'lifestyle' },
  { file: '27.png', name: 'Serum Blur — Hook + 3 Benefits + Reviews', desc: 'Blurred serum/oil bottle background, bold hook text, subtext, 3 benefit pills, star reviews, LEARN MORE CTA', category: 'hook' },

  // === COMPARISON / VS ===
  { file: '5.png', name: 'Before / After Split', desc: 'Two images side by side (before/after), product image center bottom, labels "Before" and "After"', category: 'comparison' },
  { file: '28.png', name: 'Problem vs Solution', desc: 'Split layout — left "THE PROBLEMS" with 3 problem icons, right "THE SOLUTION" with product + 5-star reviews', category: 'comparison' },
  { file: '29.png', name: 'Us vs Others — Benefits Checklist', desc: 'Product can vs crushed can, green check benefits left, red X negatives right, SHOP NOW CTA', category: 'comparison' },
  { file: '30.png', name: 'You Before / You After', desc: 'Before image with red X negatives vs After image with green check positives, star reviews + SHOP NOW CTA', category: 'comparison' },
  { file: '31.png', name: 'Toggle Switch — Negative to Positive', desc: 'Hook text top, product image left, red toggle negatives switching to green toggle positives, SHOP NOW CTA', category: 'comparison' },
  { file: '34.png', name: 'Them vs Us — Split Image', desc: 'Split image (bad vs good banana metaphor), THEM label left, US label right, negative vs positive, CTA', category: 'comparison' },

  // === LIST / CHECKLIST ===
  { file: '32.png', name: 'Say Goodbye To — Red X List', desc: '"Say goodbye to" header, 5 negatives with red X icons in black pills, product image area, SHOP NOW CTA', category: 'checklist' },
  { file: '33.png', name: 'Say Hello To — Green Check List', desc: '"Say hello to" header, 5 positives with green check icons in black pills, product image area, SHOP NOW CTA', category: 'checklist' },

  // === SOCIAL PROOF / MEME ===
  { file: '6.png', name: 'UGC Landscape Strip', desc: 'Two landscape images with product description text strip in the middle, product thumbnail bottom-left', category: 'lifestyle' },
  { file: '35.png', name: 'How It Started vs How Its Going', desc: 'Social media post style with profile pic + handle, two side-by-side transformation images', category: 'meme' },
  { file: '36.png', name: 'Me Realizing Meme Post', desc: 'Social media post format — "me realising I need this product to get main result", reaction image below', category: 'meme' },
  { file: '37.png', name: 'Review Card — Product on Wall', desc: 'Product image on a wall/shelf, reviewer name + 5 stars + review text card floating below', category: 'review' },
  { file: '38.png', name: 'Review Bubble — Serum Close-up', desc: 'Close-up serum/dropper photo, floating review bubble with avatar + stars + review text, LEARN MORE CTA', category: 'review' },
  { file: '39.png', name: 'Review Card — Polaroid Style', desc: 'Product photo in polaroid frame on fabric background, reviewer name + stars + review text below, LEARN MORE CTA', category: 'review' },
  { file: '40.png', name: 'Product Comparison Grid', desc: '"Which product will you choose?" 3 products in a comparison grid with 3 benefits each, LEARN MORE CTA', category: 'comparison' },

  // === CLEAN / MINIMAL ===
  { file: '25.png', name: 'Minimal Hook — Product Collection', desc: 'Simple hook text top, short tagline, product collection arranged below, SHOP NOW red button', category: 'minimal' },
  { file: '24.png', name: 'Lifestyle Flat Lay — Hook + CTA', desc: 'Sunglasses flat lay lifestyle photo, bold hook text bottom overlay, CTA text below', category: 'minimal' },
  { file: '23.png', name: 'Softgel Spoon — 3 Benefits', desc: 'Overhead photo of softgels on wooden spoon, 3 benefit labels as floating tags, Shop Now CTA', category: 'minimal' },

  // === PHONE MOCKUP / SOCIAL ===
  { file: '46.png', name: 'Phone Mockup — Hook + Tagline + Reviews', desc: 'Hook text top, tagline below, iPhone showing product image, star reviews bottom-right', category: 'phone' },

  // === REMAINING TEMPLATES (41-62, skipping 45 which doesn't exist) ===
  { file: '41.png', name: 'Template 41', desc: 'Canva ad template layout', category: 'other' },
  { file: '42.png', name: 'Template 42', desc: 'Canva ad template layout', category: 'other' },
  { file: '43.png', name: 'Template 43', desc: 'Canva ad template layout', category: 'other' },
  { file: '44.png', name: 'Template 44', desc: 'Canva ad template layout', category: 'other' },
  { file: '47.png', name: 'Template 47', desc: 'Canva ad template layout', category: 'other' },
  { file: '48.png', name: 'Template 48', desc: 'Canva ad template layout', category: 'other' },
  { file: '49.png', name: 'Template 49', desc: 'Canva ad template layout', category: 'other' },
  { file: '50.png', name: 'Template 50', desc: 'Canva ad template layout', category: 'other' },
  { file: '51.png', name: 'Template 51', desc: 'Canva ad template layout', category: 'other' },
  { file: '52.png', name: 'Template 52', desc: 'Canva ad template layout', category: 'other' },
  { file: '53.png', name: 'Template 53', desc: 'Canva ad template layout', category: 'other' },
  { file: '54.png', name: 'Template 54', desc: 'Canva ad template layout', category: 'other' },
  { file: '55.png', name: 'Template 55', desc: 'Canva ad template layout', category: 'other' },
  { file: '56.png', name: 'Template 56', desc: 'Canva ad template layout', category: 'other' },
  { file: '57.png', name: 'Template 57', desc: 'Canva ad template layout', category: 'other' },
  { file: '58.png', name: 'Template 58', desc: 'Canva ad template layout', category: 'other' },
  { file: '59.png', name: 'Template 59', desc: 'Canva ad template layout', category: 'other' },
  { file: '60.png', name: 'Template 60', desc: 'Canva ad template layout', category: 'other' },
  { file: '61.png', name: 'Template 61', desc: 'Canva ad template layout', category: 'other' },
  { file: '62.png', name: 'Template 62', desc: 'Canva ad template layout', category: 'other' },
];

const insert = db.prepare(`
  INSERT INTO creative_templates (id, name, description, type, template_data, thumbnail_url, is_active)
  VALUES (?, ?, ?, 'image', ?, ?, 1)
`);

let count = 0;
for (const t of templates) {
  const id = crypto.randomUUID();
  const data = JSON.stringify({
    category: t.category,
    preview_file: t.file,
    reference_description: t.desc,
  });
  const thumbnailUrl = `/api/static-ads/templates/preview/${t.file}`;
  insert.run(id, t.name, t.desc, data, thumbnailUrl);
  count++;
}

console.log(`Seeded ${count} templates`);
db.close();
