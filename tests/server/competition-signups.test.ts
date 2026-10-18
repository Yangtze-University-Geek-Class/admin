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
  it('handles internal registration and external intent registration', async () => {
    const { app, as } = await setup();
    const internalComp = app.services.competitions.insert(
      'comp-internal-1',
      {
        name: '班级极客算法邀请赛',
        kind: 'internal',
        start_at: NOW + 2 * HOUR,
        end_at: NOW + 10 * HOUR,
        signup_deadline: NOW + HOUR,
        url: null,
        description: '内部赛',
      },
      NOW,
    )!;

    const externalComp = app.services.competitions.insert(
      'comp-external-1',
      {
        name: '全国大学生计算机大赛',
        kind: 'external',
        start_at: NOW + 2 * HOUR,
        end_at: NOW + 10 * HOUR,
        signup_deadline: NOW + HOUR,
        url: 'https://example.com/contest',
        description: '外部赛',
      },
      NOW,
    )!;

    // 内部比赛报名：状态为 registered
    const resInternal = await app.inject({
      method: 'POST',
      url: `/api/competitions/${internalComp.id}/signup`,
      headers: as('bob'),
      payload: { note: '练习动态规划', contact: 'QQ: 123456' },
    });
    expect(resInternal.statusCode).toBe(201);
    const bodyInternal = resInternal.json();
    expect(bodyInternal.ok).toBe(true);
    expect(bodyInternal.signup.kind).toBe('internal');
    expect(bodyInternal.signup.status).toBe('registered');
    expect(bodyInternal.signup.github_login).toBe('bob');
    expect(bodyInternal.signup.contact).toBe('QQ: 123456');

    // 外部比赛登记意向：状态为 intent
    const resExternal = await app.inject({
      method: 'POST',
      url: `/api/competitions/${externalComp.id}/signup`,
      headers: as('charlie'),
      payload: { note: '找前端队友', contact: 'WeChat: c_team' },
    });
    expect(resExternal.statusCode).toBe(201);
    const bodyExternal = resExternal.json();
    expect(bodyExternal.ok).toBe(true);
    expect(bodyExternal.signup.kind).toBe('external');
    expect(bodyExternal.signup.status).toBe('intent');

    // 重复报名为幂等更新
    const resUpdate = await app.inject({
      method: 'POST',
      url: `/api/competitions/${internalComp.id}/signup`,
      headers: as('bob'),
      payload: { note: '练习图论算法', contact: 'QQ: 654321' },
    });
    expect(resUpdate.statusCode).toBe(201);
    expect(resUpdate.json().signup.contact).toBe('QQ: 654321');

    // 取消报名
    const resCancel = await app.inject({
      method: 'DELETE',
      url: `/api/competitions/${internalComp.id}/signup`,
      headers: as('bob'),
    });
    expect(resCancel.statusCode).toBe(200);
    expect(resCancel.json().ok).toBe(true);

    // 取消后再取消报 400
    const resCancelAgain = await app.inject({
      method: 'DELETE',
      url: `/api/competitions/${internalComp.id}/signup`,
      headers: as('bob'),
    });
    expect(resCancelAgain.statusCode).toBe(400);
    expect(resCancelAgain.json().error).toBe('not_signed_up');
  });

  it('rejects registration when competition signup is closed', async () => {
    const { app, as } = await setup();
    const closedComp = app.services.competitions.insert(
      'comp-closed-1',
      {
        name: '已截止比赛',
        kind: 'internal',
        start_at: NOW + 2 * HOUR,
        end_at: NOW + 10 * HOUR,
        signup_deadline: NOW - 1000, // 过去的时间
        url: null,
        description: '截止测试',
      },
      NOW,
    )!;

    const res = await app.inject({
      method: 'POST',
      url: `/api/competitions/${closedComp.id}/signup`,
      headers: as('bob'),
      payload: { note: '想报名' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('signup_closed');
  });

  it('supports team creation, mutual confirmation, and capacity limits', async () => {
    const { app, as } = await setup();
    const comp = app.services.competitions.insert(
      'comp-team-1',
      {
        name: '三人组队挑战赛',
        kind: 'external',
        start_at: NOW + 2 * HOUR,
        end_at: NOW + 20 * HOUR,
        signup_deadline: NOW + HOUR,
        url: 'https://example.com/team',
        description: '团队赛',
      },
      NOW,
    )!;

    // 1. Bob 创建队伍（容量上限 2 人）
    const resCreateTeam = await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/teams`,
      headers: as('bob'),
      payload: { name: '极客一队', slogan: '冲冲冲', maxMembers: 2 },
    });
    expect(resCreateTeam.statusCode).toBe(201);
    const team = resCreateTeam.json().team;
    expect(team.name).toBe('极客一队');
    expect(team.leader_login).toBe('bob');
    expect(team.confirmed_count).toBe(1);
    expect(team.members[0].role).toBe('leader');
    expect(team.members[0].status).toBe('confirmed');

    // 2. 同名建队被拒
    const resDup = await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/teams`,
      headers: as('charlie'),
      payload: { name: '极客一队' },
    });
    expect(resDup.statusCode).toBe(400);
    expect(resDup.json().error).toBe('duplicate_team_name');

    // 3. 队长邀请 Charlie
    const resInvite = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/invite`,
      headers: as('bob'),
      payload: { login: 'charlie' },
    });
    expect(resInvite.statusCode).toBe(201);
    const inviteMembershipId = resInvite.json().membership_id;

    // 4. 非被邀请人（如 Dave）尝试响应邀请返回 403
    const resIllegalRespond = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/respond`,
      headers: as('dave'),
      payload: { membership_id: inviteMembershipId, action: 'accept' },
    });
    expect(resIllegalRespond.statusCode).toBe(403);
    expect(resIllegalRespond.json().error).toBe('forbidden');

    // 5. Charlie 接受邀请 -> 双方确认成为 confirmed
    const resAccept = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/respond`,
      headers: as('charlie'),
      payload: { membership_id: inviteMembershipId, action: 'accept' },
    });
    expect(resAccept.statusCode).toBe(200);
    expect(resAccept.json().status).toBe('confirmed');

    // 6. 此时队伍达到 2 人上限，Dave 尝试申请加入被拒
    const resApplyFull = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/apply`,
      headers: as('dave'),
    });
    expect(resApplyFull.statusCode).toBe(400);
    expect(resApplyFull.json().error).toBe('team_full');

    // 7. Charlie 此时已被确认在一队，无法再建新队伍
    const resCharlieCreate = await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/teams`,
      headers: as('charlie'),
      payload: { name: '查理的新队' },
    });
    expect(resCharlieCreate.statusCode).toBe(400);
    expect(resCharlieCreate.json().error).toBe('already_in_team');

    // 8. Charlie 主动退队
    const resLeave = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/leave`,
      headers: as('charlie'),
    });
    expect(resLeave.statusCode).toBe(200);
    expect(resLeave.json().action).toBe('left');

    // 9. 退队后队伍恢复招募状态，Dave 再次申请入队成功
    const resDaveApply = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/apply`,
      headers: as('dave'),
    });
    expect(resDaveApply.statusCode).toBe(201);
    const applyMembershipId = resDaveApply.json().membership_id;

    // 10. 队长 Bob 审批通过 Dave
    const resBobApprove = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/respond`,
      headers: as('bob'),
      payload: { membership_id: applyMembershipId, action: 'accept' },
    });
    expect(resBobApprove.statusCode).toBe(200);
    expect(resBobApprove.json().status).toBe('confirmed');

    // 11. 队长 Bob 解散队伍
    const resDisband = await app.inject({
      method: 'POST',
      url: `/api/teams/${team.id}/leave`,
      headers: as('bob'),
    });
    expect(resDisband.statusCode).toBe(200);
    expect(resDisband.json().action).toBe('disbanded');
  });

  it('provides personal status query for members', async () => {
    const { app, as } = await setup();
    const comp = app.services.competitions.insert(
      'comp-status-1',
      {
        name: '个人状态测试赛',
        kind: 'internal',
        start_at: NOW + 2 * HOUR,
        end_at: NOW + 10 * HOUR,
        signup_deadline: NOW + HOUR,
        url: null,
        description: '状态测试',
      },
      NOW,
    )!;

    // 先查询为空
    const resEmpty = await app.inject({
      method: 'GET',
      url: `/api/competitions/${comp.id}/my-status`,
      headers: as('bob'),
    });
    expect(resEmpty.statusCode).toBe(200);
    expect(resEmpty.json().status.signup).toBeNull();
    expect(resEmpty.json().status.confirmed_team).toBeNull();

    // 报名后查询有记录
    await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('bob'),
      payload: { note: '参赛目标一等奖' },
    });

    const resAfter = await app.inject({
      method: 'GET',
      url: `/api/competitions/${comp.id}/my-status`,
      headers: as('bob'),
    });
    expect(resAfter.statusCode).toBe(200);
    expect(resAfter.json().status.signup.status).toBe('registered');
    expect(resAfter.json().status.signup.note).toBe('参赛目标一等奖');
  });

  it('provides console roster summary and CSV export with capability and formula injection guard', async () => {
    const { app, as } = await setup();
    const compId = randomUUID();
    const comp = app.services.competitions.insert(
      compId,
      {
        name: '新生算法杯',
        kind: 'internal',
        start_at: NOW + 2 * HOUR,
        end_at: NOW + 10 * HOUR,
        signup_deadline: NOW + HOUR,
        url: null,
        description: '新生赛',
      },
      NOW,
    )!;

    // 报名并带潜在 CSV 注入字符测试（例如 =cmd|' /C calc'!A0）
    await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('bob'),
      payload: { note: '=SUM(1,2)', contact: '13800000000' },
    });

    await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('charlie'),
      payload: { note: '+cmd', contact: '13900000000' },
    });

    // Bob 建队并吸纳 Charlie
    const teamRes = await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/teams`,
      headers: as('bob'),
      payload: { name: '胜利之师', maxMembers: 3 },
    });
    const teamId = teamRes.json().team.id;

    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/teams/${teamId}/invite`,
      headers: as('bob'),
      payload: { login: 'charlie' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/teams/${teamId}/respond`,
      headers: as('charlie'),
      payload: { membership_id: inviteRes.json().membership_id, action: 'accept' },
    });

    // Dave 只报名不入队（成为未成队成员）
    await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('dave'),
      payload: { note: '单人参战' },
    });

    // 1. 无权限舰员（bob）访问控制台 roster 接口被拒 403
    const resBobDenied = await app.inject({
      method: 'GET',
      url: `/api/console/competitions/${comp.id}/roster`,
      headers: as('bob'),
    });
    expect(resBobDenied.statusCode).toBe(403);
    expect(resBobDenied.json().error).toBe('missing_capability');

    // 2. 提督（alice）访问 roster 获得花名册与去重统计
    const resRoster = await app.inject({
      method: 'GET',
      url: `/api/console/competitions/${comp.id}/roster`,
      headers: as('alice'),
    });
    expect(resRoster.statusCode).toBe(200);
    const roster = resRoster.json().roster;
    expect(roster.summary.total_signups).toBe(3); // bob, charlie, dave
    expect(roster.summary.internal_registered).toBe(3);
    expect(roster.summary.teams_count).toBe(1);
    expect(roster.summary.confirmed_participants).toBe(3); // 3 位均已确认
    expect(roster.summary.unassigned_count).toBe(1); // 仅 dave 未成队
    expect(roster.unassigned_logins).toEqual(['dave']);

    // 3. 提督（alice）导出 CSV
    const resCsv = await app.inject({
      method: 'GET',
      url: `/api/console/competitions/${comp.id}/roster.csv`,
      headers: as('alice'),
    });
    expect(resCsv.statusCode).toBe(200);
    expect(resCsv.headers['content-type']).toContain('text/csv');
    expect(resCsv.headers['content-disposition']).toContain('attachment');
    const csvContent = resCsv.body;

    // 必须带有 UTF-8 BOM
    expect(csvContent.startsWith('﻿')).toBe(true);

    // 公式注入符号被正确单引号转义
    expect(csvContent).toContain("'=SUM(1,2)");
    expect(csvContent).toContain("'+cmd");
    expect(csvContent).toContain('bob');
    expect(csvContent).toContain('charlie');
    expect(csvContent).toContain('dave');
    expect(csvContent).toContain('胜利之师');
  });

  it('strictly isolates access: anonymous 401, outsider 403', async () => {
    const { app, as } = await setup();
    const comp = app.services.competitions.insert(
      'comp-auth-1',
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

    // 未登录访问报名 -> 401
    const resAnon = await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      payload: { note: '匿名尝试' },
    });
    expect(resAnon.statusCode).toBe(401);
    expect(resAnon.json().error).toBe('not_signed_in');

    // 非组织成员（outsider）访问报名 -> 403 not_a_member_of_org
    const resOutsider = await app.inject({
      method: 'POST',
      url: `/api/competitions/${comp.id}/signup`,
      headers: as('outsider'),
      payload: { note: '外部人员尝试' },
    });
    expect(resOutsider.statusCode).toBe(403);
    expect(resOutsider.json().error).toBe('not_a_member_of_org');
  });
});
