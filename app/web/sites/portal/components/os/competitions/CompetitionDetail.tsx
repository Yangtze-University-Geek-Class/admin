// 比赛详情（#265 起；#239 加 Hero、时间线、报名组队与天梯）。
// 顶部 Hero：按比赛生成的动态大图、类型与状态、倒计时、一键直达（外部赛直达官网，内部赛直达报名、组队）；下面是要点格子。
// 内部赛开了在线报名时分页签：概览（介绍、赛程时间线、规则）/ 队伍（组队大厅）/ 找队友 / 天梯，没开时只有概览。
// 底部操作条：报名 → 组队 → 确认参赛的进度、现在怎么样的一句话、能做的事；按钮放不放以服务端 my-status 的 actions 为准。
// 主按钮桌面在 Hero 里，手机在底部操作条里（拇指够得着），不在同一屏重复。
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import Icon from "../../Icon";
import type { IconName } from "../../../lib/icons";
import type { Competition, SignupSettings } from "../../../lib/competitions";
import { signInHref } from "../../../lib/account";
import {
  competitionAction, deadlineFact, deadlineLabel, participationText, scheduleFact, scheduleSteps, signupFact, siteHost, statusHint,
  STATUS_TEXT, timelineProgress, type Fact, type StepState,
} from "../../../lib/competitionLabels";
import {
  hubPaths, hubSentence, journey, readFreeAgents, readLeaderboard, readTeams, SCORE_RULES, useHub, useMemberRead,
  type AccountState, type HubAction, type HubPhase, type HubStats,
} from "../../../lib/competitionHub";
import CompetitionHero from "./CompetitionHero";
import BoardPanel from "./Leaderboard";
import { invitedIds, lockDialog, PeoplePanel, TeamPanel, type Act } from "./TeamHub";
import { ApplyDialog, ConfirmDialog, CreateTeamDialog, InviteDialog, SignupDialog, TransferDialog, type Dialog } from "./HubDialog";

const STEP_NOTE: Record<StepState, string | null> = { done: "已过", now: "进行中", next: "接下来", later: null };
const JOURNEY_SR = { done: "（已完成）", now: "（当前这一步）", todo: "", missed: "（没有完成）" } as const;

type TabKey = "overview" | "teams" | "people" | "board";
type Tab = { key: TabKey; label: string; count?: number };
/** 主按钮：要么是链接（官网、登录），要么在窗口里做一件事。 */
type Main = { label: string; icon: IconName; href?: string; external?: boolean; run?: () => void };

type Props = {
  item: Competition;
  now: number;
  /** 手机进详情时把焦点给标题，读屏先念比赛名。 */
  headingRef?: Ref<HTMLHeadingElement>;
  account?: AccountState;
  /** 登录者的极客班账号：在队伍、天梯里认出「我」。 */
  accountId?: string | null;
  phone?: boolean;
  /** 报名、组队变了：让「我的参赛」与角标重读。 */
  onChanged?: () => void;
};

function FactCell({ term, fact }: { term: string; fact: Fact }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>
        <b>{fact.main}</b>
        <span>{fact.sub}</span>
      </dd>
    </div>
  );
}

function statsFact(stats: HubStats, settings: SignupSettings): Fact {
  if (settings.participation === "individual") return { main: `${stats.signups} 人`, sub: "已报名" };
  return { main: `${stats.signups} 人 · ${stats.teams} 支队伍`, sub: `${stats.locked_teams} 支已确认参赛` };
}

/** 赛程时间线：桌面横排、手机竖排；进度条按时间推到「现在」。 */
function Timeline({ item, now }: { item: Competition; now: number }) {
  const steps = scheduleSteps(item, now);
  return (
    <ol className="pt-cx-line" style={{ ["--n" as string]: String(steps.length), ["--done" as string]: String(timelineProgress(steps, now)) }}>
      {steps.map((step) => (
        <li key={step.key} className={`is-${step.state}`}>
          <i aria-hidden="true">{step.state === "done" && <Icon name="check-line" size={13} />}</i>
          <b>{step.label}</b>
          <span>{step.when}</span>
          {STEP_NOTE[step.state] && <em>{STEP_NOTE[step.state]}</em>}
        </li>
      ))}
    </ol>
  );
}

function Overview({ item, now, id, hubOn, settings }: { item: Competition; now: number; id: string; hubOn: boolean; settings: SignupSettings }) {
  const team = settings.participation === "team";
  return (
    <>
      <section className="pt-cx-sec" aria-labelledby={`${id}-about`}>
        <h4 id={`${id}-about`}>介绍</h4>
        {item.description.trim() ? <p className="pt-cx-desc">{item.description}</p> : <p className="pt-cx-none">组织者还没有写介绍。</p>}
      </section>
      <section className="pt-cx-sec" aria-labelledby={`${id}-steps`}>
        <h4 id={`${id}-steps`}>赛程</h4>
        <Timeline item={item} now={now} />
      </section>
      {hubOn && (
        <section className="pt-cx-sec" aria-labelledby={`${id}-rules`}>
          <h4 id={`${id}-rules`}>参赛规则</h4>
          <ul className="pt-cx-rules">
            <li>
              <Icon name="user-line" size={16} />
              <span>用极客班账号登录后在线报名；报名截止前可以修改留言，也可以取消报名。</span>
            </li>
            {team && (
              <li>
                <Icon name="team-line" size={16} />
                <span>{participationText(settings)}。报名后创建队伍当领队，或申请加入别人的队伍；领队也能邀请「找队友」里的同学。</span>
              </li>
            )}
            {team && (
              <li>
                <Icon name="flag-line" size={16} />
                <span>队伍满 {settings.team_min} 人后，领队点「确认参赛」锁定名单；报名截止前可以取消确认再调整。</span>
              </li>
            )}
            {team && (
              <li>
                <Icon name="time-line" size={16} />
                <span>报名截止时还没有队伍的同学，这次不参赛。</span>
              </li>
            )}
          </ul>
        </section>
      )}
      {hubOn && settings.scoring === "contribution" && (
        <section className="pt-cx-sec" aria-labelledby={`${id}-score`}>
          <h4 id={`${id}-score`}>计分规则</h4>
          <ul className="pt-cx-score">
            {SCORE_RULES.map((rule) => (
              <li key={rule.kind} className={`is-${rule.kind}`}>
                <b>{rule.points}</b>
                <span>{rule.label}</span>
                <small>{rule.note}</small>
              </li>
            ))}
          </ul>
          <p className="pt-cx-fine">只计比赛期间合入的贡献；积分由组织者核实后登记，天梯每 30 秒刷新。</p>
        </section>
      )}
    </>
  );
}

/** 队伍、找队友、天梯需要成员身份：没登录给「登录」，不是成员如实说。 */
function MemberGate({ phase, reload }: { phase: HubPhase; reload: () => void }) {
  if (phase === "signed_out") {
    return (
      <div className="pt-cx-callout">
        <Icon name="lock-line" size={22} />
        <div>
          <b>登录后查看</b>
          <p>队伍、找队友和天梯只对极客班成员开放。</p>
        </div>
        <div className="pt-cx-callout-act">
          <a className="pt-btn is-sm is-primary" href={signInHref()}>
            登录
          </a>
        </div>
      </div>
    );
  }
  if (phase === "not_member") {
    return (
      <div className="pt-cx-callout is-warn">
        <Icon name="shield-user-line" size={22} />
        <div>
          <b>只对极客班成员开放</b>
          <p>已是成员的话，请用加入组织时的账号登录。</p>
        </div>
      </div>
    );
  }
  if (phase === "failed") {
    return (
      <p className="pt-cx-none">
        没加载出来。
        <button type="button" className="pt-cx-link" onClick={reload}>
          重试
        </button>
      </p>
    );
  }
  return (
    <p className="pt-cx-none" role="status">
      正在读取…
    </p>
  );
}

export default function CompetitionDetail({ item, now, headingRef, account = "signed_out", accountId = null, phone = false, onChanged }: Props) {
  const id = useId();
  const hubOn = item.kind === "internal" && item.signup.enabled;
  const hub = useHub(item.id, hubOn ? account : "signed_out", onChanged);
  const status = hubOn && hub.phase === "ready" ? hub.status : null;
  // my-status 带的设置更新鲜（组织者可能刚改过人数），没有就用公开列表里的
  const settings = status?.settings.enabled ? status.settings : item.signup;
  const teamMode = settings.participation === "team";
  const scored = settings.scoring === "contribution";
  const [tab, setTab] = useState<TabKey>("overview");
  // 换标签时把标签栏带到滚动区顶上：Hero 和要点格子占了大半屏，不滚上来就看不到刚打开的内容。
  // 面板至少一屏高，加载中的短内容也能滚到位；标签栏已经贴在顶上（往下滚过了）就不动。
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [jump, setJump] = useState(0);
  const openTab = useCallback((key: TabKey) => {
    setTab(key);
    setJump((n) => n + 1);
  }, []);
  useLayoutEffect(() => {
    const box = scrollRef.current, bar = tabsRef.current, panel = panelRef.current;
    if (jump === 0 || !box || !bar || !panel) return;
    panel.style.minHeight = `${Math.max(0, box.clientHeight - bar.offsetHeight)}px`;
    const delta = bar.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (delta <= 1 || typeof box.scrollTo !== "function") return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    box.scrollTo({ top: box.scrollTop + delta, behavior: still ? "auto" : "smooth" });
  }, [jump]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const tabs: Tab[] = hubOn
    ? [
        { key: "overview", label: "概览" },
        ...(teamMode ? [{ key: "teams" as const, label: "队伍", count: status?.stats.teams }, { key: "people" as const, label: "找队友" }] : []),
        ...(scored ? [{ key: "board" as const, label: "天梯" }] : []),
      ]
    : [];
  const current: TabKey = tabs.some((entry) => entry.key === tab) ? tab : "overview";

  const member = status !== null;
  const teams = useMemberRead(member && teamMode && current === "teams" ? hubPaths.teams(item.id) : null, readTeams, hub.version);
  const people = useMemberRead(member && teamMode && (current === "people" || dialog?.kind === "invite") ? hubPaths.freeAgents(item.id) : null, readFreeAgents, hub.version);
  const board = useMemberRead(member && scored && current === "board" ? hubPaths.leaderboard(item.id) : null, readLeaderboard, hub.version, 30_000);

  useEffect(() => {
    if (!notice?.ok) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const { run } = hub;
  /** 对话框里提交：失败原因写在框里，成功在操作条上说一声。 */
  const submit: Act = useCallback(
    async (path, method, body, done) => {
      const fail = await run(path, method, body);
      if (fail === null) setNotice({ ok: true, text: done });
      return fail;
    },
    [run],
  );
  /** 行内按钮：成功失败都在操作条上说。 */
  const act: Act = useCallback(
    async (path, method, body, done) => {
      const fail = await run(path, method, body);
      setNotice(fail === null ? { ok: true, text: done } : { ok: false, text: fail });
      return fail;
    },
    [run],
  );

  const can = (action: HubAction) => status?.actions.includes(action) ?? false;
  const action = competitionAction(item, now);
  const due = deadlineLabel(item.signup_deadline ?? item.end_at, now);

  let main: Main | null = null;
  if (!hubOn) {
    if (action.link) main = { label: action.link.label, icon: "external-link-line", href: action.link.href, external: true };
  } else if (hub.phase === "signed_out") {
    if (item.status === "registering") main = { label: "登录后报名", icon: "user-line", href: signInHref() };
  } else if (status) {
    const team = status.team;
    if (can("signup")) main = { label: "立即报名", icon: "checkbox-circle-line", run: () => setDialog({ kind: "signup" }) };
    else if (teamMode && can("create_team")) main = { label: "创建队伍", icon: "add-line", run: () => setDialog({ kind: "create" }) };
    else if (teamMode && team && can("lock")) main = { label: "确认参赛", icon: "flag-line", run: () => setDialog(lockDialog(team)) };
    else if (teamMode && team && can("invite")) main = { label: "邀请队友", icon: "user-add-line", run: () => setDialog({ kind: "invite" }) };
    else if (teamMode && team && current !== "teams") main = { label: "查看我的队伍", icon: "team-line", run: () => openTab("teams") };
    else if (scored && status.state !== "none" && current !== "board") main = { label: "查看积分天梯", icon: "medal-line", run: () => openTab("board") };
  }

  const renderMain = (className: string) => {
    if (!main) return null;
    if (main.href) {
      return (
        <a className={className} href={main.href} {...(main.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {!main.external && <Icon name={main.icon} size={16} />}
          {main.label}
          {main.external && (
            <>
              <Icon name="external-link-line" size={15} />
              <span className="pt-sr">（新标签页打开）</span>
            </>
          )}
        </a>
      );
    }
    return (
      <button type="button" className={className} onClick={main.run} disabled={hub.busy}>
        <Icon name={main.icon} size={16} />
        {main.label}
      </button>
    );
  };

  let sentence = action.text;
  if (hubOn) {
    if (status) sentence = hubSentence(status, settings, due);
    else if (hub.phase === "signed_out") sentence = item.status === "registering" ? `报名截止 ${due}。登录极客班账号后在这里报名${teamMode ? "、组队" : ""}。` : "登录极客班账号后查看队伍与天梯。";
    else if (hub.phase === "not_member") sentence = "在线报名只对极客班成员开放；已是成员的话，请用加入组织时的账号登录。";
    else if (hub.phase === "failed") sentence = "报名信息没加载出来，可能是网络不稳定。";
    else sentence = "正在读取你的报名状态…";
  }

  const secondary = [
    hubOn && hub.phase === "failed" && (
      <button key="retry" type="button" className="pt-btn" onClick={hub.reload}>
        <Icon name="refresh-line" size={15} />
        重试
      </button>
    ),
    status && teamMode && !status.team && status.state === "signed_up" && current !== "teams" && (
      <button key="teams" type="button" className="pt-btn" onClick={() => openTab("teams")}>
        <Icon name="team-line" size={15} />
        浏览队伍
      </button>
    ),
    can("update_signup") && (
      <button key="edit" type="button" className="pt-btn is-quiet" disabled={hub.busy} onClick={() => setDialog({ kind: "signup" })}>
        修改报名
      </button>
    ),
    can("cancel_signup") && (
      <button
        key="cancel"
        type="button"
        className="pt-btn is-quiet"
        disabled={hub.busy}
        onClick={() =>
          setDialog({ kind: "confirm", title: "取消报名？", body: "取消后你的报名留言不再对领队显示；报名截止前还可以重新报名。", submitText: "取消报名", danger: true, path: hubPaths.signup(item.id), method: "DELETE", done: "已取消报名。" })
        }
      >
        取消报名
      </button>
    ),
  ].filter(Boolean);

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((entry) => entry.key === current);
    const moves: Partial<Record<string, number>> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    if (!target) return;
    openTab(target.key);
    event.currentTarget.querySelector<HTMLElement>(`[data-tab="${target.key}"]`)?.focus();
  };

  const close = () => setDialog(null);
  const renderDialog = () => {
    if (!dialog || !status) return null;
    const team = status.team;
    switch (dialog.kind) {
      case "signup": {
        const fresh = status.state === "none";
        return (
          <SignupDialog
            settings={settings}
            initial={fresh ? null : status.signup}
            onClose={close}
            submit={async (body) => {
              const fail = await submit(hubPaths.signup(item.id), "POST", body, fresh ? (teamMode ? "报名成功！下一步：创建队伍，或申请加入一支队伍。" : "报名成功！") : "报名信息已保存。");
              if (fail === null && fresh && teamMode) openTab("teams");
              return fail;
            }}
          />
        );
      }
      case "create":
        return (
          <CreateTeamDialog
            settings={settings}
            onClose={close}
            submit={async (body) => {
              const fail = await submit(hubPaths.teams(item.id), "POST", body, `队伍「${body.name}」已创建，你是领队。`);
              if (fail === null) openTab("teams");
              return fail;
            }}
          />
        );
      case "apply":
        return <ApplyDialog team={dialog.team} max={settings.team_max} onClose={close} submit={(body) => submit(hubPaths.team(dialog.team.id, "apply"), "POST", body, `已申请加入「${dialog.team.name}」，等领队处理。`)} />;
      case "invite":
        return team ? (
          <InviteDialog people={people} invited={invitedIds(status)} onClose={close} invite={(person) => submit(hubPaths.team(team.id, "invite"), "POST", { account_id: person.account_id }, `已邀请 ${person.login}，等对方回复。`)} />
        ) : null;
      case "transfer":
        return team ? <TransferDialog team={team} onClose={close} submit={(member) => submit(hubPaths.team(team.id, "transfer"), "POST", { account_id: member.account_id }, `已把领队转给 ${member.login}。`)} /> : null;
      default:
        return <ConfirmDialog title={dialog.title} body={dialog.body} submitText={dialog.submitText} danger={dialog.danger} onClose={close} submit={() => submit(dialog.path, dialog.method, undefined, dialog.done)} />;
    }
  };

  const hint = statusHint(item, now);
  const tags = (
    <>
      <span className="pt-cx-hero-tag">{item.kind === "internal" ? "内部赛" : "外部赛"}</span>
      <span className={`pt-cx-hero-tag is-status is-${item.status}`}>
        <b>{STATUS_TEXT[item.status]}</b>
        {hint && (
          <>
            <span aria-hidden="true">·</span>
            <span className="pt-sr">，</span>
            <span>{hint}</span>
          </>
        )}
      </span>
      {hubOn && <span className="pt-cx-hero-tag">{participationText(settings)}</span>}
      {item.url && (
        <a className="pt-cx-hero-tag" href={item.url} target="_blank" rel="noopener noreferrer">
          <Icon name="global-line" size={13} />
          {siteHost(item.url)}
          <Icon name="external-link-line" size={12} />
          <span className="pt-sr">（比赛官网，新标签页打开）</span>
        </a>
      )}
    </>
  );
  const stats = status?.stats ?? null;
  const barMain = phone ? renderMain("pt-btn is-primary") : null;

  return (
    <section className="pt-cx-detail" aria-labelledby={`${id}-name`}>
      <div className="pt-cx-scroll" ref={scrollRef}>
        <CompetitionHero item={item} headingId={`${id}-name`} headingRef={headingRef} tags={tags} cta={phone ? null : renderMain("pt-btn is-hero")} />
        <dl className={stats ? "pt-cx-facts is-4" : "pt-cx-facts"}>
          <FactCell term="报名截止" fact={deadlineFact(item, now)} />
          <FactCell term="比赛时间" fact={scheduleFact(item.start_at, item.end_at, now)} />
          <FactCell term="报名方式" fact={signupFact({ kind: item.kind, url: item.url, signup: settings })} />
          {stats && <FactCell term="当前报名" fact={statsFact(stats, settings)} />}
        </dl>
        {tabs.length > 0 && (
          <div className="pt-cx-tabs" ref={tabsRef} role="tablist" aria-label="比赛内容" onKeyDown={onTabKey}>
            {tabs.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="tab"
                className="pt-cx-tab"
                id={`${id}-tab-${entry.key}`}
                data-tab={entry.key}
                aria-selected={current === entry.key}
                aria-controls={`${id}-panel`}
                tabIndex={current === entry.key ? 0 : -1}
                onClick={() => openTab(entry.key)}
              >
                {entry.label}
                {entry.count !== undefined && entry.count > 0 && <span className="pt-cx-count">{entry.count}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="pt-cx-panel" ref={panelRef} {...(tabs.length > 0 ? { role: "tabpanel", id: `${id}-panel`, "aria-labelledby": `${id}-tab-${current}` } : {})}>
          {current === "overview" && <Overview item={item} now={now} id={id} hubOn={hubOn} settings={settings} />}
          {current !== "overview" && !status && <MemberGate phase={hub.phase} reload={hub.reload} />}
          {current === "teams" && status && <TeamPanel status={status} teams={teams} meId={accountId} busy={hub.busy} open={setDialog} act={act} onFindPeople={() => openTab("people")} />}
          {current === "people" && status && <PeoplePanel status={status} people={people} meId={accountId} busy={hub.busy} act={act} competitionId={item.id} />}
          {current === "board" && status && <BoardPanel board={board} meId={accountId} myTeamId={status.team?.id ?? null} teamMode={teamMode} />}
        </div>
      </div>
      <footer className="pt-cx-act">
        <p className="pt-sr" aria-live="polite">
          {notice?.text ?? ""}
        </p>
        {notice && (
          <p className={notice.ok ? "pt-cx-notice" : "pt-cx-notice is-error"} aria-hidden="true">
            <Icon name={notice.ok ? "checkbox-circle-line" : "error-warning-line"} size={16} />
            {notice.text}
          </p>
        )}
        <div className="pt-cx-act-main">
          {status && (
            <ol className="pt-cx-journey" aria-label="参赛进度">
              {journey(status.state, settings.participation).map((step) => (
                <li key={step.label} className={`is-${step.state}`}>
                  {step.state === "done" && <Icon name="check-line" size={13} />}
                  {step.label}
                  <span className="pt-sr">{JOURNEY_SR[step.state]}</span>
                </li>
              ))}
            </ol>
          )}
          <p>{sentence}</p>
        </div>
        {(barMain || secondary.length > 0) && (
          <div className="pt-cx-act-btns">
            {barMain}
            {secondary}
          </div>
        )}
      </footer>
      {renderDialog()}
    </section>
  );
}
