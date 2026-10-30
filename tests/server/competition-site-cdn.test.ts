// 比赛官网的静态资源上对象存储（#360）：发布时同步到公开桶，在线版本的资源 302 到桶里的地址，HTML 与 CSP 仍由服务端下发；
// 再发布时上一版多出的文件从桶里删掉；对象存储没开启时完全同源（与 #278 一样）。
import { afterEach, describe, expect, it } from 'vitest';
import { SITE_CSP, siteCsp } from '../../app/server/src/routes/sites/index';
import { contestSetup, sitePackage, upload, type ContestContext } from './contest-fixtures';

const contexts: ContestContext[] = [];
afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});

const OBJECT_ENV = {
  OBJECT_STORAGE_ENDPOINT: 'https://s3.example.test', OBJECT_STORAGE_REGION: 'cn-south-1',
  OBJECT_STORAGE_PREFIX: 'yzgc/preview/', OBJECT_STORAGE_PUBLIC_BASE: 'https://files.example.test/',
  OBJECT_STORAGE_BUCKET: 'test-bucket', OBJECT_STORAGE_ACCESS_KEY_ID: 'AK-TEST', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'SK-TEST',
};

describe('比赛官网资源上对象存储（#360）', () => {
  it('发布时资源写到公开桶并 302 过去、HTML 仍由服务端回；再发布时删掉上一版多出的文件；未开启对象存储时同源', async () => {
    const calls: { method: string; url: string }[] = [];
    const fake = async (url: string, init: RequestInit) => {
      calls.push({ method: String(init.method), url });
      return new Response(null, { status: init.method === 'HEAD' ? 404 : 200 });
    };
    const context = await contestSetup({ objectStorageFetch: fake }, OBJECT_ENV);
    contexts.push(context);
    const { app, as, createCompetition } = context;
    const id = await createCompetition();
    const cdnPrefix = `https://files.example.test/yzgc/preview/contest-sites/`;
    const publish = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/api/console/competitions/${id}/site/publish`, headers: as('owner'), payload });

    const v1 = (await upload(app, id, sitePackage([{ path: 'assets/old.css', data: Buffer.from('a{}') }]), as('owner'))).json();
    expect((await publish({ version_id: v1.id, slug: 'oss-cdn' })).statusCode).toBe(200);
    const puts = calls.filter(call => call.method === 'PUT').map(call => call.url.replace(`https://s3.example.test/test-bucket/yzgc/preview/contest-sites/${id}/`, '')).sort();
    expect(puts).toEqual(['assets/app.js', 'assets/old.css']);
    expect(calls.some(call => call.method === 'PUT' && call.url === `https://s3.example.test/test-bucket/yzgc/preview/contest-sites/${id}/assets/old.css`)).toBe(true);
    expect(calls.some(call => call.url.includes('/index.html'))).toBe(false);

    const asset = await app.inject({ url: '/c/oss-cdn/assets/old.css' });
    expect(asset.statusCode).toBe(302);
    expect(asset.headers.location).toBe(`${cdnPrefix}${id}/assets/old.css`);
    const page = await app.inject({ url: '/c/oss-cdn/' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-security-policy']).toBe(siteCsp(cdnPrefix));
    expect(page.headers['content-security-policy']).toContain(`default-src 'self' ${cdnPrefix}`);
    expect(page.headers['content-security-policy']).toContain('sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox');

    // 第二版不带 old.css：上一版多出的文件从桶里删掉，旧地址不再 302，同源也找不到
    const v2 = (await upload(app, id, sitePackage(), as('owner'))).json();
    expect((await publish({ version_id: v2.id })).statusCode).toBe(200);
    expect(calls.some(call => call.method === 'DELETE' && call.url === `https://s3.example.test/test-bucket/yzgc/preview/contest-sites/${id}/assets/old.css`)).toBe(true);
    expect((await app.inject({ url: '/c/oss-cdn/assets/old.css' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/c/oss-cdn/assets/app.js' })).headers.location).toBe(`${cdnPrefix}${id}/assets/app.js`);

    // 没开对象存储：同一套流程不碰桶，资源同源回，CSP 与 #278 相同
    const local = await contestSetup({ objectStorageFetch: fake });
    contexts.push(local);
    const plain = await local.createCompetition();
    const localVersion = (await upload(local.app, plain, sitePackage(), local.as('owner'))).json();
    const before = calls.length;
    const published = await local.app.inject({ method: 'POST', url: `/api/console/competitions/${plain}/site/publish`, headers: local.as('owner'), payload: { version_id: localVersion.id, slug: 'oss-local' } });
    expect(published.statusCode).toBe(200);
    expect(calls.length).toBe(before);
    const localAsset = await local.app.inject({ url: '/c/oss-local/assets/app.js' });
    expect(localAsset.statusCode).toBe(200);
    expect((await local.app.inject({ url: '/c/oss-local/' })).headers['content-security-policy']).toBe(SITE_CSP);
  });
});
