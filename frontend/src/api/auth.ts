import { getApiUrl } from "@/utils/config";
const API = getApiUrl();

/**
 * อัปเดตชื่อผู้ใช้
 */
export async function updateProfile(token: string, username: string) {
  const res = await fetch(`${API}/api/auth/profile`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify({ username }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Update failed");
  return data;
}
