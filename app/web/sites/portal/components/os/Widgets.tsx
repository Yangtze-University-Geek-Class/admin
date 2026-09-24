// YUGC OS 桌面上的组件卡片：论坛最新、公开仓库、组织架构、招新状态、终端预览、日历时钟。
// 每张卡片都是 grid 子项（min-width: 0），长文本一律单行省略；论坛列表按卡片实际高度只渲染放得下的行，绝不溢出。
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { IconName } from "../../lib/icons";
import { links } from "../../lib/links";
import { OS_APPS, agoLabel, monthGrid, rowsThatFit, type AppId } from "../../lib/osApps";
import { useForumSnapshot, useRepoSnapshot } from "../../lib/snapshots";
import Icon from "../Icon";

type OpenApp = (id: AppId | "forum-feed", from?: HTMLElement | null) => void;

function Card({ id, icon, title, meta, action, className, children }: { id: string; icon: IconName; title: string; meta?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={className ? `pt-card ${className}` : "pt-card"} aria-labelledby={`${id}-title`}>
      <header className="pt-card-head">
        <span className="pt-card-icon">
          <Icon name={icon} size={15} />
        </span>
        <h2 id={`${id}-title`}>{title}</h2>
        {meta && <span className="pt-card-meta">{meta}</span>}
        {action}
      </header>
      {children}
    </section>
  );
}

/** 按容器高度算出能放下几行（ResizeObserver），卡片随窗口缩放时自动增减行数 */
function useFitRows(rowH: number, gap: number, max: number) {
  const ref = useRef<HTMLOListElement | HTMLUListElement>(null);
  const [rows, setRows] = useState(max);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setRows(Math.min(max, rowsThatFit(el.clientHeight, rowH, gap)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [rowH, gap, max]);
  return { ref, rows };
}

export function ForumWidget({ onOpen }: { onOpen: OpenApp }) {
  const snapshot = useForumSnapshot();
  const topics = snapshot.status === "ready" ? snapshot.data.latest : [];
  // 构建时只收录少量公开话题；放不满时用同样行高的版块入口补齐，卡片里不留大块空白
  const categories = snapshot.status === "ready" ? snapshot.data.summary.categories : [];
  const { ref, rows } = useFitRows(38, 2, topics.length + categories.length || 8);
  const categoryRows = categories.slice(0, Math.max(0, rows - topics.length));
  const listRef = ref as React.RefObject<HTMLOListElement>;
  const now = Date.now();
  return (
    <Card
      id="w-forum"
      className="pt-w-forum"
      icon="fire-line"
      title="论坛最新"
      action={
        <button type="button" className="pt-card-link" onClick={(event) => onOpen("forum-feed", event.currentTarget)}>
          全部 <Icon name="arrow-right-s-line" size={14} />
        </button>
      }
    >
      <ol className="pt-feed" ref={listRef}>
        {snapshot.status === "loading" && <li className="pt-empty">正在读取论坛…</li>}
        {snapshot.status === "error" && <li className="pt-empty">论坛话题没加载出来，可以直接进论坛首页看。</li>}
        {topics.slice(0, rows).map((topic) => (
          <li key={topic.id}>
            <a href={links.forumTopic(topic.id)} title={topic.title}>
              <i className="pt-dot" style={{ background: topic.color }} />
              <span className="pt-feed-title">{topic.title}</span>
              <span className="pt-feed-cat">{topic.category}</span>
              <span className="pt-feed-at">{agoLabel(topic.at, now)}</span>
            </a>
          </li>
        ))}
        {categoryRows.map((category) => (
          <li key={`c:${category.slug}`}>
            <a href={links.forumCategory(category.slug)} title={`${category.name} 版块`}>
              <i className="pt-dot is-round" style={{ background: category.color }} />
              <span className="pt-feed-title">{category.name}</span>
              <span className="pt-feed-cat">版块</span>
              <span className="pt-feed-at">
                <Icon name="arrow-right-s-line" size={13} />
              </span>
            </a>
          </li>
        ))}
      </ol>
      <footer className="pt-card-foot">
        <span>{snapshot.status === "ready" ? `${snapshot.data.summary.topics} 个话题 · ${snapshot.data.summary.users} 位用户` : "论坛"}</span>
        <a className="pt-card-link" href={links.forumHome()}>
          进入论坛首页 <Icon name="external-link-line" size={13} />
        </a>
      </footer>
    </Card>
  );
}

const LANG_COLOR: Record<string, string> = { Rust: "#dea584", TypeScript: "#3178c6", JavaScript: "#e0c43a", Python: "#3572a5", Vue: "#41b883", Go: "#00add8" };

export function ReposWidget({ onOpen }: { onOpen: OpenApp }) {
  const snapshot = useRepoSnapshot();
  const repos = snapshot.status === "ready" ? snapshot.data.repos : [];
  const { ref, rows } = useFitRows(62, 6, 4);
  const now = Date.now();
  return (
    <Card id="w-repos" className="pt-w-repos" icon="git-repository-line" title="公开仓库">
      <ul className="pt-repos" ref={ref as React.RefObject<HTMLUListElement>}>
        {snapshot.status === "error" && <li className="pt-empty">仓库列表没加载出来，可以直接打开 GitHub 组织看。</li>}
        {repos.slice(0, Math.max(1, rows)).map((repo) => (
          <li key={repo.name}>
            <a href={repo.url} target="_blank" rel="noreferrer">
              <span className="pt-repo-name">
                <Icon name="git-repository-line" size={14} />
                <b>{repo.name}</b>
              </span>
              <span className="pt-repo-desc">{repo.description ?? "没有简介"}</span>
              <span className="pt-repo-meta">
                <i className="pt-dot is-round" style={{ background: repo.language ? LANG_COLOR[repo.language] ?? "#8a91b0" : "#c8ccd9" }} />
                {repo.language ?? "—"}
                <span>·</span>
                <Icon name="history-line" size={12} />
                推送于 {agoLabel(Date.parse(repo.pushed), now)}
                <span>·</span>
                <Icon name="star-line" size={12} />
                {repo.stars}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <footer className="pt-card-foot">
        <button type="button" className="pt-card-link" onClick={(event) => onOpen("github", event.currentTarget)}>
          <Icon name="sparkling-line" size={13} /> 3D 场景
        </button>
        <a className="pt-card-link" href={links.githubOrg()} target="_blank" rel="noreferrer">
          打开 GitHub 组织 <Icon name="external-link-line" size={13} />
        </a>
      </footer>
    </Card>
  );
}

export const DEPARTMENTS: ReadonlyArray<{ name: string; icon: IconName; does: string; tint: string }> = [
  // 部门与职责来自服务端 app/server/src/lib/roles.ts 的 DEFAULT_DEPARTMENTS
  { name: "招新部", icon: "user-add-line", does: "招新和面试", tint: "#3346c8" },
  { name: "技术部", icon: "code-s-slash-line", does: "仓库和基础设施", tint: "#5b5fd6" },
  { name: "社区部", icon: "discuss-line", does: "论坛和意见箱", tint: "#128a7e" },
  { name: "项目部", icon: "git-repository-line", does: "项目立项和展示", tint: "#a16207" },
];

export function OrgWidget({ onOpen }: { onOpen: OpenApp }) {
  const open = (event: React.MouseEvent<HTMLButtonElement>) => onOpen("org", event.currentTarget);
  return (
    <Card id="w-org" className="pt-w-org" icon="organization-chart" title="组织架构" meta="班长 · 四个部门 · 领航员" action={<button type="button" className="pt-card-link" onClick={open}>展开 <Icon name="arrow-right-s-line" size={14} /></button>}>
      <div className="pt-orgmini">
        <div className="pt-orgmini-top">
          <button type="button" className="pt-chip is-lead" style={{ ["--c" as string]: "#a8740a" }} onClick={open}>
            <Icon name="vip-crown-line" size={13} /> 班长
          </button>
          <small>总负责人</small>
          <span className="pt-orgmini-spacer" />
          <button type="button" className="pt-chip is-soft" style={{ ["--c" as string]: "#3346c8" }} onClick={open}>
            <Icon name="user-line" size={13} /> 极客班成员
          </button>
          <button type="button" className="pt-chip is-soft" style={{ ["--c" as string]: "#0f766e" }} onClick={open} title="已毕业的学长学姐">
            <Icon name="compass-3-line" size={13} /> 领航员
          </button>
        </div>
        <div className="pt-orgmini-depts">
          {DEPARTMENTS.map((dept) => (
            <button key={dept.name} type="button" className="pt-orgmini-dept" style={{ ["--tint" as string]: dept.tint }} onClick={open} title={`${dept.name}：${dept.does}`}>
              <span className="pt-orgmini-ico">
                <Icon name={dept.icon} size={16} />
              </span>
              <b>{dept.name}</b>
              <small>{dept.does}</small>
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function RecruitWidget({ onOpen }: { onOpen: OpenApp }) {
  return (
    <section className="pt-card pt-w-recruit" aria-labelledby="w-recruit-title">
      <h2 id="w-recruit-title">
        <i className="pt-recruit-dot" aria-hidden="true" />
        我们正在招人
      </h2>
      <ol className="pt-steps">
        <li>
          <b>1</b>
          <span>写一封信</span>
          <small>姓名、班级、邮箱和你会什么</small>
        </li>
        <li>
          <b>2</b>
          <span>招新部看信</span>
          <small>网站上查不到进度，留意邮箱</small>
        </li>
        <li>
          <b>3</b>
          <span>邮件联系你</span>
          <small>合适的话约时间面试</small>
        </li>
      </ol>
      <button type="button" className="pt-btn is-primary" onClick={(event) => onOpen("join", event.currentTarget)}>
        <Icon name="mail-send-line" size={17} /> 加入我们 <kbd>1</kbd>
      </button>
    </section>
  );
}

export function TerminalWidget({ onOpen }: { onOpen: OpenApp }) {
  return (
    <Card id="w-term" className="pt-w-term" icon="terminal-box-line" title="终端" meta="zsh">
      <button type="button" className="pt-termmini" onClick={(event) => onOpen("terminal", event.currentTarget)} aria-label="打开终端">
        <span>
          <b>nano@yugc:~$</b> ls
        </span>
        <span>{OS_APPS.map((app) => app.id).join("  ")}</span>
        <span>
          <b>nano@yugc:~$</b> help
        </span>
        <span className="is-dim">ls · open · ./join · repos · whoami · clear</span>
        <span>
          <b>nano@yugc:~$</b> <i className="pt-caret" aria-hidden="true" />
        </span>
      </button>
      <footer className="pt-card-foot">
        <span>
          <kbd>⌘</kbd>
          <kbd>K</kbd> 搜索应用和命令
        </span>
      </footer>
    </Card>
  );
}

const WEEK = ["一", "二", "三", "四", "五", "六", "日"];

export function ClockWidget({ now }: { now: Date }) {
  const cells = monthGrid(now.getFullYear(), now.getMonth());
  const today = now.getDate();
  const time = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <section className="pt-card pt-w-clock" aria-label="日历与时间">
      <div className="pt-clock">
        <time className="pt-clock-time" dateTime={now.toISOString()}>
          {time}
        </time>
        <p className="pt-clock-date">
          {now.getMonth() + 1} 月 {today} 日 · 星期{WEEK[(now.getDay() + 6) % 7]}
        </p>
        <p className="pt-clock-note">
          <Icon name="time-line" size={13} /> 本机时间
        </p>
      </div>
      <div className="pt-cal" role="grid" aria-label={`${now.getFullYear()} 年 ${now.getMonth() + 1} 月`}>
        <div className="pt-cal-row is-head" role="row">
          {WEEK.map((day) => (
            <span key={day} role="columnheader">
              {day}
            </span>
          ))}
        </div>
        {Array.from({ length: cells.length / 7 }, (_, row) => (
          <div className="pt-cal-row" role="row" key={row}>
            {cells.slice(row * 7, row * 7 + 7).map((day, index) => (
              <span key={index} role="gridcell" className={day === today ? "is-today" : undefined} aria-current={day === today ? "date" : undefined}>
                {day ?? ""}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
