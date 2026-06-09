import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const employeeId = searchParams.get('employeeId');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const db = getDb();

  let where = 'WHERE 1=1';
  const params: any[] = [];
  if (employeeId) { where += ' AND t.employee_id = ?'; params.push(employeeId); }
  if (from) { where += ' AND t.clock_in >= ?'; params.push(from); }
  if (to) { where += ' AND t.clock_in <= ?'; params.push(to + 'T23:59:59'); }

  const entries = db.prepare(`
    SELECT t.*, e.name as employee_name, e.hourly_rate_cents
    FROM time_entries t
    JOIN employees e ON e.id = t.employee_id
    ${where}
    ORDER BY t.clock_in DESC
    LIMIT 500
  `).all(...params);

  // Active clocks (clocked in but not out)
  const activeClocks = db.prepare(`
    SELECT t.*, e.name as employee_name
    FROM time_entries t
    JOIN employees e ON e.id = t.employee_id
    WHERE t.clock_out IS NULL
    ORDER BY t.clock_in DESC
  `).all();

  // Per-employee summary for the date range
  const summary = db.prepare(`
    SELECT t.employee_id, e.name as employee_name, e.hourly_rate_cents,
      SUM(t.hours) as total_hours,
      COUNT(*) as shift_count,
      SUM(CASE WHEN t.hours IS NOT NULL THEN ROUND(t.hours * e.hourly_rate_cents) ELSE 0 END) as total_pay_cents
    FROM time_entries t
    JOIN employees e ON e.id = t.employee_id
    ${where} AND t.clock_out IS NOT NULL
    GROUP BY t.employee_id
    ORDER BY total_hours DESC
  `).all(...params);

  return NextResponse.json({ entries, activeClocks, summary });
}

// Clock in
export async function POST(req: NextRequest) {
  const { employeeId, note } = await req.json();

  if (!employeeId) {
    return NextResponse.json({ error: 'employeeId is required' }, { status: 400 });
  }

  const db = getDb();

  // Check if already clocked in
  const active: any = db.prepare(
    'SELECT id FROM time_entries WHERE employee_id = ? AND clock_out IS NULL'
  ).get(employeeId);
  if (active) {
    return NextResponse.json({ error: 'Already clocked in' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO time_entries (id, employee_id, clock_in, note) VALUES (?, ?, ?, ?)'
  ).run(id, employeeId, now, note || null);

  return NextResponse.json({ success: true, id, clockIn: now });
}

// Clock out
export async function PATCH(req: NextRequest) {
  const { employeeId, note } = await req.json();

  if (!employeeId) {
    return NextResponse.json({ error: 'employeeId is required' }, { status: 400 });
  }

  const db = getDb();

  const active: any = db.prepare(
    'SELECT id, clock_in FROM time_entries WHERE employee_id = ? AND clock_out IS NULL'
  ).get(employeeId);
  if (!active) {
    return NextResponse.json({ error: 'Not clocked in' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const clockIn = new Date(active.clock_in);
  const clockOut = new Date(now);
  const hours = Math.round(((clockOut.getTime() - clockIn.getTime()) / 3600000) * 100) / 100;

  db.prepare(
    'UPDATE time_entries SET clock_out = ?, hours = ?, note = COALESCE(?, note) WHERE id = ?'
  ).run(now, hours, note || null, active.id);

  return NextResponse.json({ success: true, hours, clockOut: now });
}

// Delete / edit entry
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  db.prepare('DELETE FROM time_entries WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}

// PUT: manual entry or edit
export async function PUT(req: NextRequest) {
  const { id, employeeId, clockIn, clockOut, note, hourlyRateCents } = await req.json();

  const db = getDb();

  // Update hourly rate
  if (employeeId && hourlyRateCents !== undefined) {
    db.prepare('UPDATE employees SET hourly_rate_cents = ? WHERE id = ?').run(hourlyRateCents, employeeId);
    return NextResponse.json({ success: true });
  }

  // Manual time entry
  if (employeeId && clockIn && clockOut) {
    const hours = Math.round(((new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 3600000) * 100) / 100;
    const entryId = id || crypto.randomUUID();

    if (id) {
      db.prepare('UPDATE time_entries SET clock_in = ?, clock_out = ?, hours = ?, note = ? WHERE id = ?')
        .run(clockIn, clockOut, hours, note || null, id);
    } else {
      db.prepare('INSERT INTO time_entries (id, employee_id, clock_in, clock_out, hours, note) VALUES (?, ?, ?, ?, ?, ?)')
        .run(entryId, employeeId, clockIn, clockOut, hours, note || null);
    }
    return NextResponse.json({ success: true, id: entryId, hours });
  }

  return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
}
