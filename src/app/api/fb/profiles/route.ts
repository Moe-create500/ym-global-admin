import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  const db = getDb();

  let where = 'WHERE fp.is_active = 1';
  const params: any[] = [];

  if (storeId) { where += ' AND fp.store_id = ?'; params.push(storeId); }

  const profiles = db.prepare(`
    SELECT fp.*, s.name as store_name,
      CASE WHEN fp.token_expires_at IS NOT NULL AND fp.token_expires_at < datetime('now', '+7 days')
        THEN 1 ELSE 0 END as token_expiring_soon,
      CASE WHEN fp.token_expires_at IS NOT NULL AND fp.token_expires_at < datetime('now')
        THEN 1 ELSE 0 END as token_expired
    FROM fb_profiles fp
    JOIN stores s ON s.id = fp.store_id
    ${where}
    ORDER BY s.name
  `).all(...params);

  return NextResponse.json({ profiles });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { storeId, profileName, adAccountId, adAccountName, accessToken,
          tokenExpiresAt, fbPageId, fbPageName, fbPageAccessToken,
          instagramActorId, pixelId, businessId } = body;

  if (!storeId || !profileName) {
    return NextResponse.json({ error: 'storeId and profileName are required' }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO fb_profiles (id, store_id, profile_name, ad_account_id, ad_account_name,
      access_token, token_expires_at, fb_page_id, fb_page_name, fb_page_access_token,
      instagram_actor_id, pixel_id, business_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, storeId, profileName, adAccountId || null, adAccountName || null,
    accessToken || null, tokenExpiresAt || null, fbPageId || null,
    fbPageName || null, fbPageAccessToken || null, instagramActorId || null,
    pixelId || null, businessId || null);

  return NextResponse.json({ success: true, id });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, adAccountId, adAccountName, profileName } = body;

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const db = getDb();
  const sets: string[] = [];
  const params: any[] = [];

  if (adAccountId !== undefined) { sets.push('ad_account_id = ?'); params.push(adAccountId); }
  if (adAccountName !== undefined) { sets.push('ad_account_name = ?'); params.push(adAccountName); }
  if (profileName !== undefined) { sets.push('profile_name = ?'); params.push(profileName); }
  sets.push("updated_at = datetime('now')");

  if (sets.length === 1) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  params.push(id);
  db.prepare(`UPDATE fb_profiles SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const db = getDb();
  db.prepare("UPDATE fb_profiles SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);

  return NextResponse.json({ success: true });
}
