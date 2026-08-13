/**
 * Simple in-memory sliding-window rate limiter.
 * Not suitable for multi-instance deployments, but correct for a
 * single-instance API server handling inquiry form submissions.
 *
 * The cleanup interval matches the longest window used so that timestamps
 * are never evicted before the window they protect has elapsed.
 */
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // match the inquiry-form window

const windows = new Map<string, number[]>();

/**
 * Returns true if the request is within the allowed rate, false if it should
 * be rejected.
 *
 * @param key      Partition key (e.g. IP address)
 * @param limit    Maximum requests allowed within `windowMs`
 * @param windowMs Duration of the sliding window in milliseconds
 */
export function isAllowed(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const timestamps = (windows.get(key) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= limit) return false;
  timestamps.push(now);
  windows.set(key, timestamps);
  return true;
}

// Purge stale keys using the same window so entries are never evicted early.
setInterval(() => {
  const cutoff = Date.now() - CLEANUP_INTERVAL_MS;
  for (const [key, timestamps] of windows) {
    if (timestamps.every((t) => t <= cutoff)) windows.delete(key);
  }
}, CLEANUP_INTERVAL_MS).unref();
