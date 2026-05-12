/**
 * Dynamically get the API URL.
 * If running in the browser, it uses the current window's hostname.
 * This allows other devices on the same network to access the app without hardcoding the IP.
 */
export const getApiUrl = (): string => {
  if (typeof window !== "undefined") {
    // We are in the browser. Construct URL from the current hostname.
    return `http://${window.location.hostname}:8000`;
  }
  
  // Fallback for SSR or if window is undefined
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
};
