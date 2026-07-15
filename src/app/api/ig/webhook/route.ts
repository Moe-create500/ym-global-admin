// /api/ig/webhook  —  Instagram comments → auto-DM router.
//
// GET  : Meta calls this once on subscription with hub.mode=subscribe and a
//        hub.challenge. We echo the challenge back if the verify token matches
//        IG_WEBHOOK_VERIFY_TOKEN.
//
// POST : Meta delivers webhook events. We verify the HMAC signature, extract
//        IG comments, match against auto_dm_rules, dedupe per commenter+keyword
//        within the configured window, send the templated DM, and log every
//        trigger to auto_dm_log.
//
// Required env:
//   IG_WEBHOOK_VERIFY_TOKEN  — opaque secret that matches the Meta app's webhook
//   FB_APP_SECRET            — for signature verification (already used elsewhere)
//
// Required per-IG-account setup:
//   fb_profiles row with ig_user_id + ig_access_token (scope: instagram_manage_messages)
//   auto_dm_rules row per keyword you want to match

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getDb } from '@/lib/db';
import {
  verifySignature,
  extractComments,
  extractMessages,
  matchesKeyword,
  matchRule,
  isRecentlyTriggered,
  sendPrivateReply,
  sendDirectMessage,
  replyToComment,
  renderTemplate,
  type AutoDmRule,
} from '@/lib/ig-webhook';
import { generateDmReply } from '@/lib/claude-dm';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Meta retries failed deliveries — keep handler fast and idempotent.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const want = process.env.IG_WEBHOOK_VERIFY_TOKEN;
  if (mode === 'subscribe' && want && token === want && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: 'invalid verification' }, { status: 403 });
}

export async function POST(req: NextRequest) {
  // IG-Login webhook is signed with the IG app's secret. Prefer IG_APP_SECRET so
  // we don't disturb the existing FB_APP_SECRET (used elsewhere); fall back to it.
  const appSecret = process.env.IG_APP_SECRET || process.env.FB_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: 'app secret not configured' }, { status: 500 });
  }

  // We MUST verify against the raw body — read as text, then parse.
  const raw = await req.text();
  const sig = req.headers.get('x-hub-signature-256');
  if (!verifySignature(raw, sig, appSecret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 403 });
  }

  let payload: any;
  try { payload = JSON.parse(raw); }
  catch { return NextResponse.json({ ok: true, ignored: 'malformed' }); }

  const comments = extractComments(payload);
  const messages = extractMessages(payload);
  if (comments.length === 0 && messages.length === 0) {
    // Mentions, reactions, story replies, etc. — ack and ignore.
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const db = getDb();
  const results: Array<{ commentId: string; status: string; error?: string; keyword?: string }> = [];

  for (const c of comments) {
    try {
      // Load active rules for this IG account
      const rules = db.prepare(`
        SELECT id, ig_user_id, keyword, dm_template, reply_comment, is_active, dedupe_window_hours
        FROM auto_dm_rules
        WHERE ig_user_id = ? AND is_active = 1
      `).all(c.igUserId) as AutoDmRule[];

      const rule = matchRule(c.text, rules);
      if (!rule) {
        results.push({ commentId: c.commentId, status: 'no_match' });
        continue;
      }

      if (isRecentlyTriggered(db, c.igUserId, c.commenterId, rule.keyword, rule.dedupe_window_hours)) {
        results.push({ commentId: c.commentId, status: 'deduped', keyword: rule.keyword });
        // Still log so analytics show the deflection
        db.prepare(`
          INSERT INTO auto_dm_log (id, rule_id, ig_user_id, media_id, comment_id, commenter_id, commenter_username, keyword_matched, comment_text, dm_send_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'deduped')
        `).run(crypto.randomUUID(), rule.id, c.igUserId, c.mediaId, c.commentId, c.commenterId, c.commenterUsername ?? null, rule.keyword, c.text);
        continue;
      }

      // Resolve access token from fb_profiles
      const profile: any = db.prepare(`
        SELECT ig_access_token FROM fb_profiles
        WHERE ig_user_id = ? AND ig_access_token IS NOT NULL
        ORDER BY rowid LIMIT 1
      `).get(c.igUserId);
      if (!profile?.ig_access_token) {
        results.push({ commentId: c.commentId, status: 'no_token', keyword: rule.keyword });
        db.prepare(`
          INSERT INTO auto_dm_log (id, rule_id, ig_user_id, media_id, comment_id, commenter_id, commenter_username, keyword_matched, comment_text, dm_send_status, dm_error)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'no_token', 'fb_profiles missing ig_access_token')
        `).run(crypto.randomUUID(), rule.id, c.igUserId, c.mediaId, c.commentId, c.commenterId, c.commenterUsername ?? null, rule.keyword, c.text);
        continue;
      }

      const dm = renderTemplate(rule.dm_template, { username: c.commenterUsername });
      const send = await sendPrivateReply(c.igUserId, profile.ig_access_token, c.commentId, dm);

      if (send.ok && rule.reply_comment) {
        // Best-effort public reply; failures don't block the DM result
        await replyToComment(c.commentId, profile.ig_access_token, renderTemplate(rule.reply_comment, { username: c.commenterUsername }));
      }

      db.prepare(`
        INSERT INTO auto_dm_log (id, rule_id, ig_user_id, media_id, comment_id, commenter_id, commenter_username, keyword_matched, comment_text, dm_send_status, dm_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), rule.id, c.igUserId, c.mediaId, c.commentId, c.commenterId, c.commenterUsername ?? null, rule.keyword, c.text, send.ok ? 'ok' : 'error', send.error ?? null);

      results.push({ commentId: c.commentId, status: send.ok ? 'sent' : 'error', error: send.error, keyword: rule.keyword });
    } catch (e: any) {
      results.push({ commentId: c.commentId, status: 'exception', error: e?.message });
    }
  }

  // ─── DM auto-reply (Claude-powered) ─────────────────────────────────────────
  // Inbound DMs → ShipSourced 3PL chatbot. Token resolves from fb_profiles by the
  // recipient ig_user_id, same as the comment path. Not logged to a DB table.
  const dmResults: Array<{ messageId: string; status: string; error?: string }> = [];
  for (const m of messages) {
    try {
      // Single-account Instagram-Login config (env-based; no DB/schema needed).
      // IG_DM_USER_ID = @y8sinn's IG user id (webhook recipient.id);
      // IG_DM_ACCESS_TOKEN = its graph.instagram.com user token.
      const botUserId = process.env.IG_DM_USER_ID;
      const botToken = process.env.IG_DM_ACCESS_TOKEN;
      if (!botToken || !botUserId || m.igUserId !== botUserId) {
        dmResults.push({ messageId: m.messageId, status: 'no_token' });
        continue;
      }

      // Keyword gate: only auto-reply when the DM contains a configured keyword
      // (default "ship"; set IG_DM_KEYWORDS as a comma-separated list to change).
      const keywords = (process.env.IG_DM_KEYWORDS || 'ship')
        .split(',').map((s) => s.trim()).filter(Boolean);
      if (!matchesKeyword(m.text, keywords)) {
        dmResults.push({ messageId: m.messageId, status: 'no_keyword' });
        continue;
      }

      const reply = await generateDmReply(m.text);
      if (!reply.ok || !reply.text) {
        dmResults.push({ messageId: m.messageId, status: 'no_reply', error: reply.error });
        continue;
      }

      const send = await sendDirectMessage(m.igUserId, botToken, m.senderId, reply.text);
      dmResults.push({ messageId: m.messageId, status: send.ok ? 'replied' : 'error', error: send.error });
    } catch (e: any) {
      dmResults.push({ messageId: m.messageId, status: 'exception', error: e?.message });
    }
  }

  // 200 is required — Meta retries on non-200 and will eventually disable the
  // subscription if it sees too many failures.
  return NextResponse.json({
    ok: true,
    processed: comments.length,
    results,
    dm_processed: messages.length,
    dm_results: dmResults,
  });
}
