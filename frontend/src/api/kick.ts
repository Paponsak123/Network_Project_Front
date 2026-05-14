import type { FetchClientOptions } from "@/utils/fetchClient";

// 1. ดึง Base URL ที่ฝัง IP มาจากขั้นตอน Build
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

    // ✅ เปลี่ยนเป็น Full URL
    const res = await fetchWithAuth(`${API_BASE_URL}/api/kick`, {
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

    // ✅ เปลี่ยนเป็น Full URL
    const res = await fetchWithAuth(`${API_BASE_URL}/api/kick/stop`, {
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
    // ✅ เปลี่ยนเป็น Full URL
    const res = await fetchWithAuth(`${API_BASE_URL}/api/kick/active`);
    if (!res.ok) return [];
    const data = await safeJson(res);
    return Array.isArray(data) ? data : [];
}