// Recurring launch schedules — "every day at 12:00 PST" / "every Monday at 09:00".
//
// A schedule stores a full launch config; when due, the background loop
// (instrumentation.ts, 5-min tick) creates a workflow from it and runs it to
// completion server-side. auto_live schedules approve their own launch gate;
// others finish with everything built but PAUSED.

import type Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createLaunchWorkflow, runWorkflowToCompletion, retryWorkflow } from '@/lib/launch-workflow';

/** Identifies the running build — a deploy resets auto-retry budgets, because
 *  new code deserves a fresh chance at runs the old code failed. */
function currentBuildId(): string {
  try { return fs.readFileSync(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim(); } catch { return 'dev'; }
}

const TZ = 'America/Los_Angeles';

export function ensureScheduleTable(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS workflow_schedules (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    name TEXT NOT NULL,
    config_json TEXT NOT NULL,
    cadence TEXT NOT NULL,            -- 'daily' | 'weekly'
    time_of_day TEXT NOT NULL,        -- 'HH:MM' in America/Los_Angeles
    day_of_week INTEGER,              -- 0=Sun..6=Sat, weekly only
    auto_live INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    last_result TEXT,
    next_run_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
}

/** UTC instant of an LA wall time (two-pass DST-safe conversion). */
function laWallTimeToUTC(ymd: string, hm: string): Date {
  let guess = new Date(`${ymd}T${hm}:00Z`);
  for (let i = 0; i < 2; i++) {
    const laStr = guess.toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T');
    const diff = new Date(`${ymd}T${hm}:00Z`).getTime() - new Date(`${laStr}Z`).getTime();
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

/** Next occurrence (ISO UTC) of cadence+time in LA, strictly after `after`. */
export function computeNextRun(cadence: string, timeOfDay: string, dayOfWeek: number | null, after = new Date()): string {
  for (let i = 0; i <= 8; i++) {
    const candidate = new Date(after.getTime() + i * 86_400_000);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
      .formatToParts(candidate);
    const ymd = `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find(p => p.type === 'weekday')!.value);
    if (cadence === 'weekly' && wd !== (dayOfWeek ?? 1)) continue;
    const at = laWallTimeToUTC(ymd, timeOfDay);
    if (at.getTime() > after.getTime()) return at.toISOString();
  }
  // Fallback (should be unreachable): tomorrow same time
  return new Date(after.getTime() + 86_400_000).toISOString();
}

export function createSchedule(db: Database.Database, s: {
  storeId: string; productId: string; name: string; config: any;
  cadence: 'daily' | 'weekly'; timeOfDay: string; dayOfWeek?: number; autoLive: boolean;
}): any {
  ensureScheduleTable(db);
  if (!/^\d{2}:\d{2}$/.test(s.timeOfDay)) throw new Error('timeOfDay must be HH:MM');
  const id = crypto.randomUUID();
  const nextRun = computeNextRun(s.cadence, s.timeOfDay, s.dayOfWeek ?? null);
  db.prepare(`INSERT INTO workflow_schedules (id, store_id, product_id, name, config_json, cadence, time_of_day, day_of_week, auto_live, next_run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, s.storeId, s.productId, s.name, JSON.stringify(s.config), s.cadence, s.timeOfDay,
      s.cadence === 'weekly' ? (s.dayOfWeek ?? 1) : null, s.autoLive ? 1 : 0, nextRun);
  return db.prepare('SELECT * FROM workflow_schedules WHERE id = ?').get(id);
}

/** Drive to completion, absorbing transient failures: on error, wait and retry
 *  the failed steps (only those — done work is never redone) up to 2 times.
 *  One flaky FB/OpenAI call must not kill an unattended nightly launch. */
async function runToCompletionWithRetries(db: Database.Database, wfId: string, autoLive: boolean) {
  let wf = await runWorkflowToCompletion(db, wfId, { autoApproveLaunchGate: autoLive });
  for (let attempt = 1; attempt <= 2 && wf.status === 'error'; attempt++) {
    console.warn(`[launch-schedule] workflow ${wfId} errored (${(wf.error || '').slice(0, 120)}) — retry ${attempt}/2 in 60s`);
    await new Promise(r => setTimeout(r, 60_000));
    retryWorkflow(db, wfId);
    wf = await runWorkflowToCompletion(db, wfId, { autoApproveLaunchGate: autoLive });
  }
  return wf;
}

/** Run every due active schedule. Called by the 5-min background tick. */
export async function runDueSchedules(db: Database.Database): Promise<{ ran: number; errors: string[] }> {
  ensureScheduleTable(db);
  const nowIso = new Date().toISOString();
  const due: any[] = db.prepare('SELECT * FROM workflow_schedules WHERE is_active = 1 AND next_run_at <= ?').all(nowIso);
  let ran = 0;
  const errors: string[] = [];

  for (const s of due) {
    // Compute the NEXT run first — even a crash mid-run must not double-fire
    const nextRun = computeNextRun(s.cadence, s.time_of_day, s.day_of_week);
    db.prepare('UPDATE workflow_schedules SET next_run_at = ?, last_run_at = ? WHERE id = ?').run(nextRun, nowIso, s.id);

    try {
      const config = JSON.parse(s.config_json);
      config.launchStatus = s.auto_live ? 'ACTIVE' : 'PAUSED';
      config.campaignName = undefined; // fresh dated name per run
      config.audienceId = null;        // every run gets a NEW Fable 5 audience
      config.scheduledRun = true;      // tag: lets the tick resume us after a process restart
      // Pre-flight: skip the run entirely if the token can't reach the ad
      // account — otherwise every tick burns a full image batch then dies
      // at the ad-set step (VV incident 2026-08-10)
      if (config.profileId) {
        const prof: any = db.prepare('SELECT profile_name, ad_account_id, access_token FROM fb_profiles WHERE id = ?').get(config.profileId);
        if (prof?.ad_account_id && prof?.access_token) {
          const acct = prof.ad_account_id.startsWith('act_') ? prof.ad_account_id : `act_${prof.ad_account_id}`;
          const chk = await fetch(`https://graph.facebook.com/v24.0/${acct}?fields=account_status&access_token=${encodeURIComponent(prof.access_token)}`)
            .then(r => r.json()).catch(() => null);
          if (!chk || chk.error) {
            throw new Error(`ad account ${prof.profile_name} (${acct}) unreachable with connected token — fix Business Manager assignment. FB: ${(chk?.error?.message || 'no response').slice(0, 120)}`);
          }
        }
      }
      const wf = createLaunchWorkflow(db, s.store_id, s.product_id, config);
      console.log(`[launch-schedule] "${s.name}" fired → workflow ${wf.id} (${s.auto_live ? 'AUTO-LIVE' : 'paused'})`);
      const done = await runToCompletionWithRetries(db, wf.id, !!s.auto_live);
      const summary = `${done.status} — ${done.steps.filter((x: any) => x.status === 'done').length}/${done.steps.length} steps${done.error ? ` · ${done.error.slice(0, 150)}` : ''}`;
      db.prepare('UPDATE workflow_schedules SET last_result = ? WHERE id = ?').run(summary, s.id);
      console.log(`[launch-schedule] "${s.name}" → ${summary}`);
      ran++;
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 200);
      db.prepare('UPDATE workflow_schedules SET last_result = ? WHERE id = ?').run(`failed to start: ${msg}`, s.id);
      errors.push(`${s.name}: ${msg}`);
      console.error(`[launch-schedule] "${s.name}" failed:`, msg);
    }
  }

  // Self-healing for ALL runs (scheduled AND browser-started — launches are
  // fully autonomous):
  //  · 'running' but silent 15+ min → nobody is driving (restart, closed tab):
  //    resume to completion. Live runs persist after every step/image, so 15
  //    minutes of silence means dead, not slow.
  //  · 'error' and untouched 5+ min → auto-retry the failed steps, max 2 times
  //    per workflow (tracked in result_json._autoRetries) so a genuinely
  //    broken config can't retry-loop forever.
  // Age guard: never resurrect runs older than 48h — a stale config going
  // live days later is worse than a dead run.
  const build = currentBuildId();
  const candidates: { id: string; name: string; action: string; newCount?: number }[] = [];
  const stuck: any[] = db.prepare(`
    SELECT id, name FROM ad_workflows
    WHERE status = 'running' AND updated_at < datetime('now', '-15 minutes')
      AND created_at > datetime('now', '-48 hours')
    ORDER BY updated_at ASC LIMIT 3
  `).all();
  for (const s of stuck) candidates.push({ ...s, action: 'resume' });
  const errored: any[] = db.prepare(`
    SELECT id, name, result_json FROM ad_workflows
    WHERE status = 'error' AND updated_at < datetime('now', '-5 minutes')
      AND created_at > datetime('now', '-48 hours')
    ORDER BY updated_at ASC LIMIT 6
  `).all();
  for (const e of errored) {
    let r: any = {};
    try { r = JSON.parse(e.result_json || '{}'); } catch {}
    // A deploy resets the budget: if the last auto-retry ran on an older
    // build, the failing code may be FIXED — try again with fresh attempts.
    const count = r._autoRetryBuild === build ? (r._autoRetries || 0) : 0;
    if (count >= 2) continue;
    candidates.push({ id: e.id, name: e.name, action: 'retry', newCount: count + 1 });
  }
  for (const o of candidates.slice(0, 4)) {
    try {
      if (o.action === 'retry') {
        db.prepare(`UPDATE ad_workflows SET result_json =
          json_set(json_set(result_json, '$._autoRetries', ?), '$._autoRetryBuild', ?) WHERE id = ?`)
          .run(o.newCount, build, o.id);
        retryWorkflow(db, o.id);
      }
      console.warn(`[launch-schedule] ${o.action === 'retry' ? `auto-retrying errored (attempt ${o.newCount}/2 on build ${build})` : 'resuming orphaned'} run "${o.name}" (${o.id})`);
      const done = await runToCompletionWithRetries(db, o.id, true);
      console.log(`[launch-schedule] ${o.action} "${o.name}" → ${done.status}`);
      ran++;
    } catch (e: any) {
      errors.push(`${o.action} ${o.name}: ${String(e?.message || e).slice(0, 150)}`);
    }
  }
  return { ran, errors };
}
