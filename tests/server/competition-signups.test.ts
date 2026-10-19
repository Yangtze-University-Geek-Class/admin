// 比赛报名与组队（#239）：支持内部赛报名、外部赛意向登记、双向确认组队与控制台名单导出。
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../app/server/src/services';
import { testApp } from './helpers';

const CONSOLE_ORG = 'Yangtze-University-Geek-Class';
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

const USERS: Record<string, number> = {
  alice: 101, // 提督，全部权限
  bob: 102,   // 成员，无 competitions.manage
  charlie: 103, // 成员
  dave: 104,  // 成员
  eve: 105,   // 成员
  outsider: 999, // 非组织成员
};

function github(roles: Record<string, 'admin' | 'member'>) {
  return (() => ({
    request: async (route: string, params: Record<string, string>) => {
      if (route === 'GET /orgs/{org}/memberships/{username}') {
        const role = params.org === CONSOLE_ORG ? roles[params.username.toLowerCase()] : undefined;
        if (!role) throw Object.assign(new Error('stub not found'), { status: 404 });
        return { data: { state: 'active', role } };
      }
      throw new Error(`Unexpected GitHub call ${route}`);
    },
  })) as unknown as ServiceOverrides['octokitFactory'];
}

async function setup() {
  const context = await testApp({
    octokitFactory: github({
      alice: 'admin',
      bob: 'member',
      charlie: 'member',
      dave: 'member',
      eve: 'member',
    }),
  });
  contexts.push(context);
  const { app } = context;
  const as = (login: string) => ({
    cookie: `sid=${app.services.auth.createSession(login, USERS[login] ?? null, null, `token-${login}`)}`,
  });
  return { app, as };
}

const HOUR = 3600_000;
const NOW = Date.now();

describe('competition signups and team formation (#239)', () => {
  it('strictly isolates access: anonymous 401, outsider 403', async () => {
    const { app, as } = await setup();
    const comp = app.services.competitions.insert(
      randomUUID(),
      {
        name: '权限防护赛',
        kind: 'internal',
        start_at: NOW + 2 * HOUR,
        end_at: NOW + 10 * HOUR,
        signup_deadline: NOW + HOUR,
        url: null,
        description: '防护测试',
      },
      NOW,
    )!;

    // 未登录访问报名 -> 401 not_signed_in
    const resAnon = await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      payload: { note: '匿名尝试' },
    });
    expect(resAnon.statusCode).toBe(401);
    expect(resAnon.json().error).toBe('not_signed_in');

    // 非组织成员（outsider）访问报名 -> 403 not_member
    const resOutsider = await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('outsider'),
      payload: { note: '外部人员尝试' },
    });
    expect(resOutsider.statusCode).toBe(403);
    expect(resOutsider.json().error).toBe('not_member');
  });

  it('manages signup settings and enforces competition constraints', async () => {
    const { app, as } = await setup();
    const comp = app.services.competitions.insert(
      randomUUID(),
      {
        name: '规则测试赛',
        kind: 'internal',
        start_at: NOW + 2 * HOUR,
        end_at: NOW + 10 * HOUR,
        signup_deadline: NOW + HOUR,
        url: null,
        description: '设置测试',
      },
      NOW,
    )!;

    // 1. 无 competitions.manage 能力的成员不能改设置 -> 403
    const resBob = await app.inject({
      method: 'PUT',
      url: `/api/console/competitions/${comp.id}/signup-settings`,
      headers: as('bob'),
      payload: { enabled: true, participation: 'team', team_min: 2, team_max: 4 },
    });
    expect(resBob.statusCode).toBe(403);

    // 2. 团队赛参数校验：team_min > team_max -> 400 bad_team_size
    const resBadSize = await app.inject({
      method: 'PUT',
      url: `/api/console/competitions/${comp.id}/signup-settings`,
      headers: as('alice'),
      payload: { enabled: true, participation: 'team', team_min: 5, team_max: 3 },
    });
    expect(resBadSize.statusCode).toBe(400);
    expect(resBadSize.json().error).toBe('bad_team_size');

    // 3. 个人赛不能指定人数 -> 400 bad_team_size
    const resBadInd = await app.inject({
      method: 'PUT',
      url: `/api/console/competitions/${comp.id}/signup-settings`,
      headers: as('alice'),
      payload: { enabled: true, participation: 'individual', team_min: 1, team_max: 1 },
    });
    expect(resBadInd.statusCode).toBe(400);
    expect(resBadInd.json().error).toBe('bad_team_size');

    // 4. 正确设置团队赛参数
    const resOk = await app.inject({
      method: 'PUT',
      url: `/api/console/competitions/${comp.id}/signup-settings`,
      headers: as('alice'),
      payload: { enabled: true, participation: 'team', team_min: 2, team_max: 3 },
    });
    expect(resOk.statusCode).toBe(200);
    expect(resOk.json().settings.enabled).toBe(true);
    expect(resOk.json().settings.team_min).toBe(2);
    expect(resOk.json().settings.team_max).toBe(3);

    // 5. Bob 报名
    const resBobSignup = await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('bob'),
      payload: { note: '参赛', looking_for_team: true },
    });
    expect(resBobSignup.statusCode).toBe(201);

    // 6. 已有报名后，不能修改比赛 kind (PATCH) -> 409 competition_has_signups
    const resPatchKind = await app.inject({
      method: 'PATCH',
      url: `/api/console/competitions/${comp.id}`,
      headers: as('alice'),
      payload: { kind: 'external' },
    });
    expect(resPatchKind.statusCode).toBe(409);
    expect(resPatchKind.json().error).toBe('competition_has_signups');

    // 7. 开放报名期间，不能清空报名截止时间 -> 409 signup_deadline_required
    const resPatchDeadline = await app.inject({
      method: 'PATCH',
      url: `/api/console/competitions/${comp.id}`,
      headers: as('alice'),
      payload: { signup_deadline: null },
    });
    expect(resPatchDeadline.statusCode).toBe(409);
    expect(resPatchDeadline.json().error).toBe('signup_deadline_required');

    // 8. 已有报名记录的比赛不能直接删除，只能下线 -> 409 competition_has_signups
    const resDelete = await app.inject({
      method: 'DELETE',
      url: `/api/console/competitions/${comp.id}`,
      headers: as('alice'),
    });
    expect(resDelete.statusCode).toBe(409);
    expect(resDelete.json().error).toBe('competition_has_signups');
  });

  it('handles individual competition registration, idempotency and cancellation', async () => {
    const { app, as } = await setup();
    const comp = app.services.competitions.insert(
      randomUUID(),
      {
        name: '单人天梯赛',
        kind: 'internal',
        start_at: NOW + 2 * HOUR,
        end_at: NOW + 10 * HOUR,
        signup_deadline: NOW + HOUR,
        url: null,
        description: '单人赛',
      },
      NOW,
    )!;

    // 1. 尚未开放报名时写操作报 409 signup_not_enabled
    const resNotOpen = await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('bob'),
      payload: { note: '急着报名' },
    });
    expect(resNotOpen.statusCode).toBe(409);
    expect(resNotOpen.json().error).toBe('signup_not_enabled');

    // 管理员开放个人赛报名
    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/console/competitions/${comp.id}/signup-settings`,
      headers: as('alice'),
      payload: { enabled: true, participation: 'individual', team_min: null, team_max: null },
    });
    expect(putRes.statusCode).toBe(200);

    // 2. 报名成功（不含 contact 字段）
    const resSignup = await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('bob'),
      payload: { note: '冲刺冠军' },
    });
    expect(resSignup.statusCode).toBe(201);
    expect(resSignup.json().signup.status).toBe('active');
    expect(resSignup.json().signup.account_id).toBe('bob');
    expect(resSignup.json().signup.note).toBe('冲刺冠军');

    // 3. 重复报名为幂等更新
    const resUpdate = await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('bob'),
      payload: { note: '更新备注' },
    });
    expect(resUpdate.statusCode).toBe(201);
    expect(resUpdate.json().signup.note).toBe('更新备注');

    // 4. 个人赛不能建队 -> 409 individual_competition
    const resTeam = await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/teams`,
      headers: as('bob'),
      payload: { name: '违规建队' },
    });
    expect(resTeam.statusCode).toBe(409);
    expect(resTeam.json().error).toBe('individual_competition');

    // 5. 查看个人状态（内部个人赛报名后 state 为 confirmed）
    const resStatus = await app.inject({
      method: 'GET',
      url: `/api/competitions/${comp.id}/my-status`,
      headers: as('bob'),
    });
    expect(resStatus.statusCode).toBe(200);
    expect(resStatus.json().status.state).toBe('confirmed');
    expect(resStatus.json().status.actions).toContain('cancel_signup');

    // 6. 取消报名
    const resCancel = await app.inject({
      method: 'DELETE',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('bob'),
    });
    expect(resCancel.statusCode).toBe(200);

    // 7. 取消后状态恢复为 none
    const resStatusAfter = await app.inject({
      method: 'GET',
      url: `/api/competitions/${comp.id}/my-status`,
      headers: as('bob'),
    });
    expect(resStatusAfter.json().status.state).toBe('none');

    // 8. 再次取消报 409 not_signed_up
    const resCancelAgain = await app.inject({
      method: 'DELETE',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('bob'),
    });
    expect(resCancelAgain.statusCode).toBe(409);
    expect(resCancelAgain.json().error).toBe('not_signed_up');
  });

  it('runs complete team lifecycle: recruiting, invite, apply, mutual confirm, lock, unlock, leave, disband', async () => {
    const { app, as } = await setup();
    const comp = app.services.competitions.insert(
      randomUUID(),
      {
        name: '极客团队对抗赛',
        kind: 'internal',
        start_at: NOW + 2 * HOUR,
        end_at: NOW + 20 * HOUR,
        signup_deadline: NOW + HOUR,
        url: null,
        description: '团队赛',
      },
      NOW,
    )!;

    // 开放团队赛：队伍人数 [2, 3]
    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/console/competitions/${comp.id}/signup-settings`,
      headers: as('alice'),
      payload: { enabled: true, participation: 'team', team_min: 2, team_max: 3 },
    });
    expect(putRes.statusCode).toBe(200);

    // 1. 未报名不能建队 -> 409 not_signed_up
    const resNoSignupTeam = await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/teams`,
      headers: as('bob'),
      payload: { name: '先锋战队' },
    });
    expect(resNoSignupTeam.statusCode).toBe(409);
    expect(resNoSignupTeam.json().error).toBe('not_signed_up');

    // Bob 报名并建队
    await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('bob'),
      payload: { note: '找人组队' },
    });

    const resCreate = await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/teams`,
      headers: as('bob'),
      payload: { name: '先锋战队', slogan: '勇争第一' },
    });
    expect(resCreate.statusCode).toBe(201);
    const teamId = resCreate.json().team.id;
    expect(resCreate.json().team.name).toBe('先锋战队');
    expect(resCreate.json().team.leader.account_id).toBe('bob');
    expect(resCreate.json().team.member_count).toBe(1);

    // 2. Charlie 报名且勾选找队友，出现在 free-agents 接口中
    await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('charlie'),
      payload: { note: '找队伍', looking_for_team: true },
    });

    const resFreeAgents = await app.inject({
      method: 'GET',
      url: `/api/competitions/${comp.id}/free-agents`,
      headers: as('bob'),
    });
    expect(resFreeAgents.statusCode).toBe(200);
    expect(resFreeAgents.json().free_agents.some((f: any) => f.account_id === 'charlie')).toBe(true);

    // 3. 邀请 Charlie（收 account_id）
    const resInvite = await app.inject({
      method: 'POST',
      url: `/api/teams/${teamId}/invite`,
      headers: as('bob'),
      payload: { account_id: 'charlie', message: '来我们队吧' },
    });
    expect(resInvite.statusCode).toBe(201);
    const inviteId = resInvite.json().membership_id;

    // 4. Dave 尝试响应 Charlie 的邀请 -> 403 forbidden
    const resDaveIllegal = await app.inject({
      method: 'POST',
      url: `/api/teams/${teamId}/respond`,
      headers: as('dave'),
      payload: { membership_id: inviteId, action: 'accept' },
    });
    expect(resDaveIllegal.statusCode).toBe(403);
    expect(resDaveIllegal.json().error).toBe('forbidden');

    // 5. Charlie 接收邀请 -> 加入队伍
    const resCharlieAccept = await app.inject({
      method: 'POST',
      url: `/api/teams/${teamId}/respond`,
      headers: as('charlie'),
      payload: { membership_id: inviteId, action: 'accept' },
    });
    expect(resCharlieAccept.statusCode).toBe(200);
    expect(resCharlieAccept.json().status).toBe('active');

    // 入队后 Charlie 从 free-agents 消失
    const resFreeAgents2 = await app.inject({
      method: 'GET',
      url: `/api/competitions/${comp.id}/free-agents`,
      headers: as('bob'),
    });
    expect(resFreeAgents2.json().free_agents.some((f: any) => f.account_id === 'charlie')).toBe(false);

    // 6. Dave 报名并申请入队
    await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('dave'),
      payload: { note: 'Dave 报名' },
    });

    const resDaveApply = await app.inject({
      method: 'POST',
      url: `/api/teams/${teamId}/apply`,
      headers: as('dave'),
      payload: { message: '请带上我' },
    });
    expect(resDaveApply.statusCode).toBe(201);
    const applyId = resDaveApply.json().membership_id;

    // 7. 队长 Bob 同意 Dave 入队（此时队伍满 3 人上限）
    const resBobApprove = await app.inject({
      method: 'POST',
      url: `/api/teams/${teamId}/respond`,
      headers: as('bob'),
      payload: { membership_id: applyId, action: 'accept' },
    });
    expect(resBobApprove.statusCode).toBe(200);
    expect(resBobApprove.json().status).toBe('active');

    // 8. Eve 报名尝试申请满员队伍 -> 409 team_full
    await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('eve'),
      payload: { note: 'Eve 报名' },
    });
    const resEveApply = await app.inject({
      method: 'POST',
      url: `/api/teams/${teamId}/apply`,
      headers: as('eve'),
    });
    expect(resEveApply.statusCode).toBe(409);
    expect(resEveApply.json().error).toBe('team_full');

    // 9. 队长确认参赛锁定队伍（达到 team_min = 2，team_max = 3）
    const resLock = await app.inject({
      method: 'POST',
      url: `/api/teams/${teamId}/lock`,
      headers: as('bob'),
    });
    expect(resLock.statusCode).toBe(200);
    expect(resLock.json().status).toBe('locked');

    // 10. 队伍锁定后队员无法退队 -> 409 team_locked
    const resLeaveLocked = await app.inject({
      method: 'POST',
      url: `/api/teams/${teamId}/leave`,
      headers: as('charlie'),
    });
    expect(resLeaveLocked.statusCode).toBe(409);
    expect(resLeaveLocked.json().error).toBe('team_locked');

    // 11. 队长撤销锁定 -> 恢复 recruiting
    const resUnlock = await app.inject({
      method: 'DELETE',
      url: `/api/teams/${teamId}/lock`,
      headers: as('bob'),
    });
    expect(resUnlock.statusCode).toBe(200);
    expect(resUnlock.json().status).toBe('recruiting');

    // 12. 队员 Dave 退出队伍
    const resDaveLeave = await app.inject({
      method: 'POST',
      url: `/api/teams/${teamId}/leave`,
      headers: as('dave'),
    });
    expect(resDaveLeave.statusCode).toBe(200);
    expect(resDaveLeave.json().action).toBe('left');

    // 13. 队长 Bob 转让队长给 Charlie
    const resTransfer = await app.inject({
      method: 'POST',
      url: `/api/teams/${teamId}/transfer`,
      headers: as('bob'),
      payload: { account_id: 'charlie' },
    });
    expect(resTransfer.statusCode).toBe(200);
    expect(resTransfer.json().leader_account_id).toBe('charlie');

    // 14. 原队长 Bob 现在成为队员，可以退队
    const resBobLeave = await app.inject({
      method: 'POST',
      url: `/api/teams/${teamId}/leave`,
      headers: as('bob'),
    });
    expect(resBobLeave.statusCode).toBe(200);
    expect(resBobLeave.json().action).toBe('left');

    // 15. 新队长 Charlie 解散队伍
    const resDisband = await app.inject({
      method: 'DELETE',
      url: `/api/teams/${teamId}`,
      headers: as('charlie'),
    });
    expect(resDisband.statusCode).toBe(200);
    expect(resDisband.json().action).toBe('disbanded');
  });

  it('provides personal multi-competition dashboard and console roster CSV export with audit', async () => {
    const { app, as } = await setup();
    const compId = randomUUID();
    const comp = app.services.competitions.insert(
      compId,
      {
        name: '全国极客应用大赛',
        kind: 'external',
        start_at: NOW + 2 * HOUR,
        end_at: NOW + 10 * HOUR,
        signup_deadline: NOW + HOUR,
        url: 'https://example.com/geek',
        description: '导出与看板测试',
      },
      NOW,
    )!;

    // 开启团队赛报名
    await app.inject({
      method: 'PUT',
      url: `/api/console/competitions/${comp.id}/signup-settings`,
      headers: as('alice'),
      payload: { enabled: true, participation: 'team', team_min: 1, team_max: 3 },
    });

    // 报名并带潜在 CSV 注入字符测试
    await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('bob'),
      payload: { note: '=SUM(1,2)' },
    });

    await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('charlie'),
      payload: { note: '+cmd' },
    });

    // Bob 建队并邀请 Charlie，Charlie 尚未接受（pending 状态）
    const teamRes = await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/teams`,
      headers: as('bob'),
      payload: { name: '胜利之师' },
    });
    const teamId = teamRes.json().team.id;

    await app.inject({
      method: 'POST',
      url: `/api/teams/${teamId}/invite`,
      headers: as('bob'),
      payload: { account_id: 'charlie' },
    });

    // 1. Charlie 查看「我的参赛」仪表板 GET /api/me/competitions
    const resMyComps = await app.inject({
      method: 'GET',
      url: '/api/me/competitions',
      headers: as('charlie'),
    });
    expect(resMyComps.statusCode).toBe(200);
    expect(resMyComps.json().pending_count).toBe(1);
    expect(resMyComps.json().pending[0].team.name).toBe('胜利之师');
    expect(resMyComps.json().competitions.length).toBe(1);

    // 2. 提督（alice）查看控制台花名册
    const resRoster = await app.inject({
      method: 'GET',
      url: `/api/console/competitions/${comp.id}/roster`,
      headers: as('alice'),
    });
    expect(resRoster.statusCode).toBe(200);
    const roster = resRoster.json().roster;
    expect(roster.summary.total_signups).toBe(2);
    expect(roster.summary.teams_count).toBe(1);

    // 3. 提督（alice）导出 CSV
    const resCsv = await app.inject({
      method: 'GET',
      url: `/api/console/competitions/${comp.id}/roster.csv`,
      headers: as('alice'),
    });
    expect(resCsv.statusCode).toBe(200);
    expect(resCsv.headers['content-type']).toContain('text/csv');
    const csvContent = resCsv.body;

    // 校验 BOM、注入防护、去除 contact、正确字段
    expect(csvContent.startsWith('﻿')).toBe(true);
    expect(csvContent).toContain("'=SUM(1,2)");
    expect(csvContent).toContain("'+cmd");
    expect(csvContent).toContain('bob');
    expect(csvContent).toContain('charlie');
    expect(csvContent).not.toContain('contact');

    // 4. 校验审计日志中有 competition.roster.export
    const auditRes = await app.inject({
      method: 'GET',
      url: '/api/console/audit?action=competition.roster.export',
      headers: as('alice'),
    });
    expect(auditRes.statusCode).toBe(200);
    expect(auditRes.json().logs.some((item: any) => item.action === 'competition.roster.export')).toBe(true);
  });
});
