// Kalodata video-ad pool: import the xlsx export (top-performing TikTok ads
// for a product), download videos with yt-dlp server-side, and hand them out
// to launch workflows (9-at-once first launch, then 3/day via schedule).

import type Database from 'better-sqlite3';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';

export function ensureVideoPoolTable(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS video_ads_pool (
    id TEXT PRIMARY KEY,              -- tiktok video id
    store_id TEXT NOT NULL,
    caption TEXT,
    author TEXT,
    tiktok_url TEXT NOT NULL,
    revenue REAL DEFAULT 0,
    duration TEXT,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | reserved | used | failed
    file_path TEXT,
    workflow_id TEXT,
    imported_at TEXT DEFAULT (datetime('now')),
    used_at TEXT
  )`);
}

/** Parse a Kalodata xlsx (already saved to disk) with python3 — no npm deps.
 *  Returns rows sorted as exported (revenue DESC). */
export async function parseKalodataXlsx(xlsxPath: string): Promise<{ id: string; caption: string; author: string; url: string; revenue: number; duration: string }[]> {
  const py = `
import sys, zipfile, re, json
import xml.etree.ElementTree as ET
ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
z = zipfile.ZipFile(sys.argv[1])
sheet = 'xl/worksheets/sheet1.xml'
root = ET.fromstring(z.read(sheet))
out = []
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
    if not url: continue
    m = re.search(r'/video/(\\d+)', url)
    if not m: continue
    caption = vals[1] if len(vals) > 1 else ''
    duration = vals[2] if len(vals) > 2 else ''
    author = vals[3] if len(vals) > 3 else ''
    revenue = 0.0
    try: revenue = float(vals[5])
    except: pass
    out.append({'id': m.group(1), 'caption': caption[:300], 'author': author, 'url': url, 'revenue': revenue, 'duration': duration})
print(json.dumps(out))
`;
  return new Promise((resolve, reject) => {
    execFile('python3', ['-c', py, xlsxPath], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(`xlsx parse failed: ${err.message.slice(0, 200)}`));
      try { resolve(JSON.parse(stdout)); } catch (e: any) { reject(new Error(`xlsx parse output invalid: ${e.message}`)); }
    });
  });
}

export function importVideos(db: Database.Database, storeId: string, rows: { id: string; caption: string; author: string; url: string; revenue: number; duration: string }[]): { imported: number; skipped: number } {
  ensureVideoPoolTable(db);
  const ins = db.prepare(`INSERT OR IGNORE INTO video_ads_pool (id, store_id, caption, author, tiktok_url, revenue, duration) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  let imported = 0;
  for (const r of rows) {
    const res = ins.run(r.id, storeId, r.caption, r.author, r.url, r.revenue, r.duration);
    if (res.changes > 0) imported++;
  }
  return { imported, skipped: rows.length - imported };
}

/** Reserve the next-best N pending videos for a workflow (revenue DESC). */
export function reserveVideos(db: Database.Database, storeId: string, n: number, workflowId: string): any[] {
  ensureVideoPoolTable(db);
  const rows: any[] = db.prepare(
    "SELECT * FROM video_ads_pool WHERE store_id = ? AND status = 'pending' ORDER BY revenue DESC LIMIT ?"
  ).all(storeId, n);
  const upd = db.prepare("UPDATE video_ads_pool SET status = 'reserved', workflow_id = ? WHERE id = ?");
  for (const r of rows) upd.run(workflowId, r.id);
  return rows;
}

export function poolStats(db: Database.Database, storeId: string): { pending: number; used: number; failed: number } {
  ensureVideoPoolTable(db);
  const s: any = db.prepare(
    `SELECT SUM(CASE WHEN status IN ('pending','reserved') THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS used,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM video_ads_pool WHERE store_id = ?`
  ).get(storeId);
  return { pending: s?.pending || 0, used: s?.used || 0, failed: s?.failed || 0 };
}

const YTDLP_CANDIDATES = ['yt-dlp', '/usr/bin/yt-dlp', `${process.env.HOME}/.local/bin/yt-dlp`];

/** Download one pool video with yt-dlp. Returns the mp4 path. */
export async function downloadPoolVideo(db: Database.Database, video: { id: string; store_id: string; tiktok_url: string }): Promise<string> {
  const dir = path.join(process.cwd(), 'static-ads', video.store_id, 'videos');
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${video.id}.mp4`);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 100_000) {
    db.prepare("UPDATE video_ads_pool SET status = 'reserved', file_path = ? WHERE id = ?").run(outPath, video.id);
    return outPath;
  }

  const tryBin = (bin: string) => new Promise<void>((resolve, reject) => {
    execFile(bin, ['-f', 'mp4', '--no-playlist', '-o', outPath, video.tiktok_url], { timeout: 120_000 }, (err) => {
      if (err) reject(err); else resolve();
    });
  });

  let lastErr: any = null;
  for (const bin of YTDLP_CANDIDATES) {
    try { await tryBin(bin); lastErr = null; break; } catch (e) { lastErr = e; }
  }
  if (lastErr || !fs.existsSync(outPath)) {
    db.prepare("UPDATE video_ads_pool SET status = 'failed' WHERE id = ?").run(video.id);
    throw new Error(`Video download failed for ${video.id}: ${String(lastErr?.message || lastErr).slice(0, 200)}`);
  }
  db.prepare('UPDATE video_ads_pool SET file_path = ? WHERE id = ?').run(outPath, video.id);
  return outPath;
}
