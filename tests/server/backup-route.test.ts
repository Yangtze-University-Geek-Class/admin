// GET /api/console/backup（#282）：权限 403/200、单账号限流、操作记录只留摘要、下载内容是一份能解包的
// 归档，且真实密钥字符串不会出现在归档字节里。lib/system-backup.ts、tar-stream.ts 的内容正确性见
// tests/server/system-backup.test.ts、tar-stream.test.ts，这里只测路由这一层。
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { unpackTarGz } from '../../app/server/src/lib/tar-stream';
import { SHIELD_NOTICE } from '../../app/server/src/lib/shield';
import { accountIdOf, activityRows, grantPermGroup, grantPermNode, signIn, testApp } from './helpers';

const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

async function readEntry(entry: { consume(onChunk: (chunk: Buffer) => void): Promise<void> }): Promise<Buffer> {
  const parts: Buffer[] = [];
  await entry.consume(chunk => parts.push(chunk));
  return Buffer.concat(parts);
}

describe('GET /api/console/backup（#282）', () => {
  it('没有 system.backup 节点时 403 forbidden', async () => {
    const { app } = await (async () => { const c = await testApp(); contexts.push(c); return c; })();
    const sid = signIn(app, 'alice', 101);
    const res = await app.inject({ method: 'GET', url: '/api/console/backup', headers: { cookie: `sid=${sid}` } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden', node: 'system.backup', message: '需要「system.backup」权限' });
  });

  it('有节点但不是 10 分钟内登录的会话：403 step_up_required，不打归档', async () => {
    const { app } = await (async () => { const c = await testApp(); contexts.push(c); return c; })();
    const sid = signIn(app, 'owner', 904);
    grantPermGroup(app, accountIdOf(app, 'owner'), 'title.site.owner');
    app.services.storage.db.prepare('UPDATE sessions SET created_at = ?').run(Date.now() - 20 * 60_000);
    const res = await app.inject({ method: 'GET', url: '/api/console/backup', headers: { cookie: `sid=${sid}` } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('step_up_required');
    expect(activityRows(app).filter((row: { action: string }) => row.action === 'system.backup.export')).toEqual([]);
  });

  it('未登录时 401 unauthenticated', async () => {
    const { app } = await (async () => { const c = await testApp(); contexts.push(c); return c; })();
    const res = await app.inject({ method: 'GET', url: '/api/console/backup' });
    expect(res.statusCode).toBe(401);
  });

  it('站长默认拿到（根通配 *）：200，下载内容是能解包的归档，操作记录只留摘要，密钥字符串不出现在归档里', async () => {
    const { app } = await (async () => { const c = await testApp(); contexts.push(c); return c; })();
    const sid = signIn(app, 'owner', 901);
    grantPermGroup(app, accountIdOf(app, 'owner'), 'title.site.owner');

    const res = await app.inject({ method: 'GET', url: '/api/console/backup', headers: { cookie: `sid=${sid}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/gzip');
    // 测试没有设置 GEEK_DEPLOYMENT_ENVIRONMENT，manifest 按路由里的默认值落回 "local"（和本机开发一致）。
    expect(String(res.headers['content-disposition'])).toMatch(/^attachment; filename="yzgc-backup-local-\d{8}\.tar\.gz"$/);

    const files = new Map<string, Buffer>();
    for await (const entry of unpackTarGz(Readable.from([res.rawPayload]))) files.set(entry.path, await readEntry(entry));
    expect(files.has('manifest.json')).toBe(true);
    expect(files.has('data.db')).toBe(true);
    const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8'));
    expect(manifest.format).toBe('yzgc-system-backup@1');
    expect(manifest.database.row_counts.sessions).toBe(0); // 这次请求刚建的会话也被清空了，不是遗漏
    expect(manifest.required_env).toContain('PUBLIC_ORIGIN');
    expect(manifest.required_env.every((name: string) => !name.includes('='))).toBe(true); // 只有名字

    // 测试环境真实用到的密钥/令牌字符串，一个字节都不该出现在归档（压缩前）内容里
    const secrets = ['isolated-core-test-secret-at-least-32', 'test-only-placeholder', `token-owner`];
    for (const secret of secrets) {
      for (const bytes of files.values()) expect(bytes.includes(secret)).toBe(false);
    }

    const rows = activityRows(app, { action: 'system.backup.export' });
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('ok');
    expect(rows[0].meta).toMatchObject({ environment: 'local', files: expect.any(Number), tables: expect.any(Number) });
    expect(rows[0].meta.excluded_tables).toContain('sessions');
  });

  it('同一账号 5 分钟内第二次请求 429 rate_limited，换一个账号不受影响', async () => {
    const { app } = await (async () => { const c = await testApp(); contexts.push(c); return c; })();
    const ownerSid = signIn(app, 'owner', 902);
    grantPermGroup(app, accountIdOf(app, 'owner'), 'title.site.owner');
    const first = await app.inject({ method: 'GET', url: '/api/console/backup', headers: { cookie: `sid=${ownerSid}` } });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'GET', url: '/api/console/backup', headers: { cookie: `sid=${ownerSid}` } });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({ error: 'rate_limited', message: '操作太频繁，请稍后再试', request_id: expect.stringMatching(/\S/), notice: SHIELD_NOTICE });

    const otherSid = signIn(app, 'bob', 903);
    grantPermNode(app, accountIdOf(app, 'bob'), 'system.backup');
    const forOther = await app.inject({ method: 'GET', url: '/api/console/backup', headers: { cookie: `sid=${otherSid}` } });
    expect(forOther.statusCode).toBe(200);
  });
});
