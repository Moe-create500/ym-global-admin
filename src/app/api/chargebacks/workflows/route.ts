import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// GET /api/chargebacks/workflows → response playbooks with usage + outcome stats
export async function GET() {
  const db = getDb();
  const workflows = db.prepare(`
    SELECT w.*,
      COUNT(c.id) as used_count,
      SUM(CASE WHEN c.status = 'won' THEN 1 ELSE 0 END) as won_count,
      SUM(CASE WHEN c.status = 'lost' THEN 1 ELSE 0 END) as lost_count
    FROM cb_response_workflows w
    LEFT JOIN chargebacks c ON c.response_workflow_id = w.id
    GROUP BY w.id
    ORDER BY w.created_at ASC
  `).all();
  return NextResponse.json({ workflows });
}

export async function POST(req: NextRequest) {
  const { name, description } = await req.json();
  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO cb_response_workflows (id, name, description) VALUES (?, ?, ?)')
    .run(id, String(name).trim(), description || null);
  return NextResponse.json({ success: true, id });
}

export async function PATCH(req: NextRequest) {
  const { id, name, description, isActive, templateJson, matchReasons } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  if (name !== undefined) { sets.push('name = ?'); vals.push(String(name).trim()); }
  if (description !== undefined) { sets.push('description = ?'); vals.push(description); }
  if (isActive !== undefined) { sets.push('is_active = ?'); vals.push(isActive ? 1 : 0); }
  if (templateJson !== undefined) {
    sets.push('template_json = ?');
    vals.push(templateJson == null ? null : (typeof templateJson === 'string' ? templateJson : JSON.stringify(templateJson)));
  }
  if (matchReasons !== undefined) {
    sets.push('match_reasons = ?');
    vals.push(matchReasons == null ? null : (typeof matchReasons === 'string' ? matchReasons : JSON.stringify(matchReasons)));
  }
  if (!sets.length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

  vals.push(id);
  db.prepare(`UPDATE cb_response_workflows SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = getDb();
  const used: any = db.prepare('SELECT COUNT(*) as n FROM chargebacks WHERE response_workflow_id = ?').get(id);
  if (used.n > 0) {
    // Preserve history — deactivate instead of deleting a playbook with outcomes
    db.prepare('UPDATE cb_response_workflows SET is_active = 0 WHERE id = ?').run(id);
    return NextResponse.json({ success: true, deactivated: true });
  }
  db.prepare('DELETE FROM cb_response_workflows WHERE id = ?').run(id);
  return NextResponse.json({ success: true });
}
