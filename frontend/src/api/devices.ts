import type { FetchClientOptions } from "@/utils/fetchClient";

// 1. ดึง Base URL จากที่ start.sh ฝังไว้ให้
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
  // ✅ แก้จาก /api/devices เป็น Full URL
  const res = await fetchWithAuth(`${API_BASE_URL}/api/devices`);
  if (!res.ok) return [];
  const data = await safeJson(res);

  if (Array.isArray(data)) return data;
  if (data?.devices && Array.isArray(data.devices)) return data.devices;
  return [];
}

/**
 * สั่ง Fingerprint เพื่อระบุ OS (Active)
 */
export async function fingerprintDevice(
  fetchWithAuth: Fetcher,
  deviceId: string,
  options: { refresh?: boolean } = {},
) {
  if (!deviceId) throw new Error("Missing device id");

  const qs = options.refresh ? "?refresh=1" : "";
  // ✅ แก้เป็น Full URL
  const res = await fetchWithAuth(`${API_BASE_URL}/api/devices/${deviceId}/fingerprint${qs}`, {
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

/**
 * ดึง raw signals + cache state ของอุปกรณ์ (สำหรับ debug)
 */
export async function fetchDeviceSignals(fetchWithAuth: Fetcher, deviceId: string) {
  if (!deviceId) throw new Error("Missing device id");
  // ✅ แก้เป็น Full URL
  const res = await fetchWithAuth(`${API_BASE_URL}/api/devices/${deviceId}/signals`);
  const data = await safeJson(res);
  if (!res.ok) {
    const msg = data?.detail?.message || data?.message || "Failed to fetch signals";
    throw new Error(msg);
  }
  return data ?? {};
}

// ... (ส่วน Interface ไม่ต้องแก้)
export interface FingerprintIndicator {
  source: string;
  attribute: string;
  value: string;
  weight: number;
  raw?: string | null;
  seen_at?: string | null;
}

export interface FingerprintResult {
  device_type?: string | null;
  os?: string | null;
  os_family?: string | null;
  vendor?: string | null;
  brand?: string | null;
  hostname?: string | null;
  confidence: number;
  indicators: FingerprintIndicator[];
  discovery_methods: string[];
  raw_signals: Record<string, unknown>;
  per_attribute_confidence: Record<string, number>;
}