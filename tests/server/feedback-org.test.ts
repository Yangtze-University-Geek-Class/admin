// 意见箱只收本部署管理的组织（#129）：组织名按不区分大小写认 CONSOLE_ORG，落库统一成配置里的写法；
// 别的组织名 400，不落库。控制台只按 CONSOLE_ORG 查，大小写不同的旧数据启动时改成规范写法。
import { afterEach, expect, it } from 'vitest';
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
