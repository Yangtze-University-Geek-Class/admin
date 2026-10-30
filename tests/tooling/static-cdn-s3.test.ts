import { describe, expect, it } from 'vitest';
import { createS3Storage, readS3Config, sha256, signS3Request } from '../../scripts/static-cdn-s3.mjs';
import { fixtureEnv, startCdnStore } from './cdn-store-fixture';

describe('CDN S3 credentials and destination', () => {
  it('keeps the same-origin opt-out, but fails closed for partial credentials and legacy tokens', () => {
    expect(readS3Config({})).toBeNull();
    expect(() => readS3Config({ STATIC_CDN_S3_ACCESS_KEY_ID: 'fixture-access' })).toThrow(/完整/);
    expect(() => readS3Config({ STATIC_CDN_UPLOAD_TOKEN: 'retired-fixture' })).toThrow(/退役/);
    expect(readS3Config({
      STATIC_CDN_S3_ACCESS_KEY_ID: 'fixture-access',
      STATIC_CDN_S3_SECRET_ACCESS_KEY: 'fixture-secret',
      STATIC_CDN_S3_BUCKET: 'fixture-bucket',
    })).toMatchObject({
      endpoint: 'https://s3.cn-south-1.qiniucs.com', bucket: 'fixture-bucket', region: 'cn-south-1', forcePathStyle: true,
    });
  });

  it.each([
    { STATIC_CDN_S3_BUCKET: '' }, { STATIC_CDN_S3_BUCKET: 'Bad_Bucket' }, { STATIC_CDN_S3_BUCKET: 'fixture-bucket/../other' },
    { STATIC_CDN_S3_REGION: 'us-east-1' }, { STATIC_CDN_S3_FORCE_PATH_STYLE: 'false' },
    { STATIC_CDN_S3_ENDPOINT: 'https://evil.example' }, { STATIC_CDN_S3_ENDPOINT: 'http://s3.cn-south-1.qiniucs.com' }, { STATIC_CDN_S3_ENDPOINT: 'https://cdn.crosery.com' },
    { STATIC_CDN_S3_ENDPOINT: 's3.cn-south-1.qiniucs.com@evil.example' },
    { STATIC_CDN_S3_ENDPOINT: 'https://s3.cn-south-1.qiniucs.com/private/' },
    { STATIC_CDN_S3_ENDPOINT: 'https://s3.cn-south-1.qiniucs.com?key=fixture' },
    { STATIC_CDN_S3_ENDPOINT: 'http://127.0.0.1:19095' },
    { STATIC_CDN_S3_ACCESS_KEY_ID: 'fixture\ninjected' }, { STATIC_CDN_S3_SECRET_ACCESS_KEY: 'fixture\ninjected' },
    { STATIC_CDN_S3_ACCESS_KEY_ID: '' }, { STATIC_CDN_S3_SECRET_ACCESS_KEY: '' },
  ])('rejects unsafe or incomplete configuration %j without leaking values', change => {
    expect(() => readS3Config({ ...fixtureEnv, ...change })).toThrow();
  });

  it('does not expose a raw delete or overwrite request even to callers of the adapter', async () => {
    const config = readS3Config(fixtureEnv);
    const storage = createS3Storage(config);
    for (const method of ['DELETE', 'POST', 'PUT']) expect(() => storage.request(method, 'yzgc/static/site/assets/a-12345678.js')).toThrow(/仅允许读取/);
    expect(() => signS3Request(config, 'DELETE', 'yzgc/static/site/assets/a-12345678.js')).toThrow(/不允许/);
  });
});

describe('S3 HTTP adapter', () => {
  it('SigV4 PUTs a missing content-addressed object and byte-checks an existing one without overwriting', async () => {
    const store = await startCdnStore();
    try {
      const storage = createS3Storage(store.config, { allowLoopbackForTests: true, backoff: 0, fetch: store.fetch });
      const key = `yzgc/static/site/forum/stickers/${sha256(Buffer.from('fixture'))}.webp`;
      expect(await storage.ensure(key, Buffer.from('fixture'), 'image/webp')).toBe('stored');
      expect(await storage.ensure(key, Buffer.from('fixture'), 'image/webp')).toBe('exists');
      await expect(storage.ensure(key, Buffer.from('different'), 'image/webp')).rejects.toThrow(/SHA-256|字节/);
      expect(store.objects.get(key)?.body.toString()).toBe('fixture');
      expect(store.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
      expect(store.calls.every(call => call.signed)).toBe(true);
    } finally {
      await store.close();
    }
  });

  it('rejects false content addresses and MIME before any HTTP, and serializes equal-key writers', async () => {
    const store = await startCdnStore();
    try {
      const storage = createS3Storage(store.config, { allowLoopbackForTests: true, backoff: 0, fetch: store.fetch });
      const body = Buffer.from('fixture');
      for (const [key, type] of [
        [`yzgc/static/site/forum/stickers/${'ab'.repeat(32)}.webp`, 'image/webp'],
        ['yzgc/static/site/forum/guides/screen-1.12345678.png', 'image/png'],
        ['yzgc/static/site/assets/app-12345678.js', 'text/html'],
      ]) await expect(storage.ensure(key, body, type)).rejects.toThrow(/哈希|SHA-256|类型/);
      expect(store.calls).toHaveLength(0);
      const key = 'yzgc/static/site/assets/app-12345678.js';
      expect(await Promise.all([storage.ensure(key, body, 'text/javascript'), storage.ensure(key, body, 'text/javascript')])).toEqual(['stored', 'exists']);
      expect(store.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
    } finally { await store.close(); }
  });
});
