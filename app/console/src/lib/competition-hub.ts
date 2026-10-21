// 比赛报名与积分（#239）控制台页面的纯逻辑：设置表单、积分表单、名单统计、GitHub 链接。
// 不导入 Vue，tests/console/competition-hub.test.ts 直接测。规则以服务端 competition-contract.ts 为准，
// 这里只做输入前的基本校验（必填、长度、分值范围），错误码与中文 message 仍原样显示服务端的。
import type {
  CompetitionKind, CompetitionRoster, RosterSignup, RosterTeam, ScoreEvent, ScoreKind, SignupSettings,
} from "./types";
import { ApiError } from "./http";

export const PARTICIPATION_TEXT: Record<SignupSettings["participation"], string> = {
  individual: "个人赛", team: "团队赛",
};
export const SCORING_TEXT: Record<SignupSettings["scoring"], string> = {
  none: "不计分", contribution: "开源贡献积分",
};
export const TEAM_STATUS_TEXT: Record<RosterTeam["status"], string> = {
  recruiting: "招募中", locked: "已确认", disbanded: "已解散",
};
export const SIGNUP_STATUS_TEXT: Record<RosterSignup["status"], string> = {
  active: "有效", cancelled: "已取消",
};
export const ROLE_TEXT: Record<"leader" | "member", string> = { leader: "领队", member: "队员" };
export const SCORE_KIND_TEXT: Record<ScoreKind, string> = {
  issue: "合入 Issue", pr: "合入 PR", penalty: "作弊扣分",
};

/** Issue 与 PR 的分值范围；扣分固定 −50（服务端另有表约束兜底）。 */
export const SCORE_POINTS: Record<ScoreKind, { min: number; max: number }> = {
  issue: { min: 5, max: 30 },
  pr: { min: 15, max: 100 },
  penalty: { min: -50, max: -50 },
};

/** 与服务端 `REPO_PATTERN` 一致：`owner/name`，各段只允许字母、数字、下划线、点和连字符。 */
export const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const charLength = (value: string) => [...value].length;
const isInteger = (value: string) => /^-?\d+$/.test(value.trim());

// —— 报名设置 ——

/** 设置表单正在编辑的样子：人数是输入框里的字符串，个人赛时隐藏也仍然带着。 */
export type SettingsForm = {
  enabled: boolean;
  participation: SignupSettings["participation"];
  teamMin: string;
  teamMax: string;
  scoring: SignupSettings["scoring"];
};

export function settingsForm(settings: SignupSettings): SettingsForm {
  return {
    enabled: settings.enabled,
    participation: settings.participation,
    teamMin: String(settings.team_min),
    teamMax: String(settings.team_max),
    scoring: settings.scoring,
  };
}

export type SettingsField = "enabled" | "teamMin" | "teamMax";
export type SettingsErrors = Partial<Record<SettingsField, string>>;

/**
 * 表单校验。逐条报错，空对象表示可以提交。
 * 服务端还会挡「有未取消报名不能改参赛形式」「人数与现有队伍冲突」这类要看数据的冲突，原样显示它的 message。
 */
export function settingsErrors(form: SettingsForm, options: { hasDeadline: boolean }): SettingsErrors {
  const errors: SettingsErrors = {};
  if (form.enabled && !options.hasDeadline) errors.enabled = "开放报名前要先设置报名截止时间。";
  if (form.participation !== "team") return errors;
  const min = form.teamMin.trim();
  const max = form.teamMax.trim();
  const minOk = isInteger(min) && Number(min) >= 1 && Number(min) <= 20;
  const maxOk = isInteger(max) && Number(max) >= 1 && Number(max) <= 20;
  if (!minOk) errors.teamMin = "最低人数要填 1–20 的整数。";
  if (!maxOk) errors.teamMax = "最高人数要填 1–20 的整数。";
  if (minOk && maxOk && Number(min) > Number(max)) errors.teamMax = "最高人数不能小于最低人数。";
  return errors;
}

/** 表单 → 请求体。个人赛不带人数，服务端会清掉这两项；契约要求始终传整数，所以填 1 / 1。 */
export function settingsPayload(form: SettingsForm): SignupSettings {
  const team = form.participation === "team";
  return {
    enabled: form.enabled,
    participation: form.participation,
    team_min: team ? Number(form.teamMin.trim()) : 1,
    team_max: team ? Number(form.teamMax.trim()) : 1,
    scoring: form.scoring,
  };
}

// —— 名单统计 ——

export type StatCard = { key: keyof CompetitionRoster["stats"]; label: string; value: number; hint: string };

/**
 * 统计卡。口径同服务端 `statsOf`：报名人数只算未取消的；个人赛没有队伍与「未成队」；
 * 外部比赛的报名叫「意向」，不等于在比赛官网报名。
 */
export function rosterStats(roster: Pick<CompetitionRoster, "stats" | "settings">, kind: CompetitionKind): StatCard[] {
  const { stats } = roster;
  const individual = roster.settings.participation === "individual";
  return [
    {
      key: "signups",
      label: kind === "external" ? "意向人数" : "报名人数",
      value: stats.signups,
      hint: kind === "external" ? "未取消的意向" : "未取消的报名",
    },
    { key: "teams", label: "队伍", value: stats.teams, hint: "未解散的队伍" },
    { key: "locked_teams", label: "已确认队伍", value: stats.locked_teams, hint: "领队确认参赛的队伍" },
    {
      key: "confirmed_people",
      label: "已确认人数",
      value: stats.confirmed_people,
      hint: individual ? "个人赛报名即确认" : "已确认队伍的在队人数",
    },
    { key: "unplaced", label: "未成队", value: stats.unplaced, hint: individual ? "个人赛不组队" : "已报名但不在队伍里" },
  ];
}

/** 队伍的领队：按成员角色找，旧数据角色缺失时退回队伍的 leader_account_id。 */
export function teamLeader(team: RosterTeam) {
  return team.members.find(member => member.role === "leader")
    ?? team.members.find(member => member.account_id === team.leader_account_id)
    ?? null;
}

/** CSV 的同源地址。接口每分钟限 5 次。 */
export const rosterCsvPath = (competitionId: string) =>
  `/api/console/competitions/${encodeURIComponent(competitionId)}/roster.csv`;

/** 下载时的文件名；服务端响应头也有 Content-Disposition，这里给 `<a download>` 兜底。 */
export const rosterCsvName = (competitionId: string) => `competition-${competitionId}-roster.csv`;

/** 导出被限流时单独说人话；其他失败交给 ErrorAlert 显示服务端的 message。 */
export function exportRateLimitNotice(error: unknown): string | null {
  return error instanceof ApiError && error.status === 429 ? "导出太频繁，请一分钟后再试" : null;
}

// —— 积分 ——

/** 积分表单正在编辑的样子；编号与分值用字符串收输入框里的原值。 */
export type ScoreForm = {
  accountId: string;
  kind: ScoreKind;
  repo: string;
  number: string;
  points: string;
  reason: string;
};

export function defaultPoints(kind: ScoreKind): number {
  return SCORE_POINTS[kind].min;
}

export function emptyScoreForm(kind: ScoreKind = "issue"): ScoreForm {
  return { accountId: "", kind, repo: "", number: "", points: String(defaultPoints(kind)), reason: "" };
}

export type ScoreField = "accountId" | "repo" | "number" | "points" | "reason";
export type ScoreErrors = Partial<Record<ScoreField, string>>;

/** 分值提示，写在输入框下面。 */
export function scorePointsHint(kind: ScoreKind): string {
  if (kind === "penalty") return "作弊扣分固定 −50，不能改。";
  const { min, max } = SCORE_POINTS[kind];
  return `可填 ${min}–${max}。`;
}

/**
 * 积分表单校验。Issue 与 PR 必填仓库和正整数编号，扣分不带这两项；说明 ≤ 200 字。
 * 重复的 Issue / PR 由服务端判 `duplicate_score_event`，这里不查。
 */
export function scoreErrors(form: ScoreForm): ScoreErrors {
  const errors: ScoreErrors = {};
  if (!form.accountId.trim()) errors.accountId = "请选择选手。";
  if (form.kind !== "penalty") {
    const repo = form.repo.trim();
    if (!repo) errors.repo = "请填写 owner/name 形式的仓库。";
    else if (charLength(repo) > 140) errors.repo = "仓库最多 140 个字。";
    else if (!REPO_PATTERN.test(repo)) errors.repo = "仓库要写成 owner/name，例如 yangtze-geek/portal。";
    const number = form.number.trim();
    if (!number) errors.number = "请填 Issue 或 PR 编号。";
    else if (!isInteger(number) || !/^\d+$/.test(number) || Number(number) < 1 || Number(number) > 1_000_000) {
      errors.number = "编号必须是 1–1000000 的整数。";
    }
  }
  const points = form.points.trim();
  const range = SCORE_POINTS[form.kind];
  if (!points) errors.points = "请填分值。";
  else if (!isInteger(points) || Number(points) < range.min || Number(points) > range.max) errors.points = `分值要填 ${range.min}–${range.max} 的整数。`;
  if (charLength(form.reason.trim()) > 200) errors.reason = "说明最多 200 个字。";
  return errors;
}

export type ScorePayload = {
  account_id: string; kind: ScoreKind; points: number;
  repo?: string; number?: number; reason: string;
};

/** 表单 → 请求体。扣分是一条针对人的记录，不带仓库与编号。 */
export function scorePayload(form: ScoreForm): ScorePayload {
  const reason = form.reason.trim();
  if (form.kind === "penalty") return { account_id: form.accountId, kind: form.kind, points: Number(form.points.trim()), reason };
  return {
    account_id: form.accountId,
    kind: form.kind,
    repo: form.repo.trim(),
    number: Number(form.number.trim()),
    points: Number(form.points.trim()),
    reason,
  };
}

/** Issue → `/issues/<编号>`，PR → `/pull/<编号>`，扣分没有链接。 */
export function scoreTargetUrl(event: Pick<ScoreEvent, "kind" | "repo" | "number">): string | null {
  if (!event.repo || event.number === null) return null;
  if (event.kind === "issue") return `https://github.com/${event.repo}/issues/${event.number}`;
  if (event.kind === "pr") return `https://github.com/${event.repo}/pull/${event.number}`;
  return null;
}

/** 仓库#编号的显示文案（扣分没有）。 */
export function scoreTargetText(event: Pick<ScoreEvent, "kind" | "repo" | "number">): string {
  if (!event.repo || event.number === null) return "—";
  return `${event.repo}#${event.number}`;
}

// —— 选手候选 ——

/** 未取消的报名才可能被登记积分（服务端 `activeSignups` 同口径）。 */
export function activeSignups(signups: RosterSignup[]): RosterSignup[] {
  return signups.filter(row => row.status === "active");
}

/** 按登录名搜索候选，不区分大小写；空关键词给全部。 */
export function matchSignups(signups: RosterSignup[], query: string): RosterSignup[] {
  const needle = query.trim().toLowerCase();
  return activeSignups(signups).filter(row => !needle || row.login.toLowerCase().includes(needle));
}
