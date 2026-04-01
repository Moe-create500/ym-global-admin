import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAdAccounts } from '@/lib/facebook';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const profileId = req.nextUrl.searchParams.get('profileId');
  if (!profileId) {
    return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
  }

  const db = getDb();
  const profile: any = db.prepare('SELECT * FROM fb_profiles WHERE id = ?').get(profileId);
  if (!profile || !profile.access_token) {
    return NextResponse.json({ error: 'Profile not found or no access token' }, { status: 404 });
  }

  try {
    const accounts = await getAdAccounts(profile.access_token);
    return NextResponse.json({ accounts });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
