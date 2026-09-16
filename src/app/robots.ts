import type { MetadataRoute } from 'next';

/** Internal tool: never indexed. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
