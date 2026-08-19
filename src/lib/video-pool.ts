// Kalodata video-ad pool: import the xlsx export (top-performing TikTok ads
// for a product), download videos with yt-dlp server-side, and hand them out
// to launch workflows (9-at-once first launch, then 3/day via schedule).

import type Database from 'better-sqlite3';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';

export function ensureVideoPoolTable(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS video_ads_pool (
    id TEXT NOT NULL,                 -- tiktok video id
    store_id TEXT NOT NULL,
    product_id TEXT,                  -- which product this ad pool belongs to
    product_title TEXT,               -- Kalodata "Product Title" column (informational)
    caption TEXT,
    author TEXT,
    tiktok_url TEXT NOT NULL,
    revenue REAL DEFAULT 0,
    duration TEXT,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | reserved | used | failed
    file_path TEXT,
    workflow_id TEXT,
    imported_at TEXT DEFAULT (datetime('now')),
    used_at TEXT,
    PRIMARY KEY (id, store_id)        -- unique per store: the same viral video can serve two stores, but never double-posts within one
  )`);

  // Migrate the v1 table (PK on id alone, no product binding) in place
  const cols: any[] = db.prepare('PRAGMA table_info(video_ads_pool)').all();
  const hasProduct = cols.some((c: any) => c.name === 'product_id');
  const pkCols = cols.filter((c: any) => c.pk > 0).map((c: any) => c.name).join(',');
  if (cols.length && (!hasProduct || pkCols === 'id')) {
    db.exec(`
      CREATE TABLE video_ads_pool_v2 (
        id TEXT NOT NULL, store_id TEXT NOT NULL,
        product_id TEXT, product_title TEXT,
        caption TEXT, author TEXT, tiktok_url TEXT NOT NULL,
        revenue REAL DEFAULT 0, duration TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        file_path TEXT, workflow_id TEXT,
        imported_at TEXT DEFAULT (datetime('now')), used_at TEXT,
        PRIMARY KEY (id, store_id)
      );
      INSERT INTO video_ads_pool_v2 (id, store_id, caption, author, tiktok_url, revenue, duration, status, file_path, workflow_id, imported_at, used_at)
        SELECT id, store_id, caption, author, tiktok_url, revenue, duration, status, file_path, workflow_id, imported_at, used_at FROM video_ads_pool;
      DROP TABLE video_ads_pool;
      ALTER TABLE video_ads_pool_v2 RENAME TO video_ads_pool;
    `);
  }
}

/** Parse a Kalodata xlsx (already saved to disk) with python3 — no npm deps.
 *  Returns rows sorted as exported (revenue DESC). */
export async function parseKalodataXlsx(xlsxPath: string): Promise<{ rows: { id: string; caption: string; author: string; url: string; revenue: number; duration: string; productTitle?: string }[]; profileRows: number }> {
  const py = `
import sys, zipfile, re, json
import xml.etree.ElementTree as ET
ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
z = zipfile.ZipFile(sys.argv[1])
sheet = 'xl/worksheets/sheet1.xml'
root = ET.fromstring(z.read(sheet))
out = []
profile_rows = 0
for row in root.iter(ns + 'row'):
    vals = []
    for c in row.iter(ns + 'c'):
        t = c.find(ns + 'is')
        if t is not None:
            vals.append(''.join(x.text or '' for x in t.iter(ns + 't')))
        else:
            v = c.find(ns + 'v')
            vals.append(v.text if v is not None else '')
    url = next((v for v in vals if isinstance(v, str) and 'tiktok.com' in v and '/video/' in v), None)
    if not url:
        # Creator exports carry profile links (tiktok.com/@handle) but no /video/ URLs
        if any(isinstance(v, str) and 'tiktok.com/@' in v for v in vals): profile_rows += 1
        continue
    m = re.search(r'/video/(\\d+)', url)
    if not m: continue
    caption = vals[1] if len(vals) > 1 else ''
    duration = vals[2] if len(vals) > 2 else ''
    author = vals[3] if len(vals) > 3 else ''
    product = vals[7] if len(vals) > 7 else ''
    revenue = 0.0
    try: revenue = float(vals[5])
    except: pass
    out.append({'id': m.group(1), 'caption': caption[:300], 'author': author, 'url': url, 'revenue': revenue, 'duration': duration, 'productTitle': product[:200]})
print(json.dumps({'rows': out, 'profileRows': profile_rows}))
`;
  return new Promise((resolve, reject) => {
    execFile('python3', ['-c', py, xlsxPath], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(`xlsx parse failed: ${err.message.slice(0, 200)}`));
      try { resolve(JSON.parse(stdout)); } catch (e: any) { reject(new Error(`xlsx parse output invalid: ${e.message}`)); }
    });
  });
}

export function importVideos(db: Database.Database, storeId: string, productId: string | null, rows: { id: string; caption: string; author: string; url: string; revenue: number; duration: string; productTitle?: string }[]): { imported: number; skipped: number } {
  ensureVideoPoolTable(db);
  // Re-importing an already-known video never clones it. PENDING rows re-bind
  // to the newest import (an abandoned launch attempt must not orphan them);
  // reserved/used rows keep their binding — a video can NEVER be posted twice
  // for the same store.
  const ins = db.prepare(`
    INSERT INTO video_ads_pool (id, store_id, product_id, product_title, caption, author, tiktok_url, revenue, duration)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id, store_id) DO UPDATE SET
      product_id = CASE WHEN video_ads_pool.status = 'pending'
        THEN COALESCE(excluded.product_id, video_ads_pool.product_id)
        ELSE video_ads_pool.product_id END,
      product_title = COALESCE(excluded.product_title, video_ads_pool.product_title)
  `);
  let imported = 0;
  for (const r of rows) {
    const res = db.prepare('SELECT 1 FROM video_ads_pool WHERE id = ? AND store_id = ?').get(r.id, storeId);
    ins.run(r.id, storeId, productId, r.productTitle || null, r.caption, r.author, r.url, r.revenue, r.duration);
    if (!res) imported++;
  }
  return { imported, skipped: rows.length - imported };
}

/** Import pasted TikTok links directly (no xlsx). Revenue unknown → 0, so
 *  xlsx-imported winners are always preferred first. */
export function importVideoLinks(db: Database.Database, storeId: string, productId: string | null, links: string[]): { imported: number; skipped: number; invalid: number } {
  ensureVideoPoolTable(db);
  let invalid = 0;
  const rows = links.map(l => {
    const m = /tiktok\.com\/.*\/video\/(\d+)/.exec(l.trim()) || /\/video\/(\d+)/.exec(l.trim());
    if (!m) { invalid++; return null; }
    return { id: m[1], caption: '', author: (/@([\w.]+)/.exec(l) || [])[1] || '', url: l.trim(), revenue: 0, duration: '' };
  }).filter(Boolean) as any[];
  const r = importVideos(db, storeId, productId, rows);
  return { ...r, invalid };
}

/** Reserve the next-best N pending videos for a workflow (revenue DESC).
 *  Product-bound rows for THIS product win first, then unbound rows; rows
 *  bound to a different product are never taken. */
export function reserveVideos(db: Database.Database, storeId: string, n: number, workflowId: string, productId?: string | null): any[] {
  ensureVideoPoolTable(db);
  const rows: any[] = productId
    ? db.prepare(`
        SELECT * FROM video_ads_pool
        WHERE store_id = ? AND status = 'pending' AND (product_id = ? OR product_id IS NULL)
        ORDER BY (product_id = ?) DESC, revenue DESC LIMIT ?
      `).all(storeId, productId, productId, n)
    : db.prepare(
        // No product key → only unbound rows; never steal another product's pool
        "SELECT * FROM video_ads_pool WHERE store_id = ? AND status = 'pending' AND product_id IS NULL ORDER BY revenue DESC LIMIT ?"
      ).all(storeId, n);
  const upd = db.prepare("UPDATE video_ads_pool SET status = 'reserved', workflow_id = ? WHERE id = ? AND store_id = ?");
  for (const r of rows) upd.run(workflowId, r.id, r.store_id);
  return rows;
}

export function poolStats(db: Database.Database, storeId: string, productId?: string | null): { pending: number; used: number; failed: number } {
  ensureVideoPoolTable(db);
  // With a product: count what reserveVideos could actually take for it
  const productFilter = productId ? 'AND (product_id = ? OR product_id IS NULL)' : '';
  const params = productId ? [storeId, productId] : [storeId];
  const s: any = db.prepare(
    `SELECT SUM(CASE WHEN status IN ('pending','reserved') THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS used,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM video_ads_pool WHERE store_id = ? ${productFilter}`
  ).get(...params);
  return { pending: s?.pending || 0, used: s?.used || 0, failed: s?.failed || 0 };
}

// Preference order: the venv build supports --impersonate chrome, which gets
// past TikTok's datacenter-IP blocks; plain binaries are fallbacks.
const YTDLP_CANDIDATES: { bin: string; args: string[] }[] = [
  { bin: `${process.env.HOME}/.ytdlp-venv/bin/yt-dlp`, args: ['--impersonate', 'chrome'] },
  { bin: '/usr/local/bin/yt-dlp', args: [] },
  { bin: 'yt-dlp', args: [] },
  { bin: '/usr/bin/yt-dlp', args: [] },
];

/** Last-resort downloader via tikwm.com's public API (their CDN is not IP-gated). */
async function tikwmDownload(tiktokUrl: string, outPath: string): Promise<void> {
  const api = await fetch('https://www.tikwm.com/api/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    body: new URLSearchParams({ url: tiktokUrl, hd: '1' }).toString(),
  });
  const d: any = await api.json().catch(() => null);
  let play: string = d?.data?.hdplay || d?.data?.play || '';
  if (!play) throw new Error(`tikwm: ${d?.msg || 'no play url'}`);
  if (play.startsWith('/')) play = `https://www.tikwm.com${play}`;
  const res = await fetch(play, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
  if (!res.ok) throw new Error(`tikwm cdn ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100_000) throw new Error('tikwm returned a suspiciously small file');
  fs.writeFileSync(outPath, buf);
}

/** Download one pool video: yt-dlp (impersonated first), then tikwm. Returns the mp4 path. */
export async function downloadPoolVideo(db: Database.Database, video: { id: string; store_id: string; tiktok_url: string }): Promise<string> {
  const dir = path.join(process.cwd(), 'static-ads', video.store_id, 'videos');
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${video.id}.mp4`);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 100_000) {
    db.prepare("UPDATE video_ads_pool SET status = 'reserved', file_path = ? WHERE id = ? AND store_id = ?").run(outPath, video.id, video.store_id);
    return outPath;
  }

  const tryBin = (c: { bin: string; args: string[] }) => new Promise<void>((resolve, reject) => {
    execFile(c.bin, [...c.args, '-f', 'mp4', '--no-playlist', '-o', outPath, video.tiktok_url], { timeout: 120_000 }, (err) => {
      if (err) reject(err); else resolve();
    });
  });

  // Keep the most meaningful error — a missing binary (ENOENT) must not mask
  // the real extractor error from a binary that DID run
  let realErr: any = null;
  let ok = false;
  for (const c of YTDLP_CANDIDATES) {
    try { await tryBin(c); ok = true; break; } catch (e: any) {
      if (!realErr || (String(e?.message || '').includes('ENOENT') ? false : true)) {
        if (!String(e?.message || '').includes('ENOENT') || !realErr) realErr = e;
      }
    }
  }
  if (!ok || !fs.existsSync(outPath)) {
    try { await tikwmDownload(video.tiktok_url, outPath); ok = true; } catch (e: any) {
      realErr = new Error(`${String(realErr?.message || realErr || 'yt-dlp failed').slice(0, 150)} | tikwm: ${String(e?.message || e).slice(0, 100)}`);
    }
  }
  if (!ok || !fs.existsSync(outPath)) {
    db.prepare("UPDATE video_ads_pool SET status = 'failed' WHERE id = ? AND store_id = ?").run(video.id, video.store_id);
    throw new Error(`Video download failed for ${video.id}: ${String(realErr?.message || realErr).slice(0, 250)}`);
  }
  db.prepare('UPDATE video_ads_pool SET file_path = ? WHERE id = ? AND store_id = ?').run(outPath, video.id, video.store_id);
  return outPath;
}
