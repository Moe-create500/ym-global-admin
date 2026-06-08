import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const templates: any[] = db.prepare(
    "SELECT * FROM creative_templates WHERE type = 'image' AND is_active = 1 ORDER BY name"
  ).all();

  const parsed = templates.map((t: any) => {
    let data: any = {};
    try { data = JSON.parse(t.template_data || '{}'); } catch {}
    return { ...t, template_data: data };
  });

  return NextResponse.json({ templates: parsed });
}

export async function POST(req: NextRequest) {
  const { name, description, templateData, thumbnailUrl } = await req.json();
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO creative_templates (id, name, description, type, template_data, thumbnail_url, is_active)
    VALUES (?, ?, ?, 'image', ?, ?, 1)
  `).run(id, name, description || null, JSON.stringify(templateData || {}), thumbnailUrl || null);

  return NextResponse.json({ success: true, id });
}
