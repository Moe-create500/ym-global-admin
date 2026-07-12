// Recurring launch schedules — "every day at 12:00 PST" / "every Monday at 09:00".
//
// A schedule stores a full launch config; when due, the background loop
// (instrumentation.ts, 5-min tick) creates a workflow from it and runs it to
// completion server-side. auto_live schedules approve their own launch gate;
// others finish with everything built but PAUSED.

import type Database from 'better-sqlite3';
import crypto from 'crypto';
import { createLaunchWorkflow, runWorkflowToCompletion } from '@/lib/launch-workflow';

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
      const wf = createLaunchWorkflow(db, s.store_id, s.product_id, config);
      console.log(`[launch-schedule] "${s.name}" fired → workflow ${wf.id} (${s.auto_live ? 'AUTO-LIVE' : 'paused'})`);
      const done = await runWorkflowToCompletion(db, wf.id, { autoApproveLaunchGate: !!s.auto_live });
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
  return { ran, errors };
}
