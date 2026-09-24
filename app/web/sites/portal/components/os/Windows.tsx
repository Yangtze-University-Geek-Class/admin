// YUGC OS 的窗口：可拖动、最小化、放大、关闭、聚焦；内容有「关于」「组织架构」「论坛最新」「终端」四种。
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { appConfig } from "@shared/config";
import { links } from "../../lib/links";
import { agoLabel, OS_APPS, runTerminal, type AppId, type TerminalLine } from "../../lib/osApps";
import { useForumSnapshot, useRepoSnapshot } from "../../lib/snapshots";
import Icon from "../Icon";
import { DEPARTMENTS } from "./Widgets";

export type WindowId = "about" | "org" | "terminal" | "forum-feed";
export type WindowState = { id: WindowId; z: number; x: number; y: number; minimized: boolean; zoomed: boolean };

type OpenApp = (id: AppId | "forum-feed", from?: HTMLElement | null) => void;

const META: Record<WindowId, { title: string; icon: "book-2-line" | "organization-chart" | "terminal-box-line" | "fire-line"; width: number; path: string }> = {
  about: { title: "关于极客班", icon: "book-2-line", width: 640, path: "~/yugc/about" },
  org: { title: "组织架构", icon: "organization-chart", width: 760, path: "~/yugc/org" },
  terminal: { title: "nano@yugc — zsh", icon: "terminal-box-line", width: 640, path: "~/yugc" },
  "forum-feed": { title: "论坛 · 最新", icon: "fire-line", width: 780, path: "~/yugc/forum" },
};

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
};

export default function OsWindow({ win, front, onFocus, onClose, onMinimize, onZoom, onMove, onOpen }: Props) {
  const meta = META[win.id];
  const ref = useRef<HTMLElement>(null);
  const width = Math.min(meta.width, window.innerWidth - 24);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, a, button:not(.pt-win-lights button)")?.focus({ preventScroll: true });
  }, []);

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button") || win.zoomed) return;
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
    <section
      ref={ref}
      className={cls}
      role="dialog"
      aria-label={meta.title}
      hidden={win.minimized}
      style={{ left: win.x, top: win.y, width, zIndex: win.z }}
      onPointerDown={onFocus}
    >
      <header className="pt-win-bar" onPointerDown={startDrag} onDoubleClick={onZoom}>
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
        <b>
          <Icon name={meta.icon} size={14} /> {meta.title}
        </b>
        <span className="pt-win-path">{meta.path}</span>
      </header>
      <div className="pt-win-body">
        {win.id === "about" && <About onOpen={onOpen} />}
        {win.id === "org" && <OrgChart />}
        {win.id === "forum-feed" && <ForumFeed onOpen={onOpen} />}
        {win.id === "terminal" && <Terminal onOpen={onOpen} />}
      </div>
    </section>
  );
}

function About({ onOpen }: { onOpen: OpenApp }) {
  const { brand } = appConfig.portal;
  return (
    <div className="pt-about">
      <img src={brand.logo} alt="长江大学计算机科学学院极客班徽标" width={112} height={112} />
      <div>
        <h3>{brand.title}</h3>
        <p>极客班在长江大学计算机科学学院。在读的同学是成员，毕业的学长学姐是领航员。大家在论坛讨论课程、竞赛和求职，代码放在 GitHub 组织里。</p>
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
            <dd>班长总负责，下面分招新、技术、社区、项目四个部门</dd>
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
      </div>
    </div>
  );
}

function OrgChart() {
  return (
    <div className="pt-orgc">
      <div className="pt-orgc-top">
        <span className="pt-chip is-lead" style={{ ["--c" as string]: "#a8740a" }}>
          <Icon name="vip-crown-line" size={14} /> 班长
        </span>
        <small>总负责人，控制台里拥有全部权限</small>
      </div>
      <div className="pt-orgc-line" aria-hidden="true" />
      <div className="pt-orgc-depts">
        {DEPARTMENTS.map((dept) => (
          <article key={dept.name} style={{ ["--tint" as string]: dept.tint }}>
            <header>
              <Icon name={dept.icon} size={18} />
              <b>{dept.name}</b>
            </header>
            <span className="pt-chip" style={{ ["--c" as string]: dept.tint }}>
              负责人
            </span>
            <span className="pt-chip is-soft" style={{ ["--c" as string]: dept.tint }}>
              干事
            </span>
            <p>{dept.does}</p>
          </article>
        ))}
      </div>
      <div className="pt-orgc-foot">
        <span className="pt-chip is-soft" style={{ ["--c" as string]: "#3346c8" }}>
          <Icon name="user-line" size={13} /> 极客班成员
        </span>
        <span className="pt-chip" style={{ ["--c" as string]: "#0f766e" }}>
          <Icon name="compass-3-line" size={13} /> 领航员
        </span>
        <small>已毕业的学长学姐</small>
      </div>
      <p className="pt-orgc-note">
        <Icon name="lock-line" size={13} /> 称号会显示在论坛和控制台。控制台按称号和部门分权限；涉及 GitHub 的操作，还要看你在 GitHub 组织里的角色。
      </p>
    </div>
  );
}

function ForumFeed({ onOpen }: { onOpen: OpenApp }) {
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
          <button type="button" className="pt-btn" onClick={(e) => onOpen("forum", e.currentTarget)}>
            <Icon name="sparkling-line" size={15} /> 3D 版块
          </button>
          <a className="pt-btn is-primary" href={links.forumHome()}>
            <Icon name="external-link-line" size={15} /> 进入论坛首页
          </a>
        </span>
      </footer>
    </div>
  );
}

function Terminal({ onOpen }: { onOpen: OpenApp }) {
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
    const result = runTerminal(command, repos.status === "ready" ? repos.data.repos : []);
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
      <p className="pt-sr">可用命令：{OS_APPS.map((app) => app.id).join("、")}</p>
    </div>
  );
}
