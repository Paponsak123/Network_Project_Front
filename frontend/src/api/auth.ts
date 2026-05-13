import { getApiUrl } from "@/utils/config";
import { fetchClient } from "@/utils/fetchClient";
const API = getApiUrl();

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

  const res = await fetchClient(`${API}/api/auth/profile`, {
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
