const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export async function kickDevice(
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>,
    ip: string,
    mac: string
) {
    const res = await fetchWithAuth(`${API_URL}/api/kick/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, mac }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail?.message || "Failed to kick device");
    }
    return res.json();
}

export async function stopKick(
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>,
    ip: string
) {
    const res = await fetchWithAuth(`${API_URL}/api/kick/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail?.message || "Failed to stop kick");
    }
    return res.json();
}

export async function getActiveKicks(
    fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
) {
    const res = await fetchWithAuth(`${API_URL}/api/kick/active`);
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail?.message || "Failed to get active kicks");
    }
    return res.json();
}
