// YUGC OS 的窗口：可拖动、最小化、放大、关闭、聚焦；内容有「关于」「组织架构」「论坛最新」「终端」「比赛」五种。
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { appConfig } from "@shared/config";
import { links } from "../../lib/links";
import { agoLabel, runTerminal, type AppId, type OsApp, type TerminalLine } from "../../lib/osApps";
import { orgChartModel, orgSummary, useOrg, type OrgBadge } from "../../lib/org";
import { useForumSnapshot, useRepoSnapshot } from "../../lib/snapshots";
import { dayRange, shortDay, useCompetitions, type CompetitionKind, type CompetitionStatus } from "../../lib/competitions";
import Icon from "../Icon";

export type WindowId = "about" | "org" | "terminal" | "forum-feed" | "competitions";
export type WindowState = { id: WindowId; z: number; x: number; y: number; minimized: boolean; zoomed: boolean };

type OpenApp = (id: AppId | "forum-feed", from?: HTMLElement | null) => void;

const META: Record<WindowId, { title: string; icon: "book-2-line" | "organization-chart" | "terminal-box-line" | "fire-line" | "trophy-line"; width: number; path: string }> = {
  about: { title: "关于极客班", icon: "book-2-line", width: 640, path: "~/yugc/about" },
  org: { title: "组织架构", icon: "organization-chart", width: 760, path: "~/yugc/org" },
  terminal: { title: "nano@yugc — zsh", icon: "terminal-box-line", width: 640, path: "~/yugc" },
  "forum-feed": { title: "论坛 · 最新", icon: "fire-line", width: 780, path: "~/yugc/forum" },
  competitions: { title: "比赛", icon: "trophy-line", width: 780, path: "~/yugc/competitions" },
};
/** 状态文案：与服务端 `competitionStatus` 的四个值一一对应。 */
const STATUS_TEXT: Record<CompetitionStatus, string> = { upcoming: "未开始", registering: "报名中", closed: "报名已截止", ongoing: "进行中", ended: "已结束" };

export function windowWidth(id: WindowId): number {
  return META[id].width;
}

type Props = {
  win: WindowState;
  front: boolean;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onZoom: () => void;
  onMove: (x: number, y: number) => void;
  onOpen: OpenApp;
  /** 这个人能打开的应用（visibleApps），终端的 ls / open 只认这些。 */
  apps: readonly OsApp[];
  phone?: boolean;
};

export default function OsWindow({ win, front, onFocus, onClose, onMinimize, onZoom, onMove, onOpen, apps, phone = false }: Props) {
  const meta = META[win.id];
  const ref = useRef<HTMLElement>(null);
  const width = Math.min(meta.width, window.innerWidth - 24);

  // 在移动端支持下滑手势关闭窗口（iOS Sheet 拖拽收起体验）
  const touchStartY = useRef<number | null>(null);
  const currentPullY = useRef<number>(0);

  const onTouchStartSheet = (e: React.TouchEvent<HTMLElement>) => {
    if (!phone) return;
    if ((e.target as HTMLElement).closest("button")) return;
    if (e.touches.length !== 1) return;
    touchStartY.current = e.touches[0].clientY;
    currentPullY.current = 0;
  };

  const onTouchMoveSheet = (e: React.TouchEvent<HTMLElement>) => {
    if (!phone || touchStartY.current === null) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy > 0) {
      currentPullY.current = dy;
      if (ref.current) {
        ref.current.style.transform = `translateY(${Math.min(dy, 240)}px)`;
        ref.current.style.transition = "none";
      }
    } else {
      currentPullY.current = 0;
      if (ref.current) {
        ref.current.style.transform = "";
      }
    }
  };

  const onTouchEndSheet = () => {
    if (!phone || touchStartY.current === null) return;
    const dy = currentPullY.current;
    touchStartY.current = null;
    currentPullY.current = 0;
    if (ref.current) {
      ref.current.style.transition = "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)";
    }
    if (dy > 70) {
      if (ref.current) ref.current.style.transform = "translateY(100%)";
      window.setTimeout(() => {
        onClose();
        if (ref.current) ref.current.style.transform = "";
      }, 180);
    } else {
      if (ref.current) ref.current.style.transform = "";
    }
  };

  const onTouchCancelSheet = () => {
    if (!phone || touchStartY.current === null) return;
    touchStartY.current = null;
    currentPullY.current = 0;
    if (ref.current) {
      ref.current.style.transition = "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)";
      ref.current.style.transform = "";
    }
  };

  useEffect(() => {
    if (ref.current) ref.current.inert = win.minimized || (phone && !front);
    if (!win.minimized && front) {
      const target = ref.current?.querySelector<HTMLElement>("input") ?? ref.current?.querySelector<HTMLElement>("a, button:not(.pt-win-lights button)");
      target?.focus({ preventScroll: true });
    }
  }, [front, phone, win.minimized]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button") || win.zoomed || phone) return;
    const bar = event.currentTarget;
    const sx = event.clientX;
    const sy = event.clientY;
    const ox = win.x;
    const oy = win.y;
    bar.setPointerCapture(event.pointerId);
    ref.current?.classList.add("is-drag");
    const move = (e: PointerEvent) => onMove(Math.min(window.innerWidth - 80, Math.max(-width + 120, ox + e.clientX - sx)), Math.min(window.innerHeight - 90, Math.max(44, oy + e.clientY - sy)));
    const up = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      ref.current?.classList.remove("is-drag");
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
  };

  const cls = ["pt-win", front ? "is-front" : "", win.zoomed ? "is-zoomed" : "", win.minimized ? "is-min" : ""].filter(Boolean).join(" ");
  return (
    <>
      {phone && front && !win.minimized && (
        <div
          className="pt-win-backdrop"
          aria-hidden="true"
          style={{ zIndex: win.z - 1 }}
          onClick={onClose}
        />
      )}
      <section
        ref={ref}
        className={cls}
        role="dialog"
        aria-label={meta.title}
        hidden={win.minimized || (phone && !front)}
        style={{ left: win.x, top: win.y, width, zIndex: win.z }}
        onPointerDown={onFocus}
      >
        {phone && (
          <div
            className="pt-win-grabber-wrap"
            onTouchStart={onTouchStartSheet}
            onTouchMove={onTouchMoveSheet}
            onTouchEnd={onTouchEndSheet}
            onTouchCancel={onTouchCancelSheet}
          >
            <div className="pt-win-grabber" aria-hidden="true" />
          </div>
        )}
        <header
          className="pt-win-bar"
          onPointerDown={startDrag}
          onDoubleClick={() => !phone && onZoom()}
          onTouchStart={onTouchStartSheet}
          onTouchMove={onTouchMoveSheet}
          onTouchEnd={onTouchEndSheet}
          onTouchCancel={onTouchCancelSheet}
        >
          {phone ? (
            <button type="button" className="pt-phone-back" aria-label="返回主屏幕" onClick={onMinimize}>
              <Icon name="arrow-left-line" size={18} />
              <span>主屏幕</span>
            </button>
          ) : (
            <span className="pt-win-lights">
              <button type="button" aria-label="关闭" onClick={onClose}>
                <Icon name="close-line" size={10} />
              </button>
              <button type="button" aria-label="最小化" onClick={onMinimize}>
                <Icon name="subtract-line" size={10} />
              </button>
              <button type="button" aria-label="放大" onClick={onZoom}>
                <Icon name="fullscreen-line" size={9} />
              </button>
            </span>
          )}
          <b>
            <Icon name={meta.icon} size={14} /> {meta.title}
          </b>
          {phone ? (
            <button type="button" className="pt-phone-close" aria-label="关闭应用" onClick={onClose}>
              <Icon name="close-line" size={18} />
            </button>
          ) : (
            <span className="pt-win-path">{meta.path}</span>
          )}
        </header>
        <div className="pt-win-body">
          {win.id === "about" && <About onOpen={onOpen} />}
          {win.id === "org" && <OrgChart />}
          {win.id === "forum-feed" && <ForumFeed />}
          {win.id === "competitions" && <Competitions />}
          {win.id === "terminal" && <Terminal onOpen={onOpen} apps={apps} />}
        </div>
      </section>
    </>
  );
}
/** 比赛（#238）窗口：还能赶上的排在前面，可按内部/外部筛；有有效官方链接就显示，不放尚未实现的报名按钮。 */
export function Competitions() {
  const { items, failed, loading } = useCompetitions();
  const [filter, setFilter] = useState<"all" | CompetitionKind>("all");
  const shown = filter === "all" ? items : items.filter((item) => item.kind === filter);
  if (loading) return <p className="pt-empty">正在读取比赛…</p>;
  if (failed) return <p className="pt-empty">比赛列表没加载出来，稍后再打开这个窗口看看。</p>;
  return (
    <div className="pt-comp">
      <div className="pt-comp-filter" role="group" aria-label="按类型筛选">
        {([["all", "全部"], ["internal", "内部"], ["external", "外部"]] as const).map(([value, label]) => (
          <button key={value} type="button" className={filter === value ? "is-on" : undefined} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="pt-empty">{items.length === 0 ? "现在还没有登记的比赛。" : "这个类型下暂时没有比赛。"}</p>
      ) : (
        <ol className="pt-comp-list">
          {shown.map((item) => (
            <li key={item.id} className={`is-${item.status}`}>
              <div className="pt-comp-head">
                <b>{item.name}</b>
                <span className="pt-comp-tags">
                  <span className={`pt-comp-kind is-${item.kind}`}>{item.kind === "internal" ? "内部" : "外部"}</span>
                  <span className="pt-comp-status">{STATUS_TEXT[item.status]}</span>
                </span>
              </div>
              {item.description && <p className="pt-comp-desc">{item.description}</p>}
              <p className="pt-comp-when">
                <Icon name="calendar-event-line" size={13} />
                {dayRange(item.start_at, item.end_at)}
                {item.signup_deadline !== null && <span className="pt-comp-due">报名截止 {shortDay(item.signup_deadline)}</span>}
              </p>
              {item.url && (
                <a className="pt-comp-link" href={item.url} target="_blank" rel="noopener noreferrer">
                  查看官方页面<Icon name="external-link-line" size={13} />
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}


function About({ onOpen }: { onOpen: OpenApp }) {
  const { brand } = appConfig.portal;
  const summary = orgSummary(useOrg());
  return (
    <div className="pt-about">
      <img src={brand.logo} alt="长江大学计算机科学学院极客班徽标" width={112} height={112} />
      <div>
        <h3>{brand.title}</h3>
        <p>极客班在长江大学计算机科学学院。{summary.members}大家在论坛讨论课程、竞赛和求职，代码放在 GitHub 组织里。</p>
        <dl>
          <div>
            <dt>
              <Icon name="code-s-slash-line" size={15} />
              平时做什么
            </dt>
            <dd>做项目、打比赛，也聊课程、求职和 AI</dd>
          </div>
          <div>
            <dt>
              <Icon name="team-line" size={15} />
              怎么分工
            </dt>
            <dd>{summary.roles}</dd>
          </div>
          <div>
            <dt>
              <Icon name="mail-line" size={15} />
              怎么加入
            </dt>
            <dd>在「加入我们」写封信，我们用邮件联系你</dd>
          </div>
        </dl>
        <div className="pt-row-btns">
          <button type="button" className="pt-btn is-primary" onClick={(e) => onOpen("join", e.currentTarget)}>
            <Icon name="mail-send-line" size={16} /> 加入我们
          </button>
          <button type="button" className="pt-btn" onClick={(e) => onOpen("org", e.currentTarget)}>
            <Icon name="organization-chart" size={16} /> 查看组织架构
          </button>
          <Link className="pt-btn" to="/docs">
            <Icon name="file-text-line" size={16} /> 文档
          </Link>
        </div>
        <p>3D 手机模型为 Apple iPhone 15 Pro Max Black，已轻量化并替换屏幕内容。</p>
        <div className="pt-row-btns">
          <a className="pt-btn" href="https://sketchfab.com/3d-models/apple-iphone-15-pro-max-black-df17520841214c1792fb8a44c6783ee7" target="_blank" rel="noopener noreferrer">
            模型作者：polyman<span className="pt-sr">（新标签页打开）</span>
          </a>
          <a className="pt-btn" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">
            CC BY 4.0<span className="pt-sr">（新标签页打开）</span>
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * 组织架构。称号与部门都是数据（在控制台改名字、图标、色调和说明），这里只按称号 id 摆位置：
 * admin → captain 的直属链、每个部门一张卡片（卡片上是 head 称号）、member 一行、alumni 与 guest 在底部。
 * 数据没到之前显示默认值，见 lib/org.ts。
 */
export function OrgChart() {
  const chart = orgChartModel(useOrg());
  return (
    <div className="pt-orgc">
      <ol className="pt-orgc-chain">
        {chart.chain.map((item) => (
          <li key={item.id}>
            <OrgChip badge={item} className="is-lead" size={14} />
            <small>{item.description}</small>
          </li>
        ))}
      </ol>
      {chart.departments.length > 0 && (
        <>
          <div className="pt-orgc-line" aria-hidden="true" />
          <div className="pt-orgc-depts">
            {chart.departments.map((dept) => (
              <article key={dept.id} style={{ ["--tint" as string]: dept.color }}>
                <header>
                  <Icon name={dept.icon} size={18} />
                  <b>{dept.name}</b>
                </header>
                <OrgChip badge={dept.head} size={12} />
                <p>{dept.description}</p>
              </article>
            ))}
          </div>
        </>
      )}
      <div className="pt-orgc-crew">
        <OrgChip badge={chart.crew} className="is-soft" size={13} />
        <small>{chart.crew.description}</small>
      </div>
      <div className="pt-orgc-foot">
        {chart.foot.map((item) => (
          <p key={item.id}>
            <OrgChip badge={item} className={item.id === "guest" ? "is-soft" : undefined} size={13} />
            <small>{item.description}</small>
          </p>
        ))}
      </div>
      <p className="pt-orgc-note">
        <Icon name="lock-line" size={13} /> 只有 GitHub 组织里的人能登录。称号显示在论坛和控制台；称号、部门和各自的权限都在控制台里设置，这张图跟着更新。
      </p>
    </div>
  );
}

function OrgChip({ badge, className, size }: { badge: OrgBadge; className?: string; size: number }) {
  return (
    <span className={className ? `pt-chip ${className}` : "pt-chip"} style={{ ["--c" as string]: badge.color }}>
      <Icon name={badge.icon} size={size} /> {badge.label}
    </span>
  );
}

function ForumFeed() {
  const snapshot = useForumSnapshot();
  const now = Date.now();
  if (snapshot.status === "loading") return <p className="pt-empty">正在读取论坛…</p>;
  if (snapshot.status === "error")
    return (
      <p className="pt-empty">
        论坛话题没加载出来。<a href={links.forumHome()}>直接进论坛首页</a>
      </p>
    );
  const { summary, latest } = snapshot.data;
  return (
    <div className="pt-feedwin">
      <div className="pt-feedwin-cats">
        {summary.categories.map((category) => (
          <a key={category.slug} href={links.forumCategory(category.slug)}>
            <i className="pt-dot" style={{ background: category.color }} />
            {category.name}
          </a>
        ))}
      </div>
      <div className="pt-feedwin-list">
        {latest.map((topic) => (
          <a key={topic.id} className="pt-feedwin-row" href={links.forumTopic(topic.id)} title={topic.title}>
            <i className="pt-dot" style={{ background: topic.color }} />
            <span className="pt-feed-title">{topic.title}</span>
            <span className="pt-feedwin-meta">
              {topic.category}
            </span>
            <span className="pt-feedwin-num">
              <Icon name="message-2-line" size={13} />
              {topic.replies}
            </span>
            <span className="pt-feedwin-num">
              <Icon name="eye-line" size={13} />
              {topic.views}
            </span>
            <span className="pt-feedwin-at">{agoLabel(topic.at, now)}</span>
          </a>
        ))}
      </div>
      <footer>
        <span>
          {summary.topics} 个话题 · {summary.users} 位用户
        </span>
        <span className="pt-row-btns">
          {/* 论坛应用已直达论坛首页（#185）；这里写明了要看 3D 版块，所以直接进 /forum-3d 场景页 */}
          <Link className="pt-btn" to="/forum-3d">
            <Icon name="sparkling-line" size={15} /> 3D 版块
          </Link>
          <a className="pt-btn is-primary" href={links.forumHome()}>
            <Icon name="external-link-line" size={15} /> 进入论坛首页
          </a>
        </span>
      </footer>
    </div>
  );
}

function Terminal({ onOpen, apps }: { onOpen: OpenApp; apps: readonly OsApp[] }) {
  const repos = useRepoSnapshot();
  const [lines, setLines] = useState<TerminalLine[]>([{ kind: "dim", text: "输入 help 查看命令" }]);
  const [value, setValue] = useState("");
  const history = useRef<string[]>([]);
  const cursor = useRef(0);
  const out = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    out.current?.scrollTo({ top: out.current.scrollHeight });
  }, [lines]);
  const run = (command: string) => {
    const result = runTerminal(command, repos.status === "ready" ? repos.data.repos : [], apps);
    setLines((current) => (result.clear ? [] : [...current, ...result.lines]));
    if (result.open) {
      const id = result.open;
      window.setTimeout(() => onOpen(id, input.current), 350);
    }
  };
  const render = (line: TerminalLine, index: number): ReactNode => {
    if (line.kind === "echo")
      return (
        <div key={index} className="is-echo">
          <b>nano@yugc:~$</b> {line.text}
        </div>
      );
    return (
      <div key={index} className={`is-${line.kind}`}>
        {line.key &&
          (line.href ? (
            <a className="pt-term-key" href={line.href} target="_blank" rel="noreferrer">
              {line.key}
            </a>
          ) : (
            <span className="pt-term-key">{line.key}</span>
          ))}
        {line.text}
      </div>
    );
  };
  return (
    <div className="pt-term" onPointerDown={() => window.setTimeout(() => input.current?.focus(), 0)}>
      <div className="pt-term-out" ref={out}>
        {lines.map(render)}
      </div>
      <label className="pt-term-in">
        <b>nano@yugc:~$</b>
        <input
          ref={input}
          value={value}
          spellCheck={false}
          autoComplete="off"
          aria-label="终端输入"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              history.current.push(value);
              cursor.current = history.current.length;
              run(value);
              setValue("");
            } else if (event.key === "ArrowUp" && cursor.current > 0) {
              cursor.current -= 1;
              setValue(history.current[cursor.current] ?? "");
              event.preventDefault();
            } else if (event.key === "ArrowDown") {
              cursor.current = Math.min(history.current.length, cursor.current + 1);
              setValue(history.current[cursor.current] ?? "");
            }
            if (!((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") && event.key !== "Escape") event.stopPropagation();
          }}
        />
      </label>
      <p className="pt-sr">可用命令：{apps.map((app) => app.id).join("、")}</p>
    </div>
  );
}
