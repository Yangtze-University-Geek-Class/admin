// 组队广场（#278，所有者 2026-10-24 22:25 要求做一个组队广场，列出各比赛里找队和招人的信息）：
// 比赛窗口顶上「赛事 / 我的参赛 / 组队广场」的第三个页签。一张跨比赛的列表，读 GET /api/team-plaza，
// 招人的队伍和找队伍的人两种卡片；申请和邀请不在这里做，点卡片上的按钮回到那场比赛的「队伍」页签，
// 那里有完整的报名状态和名额判断，规则只在一处。
import { useEffect, useState } from "react";
import { fmtRelative } from "@shared/lib/api";
import Icon from "../../Icon";
import Avatar from "./Avatar";
import { readPlaza, plazaPath, useMemberRead, type AccountState, type PlazaEntry, type PlazaKind } from "../../../lib/competitionHub";
import { signInHref } from "../../../lib/account";

type Props = {
  account: AccountState;
  /** 正在报名、开了组队的比赛：多于一场时给一排比赛筛选。 */
  competitions: { id: string; name: string }[];
  /** 回到某场比赛的「队伍」页签。 */
  onOpen: (competitionId: string) => void;
};

const KIND_CHIPS: { kind: PlazaKind | null; text: string }[] = [
  { kind: null, text: "全部" },
  { kind: "recruiting_team", text: "招人的队伍" },
  { kind: "seeking_team", text: "找队伍的人" },
];

export default function TeamPlaza({ account, competitions, onOpen }: Props) {
  const [kind, setKind] = useState<PlazaKind | null>(null);
  const [competition, setCompetition] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [keyword, setKeyword] = useState("");
  // 搜索停手 300ms 再发请求，不每敲一个字就读一次。
  useEffect(() => {
    const timer = window.setTimeout(() => setKeyword(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  const plaza = useMemberRead(account === "signed_in" ? plazaPath({ competition, kind, keyword }) : null, readPlaza);
  const items = plaza.data?.items ?? [];

  return (
    <div className="pt-cx-plaza">
      <div className="pt-cx-bar is-sub">
        <div className="pt-cx-chips" role="group" aria-label="筛选组队信息">
          {KIND_CHIPS.map((chip) => (
            <button key={chip.text} type="button" className="pt-cx-chip" aria-pressed={kind === chip.kind} onClick={() => setKind(chip.kind)}>
              {chip.text}
            </button>
          ))}
          {competitions.length > 1 && (
            <>
              <span className="pt-cx-sep" aria-hidden="true" />
              {competitions.map((item) => (
                <button key={item.id} type="button" className="pt-cx-chip" aria-pressed={competition === item.id} onClick={() => setCompetition((id) => (id === item.id ? null : item.id))}>
                  {item.name}
                </button>
              ))}
            </>
          )}
        </div>
        <label className="pt-cx-search">
          <Icon name="search-line" size={16} />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜队名、技能或留言" aria-label="搜索组队信息" enterKeyHint="search" data-no-autofocus="" />
        </label>
      </div>
      <div className="pt-cx-scroll">
        {account === "signed_out" || plaza.phase === "signed_out" ? (
          <div className="pt-cx-state">
            <Icon name="team-line" size={30} />
            <b>登录后看组队广场</b>
            <p>这里汇总所有正在报名的团队赛里招人的队伍和找队伍的同学，登录极客班账号后就能看。</p>
            <a className="pt-btn is-primary" href={signInHref()}>
              <Icon name="user-line" size={16} />
              登录
            </a>
          </div>
        ) : plaza.phase === "not_member" ? (
          <div className="pt-cx-state">
            <Icon name="team-line" size={30} />
            <b>组队只对极客班成员开放</b>
            <p>你的账号还不是极客班成员，比赛介绍和天梯在「赛事」里都能看。</p>
          </div>
        ) : plaza.phase === "failed" ? (
          <div className="pt-cx-state is-error" role="alert">
            <Icon name="error-warning-line" size={30} />
            <b>组队广场没加载出来</b>
            <p>可能是网络不稳定，或者服务暂时不可用。</p>
            <button type="button" className="pt-btn is-primary" onClick={plaza.reload}>
              <Icon name="refresh-line" size={16} />
              重试
            </button>
          </div>
        ) : !plaza.data ? (
          <div className="pt-cx-state" role="status">
            <Icon name="loader-4-line" size={30} className="pt-cx-spin" />
            <b>正在读取组队信息…</b>
          </div>
        ) : items.length === 0 ? (
          <div className="pt-cx-state">
            <Icon name="team-line" size={30} />
            <b>{keyword || kind || competition ? "没有符合条件的组队信息" : "现在还没有人在找队友"}</b>
            <p>
              {competitions.length === 0
                ? "组队广场只收正在报名的团队赛。现在没有在报名的团队赛，开了以后这里会列出招人的队伍和找队伍的同学。"
                : "报名团队赛时勾上「出现在「找队友」里」，或者领队在队伍页签里点「在广场招人」，就会出现在这里。"}
            </p>
          </div>
        ) : (
          <ul className="pt-cx-plaza-list" aria-label="组队信息">
            {items.map((entry) => (
              <li key={`${entry.kind}:${entry.team_id ?? entry.person?.account_id}:${entry.competition_id}`}>
                <PlazaCard entry={entry} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PlazaCard({ entry, onOpen }: { entry: PlazaEntry; onOpen: (competitionId: string) => void }) {
  const team = entry.kind === "recruiting_team";
  const who = team ? entry.leader : entry.person;
  return (
    <article className={team ? "pt-cx-plaza-card is-team" : "pt-cx-plaza-card"}>
      <header>
        <span className={team ? "pt-cx-plaza-kind is-team" : "pt-cx-plaza-kind"}>
          <Icon name={team ? "team-line" : "user-search-line"} size={14} />
          {team ? "招人" : "找队伍"}
        </span>
        <span className="pt-cx-plaza-comp">{entry.competition_name}</span>
        {entry.since > 0 && <small>{fmtRelative(entry.since)}</small>}
      </header>
      {team ? (
        <>
          <div className="pt-cx-plaza-title">
            <b>{entry.team_name}</b>
            {entry.member_count !== null && entry.team_max !== null && (
              <span className="pt-cx-plaza-seats">
                {entry.member_count}/{entry.team_max} 人<span className="pt-sr">，还差 {entry.team_max - entry.member_count} 人</span>
              </span>
            )}
          </div>
          {entry.slogan && <p className="pt-cx-plaza-slogan">{entry.slogan}</p>}
        </>
      ) : null}
      {entry.note && <p className="pt-cx-plaza-note">{entry.note}</p>}
      {team && entry.wanted_skills && entry.wanted_skills.length > 0 && (
        <ul className="pt-cx-plaza-skills" aria-label="想找的方向">
          {entry.wanted_skills.map((skill) => <li key={skill}>{skill}</li>)}
        </ul>
      )}
      <footer>
        {who && (
          <span className="pt-cx-plaza-who">
            <Avatar person={who} size={24} />
            <span>{team ? `领队 ${who.login}` : who.login}</span>
          </span>
        )}
        <button type="button" className="pt-btn is-sm is-primary" onClick={() => onOpen(entry.competition_id)}>
          {team ? "去申请" : "去邀请"}
          <span className="pt-sr">（打开{entry.competition_name}的队伍页签）</span>
          <Icon name="arrow-right-line" size={15} />
        </button>
      </footer>
    </article>
  );
}
