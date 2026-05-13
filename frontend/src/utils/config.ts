/**
 * Dynamically resolve the backend API URL.
 *
 * Priority:
 *   1. NEXT_PUBLIC_API_URL (explicit override — required for production / HTTPS)
 *   2. Browser: derive from window.location (same hostname, port 8000, matching protocol)
 *   3. Fallback: http://localhost:8000
 *
 * Picking the protocol from window prevents mixed-content errors when the
 * frontend is served over HTTPS but the API call defaults to http://.
 */
export const getApiUrl = (): string => {
  const envUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (envUrl) {
    // Strip any trailing slash so callers can safely append `/api/...`.
    return envUrl.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined" && window.location?.hostname) {
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    return `${protocol}//${window.location.hostname}:8000`;
  }

  return "http://localhost:8000";
};
