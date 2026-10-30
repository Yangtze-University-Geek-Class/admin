import { describe, expect, it } from 'vitest';
import { avatarKey, createObjectStorage, signV4, uploadKey, type ObjectStorageConfig } from '../../app/server/src/lib/object-storage';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const config: ObjectStorageConfig = {
  endpoint: 'https://s3.example.test', region: 'cn-south-1', bucket: 'test-bucket',
  accessKeyId: 'AK-TEST', secretAccessKey: 'SK-TEST', prefix: 'yzgc/preview/', publicBase: 'https://files.example.test/',
};

describe('SigV4 签名（#352）', () => {
  it('与 AWS 文档的 GET 示例（带 Range 头）逐字一致', () => {
    const authorization = signV4({
      method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256, 'x-amz-date': '20130524T000000Z' },
      payloadSha256: EMPTY_SHA256, amzDate: '20130524T000000Z', region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
    expect(authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });
});

describe('对象存储客户端（假 fetch，#352）', () => {
  it('先 HEAD，不存在才 PUT；请求是 path-style 且带签名；地址是 公开基址 + 前缀 + 键', async () => {
    const calls: { method: string; url: string; headers: Record<string, string> }[] = [];
    const fake = async (url: string, init: RequestInit) => {
      calls.push({ method: String(init.method), url, headers: init.headers as Record<string, string> });
      return new Response(null, { status: calls.length === 1 ? 404 : 200 });
    };
    const storage = createObjectStorage(config, { fetch: fake, now: () => new Date('2026-10-30T04:05:06.789Z') });
    const hash = 'a'.repeat(64);

    const url = await storage.ensure(avatarKey(hash), Buffer.from('webp-bytes'), 'image/webp');

    expect(url).toBe(`https://files.example.test/yzgc/preview/avatars/${hash}.webp`);
    expect(calls.map(call => call.method)).toEqual(['HEAD', 'PUT']);
    expect(calls[0].url).toBe(`https://s3.example.test/test-bucket/yzgc/preview/avatars/${hash}.webp`);
    expect(calls[1].headers['x-amz-date']).toBe('20261030T040506Z');
    expect(calls[1].headers['content-type']).toBe('image/webp');
    expect(calls[1].headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AK-TEST\/20261030\/cn-south-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('对象已经在桶里就只 HEAD，不再 PUT；关闭时不可用，公开地址直接抛错', async () => {
    const methods: string[] = [];
    const storage = createObjectStorage(config, { fetch: async (_url, init) => { methods.push(String(init.method)); return new Response(null, { status: 200 }); } });
    await storage.ensure(uploadKey('b'.repeat(64), 'image/gif'), Buffer.from('gif'), 'image/gif');
    expect(methods).toEqual(['HEAD']);

    const off = createObjectStorage(null);
    expect(off.enabled).toBe(false);
    expect(() => off.publicUrl(avatarKey('c'.repeat(64)))).toThrow();
    expect(uploadKey('d'.repeat(64), 'image/webp')).toBe(`uploads/${'d'.repeat(64)}.webp`);
  });
});
