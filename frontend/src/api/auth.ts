import { fetchClient } from "@/utils/fetchClient";

// 1. ดึง Base URL ที่เราฝัง IP ไว้ (ถ้าไม่มีให้ Default เป็น localhost)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * อัปเดตชื่อผู้ใช้
 */
export async function updateProfile(token: string, username: string) {
  if (!token) throw new Error("Missing auth token");

  // 2. เปลี่ยนจาก `/api/...` เป็น `${API_BASE_URL}/api/...`
  const res = await fetchClient(`${API_BASE_URL}/api/auth/profile`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify({ username }),
  });

  const data = await safeJson(res);
  if (!res.ok) {
    const msg = data?.detail?.message || data?.message || "Update failed";
    throw new Error(msg);
  }
  return data ?? {};
}