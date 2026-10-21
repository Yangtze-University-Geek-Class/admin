// 比赛应用（#265 起）：桌面左边列表、右边详情，手机列表点进详情再返回；比赛本身只读匿名 GET /api/public/competitions。
// #239：内部赛开了在线报名时，详情里能报名、组队、看天梯；顶部多一个「赛事 / 我的参赛」切换，「我的参赛」只列自己报了名的比赛，
// 角标是待处理的邀请与申请（GET /api/me/competitions，要登录且是成员）。登录状态用桌面 useAccount 读到的，不在这里再读一次。
// 没有哪场比赛开在线报名时不放切换，界面与 #265 一样。方案与草图见 docs/plan/COMPETITION-APP.md「结构与呈现」。
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../../Icon";
import { signInHref, type Account } from "../../../lib/account";
import { useCompetitions, type CompetitionKind } from "../../../lib/competitions";
import { applyFilter, KIND_TEXT, NO_FILTER, type CompetitionFilter } from "../../../lib/competitionLabels";
import { hubPaths, readMine, useMemberRead, type AccountState, type HubPhase } from "../../../lib/competitionHub";
import CompetitionList from "./CompetitionList";
import CompetitionDetail from "./CompetitionDetail";

/** 手机详情页借用窗口标题栏左边的返回键：「比赛列表」代替「主屏幕」。 */
export type PhoneNav = { backText: string; backLabel: string; onBack: () => void };

type Props = {
  phone?: boolean;
  /** 手机上进出详情时告诉窗口换返回键；null 恢复成「主屏幕」。 */
  onPhoneNav?: (nav: PhoneNav | null) => void;
  /** 登录者（桌面 useAccount 读的 /auth/me）；没登录是 null。 */
  account?: Account | null;
  /** /auth/me 回来了没有：没回来时先不读成员数据，也不说「没登录」。 */
  accountLoaded?: boolean;
};

/** 「我的参赛」里一场都没有时说清楚为什么：在读、没登录、不是成员、读失败、还没报名。 */
function MineEmpty({ account, phase, reload, showAll }: { account: AccountState; phase: HubPhase; reload: () => void; showAll: (open: boolean) => void }) {
  if (account === "loading" || (account === "signed_in" && phase === "loading")) {
    return (
      <div className="pt-cx-state" role="status">
        <Icon name="loader-4-line" size={30} className="pt-cx-spin" />
        <b>正在读取你的参赛…</b>
      </div>
    );
  }
  if (account === "signed_out" || phase === "signed_out") {
    return (
      <div className="pt-cx-state">
        <Icon name="user-line" size={30} />
        <b>登录后查看你的参赛</b>
        <p>用极客班账号登录后，这里会列出你报名的比赛、所在的队伍和待处理的邀请。</p>
        <a className="pt-btn is-primary" href={signInHref()}>
          <Icon name="user-line" size={16} />
          登录
        </a>
      </div>
    );
  }
  if (phase === "not_member") {
    return (
      <div className="pt-cx-state">
        <Icon name="team-line" size={30} />
        <b>报名与组队只对极客班成员开放</b>
        <p>你的账号还不是极客班成员。比赛介绍、赛程与天梯在「赛事」里都能看。</p>
        <button type="button" className="pt-btn" onClick={() => showAll(false)}>
          看看全部比赛
        </button>
      </div>
    );
  }
  if (phase === "failed") {
    return (
      <div className="pt-cx-state is-error" role="alert">
        <Icon name="error-warning-line" size={30} />
        <b>你的参赛没加载出来</b>
        <p>可能是网络不稳定，或者服务暂时不可用。</p>
        <button type="button" className="pt-btn is-primary" onClick={reload}>
          <Icon name="refresh-line" size={16} />
          重试
        </button>
      </div>
    );
  }
  return (
    <div className="pt-cx-state">
      <Icon name="trophy-line" size={30} />
      <b>你还没有报名比赛</b>
      <p>开了在线报名的比赛可以直接在这里报名、组队，报名后会出现在这里。</p>
      <button type="button" className="pt-btn is-primary" onClick={() => showAll(true)}>
        看看可报名的比赛
      </button>
    </div>
  );
}

const KINDS: CompetitionKind[] = ["internal", "external"];

/** 按比赛 id 找卡片按钮：id 来自接口，不拼进选择器。 */
function cardFor(root: HTMLElement | null, id: string): HTMLButtonElement | null {
  for (const button of root?.querySelectorAll<HTMLButtonElement>("[data-competition]") ?? []) {
    if (button.dataset.competition === id) return button;
  }
  return null;
}

export default function CompetitionsApp({ phone = false, onPhoneNav, account = null, accountLoaded = true }: Props) {
  const { items, failed, loading, now, reload } = useCompetitions();
  const [filter, setFilter] = useState<CompetitionFilter>(NO_FILTER);
  const [scope, setScope] = useState<"all" | "mine">("all");
  const accountState: AccountState = !accountLoaded ? "loading" : account ? "signed_in" : "signed_out";
  // 详情里报了名、进了队或处理了邀请就重读一次「我的参赛」，卡片与角标跟着变。
  const [mineVersion, setMineVersion] = useState(0);
  const onChanged = useCallback(() => setMineVersion((n) => n + 1), []);
  const mine = useMemberRead(accountState === "signed_in" ? hubPaths.mine : null, readMine, mineVersion);
  const entries = new Map((mine.data?.items ?? []).map((entry) => [entry.competition_id, entry] as const));
  const pendingTotal = mine.data?.pending_total ?? 0;
  const hubOn = items.some((item) => item.signup.enabled) || entries.size > 0;
  const mineScope = hubOn && scope === "mine";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "detail">("list");
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  /** 从详情返回后要把焦点放回哪张卡片。 */
  const returnTo = useRef<string | null>(null);

  const shown = mineScope ? items.filter((item) => entries.has(item.id)) : applyFilter(items, filter);
  // 两个数都是全部比赛里的总数，不随搜索和类型变，免得点之前看到的数和点之后对不上。
  const openCount = items.filter((item) => item.status === "registering").length;
  const filtered = filter.open || filter.kind !== null || filter.query.trim() !== "";
  // 桌面总有一场选中（筛掉了就换成第一场）；手机只有点进去才有。
  const selected = phone
    ? (view === "detail" ? items.find((item) => item.id === selectedId) ?? null : null)
    : shown.find((item) => item.id === selectedId) ?? shown[0] ?? null;
  const inDetail = phone && selected !== null;

  // 换到桌面布局时回到两栏，手机再打开时从列表开始。
  useEffect(() => {
    if (!phone) setView("list");
  }, [phone]);

  useEffect(() => {
    if (!onPhoneNav) return;
    const onBack = () => {
      returnTo.current = selectedId;
      setView("list");
    };
    onPhoneNav(inDetail ? { backText: "比赛列表", backLabel: "返回比赛列表", onBack } : null);
  }, [inDetail, onPhoneNav, selectedId]);
  useEffect(() => () => onPhoneNav?.(null), [onPhoneNav]);

  // 手机进详情把焦点给标题（读屏先读比赛名），返回时放回刚才那张卡片。
  useEffect(() => {
    if (inDetail) {
      heading.current?.focus({ preventScroll: true });
      return;
    }
    const id = returnTo.current;
    returnTo.current = null;
    if (id !== null) cardFor(root.current, id)?.focus();
  }, [inDetail]);

  // 数据到了（或重试有了结果）时，窗口在最前面、焦点却不在窗口里（还在打开它的桌面图标上，或者点过的「重试」没了、
  // 焦点落回页面），就把焦点放进来：读失败给「重试」，桌面给搜索框，手机给第一张卡片（手机不给搜索框，免得弹出键盘）。
  useEffect(() => {
    if (loading) return;
    const node = root.current;
    const win = node?.closest(".pt-win.is-front");
    if (!node || !win || win.contains(document.activeElement)) return;
    const target = failed
      ? node.querySelector<HTMLElement>(".pt-cx-state button")
      : node.querySelector<HTMLElement>(phone ? "[data-competition]" : ".pt-cx-search input");
    target?.focus({ preventScroll: true });
  }, [loading, failed, phone]);

  const pick = (id: string) => {
    setSelectedId(id);
    if (phone) setView("detail");
  };
  const showAll = (open: boolean) => {
    setScope("all");
    setFilter(open ? { ...NO_FILTER, open: true } : NO_FILTER);
  };

  if (loading) {
    return (
      <div className="pt-cx is-loading" ref={root} aria-busy="true">
        <div className="pt-cx-bar">
          <p className="pt-cx-loading" role="status">
            <Icon name="loader-4-line" size={16} />
            正在读取比赛…
          </p>
        </div>
        <div className="pt-cx-main" aria-hidden="true">
          <div className="pt-cx-list">
            {[0, 1, 2, 3].map((n) => <span key={n} className="pt-cx-bone is-card" />)}
          </div>
          {!phone && (
            <div className="pt-cx-detail">
              <div className="pt-cx-scroll">
                <span className="pt-cx-bone is-title" />
                <span className="pt-cx-bone is-facts" />
                <span className="pt-cx-bone is-line" />
                <span className="pt-cx-bone is-line is-short" />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="pt-cx" ref={root}>
        <div className="pt-cx-state is-error" role="alert">
          <Icon name="error-warning-line" size={30} />
          <b>比赛列表没加载出来</b>
          <p>可能是网络不稳定，或者服务暂时不可用。</p>
          <button type="button" className="pt-btn is-primary" onClick={reload}>
            <Icon name="refresh-line" size={16} />
            重试
          </button>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="pt-cx" ref={root}>
        <div className="pt-cx-state">
          <Icon name="trophy-line" size={30} />
          <b>现在还没有登记的比赛</b>
          <p>比赛由组织者在控制台登记。登记后，这里会列出每场比赛的报名截止、赛程和官网。</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="pt-cx"
      ref={root}
      onKeyDown={(event) => {
        // 手机详情里按 Esc 先回列表；不往上传，免得整个窗口也跟着收起。
        if (!inDetail || event.key !== "Escape") return;
        event.stopPropagation();
        returnTo.current = selectedId;
        setView("list");
      }}
    >
      {!inDetail && (
        <div className="pt-cx-bar">
          {hubOn && (
            <div className="pt-cx-views" role="group" aria-label="切换列表">
              <button type="button" className="pt-cx-view" aria-pressed={!mineScope} onClick={() => setScope("all")}>
                <Icon name="trophy-line" size={15} />
                赛事
              </button>
              <button type="button" className="pt-cx-view" aria-pressed={mineScope} onClick={() => setScope("mine")}>
                <Icon name="user-line" size={15} />
                我的参赛
                {pendingTotal > 0 && (
                  <span className="pt-cx-badge">
                    {pendingTotal}
                    <span className="pt-sr"> 条待处理</span>
                  </span>
                )}
              </button>
            </div>
          )}
          {!mineScope && (
            <>
              <div className="pt-cx-chips" role="group" aria-label="筛选比赛">
                <button type="button" className="pt-cx-chip" aria-pressed={!filter.open && filter.kind === null} onClick={() => setFilter((f) => ({ ...f, open: false, kind: null }))}>
                  全部<span className="pt-cx-count">{items.length}<span className="pt-sr"> 场</span></span>
                </button>
                <button type="button" className="pt-cx-chip" aria-pressed={filter.open} onClick={() => setFilter((f) => ({ ...f, open: !f.open }))}>
                  可报名<span className="pt-cx-count">{openCount}<span className="pt-sr"> 场</span></span>
                </button>
                <span className="pt-cx-sep" aria-hidden="true" />
                {KINDS.map((kind) => (
                  <button key={kind} type="button" className="pt-cx-chip" aria-pressed={filter.kind === kind} onClick={() => setFilter((f) => ({ ...f, kind: f.kind === kind ? null : kind }))}>
                    {KIND_TEXT[kind]}
                  </button>
                ))}
              </div>
              <label className="pt-cx-search">
                <Icon name="search-line" size={16} />
                <input
                  type="search"
                  value={filter.query}
                  onChange={(event) => {
                    const query = event.target.value;
                    setFilter((f) => ({ ...f, query }));
                  }}
                  placeholder="搜索比赛名称或介绍"
                  aria-label="搜索比赛"
                  enterKeyHint="search"
                  // 手机上窗口打开时不把焦点给搜索框（OsWindow 跳过带 data-no-autofocus 的输入框），免得一打开就弹出键盘
                  data-no-autofocus={phone ? "" : undefined}
                />
              </label>
              <p className="pt-sr" aria-live="polite">{filtered ? `筛出 ${shown.length} 场比赛` : ""}</p>
            </>
          )}
        </div>
      )}
      {shown.length === 0 && !inDetail && mineScope ? (
        <MineEmpty account={accountState} phase={mine.phase} reload={mine.reload} showAll={showAll} />
      ) : shown.length === 0 && !inDetail ? (
        <div className="pt-cx-state">
          <Icon name="search-line" size={30} />
          <b>没有符合条件的比赛</b>
          <p>换个关键词或筛选条件，或者清除筛选看全部 {items.length} 场。</p>
          <button type="button" className="pt-btn" onClick={() => setFilter(NO_FILTER)}>
            清除筛选
          </button>
        </div>
      ) : (
        <div className="pt-cx-main">
          {!inDetail && (
            <CompetitionList
              items={shown}
              selectedId={phone ? null : selected?.id ?? null}
              now={now}
              phone={phone}
              onPick={pick}
              mine={entries}
              label={mineScope ? "我的参赛" : "比赛列表"}
            />
          )}
          {selected && (
            <CompetitionDetail
              key={selected.id}
              item={selected}
              now={now}
              headingRef={heading}
              account={accountState}
              accountId={account?.accountId ?? null}
              phone={phone}
              onChanged={onChanged}
            />
          )}
        </div>
      )}
    </div>
  );
}
