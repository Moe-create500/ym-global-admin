import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#030712] text-white">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 bg-[#030712]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-violet-600 rounded-lg flex items-center justify-center text-xs font-black">YM</div>
            <span className="text-sm font-bold tracking-tight">YM Global Ventures</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#about" className="text-xs text-slate-400 hover:text-white transition-colors">About</a>
            <a href="#services" className="text-xs text-slate-400 hover:text-white transition-colors">Services</a>
            <a href="#why" className="text-xs text-slate-400 hover:text-white transition-colors">Why Us</a>
            <a href="#contact" className="text-xs text-slate-400 hover:text-white transition-colors">Contact</a>
            <Link href="/login" className="px-4 py-2 bg-white/10 hover:bg-white/15 text-xs font-medium rounded-lg transition-colors border border-white/10">
              Portal
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full text-xs text-blue-400 mb-8">
            <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
            Acquiring & Scaling E-Commerce Brands
          </div>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-[1.1] mb-6">
            We Buy, Build &<br />
            <span className="bg-gradient-to-r from-blue-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
              Scale E-Commerce
            </span>
          </h1>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            YM Global Ventures is a holding company that acquires e-commerce stores and transforms them with
            institutional-grade finance, logistics, and 3PL infrastructure to unlock exponential growth.
          </p>
          <div className="flex items-center justify-center gap-4">
            <a href="#contact" className="px-8 py-3 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-blue-500/25">
              Partner With Us
            </a>
            <a href="#about" className="px-8 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium rounded-xl transition-colors">
              Learn More
            </a>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="py-12 border-y border-white/5">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
          {[
            { value: '7+', label: 'Brands Managed' },
            { value: '$20M+', label: 'Annual Revenue' },
            { value: '3PL', label: 'Fulfillment Network' },
            { value: '24/7', label: 'Operations' },
          ].map(stat => (
            <div key={stat.label}>
              <p className="text-3xl font-black bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">{stat.value}</p>
              <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* About */}
      <section id="about" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs text-blue-400 uppercase tracking-widest mb-3">About Us</p>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight">
              The Holding Company for<br />Modern E-Commerce
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-8">
              <h3 className="text-lg font-bold mb-3">Acquire</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                We identify high-potential e-commerce stores with strong product-market fit but underoptimized operations.
                Our acquisition process is fast, fair, and founder-friendly.
              </p>
            </div>
            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-8">
              <h3 className="text-lg font-bold mb-3">Systematize</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                We plug every brand into our centralized finance, operations, and logistics stack.
                Real-time P&L, automated fulfillment, and CFO-level reporting from day one.
              </p>
            </div>
            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-8">
              <h3 className="text-lg font-bold mb-3">Fulfill</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Our 3PL network handles pick, pack, and ship at scale. Domestic and international fulfillment
                with real-time tracking, cost optimization, and per-SKU billing transparency.
              </p>
            </div>
            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-8">
              <h3 className="text-lg font-bold mb-3">Scale</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                With operations locked in, we pour fuel on growth. Paid ads, creative testing, new product lines,
                and expansion into new channels. Every dollar is tracked, every decision is data-driven.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      <section id="services" className="py-24 px-6 bg-white/[0.01]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs text-violet-400 uppercase tracking-widest mb-3">What We Do</p>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight">End-to-End Infrastructure</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z', title: 'CFO-Level Finance', desc: 'Real-time P&L, balance sheets, cash flow tracking, and automated cost allocation across every brand.' },
              { icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', title: '3PL Fulfillment', desc: 'US and China warehousing, per-SKU cost tracking, and integrated shipping through our ShipSourced platform.' },
              { icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6', title: 'Growth & Ads', desc: 'Facebook, TikTok, and Google ad management with creative testing, ROAS tracking, and automated reporting.' },
              { icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z', title: 'Payment Operations', desc: 'Multi-card management, invoice tracking, Shopify billing reconciliation, and chargeback management.' },
              { icon: 'M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21', title: 'Banking Integration', desc: 'Connected bank accounts via Teller, transaction categorization, and automated cash flow analysis.' },
              { icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', title: 'Chargeback Defense', desc: 'Chargeflow integration for automated dispute management with win rate tracking and P&L impact analysis.' },
            ].map(service => (
              <div key={service.title} className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-colors">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500/20 to-violet-500/20 rounded-xl flex items-center justify-center mb-4">
                  <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={service.icon} />
                  </svg>
                </div>
                <h3 className="text-sm font-bold mb-2">{service.title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{service.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Us */}
      <section id="why" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs text-emerald-400 uppercase tracking-widest mb-3">Why YM Global</p>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight">
              Built by Operators,<br />for Operators
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { title: 'Operator-First', desc: "We don't just invest — we operate. Every brand gets hands-on management with the same tools and systems we use to run our own stores." },
              { title: 'Full Stack', desc: 'Finance, fulfillment, ads, and tech under one roof. No fragmented vendors, no finger-pointing. One team, one P&L, one mission.' },
              { title: 'Founder-Friendly', desc: "Selling your store doesn't mean losing your vision. We keep what works, fix what doesn't, and scale what matters. Clean exits, fair deals." },
            ].map(item => (
              <div key={item.title} className="text-center">
                <div className="w-12 h-12 bg-gradient-to-br from-emerald-500/20 to-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <div className="w-2 h-2 bg-emerald-400 rounded-full" />
                </div>
                <h3 className="text-sm font-bold mb-2">{item.title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA / Contact */}
      <section id="contact" className="py-24 px-6 bg-gradient-to-b from-transparent via-blue-950/20 to-transparent">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight mb-4">
            Ready to Scale or Exit?
          </h2>
          <p className="text-sm text-slate-400 mb-8 max-w-xl mx-auto leading-relaxed">
            Whether you're looking to sell your e-commerce store or partner with a team that can take it to the next level,
            we'd love to talk.
          </p>
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-8 max-w-md mx-auto">
            <div className="space-y-4">
              <a href="mailto:info@ymglobalventures.com"
                className="flex items-center justify-center gap-3 w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-blue-500/25">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                info@ymglobalventures.com
              </a>
              <p className="text-[10px] text-slate-600 uppercase tracking-wider">Or reach out directly</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="px-4 py-3 bg-white/[0.03] border border-white/5 rounded-xl text-center">
                  <p className="text-[10px] text-slate-500 uppercase">Based in</p>
                  <p className="text-xs text-white font-medium mt-0.5">United States</p>
                </div>
                <div className="px-4 py-3 bg-white/[0.03] border border-white/5 rounded-xl text-center">
                  <p className="text-[10px] text-slate-500 uppercase">Structure</p>
                  <p className="text-xs text-white font-medium mt-0.5">LLC Holding Co.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-white/5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-violet-600 rounded-md flex items-center justify-center text-[8px] font-black">YM</div>
            <span className="text-xs text-slate-500">YM Global Enterprise Ventures LLC</span>
          </div>
          <p className="text-[10px] text-slate-600">&copy; {new Date().getFullYear()} All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
