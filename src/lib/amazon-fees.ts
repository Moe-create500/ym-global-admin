/**
 * Amazon referral-fee engine (Sellerboard-style).
 *
 * Amazon charges a **referral fee per item** = max($0.30, category% × item sale price),
 * where the % can depend on the item's price (tiers) and the product's category. This mirrors
 * how Sellerboard computes marketplace fees per product, rather than one blanket % on the order.
 *
 * RATES: US schedule, current as of 2025. Amazon revises these periodically — verify against
 * Seller Central "Referral fees" and adjust here. Keep this file the single source of truth.
 */

export interface FeeTier { maxCents?: number; pct: number } // maxCents undefined = catch-all top tier

// Per-category tiers. First tier whose maxCents >= price wins; last tier is the catch-all.
export const REFERRAL_SCHEDULE: Record<string, FeeTier[]> = {
  health_personal_care:   [{ maxCents: 1000, pct: 8 }, { pct: 15 }], // 8% ≤ $10, else 15%
  beauty:                 [{ maxCents: 1000, pct: 8 }, { pct: 15 }],
  supplements:            [{ pct: 15 }],                              // dietary supplements: 15%
  grocery:                [{ maxCents: 1500, pct: 8 }, { pct: 15 }], // 8% ≤ $15, else 15%
  home_kitchen:           [{ pct: 15 }],
  pet_supplies:           [{ pct: 15 }],
  sports_outdoors:        [{ pct: 15 }],
  toys_games:             [{ pct: 15 }],
  baby:                   [{ maxCents: 1000, pct: 8 }, { pct: 15 }],
  clothing:               [{ pct: 17 }],
  shoes_handbags:         [{ pct: 15 }],
  electronics:            [{ pct: 8 }],
  electronics_accessories:[{ maxCents: 10000, pct: 15 }, { pct: 8 }],
  automotive:             [{ pct: 12 }],
  tools_home_improvement: [{ pct: 15 }],
  books:                  [{ pct: 15 }],
  furniture:              [{ maxCents: 20000, pct: 15 }, { pct: 10 }],
  jewelry:                [{ maxCents: 25000, pct: 20 }, { pct: 5 }],
  default:                [{ pct: 15 }],
};

export const MIN_REFERRAL_CENTS = 30; // Amazon minimum referral fee: $0.30 per item
export const EBAY_FEE_PCT = 13.25;    // eBay final value fee (incl. payment processing)

// Dropdown options for the UI (label shows the effective rate so it's self-documenting).
export const AMAZON_CATEGORIES: { value: string; label: string }[] = [
  { value: 'health_personal_care', label: 'Health & Personal Care (8% ≤$10, else 15%)' },
  { value: 'beauty', label: 'Beauty (8% ≤$10, else 15%)' },
  { value: 'supplements', label: 'Dietary Supplements (15%)' },
  { value: 'grocery', label: 'Grocery & Gourmet (8% ≤$15, else 15%)' },
  { value: 'home_kitchen', label: 'Home & Kitchen (15%)' },
  { value: 'pet_supplies', label: 'Pet Supplies (15%)' },
  { value: 'sports_outdoors', label: 'Sports & Outdoors (15%)' },
  { value: 'toys_games', label: 'Toys & Games (15%)' },
  { value: 'baby', label: 'Baby (8% ≤$10, else 15%)' },
  { value: 'clothing', label: 'Clothing & Accessories (17%)' },
  { value: 'shoes_handbags', label: 'Shoes & Handbags (15%)' },
  { value: 'electronics', label: 'Consumer Electronics (8%)' },
  { value: 'electronics_accessories', label: 'Electronics Accessories (15% ≤$100, else 8%)' },
  { value: 'automotive', label: 'Automotive & Powersports (12%)' },
  { value: 'tools_home_improvement', label: 'Tools & Home Improvement (15%)' },
  { value: 'furniture', label: 'Furniture (15% ≤$200, else 10%)' },
  { value: 'jewelry', label: 'Jewelry (20% ≤$250, else 5%)' },
  { value: 'default', label: 'Other / Default (15%)' },
];

export function isKnownCategory(c?: string | null): boolean {
  return !!c && Object.prototype.hasOwnProperty.call(REFERRAL_SCHEDULE, c);
}

/** Referral fee for ONE unit at the given sale price, in cents (incl. $0.30 minimum). */
export function referralFeePerUnit(category: string | null | undefined, unitPriceCents: number): number {
  const tiers = REFERRAL_SCHEDULE[(category && REFERRAL_SCHEDULE[category]) ? category : 'default'];
  let pct = tiers[tiers.length - 1].pct;
  for (const t of tiers) {
    if (t.maxCents === undefined || unitPriceCents <= t.maxCents) { pct = t.pct; break; }
  }
  return Math.max(MIN_REFERRAL_CENTS, Math.round(unitPriceCents * pct / 100));
}
