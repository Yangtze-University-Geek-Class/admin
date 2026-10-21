// 积分天梯（#239）：个人榜与队伍榜。个人榜前三名上领奖台，其余进表格；我所在的行高亮。
// 数据每 30 秒重读（useMemberRead 的轮询），重读失败时保留上一份并标「没刷新上」。积分由组织者核实后在控制台登记。
import { useState } from "react";
import Icon from "../../Icon";
import Avatar, { TeamBadge } from "./Avatar";
import type { BoardPerson, BoardTeam, Leaderboard, MemberRead } from "../../../lib/competitionHub";

type Props = { board: MemberRead<Leaderboard>; meId: string | null; myTeamId: string | null; teamMode: boolean };

const pad = (value: number) => String(value).padStart(2, "0");
/** 北京时间的 `HH:mm:ss`：天梯每 30 秒刷新，精确到秒才看得出在动。 */
function clock(at: number): string {
  const d = new Date(at + 8 * 3600_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

const split = (row: BoardPerson) => `Issue ${row.issues} · PR ${row.prs}${row.penalties > 0 ? ` · 扣分 ${row.penalties} 次` : ""}`;

function Empty({ text }: { text: string }) {
  return (
    <div className="pt-cx-callout">
      <Icon name="medal-line" size={22} />
      <div>
        <b>{text}</b>
        <p>合入的 Issue 与 PR 由组织者核实后登记积分，登记后半分钟内出现在这里。</p>
      </div>
    </div>
  );
}

function People({ rows, meId }: { rows: BoardPerson[]; meId: string | null }) {
  if (rows.length === 0) return <Empty text="还没有人得分" />;
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  return (
    <>
      <ol className="pt-cx-podium" aria-label="前三名" style={{ ["--count" as string]: String(podium.length) }}>
        {podium.map((row) => (
          <li key={row.person.account_id} className={`is-${Math.min(row.rank, 3)}${row.person.account_id === meId ? " is-me" : ""}`}>
            <span className={`pt-cx-rank is-${Math.min(row.rank, 3)}`}>
              <span className="pt-sr">第 </span>
              {row.rank}
              <span className="pt-sr"> 名</span>
            </span>
            <Avatar person={row.person} size={row.rank === 1 ? 52 : 44} ring={row.rank === 1 ? "leader" : "member"} />
            <b>
              {row.person.login}
              {row.person.account_id === meId && <span className="pt-cx-me">（我）</span>}
            </b>
            <strong>
              {row.points}
              <small> 分</small>
            </strong>
            <small>{row.team ? `「${row.team.name}」` : split(row)}</small>
          </li>
        ))}
      </ol>
      {rest.length > 0 && (
        <table className="pt-cx-board">
          <caption className="pt-sr">第 4 名起的个人积分</caption>
          <thead>
            <tr>
              <th scope="col">名次</th>
              <th scope="col">选手</th>
              <th scope="col" className="is-team-col">队伍</th>
              <th scope="col" className="is-num pt-cx-split">贡献</th>
              <th scope="col" className="is-num">积分</th>
            </tr>
          </thead>
          <tbody>
            {rest.map((row) => (
              <tr key={row.person.account_id} className={row.person.account_id === meId ? "is-me" : undefined}>
                <td>
                  <span className="pt-cx-rank">{row.rank}</span>
                </td>
                <td>
                  <span className="pt-cx-who">
                    <Avatar person={row.person} size={28} />
                    <b>{row.person.login}</b>
                  </span>
                </td>
                <td className="is-team-col">{row.team?.name ?? "—"}</td>
                <td className="is-num pt-cx-split">{split(row)}</td>
                <td className="is-num pt-cx-pts">{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Teams({ rows, myTeamId }: { rows: BoardTeam[]; myTeamId: string | null }) {
  if (rows.length === 0) return <Empty text="还没有队伍得分" />;
  return (
    <table className="pt-cx-board">
      <caption className="pt-sr">队伍积分</caption>
      <thead>
        <tr>
          <th scope="col">名次</th>
          <th scope="col">队伍</th>
          <th scope="col" className="is-num">人数</th>
          <th scope="col" className="is-num">积分</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.team.id} className={row.team.id === myTeamId ? "is-me" : undefined}>
            <td>
              <span className={row.rank <= 3 ? `pt-cx-rank is-${row.rank}` : "pt-cx-rank"}>{row.rank}</span>
            </td>
            <td>
              <span className="pt-cx-who">
                <TeamBadge size={28} />
                <b>{row.team.name}</b>
                {row.team.status === "locked" && <span className="pt-cx-tst is-locked">已确认</span>}
              </span>
            </td>
            <td className="is-num">{row.member_count}</td>
            <td className="is-num pt-cx-pts">{row.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function BoardPanel({ board, meId, myTeamId, teamMode }: Props) {
  const [view, setView] = useState<"people" | "teams">("people");
  const data = board.data;
  const stale = board.phase === "failed";
  return (
    <>
      <div className="pt-cx-board-head">
        {teamMode ? (
          <div className="pt-cx-views" role="group" aria-label="天梯">
            <button type="button" className="pt-cx-view" aria-pressed={view === "people"} onClick={() => setView("people")}>
              个人榜
            </button>
            <button type="button" className="pt-cx-view" aria-pressed={view === "teams"} onClick={() => setView("teams")}>
              队伍榜
            </button>
          </div>
        ) : (
          <h4>个人榜</h4>
        )}
        {data && <p className={stale ? "pt-cx-live is-stale" : "pt-cx-live"}>{stale ? "没刷新上，稍后自动重试" : `更新于 ${clock(data.updated_at)} · 每 30 秒自动刷新`}</p>}
      </div>
      {!data ? (
        board.phase === "loading" ? (
          <p className="pt-cx-none" role="status">正在读取天梯…</p>
        ) : (
          <p className="pt-cx-none">
            天梯没加载出来。
            <button type="button" className="pt-cx-link" onClick={board.reload}>重试</button>
          </p>
        )
      ) : view === "teams" && teamMode ? (
        <Teams rows={data.teams} myTeamId={myTeamId} />
      ) : (
        <People rows={data.individuals} meId={meId} />
      )}
    </>
  );
}
