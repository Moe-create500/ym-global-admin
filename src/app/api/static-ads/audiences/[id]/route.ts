import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const db = getDb();

  const fields: string[] = [];
  const values: any[] = [];
  const allowed: Record<string, string> = {
    name: 'name', description: 'description', mindset: 'mindset', demographics: 'demographics',
    painPoints: 'pain_points', desires: 'desires', objections: 'objections', failedSolutions: 'failed_solutions',
  };
  const jsonFields = new Set(['painPoints', 'desires', 'objections', 'failedSolutions']);

  for (const [key, val] of Object.entries(body)) {
    const col = allowed[key];
    if (!col) continue;
    fields.push(`"${col}" = ?`);
    values.push(jsonFields.has(key) ? JSON.stringify(val) : val);
  }

  if (fields.length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });

  fields.push('"updated_at" = datetime(\'now\')');
  values.push(params.id);
  db.prepare(`UPDATE ad_audiences SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  db.prepare('UPDATE ad_audiences SET is_active = 0 WHERE id = ?').run(params.id);
  return NextResponse.json({ success: true });
}
