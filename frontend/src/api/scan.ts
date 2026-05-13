import { getApiUrl } from "@/utils/config";
import type { FetchClientOptions } from "@/utils/fetchClient";

const API = getApiUrl();

// Network scans can be slow (subnet sweep + port probe). Allow up to 2 minutes
// before aborting — far longer than the 15s default.
const SCAN_TIMEOUT_MS = 120_000;
// Reading the last cached scan from the DB should be fast.
const READ_TIMEOUT_MS = 15_000;

type Fetcher = (url: string, options?: FetchClientOptions) => Promise<Response>;

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * เริ่มสแกนเครือข่าย
 */
export async function triggerScan(fetchWithAuth: Fetcher) {
  const res = await fetchWithAuth(`${API}/api/scan/`, {
    method: "POST",
    timeoutMs: SCAN_TIMEOUT_MS,
    // Scans mutate state on the server (write a new history record). Don't auto-retry.
    retries: 0,
  });
  const data = await safeJson(res);
  if (!res.ok) {
    const msg = data?.detail?.message || data?.message || `Scan failed (${res.status})`;
    throw new Error(msg);
  }
  return data ?? {};
}

/**
 * ดึงประวัติการสแกน
 */
export async function fetchScanHistory(fetchWithAuth: Fetcher) {
  const res = await fetchWithAuth(`${API}/api/scan/history`, {
    timeoutMs: READ_TIMEOUT_MS,
  });
  if (!res.ok) return [];
  const data = await safeJson(res);
  return Array.isArray(data) ? data : [];
}
