import type Database from "better-sqlite3";
import type { FastifyRateLimitStoreCtor } from "@fastify/rate-limit";

/**
 * `@fastify/rate-limit` 的计数存储（#333）：计数落在 `rate_limit_counters` 表里，重启后同一个固定窗口内的次数不清零
 * （插件默认的 LocalStore 在进程内存里，重启就归零）。窗口语义和 LocalStore 一样：第一次计数开窗，窗口过后重新计数。
 * `child()` 按路由（方法加路径）分开键名，同一个 IP 在两个路由上各算各的。
 */
export type RateLimitResult = { current: number; ttl: number; iterationStartMs: number };
export type RateLimitCallback = (error: Error | null, result?: RateLimitResult) => void;

export function createRateLimitStore(db: Database.Database, clock: () => number = Date.now) {
  const select = db.prepare("SELECT hits, window_start FROM rate_limit_counters WHERE key = ?");
  const open = db.prepare("INSERT INTO rate_limit_counters(key, hits, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET hits = 1, window_start = excluded.window_start");
  const bump = db.prepare("UPDATE rate_limit_counters SET hits = hits + 1 WHERE key = ?");
  const prune = db.prepare("DELETE FROM rate_limit_counters WHERE window_start <= ?");

  function scoped(prefix: string) {
    return {
      incr(key: string, callback: RateLimitCallback, timeWindow: number): void {
        const id = `${prefix}\u0000${key}`;
        try {
          const result = db.transaction((): RateLimitResult => {
            const now = clock();
            const row = select.get(id) as { hits: number; window_start: number } | undefined;
            if (!row || row.window_start + timeWindow <= now) {
              open.run(id, now);
              return { current: 1, ttl: timeWindow, iterationStartMs: now };
            }
            bump.run(id);
            return { current: row.hits + 1, ttl: timeWindow - (now - row.window_start), iterationStartMs: row.window_start };
          }).immediate();
          callback(null, result);
        } catch (error) {
          callback(error as Error);
        }
      },
      child(routeOptions: { routeInfo?: { method?: string | string[]; url?: string } }) {
        const method = [routeOptions.routeInfo?.method ?? ""].flat().join("|");
        return scoped(`${method} ${routeOptions.routeInfo?.url ?? ""}`);
      },
    };
  }

  const root = scoped("");
  /** 插件用 `new Store(options)` 构造；构造出来的是共享的根对象，键名靠 child() 分路由。 */
  const Store = function RateLimitStore() { return root; } as unknown as FastifyRateLimitStoreCtor;
  /** 清掉窗口起点早于 `before` 的计数（每天的清理任务调用）；最长的限流窗口是 1 小时，留一天绰绰有余。 */
  function pruneBefore(before: number): number {
    return prune.run(before).changes;
  }
  return { Store, pruneBefore };
}
