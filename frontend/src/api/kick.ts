import { getApiUrl } from "@/utils/config";
import type { FetchClientOptions } from "@/utils/fetchClient";

const API_URL = getApiUrl();

type Fetcher = (url: string, options?: FetchClientOptions) => Promise<Response>;

async function safeJson(res: Response): Promise<any> {
    try {
        return await res.json();
    } catch {
        return null;
    }
}

function pickError(data: any, fallback: string): string {
    return (
        data?.detail?.message ||
        data?.message ||
        (typeof data?.detail === "string" ? data.detail : "") ||
        fallback
    );
}

/**
 * เริ่มการเตะอุปกรณ์ออกจากเครือข่าย (Kick)
 */
export async function kickDevice(fetchWithAuth: Fetcher, ip: string, mac: string) {
    if (!ip || !mac) throw new Error("Missing ip or mac");

    const res = await fetchWithAuth(`${API_URL}/api/kick/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, mac }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(pickError(data, "Failed to kick device"));
    return data ?? {};
}

/**
 * หยุดการเตะและคืนการเชื่อมต่อ
 */
export async function stopKick(fetchWithAuth: Fetcher, ip: string) {
    if (!ip) throw new Error("Missing ip");

    const res = await fetchWithAuth(`${API_URL}/api/kick/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(pickError(data, "Failed to stop kick"));
    return data ?? {};
}

/**
 * ดึงรายการอุปกรณ์ที่กำลังถูกเตะอยู่
 */
export async function getActiveKicks(fetchWithAuth: Fetcher) {
    const res = await fetchWithAuth(`${API_URL}/api/kick/active`);
    if (!res.ok) return [];
    const data = await safeJson(res);
    return Array.isArray(data) ? data : [];
}
