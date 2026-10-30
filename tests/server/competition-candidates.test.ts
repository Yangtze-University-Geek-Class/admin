// GitLab 贡献收集与「有用」标记（#278，CONTRACT-278 §4，所有者 2026-10-24 13:45 / 16:59）：
// 只有标记「有用」的才加分，分数按重要程度 × 核心度两档查表、不看改动行数；三个标签都要由有 competition.score.review
// 的人加、不能是作者本人；标签拿掉时撤销经标签加的分；控制台「标记有用」选两档与驳回；重复收集不产生重复行。
// GitLab 用注入的 gitlabFetch 模拟，不连外网。
import { afterEach, describe, expect, it } from 'vitest';
import { activityRows, grantPermNode } from './helpers';
import { contestSetup, HOUR, type ContestContext } from './contest-fixtures';
import { closingIssueIids } from '../../app/server/src/lib/competition-candidates';

const GITLAB = 'https://git.example.test';
const ENV = { GITLAB_SYNC: 'on', GITLAB_URL: GITLAB, GITLAB_API_TOKEN: 'test-gitlab-token', GITLAB_GROUP: 'geek' };
const GITLAB_IDS: Record<string, number> = { alice: 1001, bob: 1002, carol: 1003, dave: 1004 };

type Item = Record<string, unknown>;
type LabelEvent = { id: number; action: 'add' | 'remove'; user: { id: number; username: string }; created_at: string; label: { name: string } };

/** 一个只认比赛收集会发的那几个 GET 的假 GitLab。 */
function fakeGitlab(base = GITLAB) {
  const mrs: Item[] = [];
  const issues: Item[] = [];
  const labelEvents = new Map<string, LabelEvent[]>();
  const closedBy = new Map<number, Item[]>();
  const calls: string[] = [];
  const subjects = new Map<number, string>();
  const replies: { match: string; respond: () => Response }[] = [];
  const responses = new Map<string, () => Response | Promise<Response>>();
  const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
  async function fetch(input: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input);
    expect(url.origin).toBe(new URL(base).origin);
    expect(init.method ?? 'GET').toBe('GET');
    expect((init.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('test-gitlab-token');
    expect(init.redirect).toBe('error');
    const prefix = `${new URL(base).pathname.replace(/\/+$/, '')}/api/v4`;
    expect(url.pathname.startsWith(`${prefix}/`)).toBe(true);
    const path = url.pathname.slice(prefix.length);
    calls.push(`${path}${url.search}`);
    const reply = replies.findIndex(item => `${path}${url.search}`.startsWith(item.match));
    if (reply >= 0) return replies.splice(reply, 1)[0].respond();
    const response = responses.get(`${path}${url.search}`) ?? responses.get(path);
    if (response) return response();
    const user = /^\/users\/(\d+)$/.exec(path);
    if (user && subjects.has(Number(user[1]))) {
      const id = Number(user[1]);
      return json(200, { id, username: Object.keys(GITLAB_IDS).find(login => GITLAB_IDS[login] === id),
        state: 'active', is_admin: false, bot: false, identities: [{ provider: 'openid_connect', extern_uid: subjects.get(id) }] });
    }
    const project = '/projects/geek%2Fadmin';
    if (path === `${project}/merge_requests`) {
      expect(url.searchParams.get('state')).toBe('merged');
      return json(200, url.searchParams.get('page') === '1' ? mrs : []);
    }
    if (path === `${project}/issues`) return json(200, url.searchParams.get('page') === '1' ? issues : []);
    let match = /^\/projects\/geek%2Fadmin\/(merge_requests|issues)\/(\d+)\/resource_label_events$/.exec(path);
    if (match) return json(200, labelEvents.get(`${match[1]}:${match[2]}`) ?? []);
    match = /^\/projects\/geek%2Fadmin\/issues\/(\d+)\/closed_by$/.exec(path);
    if (match) return json(200, closedBy.get(Number(match[1])) ?? []);
    match = /^\/projects\/geek%2Fadmin\/issues\/(\d+)$/.exec(path);
    if (match) {
      const iid = Number(match[1]);
      const issue = issues.find(item => item.iid === iid);
      return issue ? json(200, issue) : json(404, { message: '404 Not Found' });
    }
    return json(404, { message: '404 Not Found' });
  }
  return { fetch, mrs, issues, labelEvents, closedBy, calls, subjects, responses, json,
    replyOnce(match: string, respond: () => Response) { replies.push({ match, respond }); },
  };
}

const contexts: ContestContext[] = [];
afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});

async function setup(env: Record<string, string> = ENV) {
  const gitlab = fakeGitlab(env.GITLAB_URL);
  const context = await contestSetup({ gitlabFetch: gitlab.fetch }, env);
  contexts.push(context);
  const { app, as, accountId, createCompetition, signUp } = context;
  const id = await createCompetition();
  expect((await app.inject({ method: 'PUT', url: `/api/console/competitions/${id}/signup-settings`, headers: as('owner'),
    payload: { enabled: true, participation: 'individual', team_min: 1, team_max: 1, scoring: 'contribution' } })).statusCode).toBe(200);
  for (const login of ['alice', 'carol']) await signUp(id, login);
  const rules = (await app.inject({ url: `/api/console/competitions/${id}/rules`, headers: as('owner') })).json();
  const saved = await app.inject({ method: 'PUT', url: `/api/console/competitions/${id}/rules`, headers: as('owner'), payload: { grade_factors: rules.grade_factors, prizes: [], gitlab_projects: ['geek/admin'] } });
  expect(saved.statusCode).toBe(200);
  const now = Date.now();
  app.services.oidcStore.registerClient({ name: 'GitLab', clientId: 'gitlab', redirectUris: [`${GITLAB}/users/auth/openid_connect/callback`] });
  for (const [login, gitlabId] of Object.entries(GITLAB_IDS)) {
    app.services.storage.db.prepare("INSERT INTO gitlab_accounts(account_id, gitlab_user_id, username, state, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
      .run(accountId(login), gitlabId, login, now, now);
    gitlab.subjects.set(gitlabId, app.services.oidcStore.subjectFor('git.example.test', accountId(login)));
  }
  grantPermNode(app, accountId('bob'), 'competition.score.review');
  const recent = new Date(now - HOUR / 2).toISOString();
  const author = (login: string) => ({ id: GITLAB_IDS[login] ?? 1099, username: login });
  const mr = (iid: number, login: string, labels: string[], mergedAt = recent) =>
    ({ iid, title: `MR ${iid}`, web_url: `${GITLAB}/geek/admin/-/merge_requests/${iid}`, author: author(login), labels, merged_at: mergedAt, state: 'merged' });
  const labelAdd = (key: string, login: string, action: 'add' | 'remove' = 'add', at = recent, eventId = 1, name = '有用') => {
    const list = gitlab.labelEvents.get(key) ?? [];
    list.push({ id: eventId, action, user: { id: GITLAB_IDS[login], username: login }, created_at: at, label: { name } });
    gitlab.labelEvents.set(key, list);
  };
  /** 一位审核人在 GitLab 上打「有用」和两档标签（三条标签事件），返回 MR 上该有的标签。 */
  const review = (key: string, login: string, importance = '重要', core = '业务', levelsBy = login) => {
    labelAdd(key, login);
    labelAdd(key, levelsBy, 'add', recent, 2, `重要程度::${importance}`);
    labelAdd(key, levelsBy, 'add', recent, 3, `核心度::${core}`);
    return ['有用', `重要程度::${importance}`, `核心度::${core}`];
  };
  const collect = async (login = 'bob') => {
    const res = await app.inject({ method: 'POST', url: `/api/console/competitions/${id}/candidates/collect`, headers: as(login) });
    expect(res.statusCode).toBe(200);
    return res.json().last_run;
  };
  const list = async (status?: string) =>
    (await app.inject({ url: `/api/console/competitions/${id}/candidates${status ? `?status=${status}` : ''}`, headers: as('bob') })).json();
  const scoreOf = async (login: string) => {
    const board = (await app.inject({ url: `/api/competitions/${id}/leaderboard`, headers: as('alice') })).json();
    return board.individuals.find((row: { person: { account_id: string } }) => row.person.account_id === accountId(login)).points as number;
  };
  return { ...context, gitlab, id, mr, labelAdd, review, collect, list, scoreOf, recent };
}

describe('收集候选贡献', () => {
  it('GitLab 搬到主站路径后照常收集：接口走 <基址>/api/v4，sector 不变，缺 web_url 时按新基址拼链接（#335）', async () => {
    const base = 'https://example.test/gitlab';
    const { gitlab, mr, collect, list } = await setup({ ...ENV, GITLAB_URL: base, GITLAB_OIDC_SECTOR: 'git.example.test' });
    const { web_url: _ignored, ...bare } = mr(1, 'alice', ['重要程度::重要', '核心度::业务']);
    gitlab.mrs.push(bare);
    expect(await collect()).toMatchObject({ fetched: 1, created: 1, error: null });
    expect((await list()).items).toEqual([expect.objectContaining({ gitlab_iid: 1, url: `${base}/geek/admin/-/merge_requests/1`, status: 'pending' })]);
    expect(gitlab.calls.some(call => call.startsWith('/projects/geek%2Fadmin/merge_requests'))).toBe(true);
  });

  it('不把失配的远端作者或审核人经缓存 id 归到本地账号', async () => {
    const { gitlab, mr, review, collect, list } = await setup();
    gitlab.mrs.push(mr(801, 'alice', review('merge_requests:801', 'bob')));
    gitlab.subjects.set(GITLAB_IDS.bob, 'different-reviewer');
    expect(await collect()).toMatchObject({ accepted: 0, error: null });
    expect((await list()).counts).toEqual({ pending: 1, accepted: 0, rejected: 0 });
    gitlab.subjects.set(GITLAB_IDS.alice, 'different-author');
    gitlab.mrs.push(mr(802, 'alice', []));
    expect(await collect()).toMatchObject({ created: 0, accepted: 0, skipped: 2, error: null });
  });

  it('归属核验503或超时不撤已经确认的积分，恢复后明确移除仍撤分', async () => {
    const { gitlab, mr, review, labelAdd, collect, list, recent } = await setup();
    gitlab.mrs.push(mr(803, 'alice', review('merge_requests:803', 'bob')));
    expect(await collect()).toMatchObject({ accepted: 1, error: null });
    gitlab.mrs[0].labels = [];
    labelAdd('merge_requests:803', 'bob', 'remove', new Date(Date.parse(recent) + 1000).toISOString(), 9);
    gitlab.replyOnce('/users/1001', () => new Response('{}', { status: 503 }));
    expect(await collect()).toMatchObject({ revoked: 0, error: 'gitlab_lookup_503' });
    gitlab.replyOnce('/users/1001', () => { throw new DOMException('Synthetic timeout', 'TimeoutError'); });
    expect(await collect()).toMatchObject({ revoked: 0, error: 'gitlab_unreachable' });
    expect((await list()).counts.accepted).toBe(1);
    expect(await collect()).toMatchObject({ revoked: 1, error: null });
    expect((await list()).counts.pending).toBe(1);
  });

  it('等待其它标签身份核验时被停用的审核人不能自动计分', async () => {
    const { app, as, id, accountId, gitlab, mr, review, collect } = await setup();
    gitlab.mrs.push(mr(804, 'alice', review('merge_requests:804', 'bob', '重要', '业务', 'carol')));
    gitlab.replyOnce('/users/1003', () => {
      app.services.storage.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(accountId('bob'));
      return new Response(JSON.stringify({ id: 1003, username: 'carol', state: 'active', is_admin: false, bot: false,
        identities: [{ provider: 'openid_connect', extern_uid: gitlab.subjects.get(1003) }] }), { status: 200 });
    });
    grantPermNode(app, accountId('carol'), 'competition.score.review');
    expect(await collect('owner')).toMatchObject({ accepted: 0, error: null });
    expect((await app.inject({ url: `/api/console/competitions/${id}/candidates`, headers: as('owner') })).json().counts.accepted).toBe(0);
  });

  it('I11 已停用审核人的 GitLab 标签不得自动加分（#271 集成前置）', async () => {
    const { app, as, id, accountId, gitlab, mr, review, collect, scoreOf } = await setup();
    gitlab.mrs.push(mr(1, 'alice', review('merge_requests:1', 'bob')));
    app.services.storage.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(accountId('bob'));
    expect(await collect('owner')).toMatchObject({ accepted: 0, error: null });
    expect((await app.inject({ url: `/api/console/competitions/${id}/candidates`, headers: as('owner') })).json().counts.accepted).toBe(0);
    expect(await scoreOf('alice')).toBe(0);
  });

  it('后续分页失败时整轮不落半份候选或积分；重试才完整应用', async () => {
    const { gitlab, mr, review, collect, list, scoreOf } = await setup();
    gitlab.mrs.push(mr(1, 'alice', review('merge_requests:1', 'bob')));
    gitlab.responses.set('/projects/geek%2Fadmin/issues', () => gitlab.json(429, []));
    expect(await collect()).toMatchObject({ created: 0, accepted: 0, error: 'gitlab_http_429' });
    expect((await list()).items).toEqual([]);
    expect(await scoreOf('alice')).toBe(0);
    gitlab.responses.clear();
    expect(await collect()).toMatchObject({ created: 1, accepted: 1, error: null });
    expect(await scoreOf('alice')).toBe(45);
  });

  it('标签事件必须读取全部分页，不能把后页的撤销忽略', async () => {
    const { gitlab, mr, review, collect, list, scoreOf } = await setup();
    gitlab.mrs.push(mr(1, 'alice', review('merge_requests:1', 'bob')));
    const path = '/projects/geek%2Fadmin/merge_requests/1/resource_label_events';
    gitlab.responses.set(`${path}?per_page=100&page=1`, () => gitlab.json(200, gitlab.labelEvents.get('merge_requests:1'), { 'x-next-page': '2' }));
    gitlab.responses.set(`${path}?per_page=100&page=2`, () => gitlab.json(200, [{
      id: 4, action: 'remove', created_at: new Date().toISOString(), label: { name: '有用' }, user: { id: 1002, username: 'bob' },
    }]));
    await collect();
    expect(await scoreOf('alice')).toBe(0);
    expect((await list()).counts.pending).toBe(1);
  });

  it('分页上限或循环游标是失败，不把截断列表当作完整收集', async () => {
    const { gitlab, collect, list } = await setup();
    gitlab.responses.set('/projects/geek%2Fadmin/merge_requests', () => gitlab.json(200, [], { 'x-next-page': '1' }));
    expect(await collect()).toMatchObject({ error: 'gitlab_pagination_incomplete', created: 0 });
    expect((await list()).items).toEqual([]);
  });

  it('收集等待 HTTP 时定榜，迟到的标签撤销不得改冻结积分和候选', async () => {
    const { app, as, gitlab, mr, review, labelAdd, recent, collect, list, endCompetition, id, scoreOf } = await setup();
    gitlab.mrs.push(mr(1, 'alice', review('merge_requests:1', 'bob')));
    await collect();
    gitlab.mrs[0].labels = [];
    labelAdd('merge_requests:1', 'bob', 'remove', new Date(Date.parse(recent) + 1000).toISOString(), 4);
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    gitlab.responses.set('/projects/geek%2Fadmin/merge_requests/1/resource_label_events', async () => {
      entered(); await gate;
      return gitlab.json(200, gitlab.labelEvents.get('merge_requests:1'));
    });
    const pending = collect();
    await waiting;
    await endCompetition(id);
    expect((await app.inject({ method: 'POST', url: `/api/console/competitions/${id}/final`, headers: as('owner') })).statusCode).toBe(201);
    release();
    expect(await pending).toMatchObject({ accepted: 0, revoked: 0, error: 'collection_state_changed' });
    expect(await scoreOf('alice')).toBe(45);
    expect((await list()).counts.accepted).toBe(1);
  });

  it('只收时间窗内、已报名作者的 MR 与合格 Issue，不读 diff、不看改动行数；待确认的记下标签上的两档；重复收集不产生重复行', async () => {
    const { app, gitlab, id, mr, collect, list } = await setup();
    gitlab.mrs.push(
      mr(1, 'alice', ['重要程度::重要', '核心度::业务']),
      mr(2, 'carol', ['重要程度::一般', '重要程度::关键', '核心度::核心']),
      mr(3, 'erin', []),
      mr(4, 'alice', [], new Date(Date.now() - 48 * HOUR).toISOString()),
    );
    gitlab.issues.push(
      { iid: 10, title: 'Issue 10', web_url: `${GITLAB}/geek/admin/-/issues/10`, author: { id: 1003 }, labels: ['核心度::边缘'], created_at: new Date().toISOString(), state: 'closed', merge_requests_count: 1 },
      { iid: 11, title: 'Issue 11', web_url: `${GITLAB}/geek/admin/-/issues/11`, author: { id: 1001 }, labels: [], created_at: new Date().toISOString(), state: 'opened', merge_requests_count: 0 },
    );
    gitlab.closedBy.set(10, [{ iid: 2, state: 'merged' }]);

    const first = await collect();
    expect(first).toMatchObject({ fetched: 4, created: 3, skipped: 1, accepted: 0, error: null });
    const page = await list();
    expect(page.counts).toEqual({ pending: 3, accepted: 0, rejected: 0 });
    const byIid = Object.fromEntries(page.items.map((item: { kind: string; gitlab_iid: number }) => [`${item.kind}${item.gitlab_iid}`, item]));
    expect(byIid.pr1).toMatchObject({ importance: 'important', core: 'business', final_points: null, url: `${GITLAB}/geek/admin/-/merge_requests/1`, status: 'pending' });
    // 同一个前缀打了两个标签：这一档不算，等审核人改
    expect(byIid.pr2).toMatchObject({ importance: null, core: 'core' });
    expect(byIid.issue10).toMatchObject({ importance: null, core: 'edge' });
    expect(Object.keys(byIid.pr1)).not.toEqual(expect.arrayContaining(['size_hint']));
    expect(Object.keys(byIid.pr1)).not.toEqual(expect.arrayContaining(['suggested']));
    expect(page.items[0].account).toEqual({ account_id: expect.any(String), username: expect.any(String), display_name: expect.any(String), avatar_url: null });
    expect(page.last_run).toMatchObject({ created: 3 });
    expect(gitlab.calls.filter(call => /\/(diffs|changes)(\?|$)/.test(call))).toEqual([]);

    gitlab.mrs[0].labels = ['重要程度::关键', '核心度::核心'];
    const again = await collect();
    expect(again).toMatchObject({ created: 0, fetched: 4 });
    expect((app.services.storage.db.prepare('SELECT COUNT(*) AS n FROM competition_score_candidates WHERE competition_id = ?').get(id) as { n: number }).n).toBe(3);
    expect((await list()).items.find((item: { gitlab_iid: number }) => item.gitlab_iid === 1)).toMatchObject({ importance: 'critical', core: 'core', status: 'pending' });
  });

  it('GitLab 同步关着时不收集；概览的 candidates_pending 是真实的待确认数', async () => {
    const { app, as, gitlab, mr, collect, id } = await setup();
    gitlab.mrs.push(mr(1, 'alice', []));
    await collect();
    const summary = (await app.inject({ url: '/api/console/summary', headers: as('bob') })).json();
    expect(summary.candidates_pending).toBe(1);
    await app.services.gitlab.applySettings({ mode: 'off' });
    const off = await app.inject({ method: 'POST', url: `/api/console/competitions/${id}/candidates/collect`, headers: as('bob') });
    expect(off.json().error).toBe('gitlab_sync_off');
  });

  // #331：MR 合进任意分支（主要是 stage）时 GitLab 不会自动关 Issue，靠正文的关闭关键字认 Issue；Issue 开着关着都收。
  const closedIssue = (iid: number, login: string, state = 'closed', createdAt = Date.now() - 3 * 24 * HOUR) => ({
    iid, title: `Issue ${iid}`, web_url: `${GITLAB}/geek/admin/-/issues/${iid}`, author: { id: GITLAB_IDS[login] },
    labels: [], created_at: new Date(createdAt).toISOString(), state, merge_requests_count: 1,
  });

  it('MR 合进 stage、正文写 Closes #n 时，已关闭的 Issue 收为 Issue 候选，作者是 Issue 的作者，时间是 MR 合并时间', async () => {
    const { accountId, gitlab, mr, collect, list, recent } = await setup();
    gitlab.mrs.push({ ...mr(801, 'alice', []), target_branch: 'stage', description: 'Closes #20' });
    gitlab.issues.push(closedIssue(20, 'carol'));
    expect(await collect()).toMatchObject({ created: 2, accepted: 0, error: null });
    const issue = (await list()).items.find((row: { kind: string }) => row.kind === 'issue');
    expect(issue).toMatchObject({ gitlab_iid: 20, status: 'pending', url: `${GITLAB}/geek/admin/-/issues/20`,
      account: { account_id: accountId('carol') }, contributed_at: Date.parse(recent) });
  });

  it('关闭关键字按 GitLab 官方列表识别，一个关键字可接多个编号；Refs、Related to 与跨项目写法不算', async () => {
    const { gitlab, mr, collect, list } = await setup();
    gitlab.mrs.push({ ...mr(801, 'alice', []), description: 'Fixes #20\n\nResolves #21 and closes #22, #23\n\nRefs #24, related to #25\n\nCloses geek/other#26' });
    for (const iid of [20, 21, 22, 23, 24, 25, 26]) gitlab.issues.push(closedIssue(iid, 'carol'));
    expect(await collect()).toMatchObject({ created: 5, error: null });
    const iids = (await list()).items.filter((row: { kind: string }) => row.kind === 'issue')
      .map((row: { gitlab_iid: number }) => row.gitlab_iid).sort((a: number, b: number) => a - b);
    expect(iids).toEqual([20, 21, 22, 23]);
  });

  it('只写 Refs 的 MR、未合并的 MR 与合并在窗外的 MR 都不收 Issue 候选，也不去读它们引用的 Issue', async () => {
    const { gitlab, mr, collect, list } = await setup();
    gitlab.mrs.push(
      { ...mr(801, 'alice', []), description: 'Refs #20' },
      { ...mr(802, 'alice', []), state: 'opened', merged_at: null, description: 'Closes #21' },
      { ...mr(803, 'alice', [], new Date(Date.now() - 48 * HOUR).toISOString()), description: 'Closes #22' },
    );
    gitlab.issues.push(closedIssue(20, 'carol'), closedIssue(21, 'carol'), closedIssue(22, 'carol'));
    expect(await collect()).toMatchObject({ created: 1, error: null });
    const page = await list();
    expect(page.items.map((row: { kind: string; gitlab_iid: number }) => `${row.kind}${row.gitlab_iid}`)).toEqual(['pr801']);
    expect(gitlab.calls.filter(call => /\/issues\/\d+$/.test(call))).toEqual([]);
  });

  it('Issue 合进 stage 后仍开着也收为待确认候选，分数仍要标签或控制台确认', async () => {
    const { accountId, gitlab, mr, collect, list } = await setup();
    gitlab.mrs.push({ ...mr(801, 'alice', []), target_branch: 'stage', description: 'Closes #20' });
    gitlab.issues.push(closedIssue(20, 'carol', 'opened'));
    expect(await collect()).toMatchObject({ created: 2, accepted: 0, error: null });
    expect((await list()).items.find((row: { kind: string }) => row.kind === 'issue')).toMatchObject({
      gitlab_iid: 20, status: 'pending', account: { account_id: accountId('carol') } });
  });

  it('MR 正文为 null（GitLab 对没写正文的 MR 这样返回）时只收 MR 本身', async () => {
    const { gitlab, mr, collect, list } = await setup();
    gitlab.mrs.push({ ...mr(801, 'alice', []), description: null });
    expect(await collect()).toMatchObject({ created: 1, error: null });
    expect((await list()).items.map((row: { kind: string; gitlab_iid: number }) => `${row.kind}${row.gitlab_iid}`)).toEqual(['pr801']);
  });

  it('重复收集不产生重复候选，第二轮不新建', async () => {
    const { gitlab, mr, collect, list } = await setup();
    gitlab.mrs.push({ ...mr(801, 'alice', []), description: 'Closes #20' });
    gitlab.issues.push(closedIssue(20, 'carol'));
    expect(await collect()).toMatchObject({ created: 2, error: null });
    expect(await collect()).toMatchObject({ created: 0, accepted: 0, error: null });
    expect((await list()).counts).toEqual({ pending: 2, accepted: 0, rejected: 0 });
  });

  it('Issue 既在窗口内被列出、又被 MR 正文关闭时只收一条，也不再为它单独读一次详情', async () => {
    const { gitlab, mr, collect, list } = await setup();
    gitlab.mrs.push({ ...mr(801, 'alice', []), description: 'Closes #20' });
    gitlab.issues.push(closedIssue(20, 'carol', 'closed', Date.now() - HOUR / 2));
    gitlab.closedBy.set(20, [{ iid: 801, state: 'merged' }]);
    expect(await collect()).toMatchObject({ created: 2, error: null });
    expect((await list()).items.filter((row: { kind: string; gitlab_iid: number }) => row.kind === 'issue' && row.gitlab_iid === 20)).toHaveLength(1);
    expect(gitlab.calls).not.toContain('/projects/geek%2Fadmin/issues/20');
  });

  it('MR 正文关闭的编号读不到（404）时跳过这一个，其它照常收', async () => {
    const { gitlab, mr, collect, list } = await setup();
    gitlab.mrs.push({ ...mr(801, 'alice', []), description: 'Closes #99, #20' });
    gitlab.issues.push(closedIssue(20, 'carol'));
    expect(await collect()).toMatchObject({ created: 2, skipped: 1, error: null });
    expect((await list()).items.filter((row: { kind: string }) => row.kind === 'issue').map((row: { gitlab_iid: number }) => row.gitlab_iid)).toEqual([20]);
  });

  it('读不到的编号（403、5xx）只跳过它并计入 skipped，整轮不失败', async () => {
    const { gitlab, mr, collect, list } = await setup();
    gitlab.mrs.push({ ...mr(801, 'alice', []), description: 'Closes #20, #21 and #22' });
    gitlab.issues.push(closedIssue(20, 'carol'));
    gitlab.responses.set('/projects/geek%2Fadmin/issues/21', () => gitlab.json(403, { message: '403 Forbidden' }));
    gitlab.responses.set('/projects/geek%2Fadmin/issues/22', () => gitlab.json(503, { message: 'Service Unavailable' }));
    expect(await collect()).toMatchObject({ created: 2, skipped: 2, error: null });
    expect((await list()).items.map((row: { kind: string; gitlab_iid: number }) => `${row.kind}${row.gitlab_iid}`).sort()).toEqual(['issue20', 'pr801']);
  });

  it('已驳回的候选不再读 Issue 详情，之后就算 Issue 挂上有用和两档标签也不复活', async () => {
    const { app, as, id, gitlab, mr, review, collect, list } = await setup();
    gitlab.mrs.push({ ...mr(801, 'alice', []), description: 'Closes #20' });
    gitlab.issues.push(closedIssue(20, 'carol'));
    expect(await collect()).toMatchObject({ created: 2, error: null });
    const candidate = (await list()).items.find((row: { kind: string }) => row.kind === 'issue').id;
    expect((await app.inject({ method: 'POST', url: `/api/console/competitions/${id}/candidates/${candidate}/reject`, headers: as('bob'), payload: { reason: '重复' } })).statusCode).toBe(200);
    gitlab.issues[0].labels = review('issues:20', 'bob');
    gitlab.calls.length = 0;
    expect(await collect()).toMatchObject({ created: 0, accepted: 0, error: null });
    expect(gitlab.calls).not.toContain('/projects/geek%2Fadmin/issues/20');
    expect((await list('rejected')).items.find((row: { id: string }) => row.id === candidate)).toMatchObject({ status: 'rejected' });
    expect((await list()).counts.accepted).toBe(0);
  });

  it('Issue 在窗口前创建、之后才挂上有用和两档标签，下一轮收集照样按标签自动加分', async () => {
    const { gitlab, mr, review, collect, list, scoreOf } = await setup();
    gitlab.mrs.push({ ...mr(801, 'alice', []), description: 'Closes #20' });
    gitlab.issues.push(closedIssue(20, 'carol'));
    expect(await collect()).toMatchObject({ created: 2, accepted: 0, error: null });
    gitlab.issues[0].labels = review('issues:20', 'bob');
    expect(await collect()).toMatchObject({ accepted: 1, error: null });
    expect((await list()).items.find((row: { kind: string }) => row.kind === 'issue')).toMatchObject({ status: 'accepted', accepted_via: 'label' });
    expect(await scoreOf('carol')).toBeGreaterThan(0);
  });

  it('关闭关键字可以带冒号（Closes: #n），也可以写本项目的完整路径（geek/admin#n）', async () => {
    const { gitlab, mr, collect, list } = await setup();
    gitlab.mrs.push({ ...mr(801, 'alice', []), description: 'Closes: #20' }, { ...mr(802, 'alice', []), description: 'Fixes geek/admin#21' });
    gitlab.issues.push(closedIssue(20, 'carol'), closedIssue(21, 'carol'));
    expect(await collect()).toMatchObject({ created: 4, error: null });
    const iids = (await list()).items.filter((row: { kind: string }) => row.kind === 'issue')
      .map((row: { gitlab_iid: number }) => row.gitlab_iid).sort((a: number, b: number) => a - b);
    expect(iids).toEqual([20, 21]);
  });
});

describe('closingIssueIids', () => {
  // 官方关闭关键字（大小写不计，可带冒号）后面的 `#n` 或本项目完整路径的 `geek/admin#n` 才算；Refs、Related to 与其它项目不算。
  it.each([
    ['Closes #4', [4]],
    ['Closes: #4', [4]],
    ['closed geek/admin#20 and fixes #21', [20, 21]],
    ['Resolves #21 and closes #22, #23', [21, 22, 23]],
    ['Fixes Geek/Admin#27', [27]],
    ['Closes geek/other#26', []],
    ['Refs #24, related to #25', []],
    ['Closes #8 and geek/other#9', [8]],
    [null, []],
  ])('%s', (description, expected) => {
    expect(closingIssueIids(description, 'geek/admin')).toEqual(expected);
  });
});

describe('GitLab 有限故障与竞态矩阵', () => {
  it('G01 MR/Issue/关闭来源多页完整读取，只访问配置项目', async () => {
    const c = await setup(); const path = '/projects/geek%2Fadmin';
    const mrPath = `${path}/merge_requests?state=merged&updated_after=${encodeURIComponent(new Date(c.app.services.competitions.get(c.id)!.start_at).toISOString())}&order_by=updated_at&per_page=100&page=`;
    c.gitlab.responses.set(`${mrPath}1`, () => c.gitlab.json(200, [c.mr(1, 'alice', [])], { 'x-next-page': '2' }));
    c.gitlab.responses.set(`${mrPath}2`, () => c.gitlab.json(200, [c.mr(2, 'carol', [])]));
    const record = c.app.services.competitions.get(c.id)!;
    const issuePath = `${path}/issues?created_after=${encodeURIComponent(new Date(record.start_at).toISOString())}&created_before=${encodeURIComponent(new Date(record.end_at).toISOString())}&per_page=100&page=`;
    c.gitlab.responses.set(`${issuePath}1`, () => c.gitlab.json(200, [], { 'x-next-page': '2' }));
    c.gitlab.responses.set(`${issuePath}2`, () => c.gitlab.json(200, [{ iid: 3, author: { id: 1001 }, labels: [],
      created_at: c.recent, state: 'closed', merge_requests_count: 1 }]));
    c.gitlab.responses.set(`${path}/issues/3/closed_by?per_page=100&page=1`, () => c.gitlab.json(200, [{ state: 'opened' }], { 'x-next-page': '2' }));
    c.gitlab.responses.set(`${path}/issues/3/closed_by?per_page=100&page=2`, () => c.gitlab.json(200, [{ state: 'merged' }]));
    expect(await c.collect()).toMatchObject({ created: 3, accepted: 0, error: null });
    expect((await c.list()).items.map((row: { gitlab_iid: number }) => row.gitlab_iid).sort()).toEqual([1, 2, 3]);
    expect(c.gitlab.calls.filter(call => call.startsWith('/projects/')).every(call => call.startsWith(`${path}/`))).toBe(true);
    expect(c.gitlab.calls.filter(call => !call.startsWith('/projects/')).every(call => /^\/users\/[0-9]+$/.test(call))).toBe(true);
  });

  it('G02 超时沿用真实 Adapter 脱敏错误，不计分、不撤分', async () => {
    const c = await setup();
    c.gitlab.mrs.push(c.mr(1, 'alice', c.review('merge_requests:1', 'bob')));
    await c.collect();
    c.gitlab.responses.set('/projects/geek%2Fadmin/merge_requests', () => { throw new DOMException('synthetic timeout', 'TimeoutError'); });
    expect(await c.collect()).toMatchObject({ error: 'gitlab_unreachable', accepted: 0, revoked: 0 });
    expect(await c.scoreOf('alice')).toBe(45);
  });

  it('G03 十页上限不当成成功；G04 请求预算耗尽整轮回滚', async () => {
    const c = await setup(); const path = '/projects/geek%2Fadmin/merge_requests';
    const record = c.app.services.competitions.get(c.id)!;
    const prefix = `${path}?state=merged&updated_after=${encodeURIComponent(new Date(record.start_at).toISOString())}&order_by=updated_at&per_page=100&page=`;
    for (let page = 1; page <= 10; page++) c.gitlab.responses.set(`${prefix}${page}`, () => c.gitlab.json(200, [], { 'x-next-page': String(page + 1) }));
    expect(await c.collect()).toMatchObject({ error: 'gitlab_pagination_incomplete', created: 0 });
    c.gitlab.responses.clear();
    for (let i = 1; i <= 300; i++) c.gitlab.mrs.push(c.mr(i, 'alice', c.review(`merge_requests:${i}`, 'bob')));
    expect(await c.collect()).toMatchObject({ error: 'request_budget_exhausted', created: 0, accepted: 0 });
    expect((await c.list()).items).toEqual([]);
    expect(await c.scoreOf('alice')).toBe(0);
  });

  it('G05 非合并MR、非法编号、窗外、未知映射与未报名作者都不能混入', async () => {
    const c = await setup();
    c.gitlab.mrs.push({ ...c.mr(1, 'alice', []), state: 'opened' }, { ...c.mr(2, 'alice', []), iid: 0 },
      { ...c.mr(3, 'alice', []), iid: -1 }, { ...c.mr(4, 'alice', []), iid: '4' },
      c.mr(5, 'alice', [], 'bad date'), c.mr(6, 'alice', [], new Date(Date.now() + 40 * 24 * HOUR).toISOString()),
      c.mr(7, 'unknown', []), c.mr(8, 'dave', []), c.mr(9, 'alice', []));
    expect(await c.collect()).toMatchObject({ created: 1, skipped: 2, error: null });
    expect((await c.list()).items.map((row: { gitlab_iid: number }) => row.gitlab_iid)).toEqual([9]);
  });

  it.each(['cancel', 'rules', 'reject', 'accept'] as const)('G06-%s HTTP等待期间变更生效，不被旧快照覆盖', async change => {
    const c = await setup();
    c.gitlab.mrs.push(c.mr(1, 'alice', [])); await c.collect();
    const candidate = (await c.list()).items[0];
    c.gitlab.mrs[0].labels = c.review('merge_requests:1', 'bob');
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    c.gitlab.responses.set('/projects/geek%2Fadmin/merge_requests/1/resource_label_events', async () => {
      entered(); await gate; return c.gitlab.json(200, c.gitlab.labelEvents.get('merge_requests:1'));
    });
    const pending = c.collect(); await waiting;
    if (change === 'cancel') expect((await c.app.inject({ method: 'DELETE', url: `/api/competitions/${c.id}/signup`, headers: c.as('alice') })).statusCode).toBe(200);
    else if (change === 'rules') {
      const rules = (await c.app.inject({ url: `/api/console/competitions/${c.id}/rules`, headers: c.as('owner') })).json();
      expect((await c.app.inject({ method: 'PUT', url: `/api/console/competitions/${c.id}/rules`, headers: c.as('owner'),
        payload: { grade_factors: rules.grade_factors, prizes: [], gitlab_projects: [] } })).statusCode).toBe(200);
    } else expect((await c.app.inject({ method: 'POST', url: `/api/console/competitions/${c.id}/candidates/${candidate.id}/${change}`, headers: c.as('bob'),
      payload: change === 'accept' ? { importance: 'critical', core: 'core' } : { reason: '合成驳回' } })).statusCode).toBe(200);
    release(); const run = await pending;
    expect(run.error).toBe(change === 'rules' ? 'collection_state_changed' : null);
    const current = (await c.list()).items[0];
    expect(current.status).toBe(change === 'accept' ? 'accepted' : change === 'reject' ? 'rejected' : 'pending');
    expect(current.accepted_via).toBe(change === 'accept' ? 'console' : null);
    const events = (await c.app.inject({ url: `/api/console/competitions/${c.id}/score-events`, headers: c.as('bob') })).json().events;
    expect(events).toHaveLength(change === 'accept' ? 1 : 0);
    if (change === 'accept') expect(events[0].weighted_points).toBe(100);
  });

  it('G07 并发收集同轮且重复审核只计一次', async () => {
    const c = await setup(); c.gitlab.mrs.push(c.mr(1, 'alice', []));
    const runs = await Promise.all([c.collect(), c.collect()]);
    expect(runs.map(run => run.created)).toEqual([1, 1]);
    const candidate = (await c.list()).items[0];
    const accept = () => c.app.inject({ method: 'POST', url: `/api/console/competitions/${c.id}/candidates/${candidate.id}/accept`,
      headers: c.as('bob'), payload: { importance: 'important', core: 'business' } });
    expect((await Promise.all([accept(), accept()])).map(row => row.statusCode).sort()).toEqual([200, 409]);
    expect(await c.scoreOf('alice')).toBe(45);
  });

  it.each(['label', 'accept', 'reject'] as const)('G08-%s 审计失败候选与积分一同回滚，重试可恢复', async kind => {
    const c = await setup(); c.gitlab.mrs.push(c.mr(1, 'alice', []));
    if (kind === 'label') c.gitlab.mrs[0].labels = c.review('merge_requests:1', 'bob');
    else await c.collect();
    const candidate = (await c.list()).items[0];
    const action = kind === 'reject' ? 'competition.candidate.reject' : 'competition.candidate.accept';
    c.app.services.storage.db.exec(`CREATE TRIGGER fail_candidate_audit BEFORE INSERT ON activity_events
      WHEN NEW.action = '${action}' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END`);
    const call = () => c.app.inject({ method: 'POST', url: `/api/console/competitions/${c.id}/candidates/${candidate.id}/${kind}`,
      headers: c.as('bob'), payload: kind === 'accept' ? { importance: 'important', core: 'business' } : { reason: '合成驳回' } });
    if (kind === 'label') {
      expect(await c.collect()).toMatchObject({ error: 'SQLITE_CONSTRAINT_TRIGGER', created: 0, accepted: 0 });
      expect((await c.list()).items).toEqual([]);
    } else {
      expect((await call()).statusCode).toBe(500);
      expect((await c.list()).items[0].status).toBe('pending');
    }
    expect(await c.scoreOf('alice')).toBe(0);
    c.app.services.storage.db.exec('DROP TRIGGER fail_candidate_audit');
    if (kind === 'label') expect(await c.collect()).toMatchObject({ accepted: 1, error: null });
    else expect((await call()).statusCode).toBe(200);
    expect(await c.scoreOf('alice')).toBe(kind === 'reject' ? 0 : 45);
  });
});

describe('「有用」标签', () => {
  it('较新标签事件不完整时不使用旧remove误撤积分，完整恢复后仍执行明确撤销', async () => {
    const { gitlab, mr, review, labelAdd, collect, list, scoreOf, recent } = await setup();
    gitlab.mrs.push(mr(805, 'alice', review('merge_requests:805', 'bob')));
    expect(await collect()).toMatchObject({ accepted: 1, error: null });
    expect(await scoreOf('alice')).toBe(45);
    gitlab.mrs[0].labels = [];
    labelAdd('merge_requests:805', 'bob', 'remove', new Date(Date.parse(recent) + 1000).toISOString(), 9);
    const events = gitlab.labelEvents.get('merge_requests:805')!;
    gitlab.replyOnce('/projects/geek%2Fadmin/merge_requests/805/resource_label_events', () => new Response(JSON.stringify([
      ...events, { ...events[0], id: 10, action: 'unknown', created_at: new Date(Date.parse(recent) + 2000).toISOString() },
    ]), { status: 200 }));
    expect(await collect()).toMatchObject({ revoked: 0, error: 'gitlab_data_incomplete' });
    expect((await list()).counts.accepted).toBe(1);
    expect(await scoreOf('alice')).toBe(45);
    expect(await collect()).toMatchObject({ revoked: 1, error: null });
    expect(await scoreOf('alice')).toBe(0);
  });

  it('标签事件读取失败不等于标签已移除，不撤销已验真的积分', async () => {
    const { gitlab, mr, review, collect, list, scoreOf } = await setup();
    gitlab.mrs.push(mr(1, 'alice', review('merge_requests:1', 'bob')));
    expect((await collect()).accepted).toBe(1);
    const score = await scoreOf('alice');
    gitlab.mrs[0].labels = [];
    gitlab.replyOnce('/projects/geek%2Fadmin/merge_requests/1/resource_label_events', () => new Response('{}', { status: 503 }));
    const failed = await collect();
    expect(failed.revoked).toBe(0);
    expect(failed.error).toBe('gitlab_http_503');
    expect((await list()).counts).toEqual({ pending: 0, accepted: 1, rejected: 0 });
    expect(await scoreOf('alice')).toBe(score);
  });

  it.each([undefined, null, ['有用', null]])('不完整标签字段 %j 不被当成空标签撤分', async labels => {
    const { gitlab, mr, review, collect, list, scoreOf } = await setup();
    gitlab.mrs.push(mr(1, 'alice', review('merge_requests:1', 'bob')));
    await collect();
    const score = await scoreOf('alice');
    gitlab.mrs[0].labels = labels;
    expect(await collect()).toMatchObject({ revoked: 0, error: 'gitlab_data_incomplete' });
    expect((await list()).counts.accepted).toBe(1);
    expect(await scoreOf('alice')).toBe(score);
  });

  it('完整读取标签事件分页，迟到的remove阻止旧页add自动加分，明确移除仍撤分', async () => {
    const { gitlab, mr, review, labelAdd, collect, list, scoreOf } = await setup();
    gitlab.mrs.push(mr(1, 'alice', review('merge_requests:1', 'bob')));
    const first = gitlab.labelEvents.get('merge_requests:1')!;
    const removal = { ...first[0], id: 10, action: 'remove', created_at: new Date().toISOString() };
    const path = '/projects/geek%2Fadmin/merge_requests/1/resource_label_events';
    gitlab.replyOnce(path, () => new Response(JSON.stringify(first), { status: 200, headers: { 'x-next-page': '2' } }));
    gitlab.replyOnce(path, () => new Response(JSON.stringify([removal]), { status: 200 }));
    expect(await collect()).toMatchObject({ accepted: 0, error: null });
    expect((await list()).counts).toEqual({ pending: 1, accepted: 0, rejected: 0 });
    expect((await collect()).accepted).toBe(1);
    expect(await scoreOf('alice')).toBeGreaterThan(0);
    gitlab.mrs[0].labels = [];
    labelAdd('merge_requests:1', 'bob', 'remove', new Date().toISOString(), 11);
    expect(await collect()).toMatchObject({ revoked: 1, error: null });
    expect(await scoreOf('alice')).toBe(0);
  });

  it.each([429, 500, 503])('标签事件第二页HTTP %i中断不使用第一页撤分', async status => {
    const { gitlab, mr, review, collect, list } = await setup();
    gitlab.mrs.push(mr(1, 'alice', review('merge_requests:1', 'bob')));
    await collect();
    gitlab.mrs[0].labels = [];
    const path = '/projects/geek%2Fadmin/merge_requests/1/resource_label_events';
    gitlab.replyOnce(path, () => new Response('[]', { status: 200, headers: { 'x-next-page': '2' } }));
    gitlab.replyOnce(path, () => new Response('{}', { status }));
    expect(await collect()).toMatchObject({ revoked: 0, error: `gitlab_http_${status}` });
    expect((await list()).counts.accepted).toBe(1);
  });

  it('标签事件跳过中间页时不把第一页remove作为完整撤分证据', async () => {
    const { gitlab, mr, review, collect, list, scoreOf, recent } = await setup();
    gitlab.mrs.push(mr(806, 'alice', review('merge_requests:806', 'bob')));
    expect(await collect()).toMatchObject({ accepted: 1, error: null });
    expect(await scoreOf('alice')).toBe(45);
    gitlab.mrs[0].labels = [];
    const first = gitlab.labelEvents.get('merge_requests:806')![0];
    const path = '/projects/geek%2Fadmin/merge_requests/806/resource_label_events';
    gitlab.replyOnce(path, () => new Response(JSON.stringify([{ ...first, id: 10, action: 'remove',
      created_at: new Date(Date.parse(recent) + 1000).toISOString() }]), { status: 200, headers: { 'x-next-page': '3' } }));
    gitlab.replyOnce(path, () => new Response('[]', { status: 200 }));
    expect(await collect()).toMatchObject({ revoked: 0, error: 'gitlab_pagination_incomplete' });
    expect((await list()).counts.accepted).toBe(1);
    expect(await scoreOf('alice')).toBe(45);
  });

  it('列表分页循环失败关闭，且没有标签移除事件时不臆造撤销', async () => {
    const { gitlab, mr, review, collect, list } = await setup();
    const item = mr(1, 'alice', review('merge_requests:1', 'bob'));
    gitlab.mrs.push(item);
    gitlab.replyOnce('/projects/geek%2Fadmin/merge_requests?', () => new Response(JSON.stringify([item]), { status: 200, headers: { 'x-next-page': '1' } }));
    expect(await collect()).toMatchObject({ created: 0, accepted: 0, revoked: 0, error: 'gitlab_pagination_incomplete' });
    await collect();
    gitlab.mrs[0].labels = [];
    gitlab.labelEvents.clear();
    expect(await collect()).toMatchObject({ revoked: 0, error: null });
    expect((await list()).counts.accepted).toBe(1);
  });

  it('已停用审核人的标签不能在另一个同步循环中自动加分', async () => {
    const { app, gitlab, mr, review, collect, accountId, id, as } = await setup();
    gitlab.mrs.push(mr(1, 'alice', review('merge_requests:1', 'bob')));
    app.services.storage.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(accountId('bob'));
    expect(await collect('owner')).toMatchObject({ accepted: 0, error: null });
    const page = await app.inject({ url: `/api/console/competitions/${id}/candidates`, headers: as('owner') });
    expect(page.json().counts).toEqual({ pending: 1, accepted: 0, rejected: 0 });
  });

  it.each([429, 500])('标签事件 HTTP %i 不能把已记分的贡献当成撤销', async status => {
    const { gitlab, mr, review, collect, scoreOf, list } = await setup();
    gitlab.mrs.push(mr(1, 'alice', review('merge_requests:1', 'bob')));
    await collect();
    gitlab.mrs[0].labels = [];
    gitlab.responses.set('/projects/geek%2Fadmin/merge_requests/1/resource_label_events',
      () => gitlab.json(status, { message: 'synthetic upstream failure' }));
    const run = await collect();
    expect(run.revoked).toBe(0);
    expect(await scoreOf('alice')).toBe(45);
    expect((await list()).counts.accepted).toBe(1);
  });
  it('「有用」和两档标签都由有审核权限的人加上才按两档自动加分；没有权限的人、作者自己加的、缺两档的不算，留在待确认并写明原因', async () => {
    const { app, gitlab, mr, labelAdd, review, collect, list, scoreOf, accountId, id } = await setup();
    gitlab.mrs.push(
      mr(1, 'alice', review('merge_requests:1', 'bob')),
      mr(2, 'alice', review('merge_requests:2', 'dave')),
      mr(3, 'carol', review('merge_requests:3', 'carol')),
      mr(5, 'alice', ['有用']),
      // 审核人打了「有用」，两档是作者自己改成最高的
      mr(6, 'carol', review('merge_requests:6', 'bob', '关键', '核心', 'carol')),
    );
    labelAdd('merge_requests:5', 'bob');
    const run = await collect();
    expect(run).toMatchObject({ created: 5, accepted: 1 });
    const items = (await list()).items as { gitlab_iid: number; status: string; accepted_via: string | null; note: string | null; final_points: number | null; reviewed_by: { account_id: string } | null }[];
    const one = items.find(item => item.gitlab_iid === 1)!;
    expect(one).toMatchObject({ status: 'accepted', accepted_via: 'label', importance: 'important', core: 'business', final_points: 45, note: null });
    expect(one.reviewed_by?.account_id).toBe(accountId('bob'));
    expect(items.find(item => item.gitlab_iid === 2)).toMatchObject({ status: 'pending', note: expect.stringContaining('没有审核积分的权限') });
    expect(items.find(item => item.gitlab_iid === 3)).toMatchObject({ status: 'pending', note: '「有用」标签是作者自己加的，未计分' });
    expect(items.find(item => item.gitlab_iid === 5)).toMatchObject({ status: 'pending', note: expect.stringContaining('重要程度和核心度要各有一个标签') });
    expect(items.find(item => item.gitlab_iid === 6)).toMatchObject({ status: 'pending', note: '「重要程度::关键」标签是作者自己加的，未计分' });
    expect(await scoreOf('alice')).toBe(45);
    expect(await scoreOf('carol')).toBe(0);
    expect(activityRows(app, { action: 'competition.candidate.accept' })[0]).toMatchObject({
      surface: 'system', account_id: accountId('bob'), meta: { via: 'label', points: 45, importance: 'important', core: 'business' },
    });
    const event = app.services.storage.db.prepare("SELECT created_by, repo, number, kind, importance, core, points FROM competition_score_events WHERE status = 'active'").get();
    expect(event).toEqual({ created_by: accountId('bob'), repo: 'geek/admin', number: 1, kind: 'pr', importance: 'important', core: 'business', points: 45 });
    // 公开动态里带上 GitLab 的标题、链接和两档
    const feed = (await app.inject({ url: `/api/public/competitions/${id}/feed` })).json();
    expect(feed.items[0]).toMatchObject({ kind: 'pr', title: 'MR 1', url: `${GITLAB}/geek/admin/-/merge_requests/1`, points: 45, importance: 'important', core: 'business' });
  });

  it('同一周的「一般 × 边缘」按合并时间只算第一条，别的周照算', async () => {
    const { app, as, gitlab, mr, review, collect, scoreOf, recent, id } = await setup();
    const now = Date.now();
    expect((await app.inject({ method: 'PATCH', url: `/api/console/competitions/${id}`, headers: as('owner'), payload: { start_at: now - 20 * 24 * HOUR } })).statusCode).toBe(200);
    const lastWeek = new Date(now - 8 * 24 * HOUR).toISOString();
    gitlab.mrs.push(
      mr(1, 'alice', review('merge_requests:1', 'bob', '一般', '边缘')),
      mr(2, 'alice', review('merge_requests:2', 'bob', '一般', '边缘')),
      mr(3, 'alice', review('merge_requests:3', 'bob', '一般', '边缘'), lastWeek),
    );
    expect(await collect()).toMatchObject({ accepted: 3 });
    const events = app.services.storage.db.prepare("SELECT number, points, damp_percent, weighted_points, contributed_at FROM competition_score_events ORDER BY number").all() as { number: number; points: number; damp_percent: number; weighted_points: number; contributed_at: number }[];
    expect(events.map(row => [row.number, row.points, row.damp_percent, row.weighted_points])).toEqual([[1, 15, 100, 15], [2, 15, 0, 0], [3, 15, 100, 15]]);
    expect(events[0].contributed_at).toBe(Date.parse(recent));
    expect(await scoreOf('alice')).toBe(30);
  });

  it('标签被拿掉：经标签加的分撤销、候选回到待确认；控制台确认的不受影响', async () => {
    const { app, gitlab, mr, labelAdd, review, collect, list, scoreOf, recent } = await setup();
    gitlab.mrs.push(mr(1, 'alice', review('merge_requests:1', 'bob', '一般', '业务')));
    await collect();
    expect(await scoreOf('alice')).toBe(25);
    gitlab.mrs[0].labels = ['重要程度::一般', '核心度::业务'];
    labelAdd('merge_requests:1', 'bob', 'remove', new Date(Date.parse(recent) + 60_000).toISOString(), 4);
    const run = await collect();
    expect(run.revoked).toBe(1);
    expect(await scoreOf('alice')).toBe(0);
    const pending = (await list('pending')).items[0];
    expect(pending).toMatchObject({ status: 'pending', accepted_via: null, note: '「有用」标签被移除，经标签加的分已撤销' });
    expect(app.services.storage.db.prepare("SELECT status, revoke_reason FROM competition_score_events").get()).toEqual({ status: 'revoked', revoke_reason: 'GitLab 上的「有用」标签被移除' });
    expect(activityRows(app, { action: 'competition.candidate.label_removed' })).toHaveLength(1);
  });
});

describe('控制台标记有用与驳回', () => {
  it('要 competition.score.review 与 step-up，不能审自己的；要选两档，分数查表；驳回会撤销已加的分', async () => {
    const { app, as, gitlab, mr, collect, list, scoreOf, makeStale, accountId, id } = await setup();
    gitlab.mrs.push(mr(1, 'alice', []), mr(2, 'carol', []));
    await collect();
    const items = (await list()).items as { id: string; gitlab_iid: number }[];
    const mine = items.find(item => item.gitlab_iid === 1)!.id;
    const carols = items.find(item => item.gitlab_iid === 2)!.id;
    const levels = { importance: 'critical', core: 'business' };
    const accept = (candidate: string, login: string, payload: Record<string, unknown> = levels) =>
      app.inject({ method: 'POST', url: `/api/console/competitions/${id}/candidates/${candidate}/accept`, headers: as(login), payload });
    expect((await accept(mine, 'alice')).json()).toMatchObject({ error: 'forbidden', node: 'competition.score.review' });
    grantPermNode(app, accountId('alice'), 'competition.score.review');
    expect((await accept(mine, 'alice')).json().error).toBe('self_review');
    // 不收手填分数，两档必须都选
    expect((await accept(carols, 'alice', { ...levels, points: 60 })).statusCode).toBe(400);
    expect((await accept(carols, 'alice', { importance: 'critical' })).statusCode).toBe(400);
    expect((await accept(carols, 'alice', { importance: 'critical', core: 'kernel' })).statusCode).toBe(400);
    const accepted = await accept(carols, 'alice', { ...levels, reason: '修了登录页的竞态' });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().candidate).toMatchObject({ status: 'accepted', accepted_via: 'console', importance: 'critical', core: 'business', final_points: 65, reason: '修了登录页的竞态' });
    expect(await scoreOf('carol')).toBe(65);
    expect((await accept(carols, 'alice')).json().error).toBe('already_accepted');
    expect(activityRows(app, { action: 'competition.candidate.accept' }).filter(row => row.outcome === 'ok')[0]).toMatchObject({
      surface: 'console', meta: { via: 'console', points: 65, importance: 'critical', core: 'business' },
    });

    const reject = (candidate: string, login: string, reason = '和已有的重复') =>
      app.inject({ method: 'POST', url: `/api/console/competitions/${id}/candidates/${candidate}/reject`, headers: as(login), payload: { reason } });
    makeStale('bob');
    expect((await reject(carols, 'bob')).json().error).toBe('step_up_required');
    const rejected = await reject(carols, 'alice');
    expect(rejected.json().candidate).toMatchObject({ status: 'rejected', reason: '和已有的重复', final_points: null });
    expect(await scoreOf('carol')).toBe(0);
    // 积分记录页上撤销一条来自候选的积分，候选也变成驳回
    expect((await accept(carols, 'owner')).statusCode).toBe(200);
    const event = app.services.storage.db.prepare("SELECT id FROM competition_score_events WHERE status = 'active'").get() as { id: string };
    await app.inject({ method: 'POST', url: `/api/console/competitions/${id}/score-events/${event.id}/revoke`, headers: as('owner'), payload: { reason: '误判' } });
    expect((await list('rejected')).items.find((item: { id: string }) => item.id === carols)).toMatchObject({ status: 'rejected', reason: '误判' });
  });
});
