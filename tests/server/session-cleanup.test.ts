import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { buildApp } from '../../app/server/src/app';
import { SESSION_CLEANUP_INTERVAL_MS, SESSION_TTL_MS } from '../../app/server/src/lib/auth';
import type { ServiceOverrides } from '../../app/server/src/services';
import { testApp, testConfig } from './helpers';

/**
 * 过期会话的主动清理（#128）：`sessions` 每行都存着加密的高权限 GitHub token，登录一次就不再回来的会话
 * 不能一直留在库里（备份、迁移、卷都带着整库）。启动时清一次、之后每小时清一次；不依赖本人再来访问。
 * 时钟通过 ServiceOverrides.clock 注入（写法同 tests/server/mail-outbox.test.ts），用例不依赖真实时间。
 * 删掉的行还要在库文件、WAL 和在线备份里找不到（文件末尾的 describe）。
 */

/** 可以拨的时钟 */
function clock(start = Date.UTC(2026, 8, 28, 3, 0)) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

/** 只替换间隔计时器：不动 Date 与 setImmediate，应用 ready、fastify 注册照常用真实机制。 */
const fakeIntervals = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

const apps: { close: () => Promise<unknown> }[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  vi.useRealTimers();
});

const sessionIds = (db: Database.Database) =>
  (db.prepare('SELECT id FROM sessions ORDER BY created_at, id').all() as { id: string }[]).map(row => row.id);

async function setup() {
  const time = clock();
  const context = await testApp({ clock: time.now });
  apps.push(context);
  const db = context.app.services.storage.db;
  return { ...context, time, auth: context.app.services.auth, db, rows: () => sessionIds(db) };
}

/** 真实进程的组装方式（同 tests/server/mail-outbox.test.ts 的 worker 用例）：buildApp 自己建服务，onReady/onClose 管计时器。 */
async function rawApp(sessionCleanup: boolean) {
  const time = clock();
  const deny = () => { throw new Error('Unexpected external network request in isolated core test'); };
  const config = testConfig({
    NODE_ENV: 'test', PUBLIC_ORIGIN: 'https://example.test', DB_PATH: ':memory:',
    SESSION_SECRET: 'isolated-core-test-secret-at-least-32',
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    OAUTH_CLIENT_ID: 'test-client', OAUTH_CLIENT_SECRET: 'test-only-placeholder', POW_DIFFICULTY: '0',
  });
  const app = await buildApp({
    config, staticRoot: false, sessionCleanup,
    overrides: { httpRequest: deny, octokitFactory: deny, mailFetch: deny, clock: time.now } as ServiceOverrides,
  });
  apps.push({ close: () => app.close() });
  const db = app.services.storage.db;
  return { app, time, auth: app.services.auth, db, rows: () => sessionIds(db) };
}

describe('expired sessions are deleted without waiting for their owner to come back (#128)', () => {
  it('deletes the expired rows and leaves the unexpired ones alone', async () => {
    const { auth, db, time, rows } = await setup();
    const stale = auth.createSession('stale-user', 1, null, 'token-stale');
    // 拨到过期之后再建一个：这时前者已过期、后者还有效
    time.advance(SESSION_TTL_MS + 1);
    const fresh = auth.createSession('fresh-user', 2, null, 'token-fresh');
    expect(rows()).toEqual([stale, fresh]);

    // 没有人再拿这个 sid 访问过：过期行仍在库里，只有主动清理才会消失
    expect(auth.cleanupExpiredSessions()).toEqual({ deleted: 1, walTruncated: true });
    expect(rows()).toEqual([fresh]);
    // 清掉的是那一行加密 token，没动未过期会话
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE access_token_encrypted IS NOT NULL').get()).toEqual({ n: 1 });
    expect(auth.getSession(fresh)?.login).toBe('fresh-user');
  });

  it('cleans once when the loop starts, then hourly, and stops for good when stopped', async () => {
    fakeIntervals();
    const { auth, time, rows } = await setup();
    auth.createSession('stale-user', 1, null, 'token-stale');
    time.advance(SESSION_TTL_MS + 1);
    const fresh = auth.createSession('fresh-user', 2, null, 'token-fresh');

    const logger = { info: vi.fn(), error: vi.fn() };
    auth.startCleanup(logger);
    expect(rows()).toEqual([fresh]);                                  // 启动时先清一次
    expect(logger.info).toHaveBeenCalledWith({ deleted: 1 }, expect.any(String));

    time.advance(SESSION_TTL_MS + 1);                                 // fresh 也过期了
    vi.advanceTimersByTime(SESSION_CLEANUP_INTERVAL_MS);
    expect(rows()).toEqual([]);                                       // 每小时清一次
    expect(logger.info).toHaveBeenCalledTimes(2);

    auth.stopCleanup();
    const later = auth.createSession('later-user', 3, null, 'token-later');
    time.advance(SESSION_TTL_MS + 1);
    vi.advanceTimersByTime(SESSION_CLEANUP_INTERVAL_MS * 3);
    expect(rows()).toEqual([later]);                                  // 停掉之后不再清
  });

  it('only logs when a cleanup pass fails and the service keeps answering', async () => {
    const { app, auth, db } = await setup();
    db.exec('DROP TABLE sessions');                                   // 让这一趟清理出错
    const logger = { info: vi.fn(), error: vi.fn() };
    expect(() => auth.startCleanup(logger)).not.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(1);
    // 日志带 SQLite 的错误码，分得清是表没了、库忙还是库坏了
    expect(logger.error).toHaveBeenCalledWith({ error: 'SqliteError', code: 'SQLITE_ERROR' }, 'session cleanup failed');
    expect(logger.info).not.toHaveBeenCalled();
    auth.stopCleanup();
    expect((await app.inject('/healthz')).statusCode).toBe(200);
  });

  it('runs with the app (startup pass, hourly timer, stop on close) only when asked', async () => {
    fakeIntervals();
    const context = await rawApp(true);
    context.auth.createSession('stale-user', 1, null, 'token-stale');
    context.time.advance(SESSION_TTL_MS + 1);
    await context.app.ready();                                        // onReady：启动时清一次
    expect(context.rows()).toEqual([]);

    const another = context.auth.createSession('another-user', 2, null, 'token-another');
    expect(context.auth.getSession(another)?.login).toBe('another-user');
    context.time.advance(SESSION_TTL_MS + 1);
    vi.advanceTimersByTime(SESSION_CLEANUP_INTERVAL_MS);              // 之后每小时清一次
    expect(context.rows()).toEqual([]);

    await context.app.close();                                        // onClose：停掉计时器
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not run the loop when the flag is off, so injected-service tests never clean on their own', async () => {
    fakeIntervals();
    const plain = await rawApp(false);
    const kept = plain.auth.createSession('kept-user', 4, null, 'token-kept');
    plain.time.advance(SESSION_TTL_MS + 1);
    await plain.app.ready();
    vi.advanceTimersByTime(SESSION_CLEANUP_INTERVAL_MS * 3);
    expect(plain.rows()).toEqual([kept]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not keep the process alive: the hourly timer is unref\'d', async () => {
    const { auth } = await setup();
    const spy = vi.spyOn(globalThis, 'setInterval');
    try {
      auth.startCleanup({ info: vi.fn(), error: vi.fn() });
      const call = spy.mock.calls.findIndex(([, ms]) => ms === SESSION_CLEANUP_INTERVAL_MS);
      expect(call).toBeGreaterThanOrEqual(0);
      expect((spy.mock.results[call].value as NodeJS.Timeout).hasRef()).toBe(false);
    } finally {
      auth.stopCleanup();
      spy.mockRestore();
    }
  });
});

// better-sqlite3 只装在 app/server 下（同 tests/server/legacy-database.test.ts）；用来开第二个连接占着读
const SqliteDatabase = createRequire(new URL('../../app/server/package.json', import.meta.url))('better-sqlite3') as typeof import('better-sqlite3');

/** 文件里有没有这串字节（文件不存在算没有）。 */
const fileHas = (file: string, text: string) => existsSync(file) && readFileSync(file).includes(Buffer.from(text));

/**
 * 只删 SQL 行不够（#128 审查 F1）：SQLite 默认不清零被删的内容，密文会留在页的空闲块和 WAL 里，
 * 在线备份照样带走。这里用文件库走真实的组装（createServices → createDatabase），按字节找被删会话的密文。
 */
describe('a removed session leaves no bytes of its token in the files (#128)', () => {
  async function fileApp() {
    const dir = mkdtempSync(join(tmpdir(), 'geek-session-cleanup-'));
    const path = join(dir, 'data.db');
    const time = clock();
    const { app } = await testApp({ clock: time.now }, false, { DB_PATH: path });
    let closed = false;
    const close = async () => { if (!closed) { closed = true; await app.close(); } };
    apps.push({ close: async () => { await close(); rmSync(dir, { recursive: true, force: true }); } });
    const { auth, storage: { db } } = app.services;
    const stale = auth.createSession('stale-user', 1, null, 'token-stale');
    const sealed = (db.prepare('SELECT access_token_encrypted AS v FROM sessions WHERE id = ?').get(stale) as { v: string }).v;
    time.advance(SESSION_TTL_MS + 1);
    return { dir, path, wal: `${path}-wal`, auth, db, stale, sealed, close };
  }

  it('zeroes the deleted token in data.db, its WAL and an online backup', async () => {
    const { dir, path, wal, auth, db, stale, sealed, close } = await fileApp();
    expect(db.pragma('secure_delete', { simple: true })).toBe(1);
    // 对照：清理之前密文就在 WAL 里，下面的「找不到」不是空过
    expect(fileHas(wal, sealed)).toBe(true);

    expect(auth.cleanupExpiredSessions()).toEqual({ deleted: 1, walTruncated: true });
    expect(statSync(wal).size).toBe(0);
    expect(fileHas(path, sealed)).toBe(false);
    expect(fileHas(path, stale)).toBe(false);
    const backup = join(dir, 'backup.db');
    await db.backup(backup);
    expect(fileHas(backup, sealed)).toBe(false);

    await close();                                                    // 关库：-wal 写回并删除
    expect(existsSync(wal)).toBe(false);
    expect(fileHas(path, sealed)).toBe(false);
  });

  it('does not wait while another connection is reading, and truncates on the next pass', async () => {
    const { path, wal, auth, db, sealed } = await fileApp();
    const reader = new SqliteDatabase(path);
    reader.exec('BEGIN');
    reader.prepare('SELECT COUNT(*) FROM sessions').get();
    try {
      const started = performance.now();
      expect(auth.cleanupExpiredSessions()).toEqual({ deleted: 1, walTruncated: false });
      expect(performance.now() - started).toBeLessThan(1000);         // better-sqlite3 默认会在这里等 5 秒
      expect(db.pragma('busy_timeout', { simple: true })).toBe(5000); // 等待时间恢复原值，别的语句照旧等锁
      const logger = { info: vi.fn(), error: vi.fn() };
      auth.startCleanup(logger);
      auth.stopCleanup();
      expect(logger.info).toHaveBeenCalledWith({}, 'wal truncate deferred: another connection is reading');
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      reader.exec('COMMIT');
      reader.close();
    }
    expect(auth.cleanupExpiredSessions()).toEqual({ deleted: 0, walTruncated: true });
    expect(statSync(wal).size).toBe(0);
    expect(fileHas(path, sealed)).toBe(false);
  });
});
