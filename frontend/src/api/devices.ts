import { getApiUrl } from "@/utils/config";
const API = getApiUrl();

/**
 * ดึงรายการอุปกรณ์ทั้งหมด
 */
export async function fetchDevices(fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>) {
  const res = await fetchWithAuth(`${API}/api/devices`);
  const data = await res.json();

  if (Array.isArray(data)) return data;
  if (data?.devices && Array.isArray(data.devices)) return data.devices;
  return [];
}
