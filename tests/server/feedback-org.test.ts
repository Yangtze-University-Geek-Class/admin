// 意见箱只收本部署管理的组织（#129）：组织名按不区分大小写认 CONSOLE_ORG，落库统一成配置里的写法；
// 别的组织名 400，不落库。控制台只按 CONSOLE_ORG 查，大小写不同的旧数据启动时改成规范写法。
import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testApp } from './helpers';

type TestContext = { app: Awaited<ReturnType<typeof testApp>>['app']; close: () => Promise<void> };
type OrgRow = { org: string };
type CountRow = { n: number };

const contexts: TestContext[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
async function setup(env: Record<string, string> = {}): Promise<TestContext> {
  const c = await testApp({}, false, env);
  contexts.push(c);
  return c;
}
const ORG = 'Yangtze-University-Geek-Class';
const submit = (app: TestContext['app'], org: string, content = `发给 ${org} 的意见`) => app.inject({
  method: 'POST', url: '/api/feedback', headers: { origin: 'https://example.test' },
  payload: { org, content, category: '建议', pow: { timestamp: Date.now(), nonce: 'x' } },
});
const storedOrgs = (app: TestContext['app']): string[] => {
  const rows: OrgRow[] = app.services.storage.db.prepare('SELECT org FROM feedback ORDER BY id').all() as OrgRow[];
  return rows.map(row => row.org);
};

it('accepts the console org in any case and stores it in the configured spelling, so the console sees it', async () => {
  const { app } = await setup();
  for (const org of [ORG, ORG.toLowerCase(), ORG.toUpperCase()]) expect((await submit(app, org)).statusCode).toBe(200);
  expect(storedOrgs(app)).toEqual([ORG, ORG, ORG]);
  expect(app.services.feedback.listFeedback(app.services.config.consoleOrg).items).toHaveLength(3);
});

it('tells the portal which org the feedback box takes, so the page never submits a name the server rejects', async () => {
  const { app } = await setup();
  expect((await app.inject({ url: '/api/feedback/categories' })).json().org).toBe(ORG);
  // 部署换了组织（CONSOLE_ORG 与官网站点配置的 githubOrg 对不上）时，官网照接口下发的写法提交，照样能收
  const other = await setup({ CONSOLE_ORG: 'Some-Other-Org' });
  const served: string = (await other.app.inject({ url: '/api/feedback/categories' })).json().org;
  expect(served).toBe('Some-Other-Org');
  expect((await submit(other.app, served)).statusCode).toBe(200);
  expect(storedOrgs(other.app)).toEqual(['Some-Other-Org']);
});

it('rejects an organisation this deployment does not manage, without storing anything', async () => {
  const { app } = await setup();
  const response = await submit(app, 'some-random-org');
  expect(response.statusCode).toBe(400);
  expect(response.json().error).toContain(ORG);
  const count: CountRow = app.services.storage.db.prepare('SELECT COUNT(*) AS n FROM feedback').get() as CountRow;
  expect(count.n).toBe(0);
});

it('reads the public list for the console org in any case, and nothing for other organisations', async () => {
  const { app } = await setup();
  await submit(app, ORG);
  const count = async (org: string) => (await app.inject({ url: `/api/feedback/public?org=${org}` })).json().items.length;
  expect(await count(ORG)).toBe(1);
  expect(await count(ORG.toLowerCase())).toBe(1);
  expect(await count('some-random-org')).toBe(0);
});

it('answers a malformed org on the public list with 400 validation_error instead of a server error', async () => {
  const { app } = await setup();
  await submit(app, ORG);
  for (const query of [`org=${ORG}&org=${ORG.toLowerCase()}`, `org=${'a'.repeat(40)}`]) {
    const response = await app.inject({ url: `/api/feedback/public?${query}` });
    expect(response.statusCode, query).toBe(400);
    expect(response.json().error).toBe('validation_error');
  }
  // 合同整份替换了公共 querystring：limit 的规则仍在，别的参数照旧放行
  expect((await app.inject({ url: `/api/feedback/public?org=${ORG}&limit=0` })).statusCode).toBe(400);
  expect((await app.inject({ url: `/api/feedback/public?org=${ORG}&limit=1&_=1` })).json().items).toHaveLength(1);
});

it('verifies the proof against the org string the submitter sent, so another case is not a proof failure', async () => {
  const { app } = await setup({ POW_DIFFICULTY: '1' });
  const content = '小写组织名也要能提交';
  const submitted = `fb:${ORG.toLowerCase()}:${content}`;
  const canonical = `fb:${ORG}:${content}`;
  const timestamp = Date.now();
  // 只对提交的写法有效的 nonce：如果服务端改用规范写法算摘要，这条请求会 400，用例能区分修复前后
  const sha = (input: string) => createHash('sha256').update(input).digest('hex');
  let nonce = '';
  for (let n = 0; !nonce; n++) {
    const candidate = n.toString(36);
    if (sha(`${timestamp}:${submitted}:${candidate}`).startsWith('0') && !sha(`${timestamp}:${canonical}:${candidate}`).startsWith('0')) nonce = candidate;
  }
  const response = await app.inject({
    method: 'POST', url: '/api/feedback', headers: { origin: 'https://example.test' },
    payload: { org: ORG.toLowerCase(), content, category: '建议', pow: { timestamp, nonce } },
  });
  expect(response.statusCode).toBe(200);
  expect(storedOrgs(app)).toEqual([ORG]);
});

it('moves older rows written in another case onto the configured spelling when the server starts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'geek-feedback-org-'));
  dirs.push(dir);
  const dbPath = join(dir, 'data.db');
  const first = await setup({ DB_PATH: dbPath });
  const insert = first.app.services.storage.db.prepare("INSERT INTO feedback(org, content, status, created_at, updated_at) VALUES(?, ?, 'open', 1, 1)");
  insert.run(ORG.toLowerCase(), '旧的小写意见');
  insert.run('some-random-org', '别的组织的旧意见');
  await first.close();
  contexts.splice(contexts.indexOf(first), 1);

  const second = await setup({ DB_PATH: dbPath });
  expect(second.app.services.feedback.listFeedback(ORG).items.map(item => item.content)).toEqual(['旧的小写意见']);
  // 别的组织的旧数据不动：不猜它本来想发给谁
  expect(storedOrgs(second.app)).toEqual([ORG, 'some-random-org']);
});
