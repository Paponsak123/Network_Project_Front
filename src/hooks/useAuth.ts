"use client";

import { useRouter } from "next/navigation";

export function useAuth() {
    const router = useRouter();

    const getToken = () => {
        if (typeof window !== "undefined") {
            return localStorage.getItem("token");
        }
        return null;
    };

    const handleUnauthorized = () => {
        if (typeof window !== "undefined") {
            localStorage.removeItem("token");
        }
        router.push("/login");
    };

    // Helper method for authenticated API calls
    const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
        const token = getToken();
        if (!token) {
            handleUnauthorized();
            throw new Error("Unauthorized");
        }

        const headers = {
            ...options.headers,
            Authorization: `Bearer ${token}`,
        };

        try {
            const res = await fetch(url, { ...options, headers });
            
            if (res.status === 401) {
                handleUnauthorized();
                throw new Error("Unauthorized");
            }
            
            return res;
        } catch (err: any) {
            if (err.message === "Unauthorized") {
                handleUnauthorized();
            }
            throw err;
        }
    };

    return { getToken, handleUnauthorized, fetchWithAuth };
}
