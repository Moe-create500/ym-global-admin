// Pre-built long-form lander skeleton, modeled on top-converting supplement
// landers (Eloix-style): benefit grid → reported-outcomes checklist → 3-phase
// "journey" story → story-style testimonials → guarantee → FAQ. The HTML lives
// HERE in the repo so generation is near-instant: Fable 5 only writes the copy
// (small JSON) and we pour it in. Inline styles only (goes into a Shopify
// product body_html), mobile-first, max 760px centered.

export interface LanderCopy {
  headline: string;                                            // hero, benefit-led
  subhead: string;
  whyTitle: string;                                            // e.g. "Why Our Berberine Works Better."
  benefits: { icon: string; title: string; text: string }[];   // 5 cards
  outcomesTitle: string;                                       // e.g. "What Consistent Support Can Look Like"
  outcomes: string[];                                          // 4 reported-outcome lines
  journeyTitle: string;                                        // e.g. "Your Journey Ahead"
  journey: { title: string; text: string }[];                  // 3 emotive phases
  quotes: { headline: string; text: string; name: string }[];  // 3 story testimonials
  guaranteeTitle: string;
  guaranteeText: string;
  faqs: { q: string; a: string }[];                            // 5
}

const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const F = 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;';
const H2 = `font-size:26px;font-weight:800;margin:44px 0 8px;text-align:center;letter-spacing:-0.4px;color:#111;${F}`;

export function renderLander(copy: LanderCopy): string {
  const benefits = (copy.benefits || []).slice(0, 5).map(b => `
    <div style="background:#f7f7f5;border-radius:16px;padding:20px;display:flex;gap:14px;align-items:flex-start;">
      <div style="font-size:26px;line-height:1;min-width:32px;">${esc(b.icon)}</div>
      <div><p style="font-weight:800;font-size:16px;margin:0 0 4px;color:#111;">${esc(b.title)}</p>
      <p style="font-size:14px;color:#4b4b4b;margin:0;line-height:1.55;">${esc(b.text)}</p></div>
    </div>`).join('');

  const outcomes = (copy.outcomes || []).slice(0, 4).map(o => `
    <div style="display:flex;gap:12px;align-items:flex-start;background:#f2f8f3;border:1px solid #d8ecdc;border-radius:12px;padding:14px 16px;">
      <span style="color:#2e9e4f;font-weight:900;font-size:16px;">✓</span>
      <p style="font-size:14.5px;font-weight:600;color:#1d3a26;margin:0;line-height:1.5;">${esc(o)}</p>
    </div>`).join('');

  const journey = (copy.journey || []).slice(0, 3).map((j, i) => `
    <div style="border-left:3px solid #111;padding:2px 0 2px 18px;margin:18px 0;">
      <p style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#999;margin:0 0 4px;">Phase ${i + 1}</p>
      <p style="font-weight:800;font-size:17px;color:#111;margin:0 0 6px;">${esc(j.title)}</p>
      <p style="font-size:14.5px;color:#4b4b4b;margin:0;line-height:1.65;">${esc(j.text)}</p>
    </div>`).join('');

  const quotes = (copy.quotes || []).slice(0, 3).map(q => `
    <div style="background:#fafafa;border-radius:16px;padding:22px;margin:12px 0;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
      <p style="color:#f5a623;font-size:14px;letter-spacing:2.5px;margin:0 0 8px;">★★★★★</p>
      <p style="font-weight:800;font-size:15.5px;color:#111;margin:0 0 8px;">&ldquo;${esc(q.headline)}&rdquo;</p>
      <p style="font-size:14px;color:#4b4b4b;margin:0 0 10px;line-height:1.6;">${esc(q.text)}</p>
      <p style="font-size:13px;font-weight:700;color:#8a8a8a;margin:0;">— ${esc(q.name)} <span style="color:#2e9e4f;font-weight:600;">✓ Verified Buyer</span></p>
    </div>`).join('');

  const faqs = (copy.faqs || []).slice(0, 5).map(f => `
    <details style="background:#f7f7f5;border-radius:12px;padding:15px 18px;margin:8px 0;">
      <summary style="font-weight:700;font-size:15px;cursor:pointer;color:#111;">${esc(f.q)}</summary>
      <p style="font-size:14px;color:#4b4b4b;margin:10px 0 0;line-height:1.6;">${esc(f.a)}</p>
    </details>`).join('');

  return `
<div id="ym-lander" style="max-width:760px;margin:0 auto;${F}color:#1a1a1a;line-height:1.6;">

  <div style="text-align:center;margin:30px 0 6px;">
    <h2 style="font-size:32px;font-weight:900;margin:0 0 10px;letter-spacing:-0.6px;color:#111;">${esc(copy.headline)}</h2>
    <p style="font-size:16.5px;color:#555;margin:0 auto;max-width:560px;">${esc(copy.subhead)}</p>
  </div>

  <div style="display:flex;justify-content:center;gap:18px;flex-wrap:wrap;margin:22px 0 8px;padding:14px 0;border-top:1px solid #eee;border-bottom:1px solid #eee;">
    <span style="font-size:12.5px;font-weight:700;color:#444;">🚚 Fast Shipping</span>
    <span style="font-size:12.5px;font-weight:700;color:#444;">🛡️ ${esc(copy.guaranteeTitle)}</span>
    <span style="font-size:12.5px;font-weight:700;color:#444;">🔒 Secure Checkout</span>
  </div>

  <h2 style="${H2}">${esc(copy.whyTitle)}</h2>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:16px;">
    ${benefits}
  </div>

  <h2 style="${H2}">${esc(copy.outcomesTitle)}</h2>
  <div style="display:grid;gap:10px;margin-top:14px;">
    ${outcomes}
  </div>

  <h2 style="${H2}">${esc(copy.journeyTitle)}</h2>
  ${journey}

  <h2 style="${H2}">Customer Testimonials</h2>
  ${quotes}

  <div style="background:#eef8f0;border:1.5px solid #bfe5c8;border-radius:18px;padding:28px;margin:36px 0;text-align:center;">
    <p style="font-size:34px;margin:0 0 8px;">🛡️</p>
    <p style="font-weight:900;font-size:19px;margin:0 0 8px;color:#111;">${esc(copy.guaranteeTitle)}</p>
    <p style="font-size:14.5px;color:#3d5244;margin:0 auto;max-width:480px;line-height:1.6;">${esc(copy.guaranteeText)}</p>
  </div>

  <h2 style="${H2}">Frequently Asked Questions</h2>
  ${faqs}
</div>`;
}
