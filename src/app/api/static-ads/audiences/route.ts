import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { chatCompletion } from '@/lib/openai-chat';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 });

  const db = getDb();
  const audiences = db.prepare(
    'SELECT * FROM ad_audiences WHERE store_id = ? AND is_active = 1 ORDER BY created_at DESC'
  ).all(storeId);

  return NextResponse.json({ audiences });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // AI parse mode: paste a raw text block and GPT-4o extracts fields
  if (body.rawText && body.storeId) {
    return parseAndCreate(body.storeId, body.rawText);
  }

  const { storeId, name, description, painPoints, desires, objections, mindset, failedSolutions, demographics, creativeAngles, bofReasoning } = body;

  if (!storeId || !name) {
    return NextResponse.json({ error: 'storeId and name required' }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO ad_audiences (id, store_id, name, description, pain_points, desires, objections, mindset, failed_solutions, demographics, creative_angles, bof_reasoning)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, storeId, name, description || null,
    JSON.stringify(painPoints || []),
    JSON.stringify(desires || []),
    JSON.stringify(objections || []),
    mindset || null,
    JSON.stringify(failedSolutions || []),
    demographics || null,
    JSON.stringify(creativeAngles || []),
    bofReasoning || null
  );

  return NextResponse.json({ success: true, id });
}

async function parseAndCreate(storeId: string, rawText: string) {
  const messages = [
    {
      role: 'system' as const,
      content: `You parse audience profile text blocks into structured JSON. Extract every field you can find. Return valid JSON only.

Return this exact structure:
{
  "name": "short audience name from the text",
  "painPoints": ["array of pain points"],
  "desires": ["array of desires/wants"],
  "objections": ["array of objections or things they've already tried"],
  "failedSolutions": ["array of solutions they tried that failed"],
  "mindset": "what they are thinking — combine all their thoughts into one string",
  "demographics": "any demographic info found, or null",
  "creativeAngles": ["array of creative/ad angle ideas"],
  "bofReasoning": "why this is a bottom-of-funnel audience — combine all BOF reasoning"
}

If a field isn't in the text, use an empty array [] or null.`,
    },
    { role: 'user' as const, content: rawText },
  ];

  try {
    const result = await chatCompletion(messages, { model: 'gpt-5.5', temperature: 1, maxTokens: 2000 });
    const parsed = JSON.parse(result.content);

    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO ad_audiences (id, store_id, name, description, pain_points, desires, objections, mindset, failed_solutions, demographics, creative_angles, bof_reasoning)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, storeId,
      parsed.name || 'Parsed Audience',
      null,
      JSON.stringify(parsed.painPoints || []),
      JSON.stringify(parsed.desires || []),
      JSON.stringify(parsed.objections || []),
      parsed.mindset || null,
      JSON.stringify(parsed.failedSolutions || []),
      parsed.demographics || null,
      JSON.stringify(parsed.creativeAngles || []),
      parsed.bofReasoning || null
    );

    return NextResponse.json({ success: true, id, parsed });
  } catch (err: any) {
    return NextResponse.json({ error: `AI parse failed: ${err.message}` }, { status: 500 });
  }
}
