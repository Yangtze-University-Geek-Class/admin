// 组队大厅（#239）。「队伍」页签：我的队伍（槽位头像框，领队点空位就能邀请）、待处理的申请与邀请、其他队伍；
// 「找队友」页签：正在找队伍的同学，领队可以直接邀请。哪些按钮出现以 my-status 的 actions 为准，服务端再校验一次。
import { useId } from "react";
import { fmtRelative } from "@shared/lib/api";
import Icon from "../../Icon";
import Avatar, { TeamBadge } from "./Avatar";
import type { Dialog } from "./HubDialog";
import { hubPaths, pendingView, teamSlots, type FreeAgent, type HubAction, type HubPhase, type MemberRead, type MyStatus, type Pending, type Team } from "../../../lib/competitionHub";

/** 行内按钮做事：成功或失败都在底部操作条上说一声；返回失败原因或 null。 */
export type Act = (path: string, method: "POST" | "DELETE", body: Record<string, unknown> | undefined, done: string) => Promise<string | null>;

const can = (status: MyStatus, action: HubAction) => status.actions.includes(action);

const RESPOND_TEXT = {
  accept: { application: "同意", invitation: "接受" },
  decline: { application: "拒绝", invitation: "婉拒" },
  withdraw: { application: "撤回申请", invitation: "撤回邀请" },
} as const;
const RESPOND_DONE = {
  accept: { application: "已同意，对方加入了队伍。", invitation: "已加入队伍。" },
  decline: { application: "已拒绝这条申请。", invitation: "已婉拒邀请。" },
  withdraw: { application: "已撤回申请。", invitation: "已撤回邀请。" },
} as const;

/** 确认参赛（锁队）前的二次确认：队伍卡片和详情主按钮共用。 */
export function lockDialog(team: Team): Dialog {
  return {
    kind: "confirm",
    title: "确认参赛并锁定名单？",
    body: `「${team.name}」${team.member_count} 人参赛。锁定后不能再加人或退出；报名截止前，领队可以取消确认再调整。`,
    submitText: "确认参赛",
    path: hubPaths.team(team.id, "lock"),
    method: "POST",
    done: "已确认参赛，名单已锁定。",
  };
}

/** 我的队伍已经邀请过的人（还没回复）。 */
export function invitedIds(status: MyStatus): Set<string> {
  return new Set(status.pending.filter((item) => item.kind === "invitation" && item.team_id === status.team?.id).map((item) => item.person.account_id));
}

function ListState({ phase, what, reload }: { phase: HubPhase; what: string; reload: () => void }) {
  if (phase === "loading") {
    return (
      <p className="pt-cx-none" role="status">
        正在读取{what}…
      </p>
    );
  }
  return (
    <p className="pt-cx-none">
      {what}没加载出来。
      <button type="button" className="pt-cx-link" onClick={reload}>
        重试
      </button>
    </p>
  );
}

type TeamProps = { status: MyStatus; teams: MemberRead<Team[]>; meId: string | null; busy: boolean; open: (dialog: Dialog) => void; act: Act; onFindPeople: () => void };

export function TeamPanel({ status, teams, meId, busy, open, act, onFindPeople }: TeamProps) {
  const id = useId();
  const mine = status.team;
  const max = status.settings.team_max;
  const others = (teams.data ?? []).filter((team) => team.id !== mine?.id);
  const applied = new Set(status.pending.filter((item) => item.kind === "application" && item.team_id !== mine?.id).map((item) => item.team_id));
  return (
    <>
      {mine ? <MyTeam team={mine} status={status} meId={meId} busy={busy} open={open} act={act} /> : <NoTeam status={status} open={open} onFindPeople={onFindPeople} />}
      {status.pending.length > 0 && <PendingList status={status} busy={busy} act={act} />}
      <section className="pt-cx-sec" aria-labelledby={`${id}-others`}>
        <h4 id={`${id}-others`}>
          {mine ? "其他队伍" : "所有队伍"}
          {teams.data && <span className="pt-cx-count">{others.length}</span>}
        </h4>
        {!teams.data ? (
          <ListState phase={teams.phase} what="队伍" reload={teams.reload} />
        ) : others.length === 0 ? (
          <p className="pt-cx-none">{mine ? "还没有其他队伍。" : "还没有人创建队伍，来当第一个领队吧。"}</p>
        ) : (
          <ul className="pt-cx-teams">
            {others.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                max={max}
                applied={applied.has(team.id)}
                canApply={!mine && can(status, "apply") && team.status === "recruiting" && team.member_count < max}
                busy={busy}
                onApply={() => open({ kind: "apply", team })}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function MyTeam({ team, status, meId, busy, open, act }: { team: Team; status: MyStatus; meId: string | null; busy: boolean; open: (dialog: Dialog) => void; act: Act }) {
  const id = useId();
  const { team_min: min, team_max: max } = status.settings;
  const leader = status.role === "leader";
  const locked = team.status === "locked";
  const short = min - team.member_count;
  const invite = leader && can(status, "invite");
  const buttons = [
    invite && (
      <button key="invite" type="button" className="pt-btn is-sm" disabled={busy} onClick={() => open({ kind: "invite" })}>
        <Icon name="user-add-line" size={15} />
        邀请队友
      </button>
    ),
    can(status, "lock") && (
      <button key="lock" type="button" className="pt-btn is-sm is-primary" disabled={busy} onClick={() => open(lockDialog(team))}>
        <Icon name="flag-line" size={15} />
        确认参赛
      </button>
    ),
    can(status, "unlock") && (
      <button key="unlock" type="button" className="pt-btn is-sm" disabled={busy} onClick={() => void act(hubPaths.team(team.id, "lock"), "DELETE", undefined, "已取消确认，可以继续调整队伍。")}>
        <Icon name="lock-unlock-line" size={15} />
        取消确认
      </button>
    ),
    can(status, "transfer") && (
      <button key="transfer" type="button" className="pt-btn is-sm is-quiet" disabled={busy} onClick={() => open({ kind: "transfer" })}>
        <Icon name="exchange-line" size={15} />
        转让领队
      </button>
    ),
    can(status, "leave") && (
      <button
        key="leave"
        type="button"
        className="pt-btn is-sm is-quiet"
        disabled={busy}
        onClick={() =>
          open({ kind: "confirm", title: `退出「${team.name}」？`, body: "退出后你回到「已报名、没有队伍」，可以再创建或加入别的队伍。", submitText: "退出队伍", danger: true, path: hubPaths.team(team.id, "leave"), method: "POST", done: "已退出队伍。" })
        }
      >
        <Icon name="logout-box-r-line" size={15} />
        退出队伍
      </button>
    ),
    can(status, "disband") && (
      <button
        key="disband"
        type="button"
        className="pt-btn is-sm is-quiet"
        disabled={busy}
        onClick={() =>
          open({ kind: "confirm", title: `解散「${team.name}」？`, body: "队员都会回到「已报名、没有队伍」，还没处理的申请和邀请一并作废。这一步不能撤销。", submitText: "解散队伍", danger: true, path: hubPaths.team(team.id), method: "DELETE", done: "队伍已解散。" })
        }
      >
        <Icon name="delete-bin-line" size={15} />
        解散队伍
      </button>
    ),
  ].filter(Boolean);
  return (
    <section className={`pt-cx-team is-${team.status}`} aria-labelledby={`${id}-name`}>
      <div className="pt-cx-team-top">
        <small>我的队伍</small>
        <h4 id={`${id}-name`}>{team.name}</h4>
        <span className={`pt-cx-tst is-${team.status}`}>
          {locked ? "已确认参赛" : "招募中"} · {team.member_count}/{max} 人
        </span>
        {leader && (
          <span className="pt-cx-role">
            <Icon name="vip-crown-2-line" size={13} />
            我是领队
          </span>
        )}
      </div>
      {team.slogan && <p className="pt-cx-slogan">{team.slogan}</p>}
      <ul className="pt-cx-slots" aria-label={`队员 ${team.member_count}/${max}`}>
        {teamSlots(team, max).map((member, index) => (
          <li key={member?.account_id ?? `open-${index}`}>
            {member ? (
              <div className="pt-cx-slot">
                <Avatar person={member} size={48} ring={member.role} crown={member.role === "leader"} />
                <b>{member.login}</b>
                <span>
                  {member.role === "leader" ? "领队" : "队员"}
                  {member.account_id === meId ? " · 我" : ""}
                </span>
              </div>
            ) : invite ? (
              <button type="button" className="pt-cx-slot is-empty" disabled={busy} onClick={() => open({ kind: "invite" })}>
                <Avatar person={null} size={48} />
                <b>空位</b>
                <span>点这里邀请</span>
              </button>
            ) : (
              <div className="pt-cx-slot is-empty">
                <Avatar person={null} size={48} icon="user-line" />
                <b>空位</b>
                <span>{locked ? "名单已锁定" : "等领队邀请"}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
      {leader && !locked && short > 0 && (
        <p className="pt-cx-hint">
          还差 {short} 人才能确认参赛（每队至少 {min} 人）。
        </p>
      )}
      {buttons.length > 0 && <div className="pt-cx-team-act">{buttons}</div>}
    </section>
  );
}

function NoTeam({ status, open, onFindPeople }: { status: MyStatus; open: (dialog: Dialog) => void; onFindPeople: () => void }) {
  if (status.state === "unplaced") {
    return (
      <div className="pt-cx-callout is-warn">
        <Icon name="error-warning-line" size={22} />
        <div>
          <b>这次没能参赛</b>
          <p>报名截止时你还没有加入队伍。</p>
        </div>
      </div>
    );
  }
  if (status.state === "none") {
    return (
      <div className="pt-cx-callout">
        <Icon name="team-line" size={22} />
        <div>
          <b>报名后才能组队</b>
          <p>{status.writable ? "先报名，再创建队伍或申请加入下面的队伍。" : "报名已截止。"}</p>
        </div>
        {can(status, "signup") && (
          <div className="pt-cx-callout-act">
            <button type="button" className="pt-btn is-sm is-primary" onClick={() => open({ kind: "signup" })}>
              立即报名
            </button>
          </div>
        )}
      </div>
    );
  }
  const looking = status.signup?.looking_for_team === true;
  return (
    <div className="pt-cx-callout">
      <Icon name="team-line" size={22} />
      <div>
        <b>你还没有队伍</b>
        <p>
          {status.writable
            ? `创建一支队伍当领队，或申请加入下面招募中的队伍${looking ? "；你也在「找队友」里，领队可以直接邀请你" : ""}。`
            : "报名已截止，不能再组队。"}
        </p>
      </div>
      {status.writable && (
        <div className="pt-cx-callout-act">
          {can(status, "create_team") && (
            <button type="button" className="pt-btn is-sm is-primary" onClick={() => open({ kind: "create" })}>
              <Icon name="add-line" size={15} />
              创建队伍
            </button>
          )}
          <button type="button" className="pt-btn is-sm" onClick={onFindPeople}>
            <Icon name="user-search-line" size={15} />
            找队友
          </button>
        </div>
      )}
    </div>
  );
}

function PendingList({ status, busy, act }: { status: MyStatus; busy: boolean; act: Act }) {
  const id = useId();
  return (
    <section className="pt-cx-sec" aria-labelledby={`${id}-pending`}>
      <h4 id={`${id}-pending`}>
        待处理
        <span className="pt-cx-count">{status.pending.length}</span>
      </h4>
      <ul className="pt-cx-pend">
        {status.pending.map((item) => (
          <PendingRow key={item.membership_id} item={item} status={status} busy={busy} act={act} />
        ))}
      </ul>
    </section>
  );
}

function PendingRow({ item, status, busy, act }: { item: Pending; status: MyStatus; busy: boolean; act: Act }) {
  const view = pendingView(item, status);
  const aboutUs = status.team !== null && item.team_id === status.team.id;
  return (
    <li className={view.incoming ? "is-in" : undefined}>
      {aboutUs ? <Avatar person={item.person} size={36} /> : <TeamBadge size={36} />}
      <div className="pt-cx-pend-text">
        <b>{view.title}</b>
        <span>
          {view.detail}
          {item.created_at > 0 && ` · ${fmtRelative(item.created_at)}`}
        </span>
      </div>
      {view.actions.length > 0 && (
        <div className="pt-cx-pend-act">
          {view.actions.map((action) => (
            <button
              key={action}
              type="button"
              className={action === "accept" ? "pt-btn is-sm is-primary" : "pt-btn is-sm"}
              disabled={busy}
              onClick={() => void act(hubPaths.team(item.team_id, "respond"), "POST", { membership_id: item.membership_id, action }, RESPOND_DONE[action][item.kind])}
            >
              {RESPOND_TEXT[action][item.kind]}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function TeamCard({ team, max, applied, canApply, busy, onApply }: { team: Team; max: number; applied: boolean; canApply: boolean; busy: boolean; onApply: () => void }) {
  const leader = team.members.find((member) => member.role === "leader");
  const full = team.member_count >= max;
  const tone = team.status === "locked" ? "locked" : full ? "full" : "recruiting";
  return (
    <li className="pt-cx-tcard">
      <div className="pt-cx-tcard-top">
        <b>{team.name}</b>
        <span className={`pt-cx-tst is-${tone}`}>{tone === "locked" ? "已确认" : tone === "full" ? "已满员" : "招募中"}</span>
      </div>
      <p>{team.slogan || "领队还没写口号。"}</p>
      <div className="pt-cx-tcard-foot">
        <span className="pt-cx-stack" aria-hidden="true">
          {teamSlots(team, max).map((member, index) => (
            <Avatar key={member?.account_id ?? `open-${index}`} person={member} size={28} ring={member?.role ?? "none"} icon="user-line" />
          ))}
        </span>
        <span>
          {team.member_count}/{max} 人{leader ? ` · 领队 ${leader.login}` : ""}
          <span className="pt-sr">，成员：{team.members.map((member) => member.login).join("、")}</span>
        </span>
        {applied ? (
          <span className="pt-cx-ok">
            <Icon name="check-line" size={14} />
            已申请
          </span>
        ) : (
          canApply && (
            <button type="button" className="pt-btn is-sm" disabled={busy} onClick={onApply}>
              申请加入<span className="pt-sr">「{team.name}」</span>
            </button>
          )
        )}
      </div>
    </li>
  );
}

type PeopleProps = { status: MyStatus; people: MemberRead<FreeAgent[]>; meId: string | null; busy: boolean; act: Act; competitionId: string };

export function PeoplePanel({ status, people, meId, busy, act, competitionId }: PeopleProps) {
  const id = useId();
  const mine = status.team;
  // 领队、队伍没满、服务端允许邀请时，每个人后面放「邀请」
  const inviteTeam = mine !== null && status.role === "leader" && can(status, "invite") && mine.member_count < status.settings.team_max ? mine : null;
  const invited = invitedIds(status);
  const list = (people.data ?? []).filter((person) => person.account_id !== meId);
  const solo = status.state === "signed_up" && mine === null && status.signup !== null;
  const looking = status.signup?.looking_for_team === true;
  return (
    <>
      {solo && can(status, "update_signup") && (
        <div className="pt-cx-callout">
          <Icon name="user-search-line" size={22} />
          <div>
            <b>{looking ? "你正在找队伍" : "你没有出现在这里"}</b>
            <p>{looking ? "领队能在这里看到你和你的留言，直接邀请你入队。" : "打开后，领队能在这里看到你并邀请你入队。"}</p>
          </div>
          <div className="pt-cx-callout-act">
            <button
              type="button"
              className="pt-btn is-sm"
              disabled={busy}
              onClick={() =>
                void act(hubPaths.signup(competitionId), "POST", { note: status.signup?.note ?? "", looking_for_team: !looking }, looking ? "已不在「找队友」里显示你。" : "已在「找队友」里显示你。")
              }
            >
              {looking ? "不再显示我" : "让领队看到我"}
            </button>
          </div>
        </div>
      )}
      <section className="pt-cx-sec" aria-labelledby={`${id}-people`}>
        <h4 id={`${id}-people`}>
          正在找队伍的同学
          {people.data && <span className="pt-cx-count">{list.length}</span>}
        </h4>
        {!people.data ? (
          <ListState phase={people.phase} what="名单" reload={people.reload} />
        ) : list.length === 0 ? (
          <p className="pt-cx-none">现在没有正在找队伍的同学。</p>
        ) : (
          <ul className="pt-cx-people">
            {list.map((person) => (
              <li key={person.account_id} className="pt-cx-person">
                <Avatar person={person} size={40} />
                <div>
                  <b>{person.login}</b>
                  <span>{person.note || "没有留言"}</span>
                  {person.since > 0 && <small>{fmtRelative(person.since)}开始找队伍</small>}
                </div>
                {inviteTeam &&
                  (invited.has(person.account_id) ? (
                    <span className="pt-cx-ok">
                      <Icon name="check-line" size={14} />
                      已邀请
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="pt-btn is-sm"
                      disabled={busy}
                      onClick={() => void act(hubPaths.team(inviteTeam.id, "invite"), "POST", { account_id: person.account_id }, `已邀请 ${person.login}，等对方回复。`)}
                    >
                      <Icon name="user-add-line" size={15} />
                      邀请<span className="pt-sr"> {person.login}</span>
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
