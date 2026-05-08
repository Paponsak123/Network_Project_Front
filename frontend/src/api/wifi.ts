const API = process.env.NEXT_PUBLIC_API_URL;

/**
 * ดึงชื่อ Wi-Fi (SSID) ที่เชื่อมต่ออยู่
 */
export async function fetchSSID(): Promise<string | null> {
  try {
    const res = await fetch(`${API}/api/wifi/ssid`);
    const data = await res.json();
    return data.ssid || null;
  } catch {
    return null;
  }
}
