import { NextResponse } from 'next/server';
import { listAvatars } from '@/lib/heygen';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const avatars = await listAvatars();
    return NextResponse.json({ avatars });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
