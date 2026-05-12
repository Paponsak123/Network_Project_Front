import { getApiUrl } from "@/utils/config";
const API = getApiUrl();

/**
 * เริ่มสแกนเครือข่าย
 */
export async function triggerScan(fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>) {
  const res = await fetchWithAuth(`${API}/api/scan`, { method: "POST" });
  return res.json();
}

/**
 * ดึงประวัติการสแกน
 */
export async function fetchScanHistory(fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>) {
  const res = await fetchWithAuth(`${API}/api/scan/history`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}
