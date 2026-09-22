type Entry<T> = { value: T; expires: number };

export function createCache() {
const MAX_ENTRIES = 500;
const store = new Map<string, Entry<unknown>>();

function evictIfFull() {
  if (store.size < MAX_ENTRIES) return;
  // drop oldest 10% (insertion-order iteration)
  const drop = Math.ceil(MAX_ENTRIES * 0.1);
  let i = 0;
  for (const k of store.keys()) {
    store.delete(k);
    if (++i >= drop) break;
  }
}

/**
 * Memoize an async producer by string key for `ttlMs`. Same key + still-fresh
 * cache returns immediately. After expiry the next call re-runs `fn` and
 * refreshes. Errors are NOT cached — failures retry on next call.
 */
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn();
  evictIfFull();
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

function invalidate(prefix: string) {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

function cacheStats() {
  return { size: store.size, max: MAX_ENTRIES };
}

return { cached, invalidate, cacheStats };
}
