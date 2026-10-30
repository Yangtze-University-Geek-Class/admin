// GitLab 项目事件进操作记录（#370，lib/gitlab-events.ts）：游标续拉不重复；拉取失败整个项目不写；对不上账号的标未关联；
// 翻页到上限就停；控制台按 surface=gitlab 筛选只回这些行。GitLab 用注入的 gitlabFetch 模拟，不连外网。
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { accountIdOf, grantPermNode, signIn, testApp } from './helpers';
import { EVENTS_PAGES_MAX, EVENTS_PAGE_SIZE } from '../../app/server/src/lib/gitlab-events';

const GITLAB = 'https://git.example.test';
const SYNC_ENV = { GITLAB_SYNC: 'on', GITLAB_URL: GITLAB, GITLAB_API_TOKEN: 'test-gitlab-token', GITLAB_GROUP: 'geek' };
const PROJECT_ID = 10;
const ALICE_GITLAB_ID = 1001;
const BOB_GITLAB_ID = 1002;

type Item = Record<string, unknown>;

/**
 * 假 GitLab：只回组内项目列表与项目事件。事件按编号从新到旧放（和 GitLab 一样），每页 100 条，用 X-Next-Page 指向下一页。
 * `failures`：某个项目的事件接口全部返回给定状态码，或 'unreachable' 让连接失败；`pageFailures` 只让「项目编号:页码」那一页失败。
 * `unexpected` 记下没预料到的请求，用例末尾断言为空。
 */
function fakeGitlab() {
  const events = new Map<number, Item[]>();
  const failures = new Map<number, number | 'unreachable'>();
  const pageFailures = new Map<string, number>();
  const eventCalls: string[] = [];
  const unexpected: string[] = [];
  const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
  async function fetch(input: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input);
    expect(url.origin).toBe(new URL(GITLAB).origin);
    expect(init.method ?? 'GET').toBe('GET');
    expect((init.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('test-gitlab-token');
    expect(init.redirect).toBe('error');
    const path = url.pathname.replace(/^\/api\/v4/, '');
    const groups = /^\/groups\/geek\/projects$/.exec(path);
    if (groups) {
      const page = url.searchParams.get('page');
      return json(200, page === '1' ? [{ id: PROJECT_ID, path_with_namespace: 'geek/admin', web_url: `${GITLAB}/geek/admin` }] : []);
    }
    const project = /^\/projects\/(\d+)\/events$/.exec(path);
    if (project) {
      const id = Number(project[1]);
      eventCalls.push(`${id}:${url.searchParams.get('page')}`);
      const failure = failures.get(id);
      if (failure === 'unreachable') throw new TypeError('fetch failed');
      if (failure !== undefined) return json(failure, { message: 'upstream' });
      const page = Number(url.searchParams.get('page') ?? '1');
      const pageFailure = pageFailures.get(`${id}:${page}`);
      if (pageFailure !== undefined) return json(pageFailure, { message: 'upstream' });
      const all = events.get(id) ?? [];
      const slice = all.slice((page - 1) * EVENTS_PAGE_SIZE, page * EVENTS_PAGE_SIZE);
      const more = page * EVENTS_PAGE_SIZE < all.length;
      return json(200, slice, more ? { 'x-next-page': String(page + 1) } : {});
    }
    unexpected.push(`${init.method ?? 'GET'} ${path}`);
    return json(404, { message: '404 Not Found' });
  }
  return { fetch, events, failures, pageFailures, eventCalls, unexpected };
}

const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

/** 新到旧的事件：编号越大越新，时间都在保留期内。 */
function issueEvent(id: number, author = ALICE_GITLAB_ID, patch: Item = {}): Item {
  return {
    id, project_id: PROJECT_ID, action_name: 'opened', target_type: 'Issue', target_iid: id, target_id: 500 + id,
    author_id: author, author_username: author === ALICE_GITLAB_ID ? 'alice' : 'bob',
    created_at: new Date(Date.now() - (1000 - id) * 60_000).toISOString(), push_data: null, note: null, ...patch,
  };
}
const newestFirst = (list: Item[]) => [...list].sort((a, b) => (b.id as number) - (a.id as number));

async function setup(env: Record<string, string> = SYNC_ENV) {
  const gitlab = fakeGitlab();
  const context = await testApp({ gitlabFetch: gitlab.fetch }, false, env);
  contexts.push(context);
  const { app } = context;
  const db = app.services.storage.db;
  // 只有 alice 绑了 GitLab 账号（编号 1001）；bob 的 GitLab 编号 1002 在极客班里没有账号。
  signIn(app, 'alice', 811);
  const aliceId = accountIdOf(app, 'alice');
  const now = Date.now();
  db.prepare('INSERT INTO gitlab_accounts(account_id, gitlab_user_id, username, state, access_level, created_at, updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(aliceId, ALICE_GITLAB_ID, 'alice', 'active', 30, now, now);
  return { app, db, gitlab, aliceId, run: () => app.services.gitlabEvents.collectOnce() };
}

type GitlabRow = { id: number; account_id: string | null; action: string; target_type: string | null; target_id: string | null; meta: Record<string, unknown> };
function gitlabRows(db: { prepare(sql: string): { all(): unknown[] } }): GitlabRow[] {
  return (db.prepare("SELECT id, account_id, action, target_type, target_id, meta FROM activity_events WHERE surface = 'gitlab' ORDER BY id").all() as
    (Omit<GitlabRow, 'meta'> & { meta: string })[]).map(row => ({ ...row, meta: JSON.parse(row.meta) as Record<string, unknown> }));
}
const cursorOf = (db: { prepare(sql: string): { get(key: string): unknown } }, projectId = PROJECT_ID) =>
  (db.prepare('SELECT value FROM app_state WHERE key = ?').get(`gitlab_events_cursor:${projectId}`) as { value: string } | undefined)?.value ?? null;

describe('GitLab 项目事件进操作记录（#370）', () => {
  it('游标续拉：只取游标之后的新事件，重复拉取不产生重复行', async () => {
    const { db, gitlab, run } = await setup();
    gitlab.events.set(PROJECT_ID, newestFirst([issueEvent(1), issueEvent(2), issueEvent(3)]));
    const first = await run();
    expect(first).toMatchObject({ error: null, skipped: null, failed: 0, written: 3 });
    expect(gitlabRows(db).map(row => row.meta.gitlab_event_id)).toEqual([1, 2, 3]);
    expect(cursorOf(db)).toBe('3');

    // GitLab 又多了两条：只写这两条，游标停在新的最大编号
    gitlab.events.set(PROJECT_ID, newestFirst([issueEvent(1), issueEvent(2), issueEvent(3), issueEvent(4), issueEvent(5)]));
    gitlab.eventCalls.length = 0;
    const second = await run();
    expect(second).toMatchObject({ failed: 0, written: 2 });
    expect(gitlabRows(db).map(row => row.meta.gitlab_event_id)).toEqual([1, 2, 3, 4, 5]);
    expect(cursorOf(db)).toBe('5');
    // 翻到游标（编号 3）就停：第一页已经碰到游标，不再翻下一页
    expect(gitlab.eventCalls).toEqual([`${PROJECT_ID}:1`]);

    // 没有新事件：什么也不写
    const third = await run();
    expect(third).toMatchObject({ failed: 0, written: 0 });
    expect(gitlabRows(db)).toHaveLength(5);
    expect(gitlab.unexpected).toEqual([]);
  });

  it('拉取失败的项目整轮不写一条，游标不动；恢复后按原样补上，不留半份', async () => {
    const { db, gitlab, run } = await setup();
    // 150 条分两页：第二页 502。第一页的 100 条已经拿到，也不能写进去。
    gitlab.events.set(PROJECT_ID, newestFirst(Array.from({ length: 150 }, (_, index) => issueEvent(index + 1))));
    gitlab.pageFailures.set(`${PROJECT_ID}:2`, 502);
    const failed = await run();
    expect(failed).toMatchObject({ failed: 1, written: 0, error: null });
    expect(gitlabRows(db)).toEqual([]);
    expect(cursorOf(db)).toBeNull();

    gitlab.pageFailures.clear();
    const recovered = await run();
    expect(recovered).toMatchObject({ failed: 0, written: 150 });
    expect(gitlabRows(db)).toHaveLength(150);
    expect(cursorOf(db)).toBe('150');
    expect(gitlab.unexpected).toEqual([]);
  });

  it('GitLab 连不上时整项目不写，并且不抛出（操作记录照常可用）', async () => {
    const { db, gitlab, run } = await setup();
    gitlab.events.set(PROJECT_ID, newestFirst([issueEvent(1)]));
    gitlab.failures.set(PROJECT_ID, 'unreachable');
    const result = await run();
    expect(result).toMatchObject({ failed: 1, written: 0, error: null });
    expect(gitlabRows(db)).toEqual([]);
    expect(cursorOf(db)).toBeNull();
  });

  it('对不上极客班账号的事件照样写，标成未关联，账号留空', async () => {
    const { db, gitlab, run } = await setup();
    gitlab.events.set(PROJECT_ID, newestFirst([
      issueEvent(1),
      issueEvent(2, BOB_GITLAB_ID),
    ]));
    await run();
    const rows = gitlabRows(db);
    expect(rows).toHaveLength(2);
    const [linked, unlinked] = rows;
    expect(linked.account_id).not.toBeNull();
    expect(linked.meta.linked).toBe(true);
    expect(unlinked.account_id).toBeNull();
    expect(unlinked.meta).toMatchObject({ linked: false, gitlab_user_id: BOB_GITLAB_ID, gitlab_username: 'bob' });
    expect(unlinked.action).toBe('gitlab.issue.opened');
  });

  it('翻页到上限就停：最多 EVENTS_PAGES_MAX 页，写已经拿到的，记为截断', async () => {
    const { db, gitlab, run } = await setup();
    const total = EVENTS_PAGES_MAX * EVENTS_PAGE_SIZE + 200;
    gitlab.events.set(PROJECT_ID, newestFirst(Array.from({ length: total }, (_, index) => issueEvent(index + 1))));
    const result = await run();
    expect(gitlab.eventCalls).toHaveLength(EVENTS_PAGES_MAX);
    expect(result).toMatchObject({ failed: 0, truncated: 1, written: EVENTS_PAGES_MAX * EVENTS_PAGE_SIZE });
    expect(gitlabRows(db)).toHaveLength(EVENTS_PAGES_MAX * EVENTS_PAGE_SIZE);
    expect(cursorOf(db)).toBe(String(total));
  });

  it('写入的行带对象、编号和链接；推送事件不记提交说明', async () => {
    const { db, gitlab, run } = await setup();
    gitlab.events.set(PROJECT_ID, newestFirst([
      issueEvent(1),
      {
        id: 2, project_id: PROJECT_ID, action_name: 'pushed to', target_type: null, target_iid: null, target_id: null,
        author_id: ALICE_GITLAB_ID, author_username: 'alice', created_at: new Date(Date.now() - 60_000).toISOString(), note: null,
        push_data: { ref: 'main', commit_count: 2, commit_to: 'abcdef1234567', commit_title: 'SECRET COMMIT MESSAGE', action: 'pushed' },
      },
      {
        id: 3, project_id: PROJECT_ID, action_name: 'commented on', target_type: 'DiffNote', target_iid: null, target_id: 77,
        author_id: ALICE_GITLAB_ID, author_username: 'alice', created_at: new Date(Date.now() - 30_000).toISOString(), push_data: null,
        note: { id: 77, body: 'SECRET COMMENT BODY', noteable_type: 'MergeRequest', noteable_iid: 9 },
      },
    ]));
    await run();
    const rows = gitlabRows(db);
    const [issue, push, note] = rows;
    expect(issue).toMatchObject({ action: 'gitlab.issue.opened', target_type: 'Issue', target_id: '1' });
    expect(issue.meta).toMatchObject({ project: 'geek/admin', url: `${GITLAB}/geek/admin/-/issues/1` });
    expect(push).toMatchObject({ action: 'gitlab.push.pushed_to', target_type: null, target_id: null });
    expect(push.meta).toMatchObject({ ref: 'main', commit_count: 2, url: `${GITLAB}/geek/admin/-/commit/abcdef1234567` });
    expect(note).toMatchObject({ action: 'gitlab.note.commented_on', target_type: 'MergeRequest', target_id: '9' });
    expect(note.meta.url).toBe(`${GITLAB}/geek/admin/-/merge_requests/9#note_77`);
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain('SECRET COMMIT MESSAGE');
    expect(stored).not.toContain('SECRET COMMENT BODY');
  });

  it('间隔为 0 时关闭：不调 GitLab，跳过原因是 events_off', async () => {
    const { db, gitlab, run } = await setup({ ...SYNC_ENV, GITLAB_EVENTS_INTERVAL_MINUTES: '0' });
    gitlab.events.set(PROJECT_ID, newestFirst([issueEvent(1)]));
    const result = await run();
    expect(result).toMatchObject({ skipped: 'events_off', error: null, written: 0 });
    expect(gitlab.eventCalls).toEqual([]);
    expect(gitlabRows(db)).toEqual([]);
  });

  it('GITLAB_SYNC 关着、配了令牌、间隔大于 0 时照样拉取（与账号同步的开关无关）', async () => {
    const { db, gitlab, run } = await setup({ ...SYNC_ENV, GITLAB_SYNC: 'off' });
    gitlab.events.set(PROJECT_ID, newestFirst([issueEvent(1), issueEvent(2)]));
    const result = await run();
    expect(result).toMatchObject({ skipped: null, error: null, failed: 0, written: 2 });
    expect(gitlab.eventCalls).toEqual([`${PROJECT_ID}:1`]);
    expect(gitlabRows(db)).toHaveLength(2);
    expect(gitlab.unexpected).toEqual([]);
  });

  it('缺令牌时报错，不调 GitLab（间隔大于 0）', async () => {
    const { db, gitlab, run } = await setup({ GITLAB_URL: GITLAB, GITLAB_GROUP: 'geek', GITLAB_SYNC: 'off' });
    gitlab.events.set(PROJECT_ID, newestFirst([issueEvent(1)]));
    const result = await run();
    expect(result).toMatchObject({ error: 'gitlab_not_configured', skipped: null, written: 0 });
    expect(gitlab.eventCalls).toEqual([]);
    expect(gitlabRows(db)).toEqual([]);
  });

  it('控制台 surface=gitlab 只返回 GitLab 的行，全部来源里两类都有', async () => {
    const { app, db, gitlab, aliceId, run } = await setup();
    grantPermNode(app, aliceId, 'activity.read');
    const sid = signIn(app, 'alice', 811);
    db.prepare("INSERT INTO activity_events(at, account_id, visitor_id, surface, action, target_type, target_id, outcome, ip, ua, request_id, meta) VALUES(?, ?, NULL, 'console', 'test.console', NULL, NULL, 'ok', NULL, NULL, NULL, '{}')")
      .run(Date.now(), aliceId);
    gitlab.events.set(PROJECT_ID, newestFirst([issueEvent(1), issueEvent(2, BOB_GITLAB_ID)]));
    await run();
    const filtered = await app.inject({ url: '/api/console/activity?surface=gitlab', headers: { cookie: `sid=${sid}` } });
    expect(filtered.statusCode).toBe(200);
    const items = filtered.json().items as { surface: string; action: string; account: unknown }[];
    expect(items).toHaveLength(2);
    expect(items.every(item => item.surface === 'gitlab' && item.action.startsWith('gitlab.'))).toBe(true);
    expect(items.map(item => item.account === null)).toEqual([true, false]);
    const all = await app.inject({ url: '/api/console/activity', headers: { cookie: `sid=${sid}` } });
    const surfaces = new Set((all.json().items as { surface: string }[]).map(item => item.surface));
    expect(surfaces.has('gitlab') && surfaces.has('console')).toBe(true);
    expect(gitlab.unexpected).toEqual([]);
  });
});
