/**
 * Returns the base prefix for all API calls.
 *
 * All requests go through the Next.js rewrite rule:
 *   /api/:path*  →  http://backend:8000/api/:path*   (server-side, Docker network)
 *
 * Using an empty string means callers write `/api/...` as a relative URL,
 * which works in both the browser and during SSR (Next.js resolves it internally).
 */
export const getApiUrl = (): string => "";
