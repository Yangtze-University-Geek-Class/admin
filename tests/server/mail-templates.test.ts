import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../app/server/src/lib/db';
import { ALIYUN_ENDPOINT, RESEND_ENDPOINT } from '../../app/server/src/lib/mail/providers';
import { MAIL_TEMPLATES_SEED, runMailTemplatesMigration } from '../../app/server/src/lib/migrations/2026-10-mail-templates';
import { DEFAULT_TEMPLATES, SEED_TEMPLATES, TEMPLATE_VARIABLES } from '../../app/server/src/lib/mail/template-content';
import { accountIdOf, activityRows, grantPermGroup, grantPermNode, signIn, testApp } from './helpers';

/**
 * 招聘邮件多套模板、随时预览、测试邮箱试发（#285）。走真实路由；发信商的请求由假的 fetch 回答，不连真实的阿里云和 Resend。
 */

const T0 = Date.UTC(2026, 8, 27, 3, 0);
const HOUR = 3600_000;
const ALIYUN_ENV = { MAIL_ALIYUN_ACCESS_KEY_ID: 'test-aliyun-id', MAIL_ALIYUN_ACCESS_KEY_SECRET: 'test-aliyun-secret-value', MAIL_ALIYUN_FROM: 'notify@mail.example.test' };
const RESEND_ENV = { MAIL_RESEND_API_KEY: 're_test_resend_key_value', MAIL_RESEND_FROM: 'notify@example.test' };
const BOTH = { ...ALIYUN_ENV, ...RESEND_ENV, MAIL_RECIPIENTS: 'all' };
const APPLICANT = {
  name: '李小满', className: '计科2301', email: 'Xiaoman.Li@Example.test',
  strengths: '做过一个课表小程序，后端用 Go，前端用 Vue，喜欢折腾。',
};
const TEST_BOX = 'qa-box@example.test';

type Call = { url: string; body: string };
type Answer = { status: number; json: unknown };

function fakeFetch(handler: (call: Call) => Answer = defaultAnswer) {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const call = { url: String(url), body: String(init.body) };
    calls.push(call);
    const answer = handler(call);
    return new Response(JSON.stringify(answer.json), { status: answer.status, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
function defaultAnswer(call: Call): Answer {
  return call.url === ALIYUN_ENDPOINT ? { status: 200, json: { EnvId: 'env-1', RequestId: 'req-1' } } : { status: 200, json: { id: 're-message-1' } };
}
/** 这次请求是发给哪个地址的（阿里云是表单，Resend 是 JSON） */
const recipientOf = (call: Call): string => (call.url === ALIYUN_ENDPOINT ? new URLSearchParams(call.body).get('ToAddress')! : (JSON.parse(call.body).to as string[])[0]);
const subjectOf = (call: Call): string => (call.url === ALIYUN_ENDPOINT ? new URLSearchParams(call.body).get('Subject')! : JSON.parse(call.body).subject);

function clock(start = T0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

async function setup(env: Record<string, string> = BOTH, fetch = fakeFetch(), time = clock()) {
  const context = await testApp({ mailFetch: fetch.fetch, clock: time.now }, false, env);
  contexts.push(context);
  const { app } = context;
  const { db } = app.services.storage;
  let githubId = 100;
  /** 登录一个账号；group 是权限组，nodes 是直接加的权限节点 */
  const login = (name: string, options: { group?: string; nodes?: string[] } = {}) => {
    githubId += 1;
    const cookie = `sid=${signIn(app, name, githubId, null, `token-${name}`)}`;
    const accountId = accountIdOf(app, name);
    if (options.group) grantPermGroup(app, accountId, options.group);
    for (const node of options.nodes ?? []) grantPermNode(app, accountId, node);
    return { cookie, accountId, name };
  };
  const owner = login('alice', { group: 'title.site.owner' });
  const reviewer = login('reviewer', { nodes: ['apply.view', 'apply.review'] });
  const viewer = login('viewer-only', { nodes: ['apply.view'] });
  const applicant = { cookie: `sid=${signIn(app, 'mail-applicant', 9001, null)}` };
  const call = (who: { cookie: string }, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: { cookie: who.cookie }, payload });
  const api = {
    list: (who = owner) => call(who, 'GET', '/api/console/mail-templates'),
    create: (payload: Record<string, unknown>, who = owner) => call(who, 'POST', '/api/console/mail-templates', payload),
    patch: (id: string, payload: Record<string, unknown>, who = owner) => call(who, 'PATCH', `/api/console/mail-templates/${id}`, payload),
    remove: (id: string, who = owner) => call(who, 'DELETE', `/api/console/mail-templates/${id}`),
    preview: (payload: Record<string, unknown>, who = owner) => call(who, 'POST', '/api/console/mail-templates/preview', payload),
    testSend: (payload: Record<string, unknown>, who = owner) => call(who, 'POST', '/api/console/mail-templates/test-send', payload),
  };
  const apply = async (patch: Record<string, unknown> = {}) => {
    const response = await app.inject({ method: 'POST', url: '/api/portal/apply', headers: applicant, payload: { ...APPLICANT, pow: { timestamp: Date.now(), nonce: 'test' }, ...patch } });
    expect(response.statusCode).toBe(201);
    return response.json().id as string;
  };
  const seen = (id: string) => {
    const row = db.prepare('SELECT status FROM applications WHERE id = ?').get(id) as { status: string };
    const last = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM application_reviews WHERE application_id = ?').get(id) as { id: number };
    return { expected_status: row.status, expected_review_id: last.id };
  };
  const review = (id: string, payload: Record<string, unknown>, who: { cookie: string } = owner) => call(who, 'PATCH', `/api/console/applications/${id}`, { ...seen(id), ...payload });
  const letterPreview = (id: string, payload: Record<string, unknown>, who: { cookie: string } = owner) => call(who, 'POST', `/api/console/applications/${id}/letter-preview`, payload);
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const outbox = () => db.prepare('SELECT * FROM mail_outbox ORDER BY id').all() as Record<string, unknown>[];
  /** 预览和试发不该动的那些表的行数，加上发信商收到的请求数 */
  const footprint = () => ({
    applications: count('applications'), reviews: count('application_reviews'), outbox: count('mail_outbox'), templates: count('mail_templates'), calls: fetch.calls.length,
  });
  return { app, db, fetch, time, login, owner, reviewer, viewer, api, call, apply, review, letterPreview, count, outbox, footprint, mail: app.services.mail };
}

/** 一封「未通过」的自定义模板，用来对照默认模板 */
const GENTLE = {
  name: '温和一点', kind: 'rejected', subject: '给{{姓名}}的回信', preheader: '谢谢你写信给极客班', kicker: '招新进度 · 结果',
  blocks: [{ kind: 'paragraph', text: '谢谢你，{{姓名}}。' }, { kind: 'paragraph', text: '{{说明}}' }],
};

const sha = (rows: unknown) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');

describe('迁移', () => {
  it('第二次运行表和行数都不变，种子只插一次', () => {
    const { db } = createDatabase(':memory:');
    const dump = () => db.prepare('SELECT * FROM mail_templates ORDER BY id').all();
    const first = dump();
    expect(first).toHaveLength(5);
    expect(db.prepare('SELECT name FROM console_seeds WHERE name = ?').get(MAIL_TEMPLATES_SEED)).toBeTruthy();

    const report = runMailTemplatesMigration(db, Date.now() + 60_000);
    expect(report).toEqual({ rows_before: 5, rows_after: 5, seeded_this_run: 0 });
    expect(sha(dump())).toBe(sha(first));

    const kinds = db.prepare('SELECT kind, COUNT(*) AS n, SUM(is_default) AS defaults FROM mail_templates GROUP BY kind ORDER BY kind').all();
    expect(kinds).toEqual([
      { kind: 'accepted', n: 1, defaults: 1 }, { kind: 'interview', n: 2, defaults: 1 }, { kind: 'received', n: 1, defaults: 1 }, { kind: 'rejected', n: 1, defaults: 1 },
    ]);
  });

  it('控制台改过的、删掉的种子模板，重跑迁移不补回也不改回', () => {
    const { db } = createDatabase(':memory:');
    db.prepare("UPDATE mail_templates SET name = '我改过名', subject = '我改过的主题' WHERE id = 'default-rejected'").run();
    db.prepare("DELETE FROM mail_templates WHERE id = 'interview-short'").run();
    expect(runMailTemplatesMigration(db, Date.now())).toEqual({ rows_before: 4, rows_after: 4, seeded_this_run: 0 });
    expect(db.prepare("SELECT name, subject FROM mail_templates WHERE id = 'default-rejected'").get()).toEqual({ name: '我改过名', subject: '我改过的主题' });
    expect(db.prepare("SELECT 1 FROM mail_templates WHERE id = 'interview-short'").get()).toBeUndefined();
  });

  it('库里的种子和内置默认是同一份内容，不是另抄的', () => {
    const { db } = createDatabase(':memory:');
    for (const seed of SEED_TEMPLATES) {
      const row = db.prepare('SELECT * FROM mail_templates WHERE id = ?').get(seed.id) as Record<string, string | null>;
      expect(row.subject, seed.id).toBe(seed.content.subject);
      expect(JSON.parse(row.blocks as string), seed.id).toEqual(seed.content.blocks);
      expect(row.button_path, seed.id).toBe(seed.content.button?.path ?? null);
    }
    expect(SEED_TEMPLATES.filter(seed => seed.kind === 'interview')).toHaveLength(2);
    expect(DEFAULT_TEMPLATES.interview.id).toBe('default-interview');
  });

  it('库本身守住规则：每类只有一个默认、同类名字不重复（不分大小写）、默认必须启用', () => {
    const { db } = createDatabase(':memory:');
    const insert = (id: string, name: string, extra = '') => db.prepare(`INSERT INTO mail_templates(id, name, kind, subject, blocks, ${extra ? 'is_default, enabled, ' : ''}created_by, created_at, updated_by, updated_at)
      VALUES (?, ?, 'rejected', 's', '[]', ${extra ? extra + ', ' : ''}'t', 1, 't', 1)`).run(id, name);
    expect(() => insert('x1', '默认')).toThrow(/UNIQUE/);
    expect(() => insert('x2', 'ABC')).not.toThrow();
    expect(() => insert('x3', 'abc')).toThrow(/UNIQUE/);
    expect(() => insert('x4', '又一个默认', '1, 1')).toThrow(/UNIQUE/);
    expect(() => insert('x5', '停用的默认', '1, 0')).toThrow(/CHECK/);
  });
});

describe('权限', () => {
  it('模板接口只有站长默认能用；审核投递的人、普通成员都是 403，并说明缺哪个节点', async () => {
    const { api, reviewer, login } = await setup();
    const member = login('plain-member');
    for (const who of [reviewer, member]) {
      const responses = [
        await api.list(who), await api.create({ ...GENTLE }, who), await api.patch('default-rejected', { enabled: true }, who), await api.remove('interview-short', who),
        await api.preview({ template_id: 'default-rejected' }, who), await api.testSend({ template_id: 'default-rejected', to: TEST_BOX }, who),
      ];
      for (const response of responses) {
        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({ error: 'forbidden', node: 'mail.template.manage' });
      }
    }
  });

  it('没登录是 401；单独授予 mail.template.manage 的账号可以用，但读真实投递还要 apply.view', async () => {
    const { app, api, login, apply, db } = await setup();
    expect((await app.inject({ url: '/api/console/mail-templates' })).statusCode).toBe(401);
    const editor = login('editor', { nodes: ['mail.template.manage'] });
    expect((await api.list(editor)).statusCode).toBe(200);
    expect((await api.preview({ template_id: 'default-rejected' }, editor)).statusCode).toBe(200);
    const id = await apply();
    const denied = await api.preview({ template_id: 'default-rejected', application_id: id }, editor);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'forbidden', node: 'apply.view' });
    expect(db.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE action = 'mail.template.preview'").get()).toEqual({ n: 0 });
  });

  it('写操作和试发要求刚登录过，读和预览不要求', async () => {
    const { api, time, app, owner } = await setup();
    time.advance(11 * 60_000);
    for (const response of [
      await api.create({ ...GENTLE }), await api.patch('default-rejected', { enabled: true }), await api.remove('interview-short'),
      await api.testSend({ template_id: 'default-rejected', to: TEST_BOX }),
    ]) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: 'step_up_required' });
    }
    expect((await api.list()).statusCode).toBe(200);
    expect((await api.preview({ template_id: 'default-rejected' })).statusCode).toBe(200);
    // 重新登录之后又可以写
    const fresh = { cookie: `sid=${signIn(app, 'alice', 101, null, 'token-alice')}` };
    expect(fresh.cookie).not.toBe(owner.cookie);
    expect((await api.create({ ...GENTLE }, fresh)).statusCode).toBe(201);
  });
});

describe('模板的增删改查', () => {
  it('列表带着四类信的种子、变量清单、限制和发信状态', async () => {
    const { api } = await setup();
    const body = (await api.list()).json();
    expect(body.templates.map((item: { id: string }) => item.id)).toEqual(['default-received', 'default-interview', 'interview-short', 'default-accepted', 'default-rejected']);
    expect(body.templates.find((item: { id: string }) => item.id === 'default-interview')).toMatchObject({
      name: '默认', kind: 'interview', enabled: true, is_default: true, kicker: '招新进度 · 待面试', button: null, created_by: 'migration:2026-10-mail-templates',
    });
    expect(body.variables.map((item: { name: string }) => item.name)).toEqual(TEMPLATE_VARIABLES.map(item => item.name));
    expect(body.variables.find((item: { name: string }) => item.name === '面试时间')).toMatchObject({ group: 'letter', group_label: '改状态时填的', kinds: ['interview'] });
    expect(body.kinds.map((item: { id: string }) => item.id)).toEqual(['received', 'interview', 'accepted', 'rejected']);
    expect(body.limits).toMatchObject({ name: 40, subject: 100, blocks: 20 });
    expect(body.mail).toEqual({ enabled: true, recipients: 'all', reply_to: false });
    expect(body.test_send).toEqual({ per_hour_per_account: 10, per_hour_site: 30 });
  });

  it('新建一套：不是默认，出现在列表里，同类同名（不分大小写）被拒', async () => {
    const { api, count } = await setup();
    const created = await api.create({ ...GENTLE });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: '温和一点', kind: 'rejected', enabled: true, is_default: false, greeting: '{{称呼}}', button: null, footer: [], created_by: 'alice' });
    expect(count('mail_templates')).toBe(6);
    const again = await api.create({ ...GENTLE, name: '  温和一点 ' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'template_name_taken', reason: 'name_taken' });
    // 别的类别里可以重名
    expect((await api.create({ ...GENTLE, kind: 'accepted', blocks: [{ kind: 'paragraph', text: '欢迎。' }] })).statusCode).toBe(201);
    expect(count('mail_templates')).toBe(7);
  });

  it('保存时核对内容：不认识的变量、别的类别的变量、坏的按钮路径、块的结构都被拒，并指出位置', async () => {
    const { api, count } = await setup();
    const reject = async (patch: Record<string, unknown>) => {
      const response = await api.create({ ...GENTLE, name: `试${Math.random()}`, ...patch });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('template_invalid');
      return response.json().issues as { path: string; message: string }[];
    };
    const unknown = await reject({ subject: '给 {{部门}} 的信' });
    expect(unknown).toEqual([{ path: 'subject', message: expect.stringContaining('部门') }]);
    const wrongKind = await reject({ blocks: [{ kind: 'paragraph', text: '面试在 {{面试时间}}' }] });
    expect(wrongKind[0]).toMatchObject({ path: 'blocks[0].text' });
    expect(wrongKind[0].message).toContain('面试时间');
    expect((await reject({ button: { label: '点这里', path: 'https://evil.example/' } }))[0].path).toBe('button.path');
    expect((await reject({ button: { label: '点这里', path: '//evil.example/x' } }))[0].path).toBe('button.path');
    expect((await reject({ blocks: [{ kind: 'html', text: '<b>x</b>' }] }))[0].path).toBe('blocks[0]');
    expect((await reject({ blocks: [{ kind: 'paragraph', text: '你好', style: 'color:red' }] }))[0].path).toBe('blocks[0]');
    expect((await reject({ name: '' }))[0].path).toBe('name');
    const several = await reject({ subject: '{{甲}}', preheader: '{{乙}}' });
    expect(several.map(issue => issue.path)).toEqual(['subject', 'preheader']);
    expect(count('mail_templates')).toBe(5);
  });

  it('没配回信地址却请对方直接回复的模板，保存时就被拒，不等到发信那一刻', async () => {
    const { api } = await setup();
    const response = await api.create({ ...GENTLE, blocks: [{ kind: 'paragraph', text: '有问题请直接回复这封邮件。' }] });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'template_invalid', message: expect.stringContaining('回信地址') });
    // 配了回信地址的环境里同一段话可以保存
    const withReply = await setup({ ...BOTH, MAIL_REPLY_TO: 'join@example.test' });
    expect((await withReply.api.create({ ...GENTLE, blocks: [{ kind: 'paragraph', text: '有问题请直接回复这封邮件。' }] })).statusCode).toBe(201);
  });

  it('主题和抬头不能只靠可能为空的变量：没填说明时会渲染不出来的模板保存时被拒', async () => {
    const { api } = await setup();
    const response = await api.create({ ...GENTLE, subject: '{{说明}}' });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('没填');
  });

  it('改一套：内容、名字、启停；类别不能改；更新时间变了；别人先改过就 409', async () => {
    const { api, time } = await setup();
    const created = (await api.create({ ...GENTLE })).json();
    time.advance(5000);
    const edited = await api.patch(created.id, { subject: '新的主题 {{姓名}}', button: { label: '去论坛看看', path: '/forum/' }, footer: ['页脚一行'], expected_updated_at: created.updated_at });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ subject: '新的主题 {{姓名}}', button: { label: '去论坛看看', path: '/forum/' }, footer: ['页脚一行'], updated_at: created.updated_at + 5000, updated_by: 'alice' });
    // 没给的内容项沿用库里的
    expect(edited.json().blocks).toEqual(created.blocks);

    const stale = await api.patch(created.id, { name: '过期的改动', expected_updated_at: created.updated_at });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'template_changed' });
    expect((await api.list()).json().templates.find((item: { id: string }) => item.id === created.id).name).toBe('温和一点');

    expect((await api.patch(created.id, { kind: 'accepted' })).json()).toMatchObject({ error: 'validation_error' });
    const cleared = await api.patch(created.id, { button: null });
    expect(cleared.json().button).toBeNull();
    const taken = await api.patch(created.id, { name: '默认' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ error: 'template_name_taken' });
    expect((await api.patch(created.id, { name: '温和一点（改）' })).statusCode).toBe(200);
    // 改成自己现在的名字不算重名
    expect((await api.patch('default-rejected', { name: '默认' })).statusCode).toBe(200);
    expect((await api.patch('no-such-template', { enabled: false })).statusCode).toBe(404);
    expect((await api.patch(created.id, {})).json()).toMatchObject({ error: 'validation_error' });
  });

  it('每类信有且只有一个默认：换默认时旧的同时取消，默认不能停用或删除，停用的不能设为默认', async () => {
    const { api, db } = await setup();
    const defaults = () => (db.prepare("SELECT id FROM mail_templates WHERE kind = 'rejected' AND is_default = 1").all() as { id: string }[]).map(row => row.id);
    expect(defaults()).toEqual(['default-rejected']);
    const gentle = (await api.create({ ...GENTLE })).json();

    const locked = await api.patch('default-rejected', { enabled: false });
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toMatchObject({ error: 'default_template' });
    expect((await api.remove('default-rejected')).json()).toMatchObject({ error: 'default_template' });

    expect((await api.patch(gentle.id, { enabled: false })).statusCode).toBe(200);
    const disabled = await api.patch(gentle.id, { is_default: true });
    expect(disabled.statusCode).toBe(409);
    expect(disabled.json()).toMatchObject({ error: 'template_disabled' });
    expect(defaults()).toEqual(['default-rejected']);

    expect((await api.patch(gentle.id, { enabled: true })).statusCode).toBe(200);
    const switched = await api.patch(gentle.id, { is_default: true });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().is_default).toBe(true);
    expect(defaults()).toEqual([gentle.id]);
    // 只换默认标记不算改内容：更新时间不动
    expect(switched.json().updated_at).toBe(gentle.updated_at);

    expect((await api.remove('default-rejected')).statusCode).toBe(200);
    expect((await api.remove(gentle.id)).json()).toMatchObject({ error: 'default_template' });
    expect((await api.remove('default-rejected')).statusCode).toBe(404);
  });

  it('操作记录只写模板 id 和改了哪几项，不写模板内容', async () => {
    const { api, app } = await setup();
    const created = (await api.create({ ...GENTLE, blocks: [{ kind: 'paragraph', text: '只有这段话，不该出现在记录里。' }] })).json();
    await api.patch(created.id, { subject: '另一个主题 {{姓名}}', enabled: false });
    await api.remove(created.id);
    const rows = activityRows(app, { actionLike: 'mail.template.%' });
    expect(rows.map(row => [row.action, row.target_id, row.outcome])).toEqual([
      ['mail.template.create', created.id, 'ok'], ['mail.template.update', created.id, 'ok'], ['mail.template.delete', created.id, 'ok'],
    ]);
    expect(rows[1].meta).toEqual({ kind: 'rejected', fields: ['subject', 'enabled'] });
    expect(JSON.stringify(rows)).not.toContain('只有这段话');
    expect(JSON.stringify(rows)).not.toContain('另一个主题');
  });
});

describe('预览', () => {
  it('按模板 id 和按草稿都返回主题、HTML、纯文本；不入队、不改投递和审核、不请求发信商', async () => {
    const { api, apply, review, footprint, app } = await setup();
    const id = await apply();
    expect((await review(id, { status: 'interview', letter: { time: '9 月 30 日 19:00', place: '东校区 3 教 301' } })).statusCode).toBe(200);
    const before = footprint();
    const activityBefore = activityRows(app).length;

    const byId = await api.preview({ template_id: 'default-interview' });
    expect(byId.statusCode).toBe(200);
    const sample = byId.json();
    expect(Object.keys(sample).sort()).toEqual(['html', 'subject', 'text']);
    expect(sample.subject).toBe('极客班面试安排：9 月 30 日（周三）19:00');
    expect(sample.text).toContain('张同学，你好：');
    expect(sample.text).toContain('东校区 3 教 301');

    const draft = { kind: 'rejected', subject: '草稿主题', preheader: '', kicker: '', blocks: [{ kind: 'paragraph', text: '给{{姓名}}的话：{{说明}}' }] };
    const byDraft = await api.preview({ draft });
    expect(byDraft.statusCode).toBe(200);
    expect(byDraft.json().subject).toBe('草稿主题');
    expect(byDraft.json().text).toContain('给张三的话：这一轮我们更想找做过后端项目的同学。');

    // 预览用示例数据时换成自己填的示例
    const custom = await api.preview({ draft, sample: { name: '王五' }, letter: { message: '下一轮见。' } });
    expect(custom.json().text).toContain('给王五的话：下一轮见。');

    expect(footprint()).toEqual(before);
    // 编辑时每停一下就预览一次，用示例数据的预览不写操作记录
    expect(activityRows(app).length).toBe(activityBefore);
  });

  it('草稿有问题时回 400 和出错的位置，模板 id 和草稿要给一个，不能都给或都不给', async () => {
    const { api } = await setup();
    const bad = await api.preview({ draft: { kind: 'rejected', subject: '{{电话}}', blocks: [{ kind: 'paragraph', text: '你好' }] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'template_invalid', issues: [{ path: 'subject' }] });
    const both = await api.preview({ template_id: 'default-rejected', draft: { kind: 'rejected', subject: 's', blocks: [{ kind: 'paragraph', text: 'x' }] } });
    expect(both.json()).toMatchObject({ error: 'template_required' });
    expect((await api.preview({})).json()).toMatchObject({ error: 'template_required' });
    expect((await api.preview({ template_id: 'no-such-template' })).statusCode).toBe(404);
  });

  it('变量的值被转义，值里的网址不会变成可点的链接，按钮只指向官网', async () => {
    const { api } = await setup();
    const draft = {
      kind: 'interview', subject: '给{{姓名}}', preheader: '{{姓名}}', kicker: '',
      blocks: [{ kind: 'paragraph', text: '{{姓名}}' }, { kind: 'facts', items: [{ label: '班级', value: '{{班级}}' }] }, { kind: 'list', items: ['{{说明}}'] }],
      button: { label: '去论坛看看', path: '/forum/' },
    };
    const response = await api.preview({
      draft,
      sample: { name: '<script>alert(1)</script>', class_name: '<a href="https://evil.example/">点这里</a>' },
      letter: { notes: '<img src=x onerror=alert(2)>\njavascript:alert(3)\nhttps://evil.example/phish' },
    });
    expect(response.statusCode).toBe(200);
    const { html, text } = response.json();
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<a href="https://evil.example/">');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
    expect(text).toContain('<script>alert(1)</script>');
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map(match => match[1] as string);
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every(href => /^https:\/\/yangtzeu\.work\//.test(href))).toBe(true);
    expect(html).toContain('href="https://yangtzeu.work/forum/"');
  });

  it('用真实投递的字段预览：需要 apply.view，只记一条不含内容的操作记录，不改投递', async () => {
    const { api, apply, app, footprint } = await setup();
    const id = await apply({ name: '欧阳娜娜' });
    const before = footprint();
    const response = await api.preview({ template_id: 'default-rejected', application_id: id, letter: { message: '这一轮没有合适的位置。' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().text).toContain('欧阳同学，你好：');
    expect(response.json().text).toContain(`报名编号：${id}`);
    expect(response.json().text).toContain('这一轮没有合适的位置。');
    expect(footprint()).toEqual(before);
    const [record, ...rest] = activityRows(app, { action: 'mail.template.preview' });
    expect(rest).toEqual([]);
    expect(record).toMatchObject({ target_type: 'application', target_id: id, outcome: 'ok', meta: { kind: 'rejected', template_id: 'default-rejected' } });
    expect(JSON.stringify(record)).not.toContain('这一轮没有合适的位置');
    expect((await api.preview({ template_id: 'default-rejected', application_id: '5f0c2a8e-3d41-4b6f-9a7e-1c2d3e4f5a6b' })).statusCode).toBe(404);
  });

  it('待面试还没填时间和地点时，预览里用占位文字标出它们的位置', async () => {
    const { api } = await setup();
    const response = await api.preview({ template_id: 'default-interview', letter: { time: '', place: '  ' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().subject).toBe('极客班面试安排：【面试时间待填】');
    expect(response.json().text).toContain('【面试地点待填】');
  });
});

describe('测试邮箱试发', () => {
  it('只给填的这个邮箱发一封，主题带【测试】，投递、审核、其它邮件都不动，收件地址发完就清掉', async () => {
    const { api, apply, review, mail, fetch, footprint, outbox, db } = await setup();
    const id = await apply();
    expect((await review(id, { status: 'rejected', letter: { message: '谢谢你。' } })).statusCode).toBe(200);
    await mail.drain(); // 已收到、未通过两封先发掉
    expect(fetch.calls).toHaveLength(2);
    const before = footprint();

    const response = await api.testSend({ template_id: 'default-interview', to: ` ${TEST_BOX} ` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'sent', skip_reason: null, error: null, subject: '【测试】极客班面试安排：9 月 30 日（周三）19:00', to: 'q***@example.test' });

    const after = footprint();
    expect(after).toEqual({ ...before, outbox: before.outbox + 1, calls: before.calls + 1 });
    const call = fetch.calls.at(-1)!;
    expect(recipientOf(call)).toBe(TEST_BOX);
    expect(subjectOf(call)).toBe('【测试】极客班面试安排：9 月 30 日（周三）19:00');
    // 发给测试邮箱的信里是示例数据，不带真实投递人的内容
    expect(call.body).not.toContain(APPLICANT.email);
    expect(call.body).not.toContain('李小满');
    const row = outbox().at(-1)!;
    expect(row).toMatchObject({ kind: 'recruitment.test', application_id: null, review_id: null, status: 'sent', attempts: 1, recipient: null, html: null, text: null });
    expect(String(row.event_key)).toMatch(/^test:[0-9a-f-]{36}$/);
    expect(db.prepare('SELECT status FROM applications WHERE id = ?').get(id)).toEqual({ status: 'rejected' });
  });

  it('草稿也可以试发；每次的事件键都是新的，连点两次是两封', async () => {
    const { api, fetch, outbox } = await setup();
    const draft = { kind: 'accepted', subject: '草稿主题 {{姓名}}', blocks: [{ kind: 'paragraph', text: '欢迎，{{姓名}}。' }] };
    expect((await api.testSend({ draft, to: TEST_BOX })).json()).toMatchObject({ status: 'sent', subject: '【测试】草稿主题 张三' });
    expect((await api.testSend({ draft, to: TEST_BOX })).json()).toMatchObject({ status: 'sent' });
    expect(fetch.calls).toHaveLength(2);
    expect(new Set(outbox().map(row => row.event_key)).size).toBe(2);
  });

  it('地址不合法、模板有问题、渲染不出来时不入队也不占次数', async () => {
    const { api, footprint, db } = await setup();
    const before = footprint();
    for (const to of ['不是邮箱', 'a@b', 'a@example.test\r\nBcc: x@evil.example', 'two@example.test,three@example.test', 'x <y@example.test>']) {
      const response = await api.testSend({ template_id: 'default-rejected', to });
      expect(response.statusCode, to).toBe(400);
      expect(response.json(), to).toMatchObject({ error: 'invalid_address' });
    }
    expect((await api.testSend({ draft: { kind: 'rejected', subject: '{{电话}}', blocks: [{ kind: 'paragraph', text: 'x' }] }, to: TEST_BOX })).json()).toMatchObject({ error: 'template_invalid' });
    expect((await api.testSend({ template_id: 'default-rejected', draft: { kind: 'rejected', subject: 's', blocks: [{ kind: 'paragraph', text: 'x' }] }, to: TEST_BOX })).json()).toMatchObject({ error: 'template_required' });
    expect((await api.testSend({ template_id: 'no-such-template', to: TEST_BOX })).statusCode).toBe(404);
    expect(footprint()).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM limit_events WHERE bucket = 'mail.test.hourly'").get()).toEqual({ n: 0 });
  });

  it('每个账号每小时 10 封，第 11 封回 429；过了一小时又可以', async () => {
    const { api, fetch, time, app, db } = await setup();
    for (let i = 0; i < 10; i += 1) expect((await api.testSend({ template_id: 'default-rejected', to: TEST_BOX })).statusCode).toBe(200);
    const limited = await api.testSend({ template_id: 'default-rejected', to: TEST_BOX });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: 'rate_limited', bucket: 'mail.test.hourly', retry_after: 3600 });
    expect(limited.headers['retry-after']).toBe('3600');
    expect(fetch.calls).toHaveLength(10);
    expect(db.prepare("SELECT COUNT(*) AS n FROM mail_outbox WHERE kind = 'recruitment.test'").get()).toEqual({ n: 10 });

    time.advance(HOUR + 60_000);
    const fresh = { cookie: `sid=${signIn(app, 'alice', 101, null, 'token-alice')}` };
    expect((await api.testSend({ template_id: 'default-rejected', to: TEST_BOX }, fresh)).statusCode).toBe(200);
    expect(fetch.calls).toHaveLength(11);
  });

  it('全站每小时 30 封：不同账号加起来超过就回 429，不再发', async () => {
    const { api, fetch, login } = await setup();
    for (const name of ['owner-a', 'owner-b', 'owner-c']) {
      const who = login(name, { group: 'title.site.owner' });
      for (let i = 0; i < 10; i += 1) expect((await api.testSend({ template_id: 'default-rejected', to: TEST_BOX }, who)).statusCode).toBe(200);
    }
    expect(fetch.calls).toHaveLength(30);
    const last = await api.testSend({ template_id: 'default-rejected', to: TEST_BOX }, login('owner-d', { group: 'title.site.owner' }));
    expect(last.statusCode).toBe(429);
    expect(last.json()).toMatchObject({ error: 'rate_limited', bucket: 'mail.test.site' });
    expect(fetch.calls).toHaveLength(30);
  });

  it('没配置发信商、或地址不在白名单里：照实回答 skipped，不入队、不占次数', async () => {
    const off = await setup({ MAIL_RECIPIENTS: 'all' });
    const none = await off.api.testSend({ template_id: 'default-rejected', to: TEST_BOX });
    expect(none.statusCode).toBe(200);
    expect(none.json()).toMatchObject({ status: 'skipped', skip_reason: 'mail_disabled', error: null });
    expect(off.count('mail_outbox')).toBe(0);
    expect(off.count('limit_events')).toBe(0);

    const listed = await setup({ ...RESEND_ENV, MAIL_RECIPIENTS: 'allowlist', MAIL_ALLOWLIST: 'friend@example.test' });
    const refused = await listed.api.testSend({ template_id: 'default-rejected', to: TEST_BOX });
    expect(refused.json()).toMatchObject({ status: 'skipped', skip_reason: 'not_allowlisted' });
    expect(listed.fetch.calls).toHaveLength(0);
    const allowed = await listed.api.testSend({ template_id: 'default-rejected', to: 'Friend@Example.test' });
    expect(allowed.json()).toMatchObject({ status: 'sent' });
    expect(listed.fetch.calls).toHaveLength(1);
  });

  it('发信商都失败时如实回报原因，只试一次、不排重试', async () => {
    const fetch = fakeFetch(() => ({ status: 500, json: { Code: 'Boom' } }));
    const { api, mail, time, outbox } = await setup(BOTH, fetch);
    const response = await api.testSend({ template_id: 'default-rejected', to: TEST_BOX });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('failed');
    expect(body.error).toContain('aliyun');
    expect(body.error).toContain('resend');
    expect(body.error).not.toContain(TEST_BOX);
    expect(fetch.calls.map(call => call.url)).toEqual([ALIYUN_ENDPOINT, RESEND_ENDPOINT]);
    expect(outbox().at(-1)).toMatchObject({ kind: 'recruitment.test', status: 'failed', attempts: 1, recipient: null, html: null });
    time.advance(7 * HOUR);
    await mail.drain();
    expect(fetch.calls).toHaveLength(2);
  });

  it('发到一半断掉的测试信租约到期后不补发，而同样情形的正式信会重新领走', async () => {
    const { mail, db, fetch, outbox, time } = await setup();
    const letter = mail.previewLetter('rejected', DEFAULT_TEMPLATES.rejected.content, { id: 'x', name: '张三', class_name: '计科', email: 'a@example.test', strengths: '特长', created_at: T0 }, {});
    for (const [key, kind] of [['stale-test', 'recruitment.test'], ['stale-real', 'recruitment.rejected']] as const) {
      mail.enqueue({ eventKey: key, kind, to: TEST_BOX, mail: letter });
      db.prepare("UPDATE mail_outbox SET status = 'sending', attempts = 1, next_attempt_at = ? WHERE event_key = ?").run(time.now() - 1, key);
    }
    await mail.drain();
    const rows = Object.fromEntries(outbox().map(row => [row.event_key, row]));
    expect(rows['stale-test']).toMatchObject({ status: 'failed', last_error: 'lease_expired' });
    expect(rows['stale-real']).toMatchObject({ status: 'sent' });
    expect(fetch.calls).toHaveLength(1);
  });

  it('操作记录里只有脱敏的邮箱和模板 id，没有邮箱明文和信的内容', async () => {
    const { api, app } = await setup();
    await api.testSend({ template_id: 'default-interview', to: TEST_BOX });
    await api.testSend({ draft: { kind: 'accepted', subject: '草稿主题', blocks: [{ kind: 'paragraph', text: '草稿正文' }] }, to: TEST_BOX });
    const rows = activityRows(app, { action: 'mail.template.test_send' });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ target_type: 'mail_template', target_id: 'default-interview', outcome: 'ok', meta: { kind: 'interview', to: 'q***@example.test', status: 'sent', skip_reason: null } });
    expect(rows[1]).toMatchObject({ target_id: 'draft', meta: { kind: 'accepted' } });
    const dump = JSON.stringify(activityRows(app));
    expect(dump).not.toContain(TEST_BOX);
    expect(dump).not.toContain('qa-box');
    expect(dump).not.toContain('草稿正文');
  });
});

describe('改状态时选模板', () => {
  it('选不同的模板，得到不同的主题和正文；不传用这一类的默认', async () => {
    const { api, apply, review, outbox } = await setup();
    const gentle = (await api.create({ ...GENTLE })).json();
    const first = await apply();
    const second = await apply({ email: 'second@example.test', name: '王小五' });
    const third = await apply({ email: 'third@example.test' });
    expect((await review(first, { status: 'rejected', letter: { message: '这一轮没能请你加入。' } })).statusCode).toBe(200);
    expect((await review(second, { status: 'rejected', template_id: gentle.id, letter: { message: '下一轮见。' } })).statusCode).toBe(200);
    expect((await review(third, { status: 'interview', template_id: 'interview-short', letter: { time: '9 月 30 日 19:00', place: '东校区 3 教 301' } })).statusCode).toBe(200);
    const [, , , byDefault, byChoice, short] = outbox();
    expect(byDefault).toMatchObject({ kind: 'recruitment.rejected', subject: '极客班招新结果' });
    expect(byChoice).toMatchObject({ kind: 'recruitment.rejected', subject: '给王小五的回信', recipient: 'second@example.test' });
    expect(String(byChoice.text)).toContain('谢谢你，王小五。');
    expect(String(byChoice.text)).toContain('下一轮见。');
    expect(String(byChoice.text)).not.toContain('论坛不登录只能看公开的帖子');
    expect(short).toMatchObject({ kind: 'recruitment.interview', subject: '极客班面试：9 月 30 日 19:00' });
    expect(String(short.text)).not.toContain('你的报名信我们看过了');
  });

  it('换了默认之后，不传 template_id 的改状态和投递后自动发的已收到信都用新的默认', async () => {
    const { api, apply, outbox } = await setup();
    const warm = (await api.create({
      name: '更热情', kind: 'received', subject: '收到啦，{{姓名}}', preheader: '', kicker: '', blocks: [{ kind: 'paragraph', text: '我们收到你的信了。' }],
    })).json();
    expect((await api.patch(warm.id, { is_default: true })).statusCode).toBe(200);
    await apply();
    expect(outbox().at(-1)).toMatchObject({ kind: 'recruitment.received', subject: '收到啦，李小满' });
  });

  it('template_id 类别不对、已停用、不存在都被拒，状态不改、不入队、不写审核记录', async () => {
    const { api, apply, review, footprint, db } = await setup();
    const id = await apply();
    const disabled = (await api.create({ ...GENTLE, name: '停用的' })).json();
    await api.patch(disabled.id, { enabled: false });
    const before = footprint();
    const cases: [string, string][] = [['default-interview', 'kind_mismatch'], [disabled.id, 'disabled'], ['no-such-template', 'not_found']];
    for (const [templateId, reason] of cases) {
      const response = await review(id, { status: 'rejected', template_id: templateId, letter: { message: '谢谢。' } });
      expect(response.statusCode, reason).toBe(400);
      expect(response.json(), reason).toMatchObject({ error: 'template_invalid', reason });
    }
    expect(footprint()).toEqual(before);
    expect(db.prepare('SELECT status FROM applications WHERE id = ?').get(id)).toEqual({ status: 'received' });
    // 不发信的改动里 template_id 不起作用
    expect((await review(id, { status: 'rejected', notify: false, template_id: 'default-interview' })).statusCode).toBe(200);
  });

  it('改状态的接口挂上响应合同后，成功体和 409、400 的失败体仍带着原来的全部字段', async () => {
    const { apply, review, call, owner } = await setup();
    const id = await apply();
    const url = `/api/console/applications/${id}`;

    const missing = await review(id, { status: 'interview' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: 'letter_required', message: '要发待面试的信，请填面试时间和地点', fields: { time: '请填面试时间', place: '请填面试地点' } });

    const changed = await review(id, { status: 'interview', letter: { time: '9 月 30 日 19:00', place: '东校区 3 教 301' } });
    expect(changed.statusCode).toBe(200);
    const detail = (await call(owner, 'GET', url)).json();
    // 成功体：application 和详情接口里的是同一份，review 带着写进去的那条记录和它的邮件状态
    expect(changed.json().application).toEqual(detail.application);
    expect(Object.keys(changed.json().review).sort()).toEqual(['created_at', 'from_status', 'id', 'mail', 'note', 'reviewer', 'to_status']);
    expect(changed.json().review).toMatchObject({ from_status: 'received', to_status: 'interview', mail: expect.objectContaining({ status: expect.any(String) }) });

    // 拿着旧画面再改：409 带着最新的 application，不改状态
    const stale = await call(owner, 'PATCH', url, { status: 'accepted', expected_status: 'received', expected_review_id: 0, letter: { notes: '欢迎。' } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'status_changed', application: detail.application });
    expect(stale.json().message).toContain('刚被别人处理过');
  });

  it('模板在库里是坏的（绕过了保存时的核对）时，渲染失败仍回 400，状态不改', async () => {
    const { apply, review, db, footprint } = await setup();
    const id = await apply();
    db.prepare(`INSERT INTO mail_templates(id, name, kind, subject, blocks, button_label, button_path, created_by, created_at, updated_by, updated_at)
      VALUES ('bad-link', '坏链接', 'rejected', '主题', '[{"kind":"paragraph","text":"你好"}]', '点这里', '//evil.example/x', 't', 1, 't', 1)`).run();
    const before = footprint();
    const response = await review(id, { status: 'rejected', template_id: 'bad-link' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'letter_invalid' });
    expect(footprint()).toEqual(before);
    expect(db.prepare('SELECT status FROM applications WHERE id = ?').get(id)).toEqual({ status: 'received' });
  });

  it('变量的值是投递人的字或审核人填的字时被转义，实际发出的信里没有可执行的标签和外链', async () => {
    const { api, apply, review, outbox } = await setup();
    const gentle = (await api.create({ ...GENTLE })).json();
    const id = await apply({ name: '<img src=x onerror=alert(1)>' });
    expect((await review(id, { status: 'rejected', template_id: gentle.id, letter: { message: '<script>alert(2)</script>\nhttps://evil.example/phish\njavascript:alert(3)' } })).statusCode).toBe(200);
    const row = outbox().at(-1)!;
    const html = String(row.html);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
    expect(html).not.toMatch(/href="(?!https:\/\/yangtzeu\.work\/)/);
    expect(String(row.text)).toContain('<script>alert(2)</script>');
  });

  it('投递详情带着每类信启用的模板（只有名字），停用的不出现', async () => {
    const { api, apply, call, reviewer } = await setup();
    const id = await apply();
    const extra = (await api.create({ ...GENTLE, name: '备选' })).json();
    await api.create({ ...GENTLE, name: '停用的' }).then(response => api.patch(response.json().id, { enabled: false }));
    // 审核人没有 mail.template.manage，也能看到可选的名字
    const detail = (await call(reviewer, 'GET', `/api/console/applications/${id}`)).json();
    expect(detail.letter_templates).toEqual({
      interview: [{ id: 'default-interview', name: '默认', is_default: true }, { id: 'interview-short', name: '面试邀请 · 简短', is_default: false }],
      accepted: [{ id: 'default-accepted', name: '默认', is_default: true }],
      rejected: [{ id: 'default-rejected', name: '默认', is_default: true }, { id: extra.id, name: '备选', is_default: false }],
    });
    expect(JSON.stringify(detail.letter_templates)).not.toContain('subject');
  });

  it('审核人也能预览将要发的信：用这份投递的真实字段，不发信、不改状态、不写审核记录', async () => {
    const { apply, letterPreview, reviewer, viewer, footprint, app } = await setup();
    const id = await apply();
    const before = footprint();
    const activityBefore = activityRows(app).length;

    const preview = await letterPreview(id, { status: 'interview', template_id: 'interview-short', letter: { time: '9 月 30 日 19:00', place: '东校区 3 教 301', notes: '带上学生证。' } }, reviewer);
    expect(preview.statusCode).toBe(200);
    expect(preview.json().subject).toBe('极客班面试：9 月 30 日 19:00');
    expect(preview.json().text).toContain('李同学，你好：');
    expect(preview.json().text).toContain('带上学生证。');
    // 时间地点还没填：占位，不报 letter_required
    const blank = await letterPreview(id, { status: 'interview' }, reviewer);
    expect(blank.statusCode).toBe(200);
    expect(blank.json().text).toContain('【面试时间待填】');
    // 默认模板
    expect((await letterPreview(id, { status: 'rejected', letter: { message: '谢谢。' } }, reviewer)).json().subject).toBe('极客班招新结果');

    expect(footprint()).toEqual(before);
    expect(activityRows(app).length).toBe(activityBefore);

    expect((await letterPreview(id, { status: 'cancelled' }, reviewer)).json()).toMatchObject({ error: 'no_letter' });
    expect((await letterPreview(id, { status: 'accepted', template_id: 'interview-short' }, reviewer)).json()).toMatchObject({ error: 'template_invalid', reason: 'kind_mismatch' });
    expect((await letterPreview('5f0c2a8e-3d41-4b6f-9a7e-1c2d3e4f5a6b', { status: 'rejected' }, reviewer)).statusCode).toBe(404);
    // 只有 apply.view、没有 apply.review 的人不能预览
    const denied = await letterPreview(id, { status: 'rejected' }, viewer);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'forbidden', node: 'apply.review' });
  });
});
