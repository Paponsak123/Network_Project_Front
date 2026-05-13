import { getApiUrl } from "@/utils/config";
import type { FetchClientOptions } from "@/utils/fetchClient";

const API = getApiUrl();

// Active OS fingerprinting does a TCP/IP probe — the UI hints ~10s, give it headroom.
const FINGERPRINT_TIMEOUT_MS = 30_000;

type Fetcher = (url: string, options?: FetchClientOptions) => Promise<Response>;

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * ดึงรายการอุปกรณ์ทั้งหมด
 */
export async function fetchDevices(fetchWithAuth: Fetcher) {
  const res = await fetchWithAuth(`${API}/api/devices`);
  if (!res.ok) return [];
  const data = await safeJson(res);

  if (Array.isArray(data)) return data;
  if (data?.devices && Array.isArray(data.devices)) return data.devices;
  return [];
}

/**
 * สั่ง Fingerprint เพื่อระบุ OS (Active)
 */
export async function fingerprintDevice(fetchWithAuth: Fetcher, deviceId: string) {
  if (!deviceId) throw new Error("Missing device id");

  const res = await fetchWithAuth(`${API}/api/devices/${deviceId}/fingerprint`, {
    method: "POST",
    timeoutMs: FINGERPRINT_TIMEOUT_MS,
    retries: 0,
  });
  const data = await safeJson(res);
  if (!res.ok) {
    const msg = data?.detail?.message || data?.message || "Failed to fingerprint device";
    throw new Error(msg);
  }
  return data ?? {};
}
