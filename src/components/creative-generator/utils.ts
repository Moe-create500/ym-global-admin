/**
 * Decide if a package is a video or an image.
 * Uses per-package contentType field first (set by backend for mixed mode),
 * then falls back to shape inference, then to the batch-level config.
 */
export function isVideoPackage(pkg: any, batchContentType?: string): boolean {
  if (pkg?.contentType === 'video') return true;
  if (pkg?.contentType === 'image') return false;
  if (pkg?.script || pkg?.sceneStructure || pkg?.brollDirection) return true;
  if (pkg?.imageFormat || pkg?.hookText || pkg?.textOverlays) return false;
  return batchContentType === 'video';
}

/** Convert a Facebook CTA enum (e.g. SHOP_NOW) into a Title Case label. */
export function formatCta(cta: string | null): string {
  if (!cta) return '';
  return cta.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/** Proxy Sora URLs through our API (they need auth headers) */
export function mediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('https://api.openai.com/v1/videos/')) {
    return `/api/creatives/media?url=${encodeURIComponent(url)}`;
  }
  return url;
}
