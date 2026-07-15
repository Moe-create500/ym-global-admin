// Helpers for the IG comment → auto-DM webhook.
//
// Meta delivers IG comment events to /api/ig/webhook. This module:
//   - verifies the X-Hub-Signature-256 header against FB_APP_SECRET
//   - matches comment text against active auto_dm_rules
//   - sends the templated DM via the IG Messenger Send API
//   - logs every trigger to auto_dm_log
//
// Requires fb_profiles row for the IG account with ig_access_token having the
// `instagram_manage_messages` scope.

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

const GRAPH = 'https://graph.facebook.com/v23.0';

export interface CommentEvent {
  igUserId: string;       // IG Business account id the comment was posted on
  mediaId: string;        // The post/reel id
  commentId: string;
  commenterId: string;    // IGSID — opaque per-user id
  commenterUsername?: string;
  text: string;
}

export interface AutoDmRule {
  id: string;
  ig_user_id: string;
  keyword: string;
  dm_template: string;        // Can contain {username} placeholder
  reply_comment?: string;     // Optional public reply to the comment
  is_active: number;
  dedupe_window_hours: number;
}

/** Verifies X-Hub-Signature-256 against the raw request body using FB_APP_SECRET. */
export function verifySignature(raw: string, header: string | null, appSecret: string): boolean {
  if (!header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw, 'utf8').digest('hex');
  // Constant-time compare to avoid timing leaks
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Extracts CommentEvent records from a Meta webhook payload.
 * Returns [] for non-comment events.
 */
export function extractComments(payload: any): CommentEvent[] {
  const out: CommentEvent[] = [];
  if (!payload?.entry) return out;
  for (const entry of payload.entry) {
    const igUserId = String(entry.id ?? '');
    const changes = entry.changes ?? [];
    for (const ch of changes) {
      if (ch.field !== 'comments') continue;
      const v = ch.value ?? {};
      // Skip self-comments (the page replying)
      if (v.from?.id && v.from.id === igUserId) continue;
      out.push({
        igUserId,
        mediaId: String(v.media?.id ?? ''),
        commentId: String(v.id ?? ''),
        commenterId: String(v.from?.id ?? ''),
        commenterUsername: v.from?.username,
        text: String(v.text ?? ''),
      });
    }
  }
  return out;
}

/** Picks the first matching active rule for a given comment + IG account. */
export function matchRule(text: string, rules: AutoDmRule[]): AutoDmRule | null {
  const t = text.toLowerCase();
  for (const r of rules) {
    if (!r.is_active) continue;
    // Word-boundary-ish match. Treat keyword as case-insensitive token.
    const k = r.keyword.trim().toLowerCase();
    if (!k) continue;
    // Surround with non-letter boundary to avoid 'shipper' matching 'ship'.
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(k)}(?:[^a-z0-9]|$)`, 'i');
    if (re.test(t)) return r;
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns true if this commenter has already been auto-DM'd for this keyword
 * within the dedupe window — used to avoid spamming the same person.
 */
export function isRecentlyTriggered(
  db: Database.Database,
  igUserId: string,
  commenterId: string,
  keyword: string,
  windowHours: number,
): boolean {
  const row = db.prepare(`
    SELECT 1 FROM auto_dm_log
    WHERE ig_user_id = ? AND commenter_id = ? AND keyword_matched = ?
      AND dm_send_status = 'ok'
      AND created_at > datetime('now', '-' || ? || ' hours')
    LIMIT 1
  `).get(igUserId, commenterId, keyword, windowHours);
  return !!row;
}

/**
 * Sends a private reply DM to a commenter using the IG Messenger Send API.
 * Returns { ok, error? }.
 */
export async function sendPrivateReply(
  igUserId: string,
  accessToken: string,
  commentId: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  // The Send API expects recipient.comment_id to route the message into the same
  // thread as the comment author. This avoids needing the IGSID directly.
  const url = `${GRAPH}/${igUserId}/messages`;
  const body = new URLSearchParams({
    recipient: JSON.stringify({ comment_id: commentId }),
    message: JSON.stringify({ text: message }),
    access_token: accessToken,
  });
  try {
    const res = await fetch(url, { method: 'POST', body });
    const text = await res.text();
    let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok || data.error) {
      return { ok: false, error: data.error?.message ?? text.slice(0, 300) };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/** Optional: post a public reply on the comment itself (visible to everyone). */
export async function replyToComment(
  commentId: string,
  accessToken: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = `${GRAPH}/${commentId}/replies`;
  const body = new URLSearchParams({ message: text, access_token: accessToken });
  try {
    const res = await fetch(url, { method: 'POST', body });
    const data = JSON.parse(await res.text());
    if (!res.ok || data.error) return { ok: false, error: data.error?.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/** Replace {username} placeholder in DM/reply templates. */
export function renderTemplate(template: string, ctx: { username?: string }): string {
  return template.replace(/\{username\}/g, ctx.username ?? 'there');
}

// ─── Direct-message (DM) auto-reply ───────────────────────────────────────────
// Added for the Claude-powered DM chatbot. The comment→DM flow above is unchanged.

export interface DirectMessageEvent {
  igUserId: string;   // IG Business account that RECEIVED the DM (webhook recipient.id)
  senderId: string;   // IGSID of the person who messaged us — reply target
  messageId: string;  // message mid (for dedupe/debug)
  text: string;
}

/** Extract inbound DMs from an IG `messages` webhook payload. Skips our own
 *  echoes and non-text events (reactions, attachments, story replies). */
export function extractMessages(payload: any): DirectMessageEvent[] {
  const out: DirectMessageEvent[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const m of entry?.messaging ?? []) {
      const msg = m?.message;
      if (!msg || msg.is_echo) continue;                 // ignore outbound echoes
      const text = typeof msg.text === 'string' ? msg.text.trim() : '';
      if (!text) continue;                                // ignore non-text events
      const senderId = m?.sender?.id;
      const recipientId = m?.recipient?.id;
      if (!senderId || !recipientId) continue;
      out.push({ igUserId: recipientId, senderId, messageId: msg.mid, text });
    }
  }
  return out;
}

/** Send a DM to a user by IGSID via the Instagram-Login Send API
 *  (graph.instagram.com — Instagram-API-with-Instagram-Login flow). */
const IG_GRAPH = 'https://graph.instagram.com/v23.0';
export async function sendDirectMessage(
  igUserId: string,
  accessToken: string,
  recipientId: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = `${IG_GRAPH}/${igUserId}/messages`;
  const body = new URLSearchParams({
    recipient: JSON.stringify({ id: recipientId }),
    message: JSON.stringify({ text: message }),
    access_token: accessToken,
  });
  try {
    const res = await fetch(url, { method: 'POST', body });
    const text = await res.text();
    let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok || data.error) return { ok: false, error: data.error?.message ?? text.slice(0, 300) };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/** Returns the first configured keyword found in the text (case-insensitive
 *  substring), or null. Used to gate DM auto-replies to relevant messages. */
export function matchesKeyword(text: string, keywords: string[]): string | null {
  const t = (text || '').toLowerCase();
  for (const kw of keywords) {
    const k = kw.trim().toLowerCase();
    if (k && t.includes(k)) return k;
  }
  return null;
}
