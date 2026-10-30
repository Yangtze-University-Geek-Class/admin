import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../app/server/src/config';
import { setExclusiveGroupMembership } from '../../app/server/src/lib/permissions';
import { accountIdOf, signIn, testApp } from './helpers';

/** sharp 是 app/server 的依赖，根目录没有它（同 forum-v2-endpoints.test.ts 的取法）。 */
const sharp = createRequire(join(REPO_ROOT, 'app/server/package.json'))('sharp') as typeof import('../../app/server/node_modules/sharp');

const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); });

describe('论坛图片上传写对象存储（#352）', () => {
  it('开启后字节写七牛、返回公开地址，库里不再存这张图', async () => {
    const calls: { method: string; url: string }[] = [];
    const fake = async (url: string, init: RequestInit) => {
      calls.push({ method: String(init.method), url });
      return new Response(null, { status: calls.length === 1 ? 404 : 200 });
    };
    const context = await testApp({ objectStorageFetch: fake }, false, {
      OBJECT_STORAGE_ENDPOINT: 'https://s3.example.test', OBJECT_STORAGE_REGION: 'cn-south-1',
      OBJECT_STORAGE_PREFIX: 'yzgc/preview/', OBJECT_STORAGE_PUBLIC_BASE: 'https://files.example.test/',
      OBJECT_STORAGE_BUCKET: 'test-bucket', OBJECT_STORAGE_ACCESS_KEY_ID: 'AK-TEST', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'SK-TEST',
    });
    contexts.push(context);
    const { app } = context;
    const sid = signIn(app, 'mem', 9802);
    expect(app.services.profiles.update(accountIdOf(app, 'mem'), { username: 'mem' }).ok).toBe(true);
    setExclusiveGroupMembership(app.services.storage.db, accountIdOf(app, 'mem'), 'level.member', Date.now(), 'test');
    app.services.permissions.bump();

    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#336699' } }).png().toBuffer();
    const res = await app.inject({ method: 'PUT', url: '/api/forum/uploads', payload: png, headers: { cookie: `sid=${sid}`, 'content-type': 'image/png' } });

    expect(res.statusCode).toBe(200);
    expect(res.json().url).toMatch(/^https:\/\/files\.example\.test\/yzgc\/preview\/uploads\/[0-9a-f]{64}\.webp$/);
    expect(calls.map(call => call.method)).toEqual(['HEAD', 'PUT']);
    expect(calls[1].url).toMatch(/^https:\/\/s3\.example\.test\/test-bucket\/yzgc\/preview\/uploads\/[0-9a-f]{64}\.webp$/);
    expect(app.services.storage.db.prepare('SELECT COUNT(*) AS n FROM forum_upload_files').get()).toEqual({ n: 0 });
  });
});
