import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getOAuthUrl, exchangeCodeForToken, getLongLivedToken, getAdAccounts, getPages } from '@/lib/facebook';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// Initiate OAuth flow
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const redirectUri = process.env.FB_REDIRECT_URI || `${req.nextUrl.protocol}//${req.nextUrl.host}/api/ads/facebook/auth`;

  // If no code, redirect to Facebook OAuth
  if (!code) {
    const storeId = searchParams.get('storeId');
    if (!storeId) {
      return NextResponse.json({ error: 'storeId is required' }, { status: 400 });
    }
    const oauthState = `${storeId}:${crypto.randomUUID().slice(0, 8)}`;
    const url = getOAuthUrl(redirectUri, oauthState);
    return NextResponse.redirect(url);
  }

  // Callback — exchange code for token
  try {
    const shortToken = await exchangeCodeForToken(code, redirectUri);
    const longToken = await getLongLivedToken(shortToken.access_token);

    const [adAccounts, pages] = await Promise.all([
      getAdAccounts(longToken.access_token),
      getPages(longToken.access_token),
    ]);

    const storeId = state?.split(':')[0] || '';
    const expiresAt = longToken.expires_in
      ? new Date(Date.now() + longToken.expires_in * 1000).toISOString()
      : null;

    // Store token info so the connect page can pick it up
    const db = getDb();
    const tempId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO fb_profiles (id, store_id, profile_name, access_token, token_expires_at)
      VALUES (?, ?, 'Pending Setup', ?, ?)
    `).run(tempId, storeId, longToken.access_token, expiresAt);

    // Redirect back to connect page with success
    const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '');
    const host = req.headers.get('host') || req.nextUrl.host;
    const baseUrl = `${proto}://${host}`;
    return NextResponse.redirect(
      `${baseUrl}/dashboard/ads/connect?success=1&profileId=${tempId}&accounts=${adAccounts.length}&pages=${pages.length}`
    );
  } catch (err: any) {
    const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '');
    const host = req.headers.get('host') || req.nextUrl.host;
    const baseUrl = `${proto}://${host}`;
    return NextResponse.redirect(
      `${baseUrl}/dashboard/ads/connect?error=${encodeURIComponent(err.message)}`
    );
  }
}
