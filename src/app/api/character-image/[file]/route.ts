import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import path from 'path';

/**
 * GET /api/character-image/<filename>
 *
 * Reads a character reference image from /public/uploads/scene-refs/<filename>
 * at request time and streams it to the caller. This route exists because
 * Next.js 14's production static handler enumerates /public/ at `next build`
 * time and does NOT serve files added at runtime — Pattern 1 generates
 * character images via Nano Banana at request time, so the /uploads/scene-refs/
 * URL pattern can never work for them.
 *
 * Diagnosed in commit 213ed77's first smoke test (Fal.ai's R2V image_urls
 * downloader returned file_download_error on every Pattern 1 character image
 * URL). The .gitkeep + rsync fix in commit 9ff3049 only solved serving for
 * files that existed at build time — the underlying runtime-write blindness
 * is a Next.js production architectural limit, not a configuration bug.
 *
 * Auth: exempted from middleware (public path). These images are referenced
 * by third-party APIs (Fal.ai Seedance R2V) that have no session cookie.
 * UUID-keyed filenames provide adequate obscurity — no enumeration risk.
 *
 * Security:
 *   - Filename must not contain .., /, \ (path traversal blocked)
 *   - Reads only from public/uploads/scene-refs/ (no other directories)
 *   - Returns 400 for malformed filenames, 404 for missing files, 500 for
 *     filesystem errors
 *
 * Used by:
 *   - src/lib/character-image.ts (auto-generated character images)
 *   - src/app/api/creatives/upload-character-image/route.ts (user-uploaded
 *     character images — same disk path, same /api/character-image/ URL pattern)
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ file: string }> }
) {
  try {
    const { file } = await params;

    // Path-traversal guard. Filenames are UUIDs + known extensions, so this
    // catches only attack attempts — legitimate filenames never contain these.
    if (file.includes('..') || file.includes('/') || file.includes('\\')) {
      console.warn(`[CHARACTER-IMAGE-SERVE] Rejected suspicious filename: ${file}`);
      return NextResponse.json({ error: 'INVALID_FILENAME' }, { status: 400 });
    }

    const filepath = path.join(process.cwd(), 'public', 'uploads', 'scene-refs', file);

    const fileStat = await stat(filepath).catch(() => null);
    if (!fileStat) {
      console.warn(`[CHARACTER-IMAGE-SERVE] Not found: ${file}`);
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const data = await readFile(filepath);

    // Content-Type from extension. character-image.ts always writes .png
    // (Nano Banana output_format='png'); upload-character-image accepts .png,
    // .jpg, .webp. Other extensions fall through to octet-stream.
    let contentType = 'application/octet-stream';
    const lower = file.toLowerCase();
    if (lower.endsWith('.png')) contentType = 'image/png';
    else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) contentType = 'image/jpeg';
    else if (lower.endsWith('.webp')) contentType = 'image/webp';

    console.log(`[CHARACTER-IMAGE-SERVE] Served ${file} (${fileStat.size} bytes, ${contentType})`);

    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileStat.size.toString(),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (e: any) {
    console.error(`[CHARACTER-IMAGE-SERVE] Serve error: ${e?.message}`);
    return NextResponse.json({ error: 'SERVE_ERROR', message: e?.message }, { status: 500 });
  }
}
