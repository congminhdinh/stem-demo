// N18 P2: work the lab can do later waits for the browser's idle time (requestIdleCallback, at most IDLE_TIMEOUT_MS away), or
// IDLE_FALLBACK_MS where the browser has none.

/** The longest the work waits for idle time, ms. */
export const IDLE_TIMEOUT_MS = 2000;
/** How long the work waits where there are no idle callbacks, ms. */
export const IDLE_FALLBACK_MS = 300;

/** Calls `work` once the browser is idle; returns the way to take it back. */
export function whenIdle(work: () => void): () => void {
  if (typeof globalThis.requestIdleCallback === 'function') {
    const handle = globalThis.requestIdleCallback(() => work(), { timeout: IDLE_TIMEOUT_MS });
    return () => globalThis.cancelIdleCallback(handle);
  }
  const timer = setTimeout(work, IDLE_FALLBACK_MS);
  return () => clearTimeout(timer);
}
