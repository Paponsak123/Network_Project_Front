/**
 * Resilient fetch wrapper:
 *   - per-request timeout via AbortController (default 15s)
 *   - automatic retry on network failure + 5xx (default 2 retries)
 *   - exponential backoff with jitter
 *   - never retries on POST/PUT/PATCH/DELETE by default (avoid duplicate writes)
 *
 * Intentionally tiny so it can wrap any existing fetch call site.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface FetchClientOptions extends RequestInit {
  /** Per-request timeout in ms. Default: 15000. */
  timeoutMs?: number;
  /** Max retry attempts after the first try. Default: 2 for safe methods, 0 for unsafe. */
  retries?: number;
  /** Force retry even for unsafe methods (only use for idempotent endpoints). */
  forceRetry?: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Cross-browser check for "request was aborted" — different runtimes use
 * different error names / messages, and DOMException isn't available in SSR.
 */
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

    // Combine external signal with our timeout signal.
    const onExternalAbort = () => ctrl.abort();
    if (externalSignal) {
      if (externalSignal.aborted) ctrl.abort();
      else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });

      // Retry on server-side errors (likely transient).
      if (res.status >= 500 && res.status < 600 && attempt < maxRetries) {
        lastErr = new Error(`Server responded ${res.status}`);
      } else {
        return res;
      }
    } catch (err) {
      lastErr = err;
      // If caller aborted, surface immediately.
      if (externalSignal?.aborted) throw err;
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
    }

    if (attempt < maxRetries) {
      // Exponential backoff with jitter: 300ms, 600ms, 1200ms ...
      const backoff = 300 * 2 ** attempt + Math.random() * 200;
      await sleep(backoff);
    }
  }

  // Out of retries — rethrow the last error.
  throw lastErr instanceof Error ? lastErr : new Error("Network request failed");
}
