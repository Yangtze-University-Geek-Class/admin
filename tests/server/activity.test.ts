import { afterEach, describe, expect, it } from 'vitest';
import { accountIdOf, activityRows, grantPermGroup, grantPermNode, signIn, testApp } from './helpers';

/**
 * 操作记录（routes/console/activity.ts，CONTRACT-274 §4）：GET /api/console/activity、activity.csv、
 * GET /api/console/accounts/:id/activity。这张路由改动前完全没有测试覆盖（人工审查确认），这里补上：
 * 403 门禁、IP 打码（默认打码，activity.read.ip 才给全量）、部长按本部门范围过滤（含 dept.none 特例）、
 * CSV 导出、单账号操作记录的范围外 403。写入口 recordActivity() 还没做（Step D），这里直接写 activity_events。
 */
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

const USERS: Record<string, number> = { alice: 801, bob: 802, carol: 803, dave: 804, erin: 805, frank: 806 };
async function setup() {
  const context = await testApp();
  contexts.push(context);
  const { app } = context;
  const sids = new Map<string, string>();
  const as = (login: string) => {
    if (!sids.has(login)) sids.set(login, signIn(app, login, USERS[login]));
    return { cookie: `sid=${sids.get(login)}` };
  };
  const accountId = (login: string) => { as(login); return accountIdOf(app, login); };
  const db = app.services.storage.db;
  // 一个全新的库启动时，迁移会把首次回填账号系统写的 identity.backfill 审计复制进 activity_events（见
  // lib/migrations/2026-10-yugc-v2.ts 步骤 7），和这里测试要插入的记录无关，先清掉以免干扰计数与分页断言。
  db.prepare("DELETE FROM activity_events WHERE action = 'identity.backfill'").run();
  const insertEvent = (patch: Partial<{
    at: number; account_id: string | null; visitor_id: string | null; surface: string; action: string;
    target_type: string | null; target_id: string | null; outcome: string; ip: string | null; ua: string | null; request_id: string | null; meta: string;
  }> = {}) => {
    const row = {
      at: Date.now(), account_id: null, visitor_id: null, surface: 'console', action: 'test.event',
      target_type: null, target_id: null, outcome: 'ok', ip: null, ua: 'fixture-agent/1.0', request_id: null, meta: '{}',
      ...patch,
    };
    db.prepare(`INSERT INTO activity_events(at, account_id, visitor_id, surface, action, target_type, target_id, outcome, ip, ua, request_id, meta)
      VALUES(@at, @account_id, @visitor_id, @surface, @action, @target_type, @target_id, @outcome, @ip, @ua, @request_id, @meta)`).run(row);
  };
  return { app, as, accountId, db, insertEvent };
}

describe('GET /api/console/activity（CONTRACT-274 §4：activity.read，IP 默认打码）', () => {
  it('没有 activity.read 回 403', async () => {
    const { app, as } = await setup();
    const denied = await app.inject({ url: '/api/console/activity', headers: as('dave') });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'forbidden', node: 'activity.read', message: '需要「activity.read」权限' });
  });

  it('全站权限看到全部记录；IP 默认打码（IPv4 前两段、IPv6 前 4 组），有 activity.read.ip 才给全量', async () => {
    const { app, as, accountId, insertEvent } = await setup();
    const aliceId = accountId('alice');
    insertEvent({ account_id: aliceId, ip: '203.0.113.42', action: 'application.view' });
    insertEvent({ visitor_id: 'v-anon-1', ip: '2001:db8:85a3:0000:0000:8a2e:0370:7334', action: 'forum.read' });
    grantPermNode(app, aliceId, 'activity.read');

    const masked = await app.inject({ url: '/api/console/activity', headers: as('alice') });
    expect(masked.statusCode).toBe(200);
    const items = masked.json().items as { ip: string | null; account: { id: string } | null; visitor_id: string | null }[];
    expect(items).toHaveLength(2);
    expect(items.find(i => i.account?.id === aliceId)!.ip).toBe('203.0.*.*');
    expect(items.find(i => i.visitor_id === 'v-anon-1')!.ip).toBe('2001:db8:85a3:0000::*');

    grantPermNode(app, aliceId, 'activity.read.ip');
    const full = await app.inject({ url: '/api/console/activity', headers: as('alice') });
    const fullItems = full.json().items as { ip: string | null; account: { id: string } | null; visitor_id: string | null }[];
    expect(fullItems.find(i => i.account?.id === aliceId)!.ip).toBe('203.0.113.42');
    expect(fullItems.find(i => i.visitor_id === 'v-anon-1')!.ip).toBe('2001:db8:85a3:0000:0000:8a2e:0370:7334');
  });

  it('部长按本部门范围过滤；dept.none 把没有部门的人单独算一类', async () => {
    const { app, as, accountId, insertEvent } = await setup();
    const carolId = accountId('carol'); // dept.ai 成员
    const daveId = accountId('dave'); // dept.algo 成员
    const bobId = accountId('bob'); // 没有任何部门
    grantPermGroup(app, carolId, 'dept.ai');
    grantPermGroup(app, daveId, 'dept.algo');
    insertEvent({ account_id: carolId, action: 'apply.review' });
    insertEvent({ account_id: daveId, action: 'apply.review' });
    insertEvent({ account_id: bobId, action: 'apply.review' });

    const erinId = accountId('erin');
    grantPermGroup(app, erinId, 'title.ai.head'); // 部长称号自带 scope {department:["dept.ai"]} 的 activity.read
    const scoped = await app.inject({ url: '/api/console/activity', headers: as('erin') });
    expect(scoped.statusCode).toBe(200);
    const scopedIds = (scoped.json().items as { account: { id: string } | null }[]).map(item => item.account?.id);
    expect(scopedIds).toEqual([carolId]);

    // dept.none：直接测 requireScopedPermission 对这个特殊取值的处理，不依赖具体哪个称号会授予它。
    const frankId = accountId('frank');
    grantPermNode(app, frankId, 'activity.read', { department: ['dept.none'] });
    const noneScoped = await app.inject({ url: '/api/console/activity', headers: as('frank') });
    expect(noneScoped.statusCode).toBe(200);
    const noneIds = (noneScoped.json().items as { account: { id: string } | null }[]).map(item => item.account?.id);
    expect(noneIds).toContain(bobId);
    expect(noneIds).not.toContain(carolId);
    expect(noneIds).not.toContain(daveId);
  });

  it('blocked_today 按北京时间今天统计 outcome=limited 的桶', async () => {
    const { app, as, accountId, insertEvent } = await setup();
    const aliceId = accountId('alice');
    grantPermNode(app, aliceId, 'activity.read');
    insertEvent({ outcome: 'limited', meta: JSON.stringify({ bucket: 'apply.daily' }) });
    insertEvent({ outcome: 'limited', meta: JSON.stringify({ bucket: 'apply.daily' }) });
    insertEvent({ outcome: 'limited', meta: JSON.stringify({ bucket: 'forum.topic.hourly' }) });
    // 三天前的限额记录不算进「今天」
    insertEvent({ outcome: 'limited', meta: JSON.stringify({ bucket: 'apply.daily' }), at: Date.now() - 3 * 24 * 60 * 60 * 1000 });
    const response = await app.inject({ url: '/api/console/activity', headers: as('alice') });
    const blocked = response.json().blocked_today as { bucket: string; count: number }[];
    expect(blocked.sort((a, b) => a.bucket.localeCompare(b.bucket))).toEqual([{ bucket: 'apply.daily', count: 2 }, { bucket: 'forum.topic.hourly', count: 1 }]);
  });

  it('游标翻页：超过一页时带下一页的游标，用它能翻到剩下的记录且不重复', async () => {
    const { app, as, accountId, insertEvent } = await setup();
    const aliceId = accountId('alice');
    grantPermNode(app, aliceId, 'activity.read');
    const base = Date.now();
    for (let i = 0; i < 51; i += 1) insertEvent({ at: base - i, action: `test.event.${i}` });
    const first = await app.inject({ url: '/api/console/activity', headers: as('alice') });
    const firstBody = first.json() as { items: { action: string }[]; next_cursor: string | null };
    expect(firstBody.items).toHaveLength(50);
    expect(firstBody.next_cursor).not.toBeNull();
    const second = await app.inject({ url: `/api/console/activity?cursor=${firstBody.next_cursor}`, headers: as('alice') });
    const secondBody = second.json() as { items: { action: string }[]; next_cursor: string | null };
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.next_cursor).toBeNull();
    const seen = new Set([...firstBody.items, ...secondBody.items].map(item => item.action));
    expect(seen.size).toBe(51);
  });

  it('按页翻（#370）：offset 指定从第几条读起，total 是筛选条件下的总条数，和页码无关', async () => {
    const { app, as, accountId, insertEvent } = await setup();
    const aliceId = accountId('alice');
    grantPermNode(app, aliceId, 'activity.read');
    const base = Date.now();
    for (let i = 0; i < 51; i += 1) insertEvent({ at: base - i, action: `test.event.${i}` });
    insertEvent({ at: base - 100, action: 'other.event' });
    type Page = { items: { action: string }[]; total: number };
    const first = (await app.inject({ url: '/api/console/activity?action=test.', headers: as('alice') })).json() as Page;
    const second = (await app.inject({ url: '/api/console/activity?action=test.&offset=50', headers: as('alice') })).json() as Page;
    expect(first.total).toBe(51);
    expect(second.total).toBe(51);
    expect(second.items.map(item => item.action)).toEqual(['test.event.50']);
    expect(new Set([...first.items, ...second.items].map(item => item.action)).size).toBe(51);
    const bad = await app.inject({ url: '/api/console/activity?offset=-1', headers: as('alice') });
    expect(bad.statusCode).toBe(400);
  });
});

describe('GET /api/console/activity.csv（CONTRACT-274 §4：activity.export，5000 行上限）', () => {
  it('没有 activity.export 回 403；有的话导出带 BOM、CRLF 和 CSV 转义，打码规则和列表一致', async () => {
    const { app, as, accountId, insertEvent } = await setup();
    const aliceId = accountId('alice');
    insertEvent({ account_id: aliceId, ip: '203.0.113.42', action: 'application.review', target_id: '"quoted",id' });
    const denied = await app.inject({ url: '/api/console/activity.csv', headers: as('alice') });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'forbidden', node: 'activity.export', message: '需要「activity.export」权限' });

    grantPermNode(app, aliceId, 'activity.export');
    const response = await app.inject({ url: '/api/console/activity.csv', headers: as('alice') });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe('attachment; filename="activity.csv"');
    expect(response.body.startsWith('﻿id,at,account_id,username,visitor_id,surface,action,target_type,target_id,outcome,ip,request_id\r\n')).toBe(true);
    expect(response.body).toContain('203.0.*.*'); // 没有 activity.read.ip 时导出也打码
    expect(response.body).toContain('"""quoted"",id"');
    // action='activity.export' 现在有两条：上面那次 403 被 http-policy.ts 的全局钩子记了一条 outcome=denied
    // 的操作记录（SPEC §3.7「所有被 403 拒绝的请求记 outcome = 'denied'」，和真正的 node 名撞了），这里只看
    // 这次真正导出成功写的那条（outcome=ok）。
    const exported = activityRows(app, { action: 'activity.export' }).find(row => row.outcome === 'ok');
    expect(exported).toBeDefined();
    // 2 行：手动插入的那条，加上上面那次 403 记的 denied 操作记录，导出时一起导出来了。
    expect(exported!.meta).toEqual({ rows: 2 });
  });
});

describe('GET /api/console/accounts/:id/activity（CONTRACT-274 §4：部长只能看本部门账号的操作记录）', () => {
  it('范围内的账号可以看，范围外的账号回 403 并说明不在范围内', async () => {
    const { app, as, accountId, insertEvent } = await setup();
    const carolId = accountId('carol');
    const daveId = accountId('dave');
    grantPermGroup(app, carolId, 'dept.ai');
    grantPermGroup(app, daveId, 'dept.algo');
    insertEvent({ account_id: carolId, action: 'apply.review' });
    insertEvent({ account_id: daveId, action: 'apply.review' });
    const erinId = accountId('erin');
    grantPermGroup(app, erinId, 'title.ai.head');

    const inScope = await app.inject({ url: `/api/console/accounts/${carolId}/activity`, headers: as('erin') });
    expect(inScope.statusCode).toBe(200);
    expect((inScope.json().items as { account: { id: string } }[]).every(item => item.account.id === carolId)).toBe(true);

    const outOfScope = await app.inject({ url: `/api/console/accounts/${daveId}/activity`, headers: as('erin') });
    expect(outOfScope.statusCode).toBe(403);
    expect(outOfScope.json()).toEqual({ error: 'forbidden', node: 'activity.read', message: '这个账号不在你的范围内' });

    // 全站权限不受这层范围限制
    const aliceId = accountId('alice');
    grantPermNode(app, aliceId, 'activity.read');
    const full = await app.inject({ url: `/api/console/accounts/${daveId}/activity`, headers: as('alice') });
    expect(full.statusCode).toBe(200);
  });
});
