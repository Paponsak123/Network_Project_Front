import { getApiUrl } from "@/utils/config";
const API = getApiUrl();

/**
 * ดึงรายการเว็บที่บล็อกทั้งหมด
 */
export async function getBlockedDomains(fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>) {
  const res = await fetchWithAuth(`${API}/api/blocker/`);
  if (!res.ok) throw new Error("Failed to fetch blocked domains");
  return res.json();
}

/**
 * เพิ่ม URL ที่ต้องการบล็อก
 */
export async function addBlockedDomain(
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>,
  url: string
) {
  const res = await fetchWithAuth(`${API}/api/blocker/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.detail || "Failed to add domain");
  }
  return res.json();
}

/**
 * เปิด/ปิดการบล็อก (Toggle)
 */
export async function toggleBlockedDomain(
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>,
  id: string,
  active: boolean
) {
  const res = await fetchWithAuth(`${API}/api/blocker/${id}?active=${active}`, {
    method: "PUT",
  });

  if (!res.ok) throw new Error("Failed to toggle domain status");
  return res.json();
}

/**
 * ลบ URL ออกจากรายการบล็อก
 */
export async function deleteBlockedDomain(
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>,
  id: string
) {
  const res = await fetchWithAuth(`${API}/api/blocker/${id}`, {
    method: "DELETE",
  });

  if (!res.ok) throw new Error("Failed to delete domain");
  return res.json();
}
