// 比赛报名、组队、积分天梯（#239）的数据：成员接口的读写、两个读数据的 hook，以及算界面文案的纯函数。
//
// 都是同源请求、带 sid cookie：/api/competitions/:id/*（我的状态、报名、队伍、找队友、天梯）、/api/teams/:id/*
// （申请、邀请、处理、退出、转让、锁队、解散）、/api/me/competitions（「我的参赛」与角标）。
// 服务端按会话里的 account_id 认人，能不能做由服务端判断：按钮放不放看 my-status 的 `actions`，
// 做完一件事就用响应里的新 MyStatus 换掉旧的，不在前端自己推算名单。
// 没登录（401）给「登录」，不是极客班成员（403）如实说，其余读失败给「重试」。天梯每 30 秒重读（页面在后台时不读）。
// 界面在 components/os/competitions/，单测在 tests/web/portal-competition-hub.test.tsx。
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@shared/lib/api";
import { readSignup, type Competition, type SignupSettings } from "./competitions";

export type Person = { account_id: string; login: string; avatar_url: string | null };
export type Member = Person & { role: "leader" | "member"; joined_at: number };
export type TeamStatus = "recruiting" | "locked";
export type Team = {
  id: string; name: string; slogan: string; status: TeamStatus; leader_account_id: string;
  members: Member[]; member_count: number; created_at: number;
};
export type Pending = {
  membership_id: string; kind: "application" | "invitation"; team_id: string; team_name: string;
  person: Person; message: string; created_at: number;
};
export type HubStats = { signups: number; teams: number; locked_teams: number; confirmed_people: number; unplaced: number };
export type HubState = "none" | "signed_up" | "in_team" | "confirmed" | "unplaced";
export type HubAction = "signup" | "update_signup" | "cancel_signup" | "create_team" | "apply" | "invite" | "lock" | "unlock" | "transfer" | "disband" | "leave";
export type MySignup = { status: "active" | "cancelled"; note: string; looking_for_team: boolean; created_at: number; updated_at: number };
export type MyStatus = {
  competition_id: string; settings: SignupSettings; writable: boolean; signup: MySignup | null; state: HubState;
  team: Team | null; role: "leader" | "member" | null; pending: Pending[]; stats: HubStats; actions: HubAction[];
};
export type FreeAgent = Person & { note: string; since: number };
export type MyEntry = {
  competition_id: string; state: HubState; pending_count: number;
  team: { id: string; name: string; status: TeamStatus; member_count: number; team_max: number } | null;
};
export type MyCompetitions = { items: MyEntry[]; pending_total: number };
export type BoardPerson = { rank: number; person: Person; team: { id: string; name: string } | null; points: number; issues: number; prs: number; penalties: number };
export type BoardTeam = { rank: number; team: { id: string; name: string; status: TeamStatus }; points: number; member_count: number };
export type Leaderboard = { updated_at: number; individuals: BoardPerson[]; teams: BoardTeam[] };

/** 登录状态：`/auth/me` 还没回来是 loading。 */
export type AccountState = "loading" | "signed_out" | "signed_in";
/** 一份成员数据读到哪了：没登录、不是成员、读失败分开说。 */
export type HubPhase = "loading" | "ready" | "signed_out" | "not_member" | "failed";

// ---- 读响应：只认要用的字段，缺 id 的条目丢掉，不显示半条 ----

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : null);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const key = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "");
const int = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0);
function list<T>(value: unknown, read: (item: unknown) => T | null): T[] {
  return Array.isArray(value) ? value.map(read).filter((item): item is T => item !== null) : [];
}
const teamStatus = (value: unknown): TeamStatus => (value === "locked" ? "locked" : "recruiting");

/** 头像只用 https 地址（GitHub 头像等），别的当没有，显示首字母。 */
function avatar(value: unknown): string | null {
  const url = str(value);
  return /^https:\/\/\S+$/.test(url) ? url : null;
}

export function readPerson(value: unknown): Person | null {
  const raw = obj(value);
  const account_id = key(raw?.account_id);
  const login = str(raw?.login);
  return raw && account_id && login ? { account_id, login, avatar_url: avatar(raw.avatar_url) } : null;
}

function readMember(value: unknown): Member | null {
  const person = readPerson(value);
  const raw = obj(value);
  return person && raw ? { ...person, role: raw.role === "leader" ? "leader" : "member", joined_at: int(raw.joined_at) } : null;
}

export function readTeam(value: unknown): Team | null {
  const raw = obj(value);
  const id = key(raw?.id);
  const name = str(raw?.name);
  if (!raw || !id || !name) return null;
  const members = list(raw.members, readMember);
  // 领队排第一个，其余按加入先后：槽位从左到右就是入队顺序
  members.sort((a, b) => (a.role === b.role ? a.joined_at - b.joined_at : a.role === "leader" ? -1 : 1));
  return {
    id, name, slogan: str(raw.slogan), status: teamStatus(raw.status), leader_account_id: key(raw.leader_account_id),
    members, member_count: Math.max(int(raw.member_count), members.length), created_at: int(raw.created_at),
  };
}

function readPending(value: unknown): Pending | null {
  const raw = obj(value);
  const person = readPerson(raw?.person);
  const membership_id = key(raw?.membership_id);
  if (!raw || !person || !membership_id) return null;
  return {
    membership_id, kind: raw.kind === "invitation" ? "invitation" : "application", team_id: key(raw.team_id),
    team_name: str(raw.team_name), person, message: str(raw.message), created_at: int(raw.created_at),
  };
}

const STATES: readonly HubState[] = ["none", "signed_up", "in_team", "confirmed", "unplaced"];
const ACTIONS: readonly HubAction[] = ["signup", "update_signup", "cancel_signup", "create_team", "apply", "invite", "lock", "unlock", "transfer", "disband", "leave"];

export function readMyStatus(value: unknown): MyStatus | null {
  const raw = obj(value);
  if (!raw || !STATES.includes(raw.state as HubState)) return null;
  const signup = obj(raw.signup);
  const stats = obj(raw.stats);
  return {
    competition_id: key(raw.competition_id),
    settings: readSignup(raw.settings),
    writable: raw.writable === true,
    signup: signup
      ? { status: signup.status === "cancelled" ? "cancelled" : "active", note: str(signup.note), looking_for_team: signup.looking_for_team === true, created_at: int(signup.created_at), updated_at: int(signup.updated_at) }
      : null,
    state: raw.state as HubState,
    team: readTeam(raw.team),
    role: raw.role === "leader" ? "leader" : raw.role === "member" ? "member" : null,
    pending: list(raw.pending, readPending),
    stats: { signups: int(stats?.signups), teams: int(stats?.teams), locked_teams: int(stats?.locked_teams), confirmed_people: int(stats?.confirmed_people), unplaced: int(stats?.unplaced) },
    actions: Array.isArray(raw.actions) ? raw.actions.filter((action): action is HubAction => ACTIONS.includes(action as HubAction)) : [],
  };
}

export function readTeams(body: unknown): Team[] | null {
  const raw = obj(body);
  return raw && Array.isArray(raw.teams) ? list(raw.teams, readTeam) : null;
}

export function readFreeAgents(body: unknown): FreeAgent[] | null {
  const raw = obj(body);
  if (!raw || !Array.isArray(raw.people)) return null;
  return list(raw.people, (item) => {
    const person = readPerson(item);
    const row = obj(item);
    return person && row ? { ...person, note: str(row.note), since: int(row.since) } : null;
  });
}

export function readMine(body: unknown): MyCompetitions | null {
  const raw = obj(body);
  if (!raw || !Array.isArray(raw.items)) return null;
  const items = list(raw.items, (item): MyEntry | null => {
    const row = obj(item);
    const competition_id = key(row?.competition_id);
    if (!row || !competition_id || !STATES.includes(row.state as HubState)) return null;
    const team = obj(row.team);
    return {
      competition_id, state: row.state as HubState, pending_count: int(row.pending_count),
      team: team && key(team.id) ? { id: key(team.id), name: str(team.name), status: teamStatus(team.status), member_count: int(team.member_count), team_max: int(team.team_max) } : null,
    };
  });
  return { items, pending_total: int(raw.pending_total) };
}

export function readLeaderboard(body: unknown): Leaderboard | null {
  const raw = obj(body);
  if (!raw || !Array.isArray(raw.individuals)) return null;
  const individuals = list(raw.individuals, (item): BoardPerson | null => {
    const row = obj(item);
    const person = readPerson(row?.person);
    if (!row || !person) return null;
    const team = obj(row.team);
    return {
      rank: int(row.rank), person, team: team && key(team.id) ? { id: key(team.id), name: str(team.name) } : null,
      points: int(row.points), issues: int(row.issues), prs: int(row.prs), penalties: int(row.penalties),
    };
  });
  const teams = list(raw.teams, (item): BoardTeam | null => {
    const row = obj(item);
    const team = obj(row?.team);
    if (!row || !team || !key(team.id)) return null;
    return { rank: int(row.rank), team: { id: key(team.id), name: str(team.name), status: teamStatus(team.status) }, points: int(row.points), member_count: int(row.member_count) };
  });
  return { updated_at: int(raw.updated_at), individuals, teams };
}

// ---- 请求 ----

const seg = encodeURIComponent;
export const hubPaths = {
  status: (competition: string) => `/api/competitions/${seg(competition)}/my-status`,
  signup: (competition: string) => `/api/competitions/${seg(competition)}/signup`,
  teams: (competition: string) => `/api/competitions/${seg(competition)}/teams`,
  freeAgents: (competition: string) => `/api/competitions/${seg(competition)}/free-agents`,
  leaderboard: (competition: string) => `/api/competitions/${seg(competition)}/leaderboard`,
  team: (team: string, what?: "apply" | "invite" | "respond" | "leave" | "transfer" | "lock") => `/api/teams/${seg(team)}${what ? `/${what}` : ""}`,
  mine: "/api/me/competitions",
};

const ACCEPT = { Accept: "application/json" };

/** 401 当没登录（会话过期、旧会话没有极客班账号），403 当不是成员，其余当读失败。 */
export function phaseOf(error: unknown): HubPhase {
  if (error instanceof ApiError && error.status === 401) return "signed_out";
  if (error instanceof ApiError && error.status === 403 && error.code !== "invalid_origin") return "not_member";
  return "failed";
}

/** 提交失败时给人看的一句：服务端带了中文说明就用它，限流、过期、断网各说各的。 */
export function failText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "操作太频繁了，请过一分钟再试。";
    if (error.status === 401) return "登录已过期，请重新登录后再试。";
    if (error.status >= 400 && error.status < 500 && /[\u4e00-\u9fff]/.test(error.message)) return error.message;
  }
  return "没有提交成功：网络不稳定或服务暂时不可用，请稍后再试。";
}

export type MemberRead<T> = { data: T | null; phase: HubPhase; reload: () => void };

/**
 * 读一份成员数据：`url` 为 null 时不读；`version` 变了（刚做完一件事）或到了轮询时间就重读。
 * 重读时保留上一份，不闪空；重读失败也留着上一份，由界面说「没刷新上」。
 */
export function useMemberRead<T>(url: string | null, read: (body: unknown) => T | null, version = 0, pollMs = 0): MemberRead<T> {
  const [data, setData] = useState<T | null>(null);
  const [phase, setPhase] = useState<HubPhase>("loading");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (url === null) return;
    const controller = new AbortController();
    api<unknown>(url, { signal: controller.signal, headers: ACCEPT })
      .then((body) => {
        if (controller.signal.aborted) return;
        const next = read(body);
        if (next === null) throw new Error("Invalid response");
        setData(next);
        setPhase("ready");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setPhase(phaseOf(error));
      });
    return () => controller.abort();
  }, [url, read, version, tick]);

  useEffect(() => {
    if (url === null || pollMs <= 0) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setTick((n) => n + 1);
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [url, pollMs]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data: url === null ? null : data, phase, reload };
}

export type Hub = {
  status: MyStatus | null;
  phase: HubPhase;
  /** 有写请求在路上：按钮先不让再点。 */
  busy: boolean;
  /** 每做完（或做失败）一件事加一：队伍、找队友、天梯跟着重读。 */
  version: number;
  /** 发一个写请求；成功返回 null 并换上响应里的新状态，失败返回给人看的原因。 */
  run: (path: string, method: "POST" | "DELETE", body?: Record<string, unknown>) => Promise<string | null>;
  reload: () => void;
};

/** 我在这场比赛里的状态（my-status）与写操作。`account` 不是 signed_in 时不发请求。 */
export function useHub(competitionId: string, account: AccountState, onChanged?: () => void): Hub {
  const [status, setStatus] = useState<MyStatus | null>(null);
  const [phase, setPhase] = useState<HubPhase>("loading");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (account !== "signed_in") {
      setStatus(null);
      setPhase(account === "signed_out" ? "signed_out" : "loading");
      return;
    }
    const controller = new AbortController();
    api<unknown>(hubPaths.status(competitionId), { signal: controller.signal, headers: ACCEPT })
      .then((body) => {
        if (controller.signal.aborted) return;
        const next = readMyStatus(body);
        if (!next) throw new Error("Invalid my-status response");
        setStatus(next);
        setPhase("ready");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setPhase(phaseOf(error));
      });
    return () => controller.abort();
  }, [competitionId, account, attempt]);

  const run = useCallback(async (path: string, method: "POST" | "DELETE", body?: Record<string, unknown>): Promise<string | null> => {
    setBusy(true);
    try {
      const init: RequestInit = method === "POST" ? { method, headers: ACCEPT, body: JSON.stringify(body ?? {}) } : { method, headers: ACCEPT };
      const next = readMyStatus(await api<unknown>(path, init));
      if (next) setStatus(next);
      else setAttempt((n) => n + 1);
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setPhase("signed_out");
      // 被拒多半是名单刚变了（队伍满了、刚被锁、报名截止）：重读一次，界面跟上
      else setAttempt((n) => n + 1);
      return failText(error);
    } finally {
      setBusy(false);
      setVersion((n) => n + 1);
      onChanged?.();
    }
  }, [onChanged]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { status, phase, busy, version, run, reload };
}

// ---- 文案与派生：纯函数，单测直接测 ----

/** 输入字数上限，与服务端请求契约一致（competition-contract.ts）：队名 2–30 字、口号 60、报名留言 200、申请留言 100。 */
export const HUB_LIMITS = { teamName: 30, teamNameMin: 2, slogan: 60, note: 200, message: 100 } as const;

/** 计分规则（与服务端登记积分时的取值范围一致）：合入 Issue +5～+30，合入 PR +15～+100，作弊 −50。 */
export const SCORE_RULES = [
  { kind: "issue", label: "合入 Issue", points: "+5～+30", note: "按问题的价值与描述质量" },
  { kind: "pr", label: "合入 PR", points: "+15～+100", note: "按改动的难度与影响" },
  { kind: "penalty", label: "作弊", points: "−50", note: "刷量、抄袭、冒名提交等，每次核实扣分" },
] as const;

/** 倒计时要数到的下一个节点：报名截止、开赛、比赛结束里最早还没到的那个；同一刻的合成一句（「报名截止 · 比赛结束」）。 */
export function nextMilestone(item: Pick<Competition, "start_at" | "end_at" | "signup_deadline">, now: number): { label: string; at: number } | null {
  const points: { label: string; at: number }[] = [];
  if (item.signup_deadline !== null && now <= item.signup_deadline) points.push({ label: "报名截止", at: item.signup_deadline });
  if (now < item.start_at) points.push({ label: "开赛", at: item.start_at });
  if (now <= item.end_at) points.push({ label: "比赛结束", at: item.end_at });
  points.sort((a, b) => a.at - b.at);
  const first = points[0];
  if (!first) return null;
  return { label: points.filter((point) => point.at === first.at).map((point) => point.label).join(" · "), at: first.at };
}

/** 倒计时拆成天、时、分、秒；已经过了算 0。 */
export function countdown(at: number, now: number): { days: number; hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor((at - now) / 1000));
  return { days: Math.floor(total / 86400), hours: Math.floor((total % 86400) / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
}

/** 读屏念的倒计时：只念到分钟，免得每秒都在变。 */
export function countdownText(at: number, now: number): string {
  const { days, hours, minutes } = countdown(at, now);
  return days > 0 ? `还有 ${days} 天 ${hours} 小时` : hours > 0 ? `还有 ${hours} 小时 ${minutes} 分` : `还有 ${minutes} 分钟`;
}

/** 队伍槽位：领队在前，其余按入队顺序，空位补到人数上限。 */
export function teamSlots(team: Pick<Team, "members">, max: number): (Member | null)[] {
  const slots: (Member | null)[] = [...team.members];
  while (slots.length < max) slots.push(null);
  return slots;
}

export type PendingView = { incoming: boolean; title: string; detail: string; actions: ("accept" | "decline" | "withdraw")[] };

/**
 * 一条待处理怎么摆：是不是在等我处理、写什么、能点什么。
 * 申请里的人是申请者，邀请里的人是被邀请者；关于我这支队伍的只有领队能处理。
 */
export function pendingView(item: Pending, status: Pick<MyStatus, "team" | "role">): PendingView {
  const ours = status.team !== null && item.team_id === status.team.id;
  const leader = ours && status.role === "leader";
  const said = item.message.trim();
  if (item.kind === "application") {
    return ours
      ? { incoming: leader, title: `${item.person.login} 申请加入`, detail: said ? `“${said}”` : "没有留言", actions: leader ? ["decline", "accept"] : [] }
      : { incoming: false, title: `已申请加入「${item.team_name}」`, detail: "等领队处理", actions: ["withdraw"] };
  }
  return ours
    ? { incoming: false, title: `已邀请 ${item.person.login}`, detail: "等对方回复", actions: leader ? ["withdraw"] : [] }
    : { incoming: true, title: `「${item.team_name}」邀请你加入`, detail: said ? `“${said}”` : "领队发来了邀请", actions: ["decline", "accept"] };
}

export type JourneyStep = { label: string; state: "done" | "now" | "todo" | "missed" };

/** 底部进度：团队赛 报名 → 组队 → 确认参赛；个人赛 报名 → 参赛。 */
export function journey(state: HubState, participation: SignupSettings["participation"]): JourneyStep[] {
  if (participation === "individual") {
    const signed = state !== "none";
    return [{ label: "报名", state: signed ? "done" : "now" }, { label: "参赛", state: signed ? "now" : "todo" }];
  }
  const at: Record<HubState, JourneyStep["state"][]> = {
    none: ["now", "todo", "todo"],
    signed_up: ["done", "now", "todo"],
    unplaced: ["done", "missed", "todo"],
    in_team: ["done", "done", "now"],
    confirmed: ["done", "done", "done"],
  };
  return ["报名", "组队", "确认参赛"].map((label, index) => ({ label, state: at[state][index] }));
}

/** 底部操作条那一句：现在是什么情况、下一步做什么。`due` 是报名截止的写法（`11-15（周日）23:59`）。 */
export function hubSentence(status: Pick<MyStatus, "state" | "writable" | "team" | "role">, settings: SignupSettings, due: string): string {
  const team = status.team;
  const scored = settings.scoring === "contribution";
  switch (status.state) {
    case "none":
      if (!status.writable) return "报名已截止，这场比赛你没有报名。";
      return settings.participation === "team"
        ? `报名截止 ${due}。报名后可以创建队伍，或申请加入别人的队伍。`
        : `报名截止 ${due}。报名即参赛${scored ? "，比赛期间合入的 Issue 与 PR 计入积分天梯" : ""}。`;
    case "signed_up":
      if (settings.participation === "individual") return scored ? "你已报名。比赛期间合入的 Issue 与 PR，由组织者核实后计入天梯。" : "你已报名，等组织者的通知。";
      return status.writable ? "你已报名，还没有队伍：创建一支，或申请加入别人的队伍。" : "报名已截止，你还没有队伍。";
    case "in_team": {
      if (!team) return "你已经在一支队伍里。";
      const short = settings.team_min - team.member_count;
      if (status.role !== "leader") return `你在「${team.name}」，等领队确认参赛。`;
      if (short > 0) return `「${team.name}」现在 ${team.member_count} 人，还差 ${short} 人才能确认参赛。`;
      return `「${team.name}」${team.member_count}/${settings.team_max} 人。人齐了就点「确认参赛」锁定名单。`;
    }
    case "confirmed":
      return team ? `「${team.name}」已确认参赛，名单已锁定。` : "你已确认参赛。";
    default:
      return "报名截止时你还没有队伍，这次没能参赛。";
  }
}

/** 「我的参赛」卡片上那一行：报名到哪一步、哪支队伍。 */
export function entryText(entry: MyEntry, participation: SignupSettings["participation"]): string {
  const team = entry.team;
  switch (entry.state) {
    case "signed_up":
      return participation === "team" ? "已报名 · 还没有队伍" : "已报名";
    case "in_team":
      return team ? `「${team.name}」${team.member_count}/${team.team_max} 人 · 招募中` : "已在队伍里";
    case "confirmed":
      return team ? `「${team.name}」已确认参赛` : "已确认参赛";
    case "unplaced":
      return "报名截止时没有队伍";
    default:
      return "有待处理的邀请";
  }
}
