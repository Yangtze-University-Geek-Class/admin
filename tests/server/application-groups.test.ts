import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../app/server/src/services';
import { groupApplications, nameClassKey } from '../../app/server/src/lib/application-groups';
import { APPLICATION_STATUS_IDS } from '../../app/server/src/lib/roles';
import { testApp } from './helpers';

/**
 * 投递按人归并与「已取消」（#184）：邮箱按收件箱规则归并后相同、或姓名+班级相同，任一成立就是同一个人，链式连通；
 * 列表一人一条、计数按投递份数且和筛选结果对得上、分页按人、CSV 与列表同一口径、改成已取消不发信但写审核记录。
 * 发信商的请求一律拒绝（helpers.ts 的 mailFetch），这里只看发信队列里写没写信。
 */

const CONSOLE_ORG = 'Yangtze-University-Geek-Class';
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

const octokitFactory = (() => ({
  request: async (route: string, params: Record<string, string>) => {
    if (route === 'GET /orgs/{org}/memberships/{username}' && params.org === CONSOLE_ORG && params.username.toLowerCase() === 'alice') return { data: { state: 'active', role: 'admin' } };
    throw Object.assign(new Error('stub not found'), { status: 404 });
  },
})) as unknown as ServiceOverrides['octokitFactory'];

const T0 = Date.UTC(2026, 8, 20, 4, 0);
const MIN = 60_000;
let seq = 0;
/** 只有归并用得到的列；id 按插入顺序递增，好读断言。 */
const row = (name: string, class_name: string, email: string, minutes: number) =>
  ({ id: `a${String(++seq).padStart(3, '0')}`, name, class_name, email, created_at: T0 + minutes * MIN });

describe('groupApplications', () => {
  it('joins applications with the same inbox even when the name differs', () => {
    const a = row('张三', '计科2301', 'zhangsan@example.test', 0);
    const b = row('张叁', '计科2302', 'ZhangSan@Example.test ', 5);
    const { groups } = groupApplications([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: a.id, reasons: ['email'] });
    expect(groups[0].members.map(m => [m.id, m.linked_by])).toEqual([[b.id, ['email']], [a.id, ['email']]]);
  });

  it('joins applications with the same name and class even when the email differs', () => {
    const a = row('李四', '软件2301', 'lisi@example.test', 0);
    const b = row('李四', '软件2301', 'li.si.new@example.test', 3);
    const { groups } = groupApplications([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: a.id, reasons: ['name_class'] });
    expect(groups[0].members.every(m => m.linked_by.join() === 'name_class')).toBe(true);
  });

  it('chains links: A and B share an inbox, B and C share a name and class, so A, B, C are one person', () => {
    const a = row('王五', '信安2401', 'wangwu@example.test', 0);
    const b = row('王小五', '信安2402', 'wangwu+again@example.test', 10);
    const c = row('王小五', '信安2402', 'xiaowu@example.test', 20);
    const other = row('王五', '信安2402', 'someone@example.test', 30); // 同名不同班：不是同一个人
    const { groups, byId } = groupApplications([a, b, c, other]);
    expect(groups.map(g => g.members.map(m => m.id))).toEqual([[other.id], [c.id, b.id, a.id]]);
    const person = byId.get(a.id)!;
    expect(person).toBe(byId.get(c.id));
    expect(person.reasons).toEqual(['email', 'name_class']);
    expect(Object.fromEntries(person.members.map(m => [m.id, m.linked_by]))).toEqual({ [a.id]: ['email'], [b.id]: ['email', 'name_class'], [c.id]: ['name_class'] });
    expect(byId.get(other.id)).toMatchObject({ key: other.id, reasons: [] });
    expect(byId.get(other.id)!.members[0].linked_by).toEqual([]);
  });

  it('folds case, +tags, Gmail dots and googlemail.com like the mail queue does', () => {
    const rows = [
      row('赵六', '计科2301', 'Zhao.Liu@Gmail.com', 0),
      row('赵 六', '计科２３０１', 'zhaoliu@googlemail.com', 1),
      row('Zhao Liu', 'CS2301', 'zhaoliu+join@gmail.com.', 2),
    ];
    const { groups } = groupApplications(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].reasons).toEqual(['email', 'name_class']);
    // 姓名班级：全角数字算半角、空白不算；不同写法的英文名字不会凑到一起，第三份只靠邮箱连上
    expect(nameClassKey('赵 六', '计科２３０１')).toBe(nameClassKey('赵六', '计科2301'));
    expect(groups[0].members.find(m => m.name === 'Zhao Liu')!.linked_by).toEqual(['email']);
    // 别的域名的点不忽略
    expect(groupApplications([row('甲', '一班', 'a.b@example.test', 0), row('乙', '二班', 'ab@example.test', 1)]).groups).toHaveLength(2);
  });

  it('keys a person by the earliest application and orders people by their newest one', () => {
    const early = row('孙七', '计科2303', 'sunqi@example.test', 0);
    const lone = row('周八', '计科2304', 'zhouba@example.test', 50);
    const late = row('孙七', '计科2303', 'sun7@example.test', 100);
    const { groups } = groupApplications([lone, late, early]);
    expect(groups.map(g => g.key)).toEqual([early.id, lone.id]);
  });
});

async function setup() {
  const context = await testApp({ octokitFactory });
  contexts.push(context);
  const { app } = context;
  const { db } = app.services.storage;
  const alice = { cookie: `sid=${app.services.auth.createSession('alice', 101, null, 'token-alice')}` };
  const insert = (patch: { name: string; class_name: string; email: string; status?: string; minutes: number }) => {
    const id = randomUUID();
    db.prepare('INSERT INTO applications(id, name, class_name, email, strengths, source_ip, user_agent, status, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, patch.name, patch.class_name, patch.email, `${patch.name} 的特长与优点`, '203.0.113.7', 'fixture-agent/1.0', patch.status ?? 'received', T0 + patch.minutes * MIN);
    return id;
  };
  const list = async (query = '') => (await app.inject({ url: `/api/console/applications${query}`, headers: alice })).json();
  return { app, db, alice, insert, list };
}

/** 三个人五份投递：甲同一个邮箱投了两次；乙一份；丙换邮箱又投了一次，后投的那份已取消。 */
async function seeded() {
  const context = await setup();
  const { insert } = context;
  const ids = {
    jiaOld: insert({ name: '甲', class_name: '计科2301', email: 'jia@example.test', minutes: 0 }),
    yi: insert({ name: '乙', class_name: '软件2302', email: 'yi@example.test', status: 'interview', minutes: 10 }),
    bing: insert({ name: '丙', class_name: '信安2401', email: 'bing@example.test', minutes: 20 }),
    jiaNew: insert({ name: '甲', class_name: '计科2301', email: 'Jia@Example.test', minutes: 30 }),
    bingAgain: insert({ name: '丙', class_name: '信安2401', email: 'bing.second@example.test', status: 'cancelled', minutes: 40 }),
  };
  return { ...context, ids };
}

type Item = { id: string; status: string; person: { key: string; reasons: string[]; size: number; applications: { id: string; email: string; status: string; linked_by: string[] }[] } };

describe('GET /api/console/applications groups by person', () => {
  it('lists one row per person with every application underneath, and counts applications per status', async () => {
    const { list, ids } = await seeded();
    const body = await list();
    expect(body.total).toBe(3);
    expect(body.total_applications).toBe(5);
    expect(body.counts).toEqual({ received: 3, interview: 1, accepted: 0, rejected: 0, cancelled: 1 });
    const sum = Object.values(body.counts as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(sum).toBe(body.total_applications);
    // 丙的主记录是没取消的那份，排在甲（30 分钟）后面；甲的主记录是新投的那份
    expect(body.items.map((item: Item) => item.id)).toEqual([ids.jiaNew, ids.bing, ids.yi]);
    const [jia, bing, yi] = body.items as Item[];
    expect(jia.person).toMatchObject({ key: ids.jiaOld, reasons: ['email', 'name_class'], size: 2 });
    expect(jia.person.applications.map(a => [a.id, a.email, a.status])).toEqual([[ids.jiaNew, 'Jia@Example.test', 'received'], [ids.jiaOld, 'jia@example.test', 'received']]);
    expect(bing.status).toBe('received');
    expect(bing.person).toMatchObject({ key: ids.bing, reasons: ['name_class'], size: 2 });
    expect(bing.person.applications.map(a => [a.id, a.status, a.linked_by])).toEqual([[ids.bingAgain, 'cancelled', ['name_class']], [ids.bing, 'received', ['name_class']]]);
    expect(yi.person).toMatchObject({ key: ids.yi, reasons: [], size: 1 });
  });

  it('keeps every status chip equal to the applications the list shows for it', async () => {
    const { list, ids } = await seeded();
    const { counts } = await list();
    for (const status of APPLICATION_STATUS_IDS) {
      const filtered = await list(`?status=${status}`);
      expect(filtered.total_applications, status).toBe(counts[status]);
      expect((filtered.items as Item[]).flatMap(item => item.person.applications).every(a => a.status === status), status).toBe(true);
    }
    // 选「已取消」：丙那一份取消的投递，主记录就是它，这个人一共两份
    const cancelled = await list('?status=cancelled');
    expect(cancelled).toMatchObject({ total: 1, total_applications: 1 });
    expect(cancelled.items[0]).toMatchObject({ id: ids.bingAgain, status: 'cancelled', person: { key: ids.bing, size: 2 } });
    expect(cancelled.items[0].person.applications.map((a: { id: string }) => a.id)).toEqual([ids.bingAgain]);
  });

  it('pages by person: a person is never split across pages, and total stays the number of people', async () => {
    const { list } = await seeded();
    const pages = [];
    for (const offset of [0, 1, 2, 3]) pages.push(await list(`?limit=1&offset=${offset}`));
    expect(pages.map(page => page.total)).toEqual([3, 3, 3, 3]);
    expect(pages.map(page => page.items.length)).toEqual([1, 1, 1, 0]);
    expect(pages.slice(0, 3).map(page => page.items[0].person.applications.length)).toEqual([2, 2, 1]);
    expect(new Set(pages.slice(0, 3).map(page => page.items[0].person.key)).size).toBe(3);
  });

  it('searches applications and still says how many the person has in all', async () => {
    const { list, ids } = await seeded();
    const found = await list(`?q=${encodeURIComponent('bing.second')}`);
    expect(found).toMatchObject({ total: 1, total_applications: 1 });
    expect(found.items[0]).toMatchObject({ id: ids.bingAgain, person: { key: ids.bing, size: 2 } });
    expect((await list('?q=%25')).total).toBe(0);
  });

  it('shows the whole person on the detail page, the current application included', async () => {
    const { app, alice, ids } = await seeded();
    const detail = (await app.inject({ url: `/api/console/applications/${ids.bingAgain}`, headers: alice })).json();
    expect(detail.person).toMatchObject({ key: ids.bing, reasons: ['name_class'] });
    expect(detail.person.applications.map((a: { id: string; status: string }) => [a.id, a.status])).toEqual([[ids.bingAgain, 'cancelled'], [ids.bing, 'received']]);
    const lone = (await app.inject({ url: `/api/console/applications/${ids.yi}`, headers: alice })).json();
    expect(lone.person).toMatchObject({ key: ids.yi, reasons: [], applications: [{ id: ids.yi, linked_by: [] }] });
  });

  it('exports the CSV in the list order with the same person groups', async () => {
    const { app, alice, list, ids } = await seeded();
    const csv = async (query = '') => {
      const response = await app.inject({ url: `/api/console/applications/export.csv${query}`, headers: alice });
      expect(response.statusCode).toBe(200);
      const [header, ...lines] = response.body.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
      return { header, lines: lines.map(line => line.split(',')) };
    };
    const all = await csv();
    expect(all.header).toBe('name,class_name,email,strengths,status,created_at_beijing,person_group');
    const listed = (await list()).items as Item[];
    // 每一行的 person_group 是列表里那个人的 person.key，先后和列表展开后的顺序一样
    expect(all.lines.map(cells => [cells[2], cells[4], cells[6]])).toEqual(listed.flatMap(item => item.person.applications.map(a => [a.email, a.status, item.person.key])));
    expect(new Set(all.lines.map(cells => cells[6])).size).toBe(3);
    const cancelled = await csv('?status=cancelled');
    expect(cancelled.lines).toEqual([['丙', '信安2401', 'bing.second@example.test', '丙 的特长与优点', 'cancelled', expect.any(String), ids.bing]]);
  });

  it('counts cancelled applications in by_status but not in the overview total', async () => {
    const { app, alice } = await seeded();
    const summary = (await app.inject({ url: '/api/console/summary', headers: alice })).json();
    expect(summary.applications.total).toBe(4);
    expect(summary.applications.by_status).toEqual({ received: 3, interview: 1, accepted: 0, rejected: 0, cancelled: 1 });
  });
});

describe('marking an application 已取消', () => {
  it('writes a review with who and when, queues no letter, and can be undone', async () => {
    const { app, db, alice, ids } = await seeded();
    const url = `/api/console/applications/${ids.jiaOld}`;
    const before = Date.now();
    const cancel = await app.inject({
      method: 'PATCH', url, headers: alice,
      payload: { status: 'cancelled', expected_status: 'received', expected_review_id: 0, note: '和 30 分钟后那份重复', notify: true, letter: { message: '不会发出去' } },
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toMatchObject({ application: { id: ids.jiaOld, status: 'cancelled' }, review: { from_status: 'received', to_status: 'cancelled', reviewer: 'alice', mail: null } });
    expect(cancel.json().review.created_at).toBeGreaterThanOrEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM mail_outbox').get()).toEqual({ n: 0 });
    const audit = db.prepare("SELECT actor, details FROM audit_logs WHERE action = 'application.review'").get() as { actor: string; details: string };
    expect(audit.actor).toBe('alice');
    expect(JSON.parse(audit.details)).toEqual({ from: 'received', to: 'cancelled', has_note: true, mail: false });

    // 列表里甲还是一行，主记录是没取消的那份；选「已取消」能看到它
    const listed = (await app.inject({ url: '/api/console/applications?status=cancelled', headers: alice })).json();
    expect(listed.items.find((item: Item) => item.person.key === ids.jiaOld).person.applications.map((a: { id: string }) => a.id)).toEqual([ids.jiaOld]);

    // 取消错了可以改回来，同样不发信，审核记录两条
    const undo = await app.inject({ method: 'PATCH', url, headers: alice, payload: { status: 'received', expected_status: 'cancelled', expected_review_id: cancel.json().review.id } });
    expect(undo.statusCode).toBe(200);
    expect(undo.json().review).toMatchObject({ from_status: 'cancelled', to_status: 'received', mail: null });
    expect(db.prepare('SELECT COUNT(*) AS n FROM application_reviews WHERE application_id = ?').get(ids.jiaOld)).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM mail_outbox').get()).toEqual({ n: 0 });

    // 别的状态照旧写信：同一个服务（没配发信商）改成未通过，队列里多一封 mail_disabled 的信
    const rejected = await app.inject({ method: 'PATCH', url: `/api/console/applications/${ids.yi}`, headers: alice, payload: { status: 'rejected', expected_status: 'interview', expected_review_id: 0 } });
    expect(rejected.json().review.mail).toMatchObject({ status: 'skipped', skip_reason: 'mail_disabled' });
    expect(db.prepare('SELECT kind FROM mail_outbox').all()).toEqual([{ kind: 'recruitment.rejected' }]);
  });

  it('accepts cancelled as a filter and as the status the page saw, and names five statuses when refusing others', async () => {
    const { app, alice, ids } = await seeded();
    expect((await app.inject({ url: '/api/console/applications?status=cancelled', headers: alice })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/console/applications/export.csv?status=cancelled', headers: alice })).statusCode).toBe(200);
    const note = await app.inject({ method: 'PATCH', url: `/api/console/applications/${ids.bingAgain}`, headers: alice, payload: { expected_status: 'cancelled', expected_review_id: 0, note: '确认是重复投递' } });
    expect(note.statusCode).toBe(200);
    const refused = await app.inject({ method: 'PATCH', url: `/api/console/applications/${ids.yi}`, headers: alice, payload: { status: 'duplicate', expected_status: 'interview', expected_review_id: 0 } });
    expect(refused.json()).toEqual({ error: 'invalid_status', message: '状态只能是已收到、待面试、已录取、未通过、已取消' });
  });
});
