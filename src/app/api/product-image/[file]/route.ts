import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import path from 'path';

/**
 * GET /api/product-image/<filename>
 *
 * Serves product images uploaded to /public/uploads/. Used by Fal Seedance R2V
 * (which requires HTTPS URLs in image_urls[] and rejects data URIs — see commit
 * ab91542 for the workaround skip predicate and Option A here for the structural
 * fix). MIME whitelist prevents inadvertent serving of non-image files
 * (voiceover mp3s, scene stitches, gemini/dalle outputs) co-located in the same
 * flat /public/uploads/ directory.
 *
 * Mirrors src/app/api/character-image/[file]/route.ts (Pattern 1 commit b72fd28).
 * Difference: reads from public/uploads/<file> (flat) instead of
 * public/uploads/scene-refs/<file> (subdir), and accepts a wider MIME set
 * (.png, .jpg, .jpeg, .webp — user uploads vary; character images are always
 * Nano Banana PNG).
 *
 * Why a separate route per file type: the underlying Next.js 14 production
 * runtime-write blindness (described in character-image route) requires an
 * API route to bypass the static manifest. Distinct routes per kind keep MIME
 * whitelists tight and let middleware exempt only what's needed.
 *
 * Auth: exempted from middleware (public path). Referenced by Fal.ai R2V which
 * has no session cookie. UUID-keyed filenames provide adequate obscurity — no
 * enumeration risk against image uploads.
 *
 * Security:
 *   - Filename must not contain .., /, \ (path traversal blocked)
 *   - Reads only from public/uploads/ (no other directories)
 *   - MIME whitelist: extension must be .png, .jpg, .jpeg, or .webp
 *   - Returns 400 for malformed filenames, 415 for non-image extensions,
 *     404 for missing files, 500 for filesystem errors
 *
 * Used by:
 *   - src/app/api/creatives/generate/route.ts (seedance-scenes branch resolves
 *     /api/products/uploads?file=... URLs into this route for Fal R2V)
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
      console.warn(`[PRODUCT-IMAGE-SERVE] Rejected suspicious filename: ${file}`);
      return NextResponse.json({ error: 'INVALID_FILENAME' }, { status: 400 });
    }

    // MIME whitelist — the /public/uploads/ directory is shared with mp3s,
    // mp4s, and other non-image outputs. Only serve image extensions.
    const lower = file.toLowerCase();
    let contentType: string;
    if (lower.endsWith('.png')) contentType = 'image/png';
    else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) contentType = 'image/jpeg';
    else if (lower.endsWith('.webp')) contentType = 'image/webp';
    else {
      console.warn(`[PRODUCT-IMAGE-SERVE] Rejected non-image extension: ${file}`);
      return NextResponse.json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
    }

    const filepath = path.join(process.cwd(), 'public', 'uploads', file);

    const fileStat = await stat(filepath).catch(() => null);
    if (!fileStat) {
      console.warn(`[PRODUCT-IMAGE-SERVE] Not found: ${file}`);
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const data = await readFile(filepath);

    console.log(`[PRODUCT-IMAGE-SERVE] Served ${file} (${fileStat.size} bytes, ${contentType})`);

    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileStat.size.toString(),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (e: any) {
    console.error(`[PRODUCT-IMAGE-SERVE] Serve error: ${e?.message}`);
    return NextResponse.json({ error: 'SERVE_ERROR', message: e?.message }, { status: 500 });
  }
}
