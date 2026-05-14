import { getApiUrl } from "./config";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface FetchClientOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  forceRetry?: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: string; message?: string };
  if (e.name === "AbortError") return true;
  if (e.code === "ABORT_ERR") return true;
  if (typeof e.message === "string" && /aborted/i.test(e.message)) return true;
  return false;
}

export async function fetchClient(
  url: string,
  options: FetchClientOptions = {}
): Promise<Response> {
  // --- 1. จัดการเรื่อง Base URL สำหรับมือถือ ---
  let finalUrl = url;
  if (url.startsWith("/")) {
    const baseUrl = getApiUrl();
    finalUrl = `${baseUrl}${url}`;
  }

  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries,
    forceRetry,
    signal: externalSignal,
    ...init
  } = options;

  const method = (init.method || "GET").toUpperCase();
  const isSafe = SAFE_METHODS.has(method);
  const maxRetries =
    typeof retries === "number" ? retries : isSafe || forceRetry ? DEFAULT_RETRIES : 0;

  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    const onExternalAbort = () => ctrl.abort();
    if (externalSignal) {
      if (externalSignal.aborted) ctrl.abort();
      else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

    try {
      // --- 2. ใช้ finalUrl ในการ fetch ---
      const res = await fetch(finalUrl, { ...init, signal: ctrl.signal });

      if (res.status >= 500 && res.status < 600 && attempt < maxRetries) {
        lastErr = new Error(`Server responded ${res.status}`);
      } else {
        return res;
      }
    } catch (err) {
      lastErr = err;
      if (externalSignal?.aborted) throw err;
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
    }

    if (attempt < maxRetries) {
      const backoff = 300 * 2 ** attempt + Math.random() * 200;
      await sleep(backoff);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("Network request failed");
}