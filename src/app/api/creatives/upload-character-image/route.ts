import { requireStoreAccess } from '@/lib/auth-tenant';
/**
 * POST /api/creatives/upload-character-image
 *
 * Accepts a user-uploaded character reference image and persists it to
 * /public/uploads/scene-refs/<uuid>.jpg with a publicly-fetchable URL.
 * The returned URL is then included in subsequent /api/creatives/generate
 * requests as `uploadedCharacterImageUrl`, and the live-action / animated
 * pipelines use it as the shared character reference across all scenes.
 *
 * Mirrors the scope-locked exemption pattern from clone-ad-refs (middleware
 * extension in commit 53c6544 was extended to /uploads/scene-refs/ in this
 * same commit to make the resulting URL externally fetchable by Fal.ai).
 *
 * Body: multipart/form-data with fields:
 *   - storeId: string (required, tenant access check)
 *   - image: File (required, image/jpeg | image/png | image/webp, ≤10MB)
 *
 * Response: { success: true, imageUrl: 'https://.../uploads/scene-refs/<uuid>.<ext>' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function jsonError(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 10_000_000; // 10MB

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function POST(req: NextRequest) {
  const contentType = (req.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('multipart/form-data')) {
    return jsonError('INVALID_CONTENT_TYPE', 'Expected multipart/form-data');
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e: any) {
    return jsonError('INVALID_BODY', `Failed to parse multipart body: ${e?.message?.substring(0, 200)}`);
  }

  const storeId = String(formData.get('storeId') || '');
  if (!storeId) return jsonError('MISSING_STORE', 'storeId is required');

  // Tenant access check
  const _auth = requireStoreAccess(req, storeId);
  if (!_auth.authorized) return _auth.response;

  const file = formData.get('image');
  if (!file || !(file instanceof File)) {
    return jsonError('MISSING_FILE', 'No image uploaded. Include an "image" field in the multipart form.');
  }

  const fileMime = file.type || '';
  if (!ALLOWED_MIMES.has(fileMime)) {
    return jsonError(
      'INVALID_FORMAT',
      `Format ${fileMime || '(empty)'} not supported. Use JPEG, PNG, or WebP.`,
    );
  }
  if (file.size > MAX_BYTES) {
    return jsonError(
      'FILE_TOO_LARGE',
      `Size ${(file.size / 1_000_000).toFixed(1)}MB exceeds ${MAX_BYTES / 1_000_000}MB ceiling.`,
    );
  }

  const ext = MIME_TO_EXT[fileMime] || 'jpg';
  const refUuid = crypto.randomUUID();
  const refDir = path.join(process.cwd(), 'public', 'uploads', 'scene-refs');
  const refFilename = `${refUuid}.${ext}`;
  const refPath = path.join(refDir, refFilename);

  try {
    await mkdir(refDir, { recursive: true });
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(refPath, buf);
    console.log(`[CHARACTER-UPLOAD] Saved ${buf.length} bytes (${fileMime}) → ${refPath}`);
  } catch (e: any) {
    console.error(`[CHARACTER-UPLOAD] File write failed: ${e?.message}`);
    return jsonError('FILE_WRITE_FAILED', `Could not save uploaded image: ${e?.message?.substring(0, 200)}`, 500);
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ymglobalventures.com';
  // URL via the /api/character-image/[file] route — bypasses Next.js's
  // build-time static manifest for /public/ so runtime-uploaded files serve
  // correctly. Disk path is unchanged (still public/uploads/scene-refs/).
  const imageUrl = `${baseUrl}/api/character-image/${refFilename}`;

  return NextResponse.json({ success: true, imageUrl }, { status: 200 });
}
