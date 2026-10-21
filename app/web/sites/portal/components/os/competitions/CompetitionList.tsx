// 比赛列表（#265）：每张卡片是一个按钮，写名称、状态、内部/外部和最要紧的那个日期。
// 桌面上选中的那张高亮；Tab 一次进列表，上下方向键、Home、End 换比赛（焦点跟着走），再 Tab 到详情里的链接。
// 手机上点卡片进详情，每张卡片都能 Tab 到。
// #239：自己报了名的比赛，卡片底下多一行「报名到哪一步 · 哪支队伍」和待处理的条数。
import { useRef, type KeyboardEvent } from "react";
import Icon from "../../Icon";
import type { IconName } from "../../../lib/icons";
import type { Competition } from "../../../lib/competitions";
import { cardWhen, KIND_TEXT, STATUS_TEXT } from "../../../lib/competitionLabels";
import { entryText, type HubState, type MyEntry } from "../../../lib/competitionHub";

type Props = {
  items: readonly Competition[];
  /** 桌面上选中的比赛；手机传 null，列表里不标选中。 */
  selectedId: string | null;
  now: number;
  phone: boolean;
  onPick: (id: string) => void;
  /** 我的参赛（按比赛 id）：没登录或没报名时是空的。 */
  mine?: ReadonlyMap<string, MyEntry>;
  /** 列表的读屏名称。 */
  label?: string;
};

const MINE_ICON: Record<HubState, IconName> = {
  none: "user-line", signed_up: "user-line", in_team: "team-line", confirmed: "flag-line", unplaced: "error-warning-line",
};

/** 读屏念卡片时各段之间停一下（屏幕上看不见）。 */
const Pause = () => <span className="pt-sr">，</span>;

export default function CompetitionList({ items, selectedId, now, phone, onPick, mine, label = "比赛列表" }: Props) {
  const list = useRef<HTMLUListElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (phone || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const index = items.findIndex((item) => item.id === selectedId);
    const moves: Partial<Record<string, number>> = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = items[Math.max(0, Math.min(items.length - 1, next))];
    if (!target) return;
    onPick(target.id);
    // 卡片 id 来自接口，不拼进选择器，逐个比对
    for (const button of list.current?.querySelectorAll<HTMLButtonElement>("[data-competition]") ?? []) {
      if (button.dataset.competition === target.id) button.focus();
    }
  };

  return (
    <ul className="pt-cx-list" ref={list} aria-label={label} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const current = item.id === selectedId;
        const entry = mine?.get(item.id);
        return (
          <li key={item.id}>
            <button
              type="button"
              className={`pt-cx-card is-${item.status}`}
              data-competition={item.id}
              aria-current={current ? "true" : undefined}
              tabIndex={phone || current ? 0 : -1}
              onClick={() => onPick(item.id)}
            >
              <span className="pt-cx-card-top">
                <b>{item.name}</b>
                <Pause />
                <span className={`pt-cx-st is-${item.status}`}>{STATUS_TEXT[item.status]}</span>
              </span>
              <Pause />
              <span className="pt-cx-card-meta">
                <span className={`pt-cx-kind is-${item.kind}`}>{KIND_TEXT[item.kind]}</span>
                <Pause />
                <span>{cardWhen(item, now)}</span>
              </span>
              {entry && (
                <>
                  <Pause />
                  <span className={`pt-cx-card-mine is-${entry.state}`}>
                    <Icon name={MINE_ICON[entry.state]} size={14} />
                    <span>{entryText(entry, item.signup.participation)}</span>
                    {entry.pending_count > 0 && <em>{entry.pending_count} 条待处理</em>}
                  </span>
                </>
              )}
              {phone && <Icon name="arrow-right-s-line" size={18} className="pt-cx-card-go" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
