import { NextResponse } from 'next/server';
import { listVoices } from '@/lib/heygen';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const voices = await listVoices();
    return NextResponse.json({ voices });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
