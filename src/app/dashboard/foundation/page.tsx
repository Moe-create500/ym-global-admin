'use client';

import { useState, useEffect, useCallback } from 'react';

const fmt = (c: number) => `$${(Math.abs(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt0 = (c: number) => `$${Math.round(Math.abs(c || 0) / 100).toLocaleString()}`;

const STATE_CHIP: Record<string, string> = {
  fresh: 'bg-emerald-500/15 text-emerald-400',
  aging: 'bg-amber-500/10 text-amber-400',
  stale: 'bg-red-500/15 text-red-400',
  failing: 'bg-red-500/20 text-red-300',
  never: 'bg-slate-700/60 text-slate-400',
};

const th = 'text-left text-[10px] uppercase tracking-wider text-slate-500 px-3 py-2';
const thR = 'text-right text-[10px] uppercase tracking-wider text-slate-500 px-3 py-2';
const td = 'px-3 py-1.5';

function CompanyCard({ label, c }: { label: string; c: any }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex-1 min-w-[260px]">
      <p className="text-[10px] uppercase tracking-widest text-slate-500">{label}</p>
      <p className="text-3xl font-bold text-white mt-1">{fmt0(c.usableCents)}</p>
      <p className="text-[11px] text-slate-500">usable now — {c.accounts} accounts</p>
      <div className="mt-2 space-y-0.5 text-[11px]">
        <p className="flex justify-between text-slate-400"><span>cash available</span><span className="tabular-nums text-slate-200">{fmt(c.cashCents)}</span></p>
        <p className="flex justify-between text-slate-400"><span>pending out (14d)</span><span className="tabular-nums text-orange-300">−{fmt(c.pendingOutCents)}</span></p>
        <p className="flex justify-between text-slate-400"><span>payments in flight</span><span className="tabular-nums text-orange-300">−{fmt(c.inFlightCents)}</span></p>
        <p className="flex justify-between text-slate-500 pt-1 border-t border-slate-800"><span>cards owed (info)</span><span className="tabular-nums">{fmt(c.cardsOwedCents)}</span></p>
      </div>
      {c.staleAccounts?.length > 0 && (
        <p className="mt-2 text-[10px] text-red-400" title={c.staleAccounts.map((s: any) => `${s.name} ·${s.last4} — data ends ${s.asOf}`).join('\n')}>
          ⚠ {c.staleAccounts.length} account{c.staleAccounts.length > 1 ? 's' : ''} with stale data — this number is a guess until reconnected
        </p>
      )}
    </div>
  );
}

export default function FoundationPage() {
  const [data, setData] = useState<any>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'recon' | 'interco' | 'identity' | 'sources'>('recon');

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/foundation?days=${days}`).then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [days]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="p-8 text-slate-400 text-sm">{loading ? 'Loading the ground floor…' : 'Failed to load.'}</div>;

  const { cash, trust, recon, interco, identity } = data;

  return (
    <div className="p-6 max-w-[1400px]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-white">🏛 Foundation</h1>
          <p className="text-xs text-slate-400">Cash truth per company · every dollar explained · brands ↔ ShipSourced tracked as real debt</p>
        </div>
        <button onClick={load} className="text-xs bg-slate-800 border border-slate-700 hover:border-blue-500 text-slate-300 rounded-lg px-3 py-1.5">↻ refresh</button>
      </div>

      {/* ── The 30-second ritual: cash now + can I trust today's data ── */}
      <div className="flex flex-wrap gap-3 mb-3">
        <CompanyCard label="YM Global Ventures" c={cash.ymgv} />
        <CompanyCard label="ShipSourced" c={cash.shipsourced} />
        <div className={`rounded-xl p-4 flex-1 min-w-[260px] border ${trust.trustworthy ? 'bg-emerald-950/30 border-emerald-800/50' : 'bg-red-950/30 border-red-800/50'}`}>
          <p className="text-[10px] uppercase tracking-widest text-slate-500">Data trust today</p>
          <p className={`text-3xl font-bold mt-1 ${trust.trustworthy ? 'text-emerald-400' : 'text-red-400'}`}>
            {trust.trustworthy ? 'TRUSTED' : `${trust.badCount} FEED${trust.badCount > 1 ? 'S' : ''} BAD`}
          </p>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{trust.summary}</p>
          {!trust.trustworthy && <p className="text-[10px] text-slate-500 mt-1">numbers driven by a stale feed are guesses — fix the feed before trusting them</p>}
        </div>
      </div>

      {/* ── Headline: the unexplained remainder ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 mb-4 flex flex-wrap items-center gap-x-8 gap-y-1">
        <div>
          <span className="text-[10px] uppercase tracking-widest text-slate-500 mr-3">Bank ↔ books · last {recon.days}d</span>
          <span className="text-white font-bold">{recon.explainedPct}% explained</span>
          <span className="text-slate-500 text-xs ml-2">of {fmt0(recon.totalMovedCents)} moved</span>
        </div>
        <div className={`font-bold ${recon.totalUnexplainedCents > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
          {recon.totalUnexplainedCents > 0 ? `${fmt(recon.totalUnexplainedCents)} UNEXPLAINED` : 'every dollar explained ✓'}
        </div>
        <select value={days} onChange={e => setDays(Number(e.target.value))}
          className="ml-auto bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1">
          <option value={7}>7 days</option><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option>
        </select>
      </div>

      <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 w-fit mb-3">
        {([['recon', '💵 Unexplained money'], ['interco', '🔁 Brands ↔ ShipSourced'], ['identity', '🪪 Identity map'], ['sources', '📡 Feeds']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`text-xs rounded-md px-3 py-1.5 font-medium ${tab === k ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>{l}</button>
        ))}
      </div>

      {tab === 'recon' && (
        <div className="space-y-3">
          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <p className="px-3 py-2 text-[11px] font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800">Per account — worst first</p>
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-slate-800">
                <th className={th}>ACCOUNT</th><th className={th}>CO</th><th className={thR}>MOVED</th><th className={thR}>EXPLAINED</th><th className={thR}>UNEXPLAINED</th><th className={thR}>%</th>
              </tr></thead>
              <tbody>
                {recon.perAccount.map((a: any) => (
                  <tr key={a.id} className="border-b border-slate-800/50">
                    <td className={`${td} text-slate-200`}>{a.institution_name} {String(a.account_name).slice(0, 28)} <span className="text-slate-600">·{a.last_four}</span></td>
                    <td className={`${td} text-slate-500 uppercase text-[10px]`}>{a.company === 'shipsourced' ? 'SS' : 'YM'}</td>
                    <td className={`${td} text-right text-slate-300 tabular-nums`}>{fmt(a.moved_cents)}</td>
                    <td className={`${td} text-right text-emerald-300 tabular-nums`}>{fmt(a.explained_cents)}</td>
                    <td className={`${td} text-right tabular-nums font-medium ${a.unexplained_cents > 0 ? 'text-amber-400' : 'text-slate-600'}`}>{a.unexplained_cents > 0 ? fmt(a.unexplained_cents) : '—'}</td>
                    <td className={`${td} text-right ${a.explained_pct >= 90 ? 'text-emerald-400' : a.explained_pct >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{a.explained_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <p className="px-3 py-2 text-[11px] font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800">
              Unexplained transactions — newest first <span className="text-slate-500 normal-case font-normal">· assign them on the Transactions ledger</span>
            </p>
            {recon.unexplained.length === 0 ? <p className="px-3 py-4 text-xs text-emerald-400">nothing unexplained in this window ✓</p> : (
              <table className="w-full text-[12px]">
                <tbody>
                  {recon.unexplained.map((t: any) => (
                    <tr key={t.id} className="border-b border-slate-800/40">
                      <td className={`${td} text-slate-500 whitespace-nowrap`}>{t.date}</td>
                      <td className={`${td} text-slate-400`}>{t.account} <span className="text-slate-600">·{t.last_four}</span></td>
                      <td className={`${td} text-slate-300 max-w-[380px] truncate`} title={t.description}>{t.description}</td>
                      <td className={`${td} text-right tabular-nums font-medium ${t.amount_cents < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{t.amount_cents < 0 ? '−' : '+'}{fmt(t.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'interco' && (
        <div className="space-y-3">
          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <p className="px-3 py-2 text-[11px] font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800">
              What each brand owes ShipSourced — real debt · total <span className="text-white">{fmt(interco.totalOwedCents)}</span>
            </p>
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-slate-800">
                <th className={th}>BRAND</th><th className={thR}>SS BILLED</th><th className={thR}>PAID</th><th className={thR}>OWES SS</th>
              </tr></thead>
              <tbody>
                {interco.brands.map((b: any) => (
                  <tr key={b.id} className="border-b border-slate-800/50">
                    <td className={`${td} text-slate-200`}>{b.name}</td>
                    <td className={`${td} text-right text-slate-300 tabular-nums`}>{fmt(b.billed)}</td>
                    <td className={`${td} text-right text-emerald-300 tabular-nums`}>{fmt(b.paid)}</td>
                    <td className={`${td} text-right tabular-nums font-bold ${b.owed > 0 ? 'text-amber-400' : 'text-slate-500'}`}>{b.owed > 0 ? fmt(b.owed) : b.owed < 0 ? `credit ${fmt(b.owed)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <p className="px-3 py-2 text-[11px] font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800">
              Transfers between our own accounts (last 60d) — {interco.interCompanyTransfers.length} crossed the company line ({fmt(interco.interCompanyPaidCents)})
            </p>
            {interco.transfers.length === 0 ? <p className="px-3 py-4 text-xs text-slate-500">no own-account transfer pairs detected in the window</p> : (
              <table className="w-full text-[12px]">
                <tbody>
                  {interco.transfers.map((p: any, i: number) => (
                    <tr key={i} className="border-b border-slate-800/40">
                      <td className={`${td} text-slate-500 whitespace-nowrap`}>{p.date}</td>
                      <td className={`${td} text-slate-300`}>{p.from} <span className="text-slate-600">({p.fromCompany === 'shipsourced' ? 'SS' : 'YM'})</span></td>
                      <td className={`${td} text-slate-500`}>→</td>
                      <td className={`${td} text-slate-300`}>{p.to} <span className="text-slate-600">({p.toCompany === 'shipsourced' ? 'SS' : 'YM'})</span></td>
                      <td className={`${td} text-right tabular-nums text-white`}>{fmt(p.cents)}</td>
                      <td className={`${td} text-[10px]`}>{p.crossCompany ? <span className="text-blue-400 font-semibold">INTER-COMPANY</span> : <span className="text-slate-600">internal</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'identity' && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <p className="px-3 py-2 text-[11px] font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800">
            One row per store — every external ID it owns. Gaps = money that can&apos;t attribute.
          </p>
          <table className="w-full text-[11px]">
            <thead><tr className="border-b border-slate-800">
              <th className={th}>STORE</th><th className={th}>SS CLIENT</th><th className={th}>SHOPIFY</th><th className={th}>FB ADS</th><th className={th}>FUNDING CARDS</th><th className={th}>BANKS</th><th className={th}>GAPS</th>
            </tr></thead>
            <tbody>
              {identity.map((s: any) => (
                <tr key={s.storeId} className={`border-b border-slate-800/50 ${!s.isActive ? 'opacity-40' : ''}`}>
                  <td className={`${td} text-slate-200 font-medium whitespace-nowrap`}>{s.name}</td>
                  <td className={`${td} ${s.ss_client.length ? 'text-emerald-400' : 'text-slate-700'}`}>{s.ss_client.length ? `✓ ${s.ss_client.length}` : '—'}</td>
                  <td className={`${td} text-slate-400 max-w-[140px] truncate`}>{s.shopify_domain.map((d: any) => d.id).join(', ') || <span className="text-slate-700">—</span>}</td>
                  <td className={`${td} ${s.fb_ad_account.length || s.fb_profile.length ? 'text-emerald-400' : 'text-slate-700'}`}>{s.fb_ad_account.length ? `act ×${s.fb_ad_account.length}` : s.fb_profile.length ? `profile ×${s.fb_profile.length}` : '—'}</td>
                  <td className={`${td} text-slate-300`}>{s.funding_card.map((c: any) => `·${c.id}`).join(' ') || <span className="text-slate-700">—</span>}</td>
                  <td className={`${td} ${s.bank_account.length ? 'text-emerald-400' : 'text-slate-700'}`}>{s.bank_account.length ? `✓ ${s.bank_account.length}` : '—'}</td>
                  <td className={`${td} text-amber-400 max-w-[260px]`}>{s.gaps.join(' · ') || <span className="text-emerald-500">complete</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'sources' && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <p className="px-3 py-2 text-[11px] font-semibold text-slate-300 uppercase tracking-wider border-b border-slate-800">
            Every feed the numbers depend on — silence is treated as failure, not success
          </p>
          <table className="w-full text-[12px]">
            <thead><tr className="border-b border-slate-800">
              <th className={th}>FEED</th><th className={th}>STATE</th><th className={thR}>LAST SUCCESS</th><th className={thR}>CADENCE</th><th className={th}>LAST ERROR</th>
            </tr></thead>
            <tbody>
              {trust.sources.map((s: any) => (
                <tr key={s.id} className="border-b border-slate-800/50">
                  <td className={`${td} text-slate-200`}>{s.label || s.id}</td>
                  <td className={td}><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATE_CHIP[s.state]}`}>{s.state.toUpperCase()}</span></td>
                  <td className={`${td} text-right text-slate-400 tabular-nums`}>{s.mins_since_success != null ? (s.mins_since_success < 60 ? `${s.mins_since_success}m ago` : `${Math.round(s.mins_since_success / 60)}h ago`) : 'never'}</td>
                  <td className={`${td} text-right text-slate-500`}>{s.expected_cadence_min}m</td>
                  <td className={`${td} text-red-400/80 max-w-[300px] truncate`} title={s.last_error || ''}>{s.last_error || ''}</td>
                </tr>
              ))}
              {trust.sources.length === 0 && <tr><td className={`${td} text-slate-500`} colSpan={5}>no feeds have reported yet — they register as each sync runs</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
