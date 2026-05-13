"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchClient, type FetchClientOptions } from "@/utils/fetchClient";

export function useAuth() {
    const router = useRouter();
    const pathname = usePathname();

    const getToken = useCallback(() => {
        if (typeof window !== "undefined") {
            try {
                return localStorage.getItem("token");
            } catch {
                // localStorage can throw in private mode / when disabled.
                return null;
            }
        }
        return null;
    }, []);

    const handleUnauthorized = useCallback(() => {
        if (typeof window !== "undefined") {
            try {
                localStorage.removeItem("token");
            } catch {
                /* ignore */
            }
        }
        // Avoid pushing /login when we're already there — prevents redirect loops.
        if (pathname !== "/login") {
            router.push("/login");
        }
    }, [pathname, router]);

    // Authenticated, resilient fetch. Preserves the original signature so callers don't change.
    const fetchWithAuth = useCallback(
        async (url: string, options: FetchClientOptions = {}) => {
            const token = getToken();
            if (!token) {
                handleUnauthorized();
                throw new Error("Unauthorized");
            }

            const headers = {
                ...(options.headers || {}),
                "ngrok-skip-browser-warning": "true",
                Authorization: `Bearer ${token}`,
            };

            try {
                const res = await fetchClient(url, { ...options, headers });

                if (res.status === 401) {
                    handleUnauthorized();
                    throw new Error("Unauthorized");
                }

                return res;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (message === "Unauthorized") {
                    handleUnauthorized();
                }
                throw err;
            }
        },
        [getToken, handleUnauthorized]
    );

    return { getToken, handleUnauthorized, fetchWithAuth };
}
