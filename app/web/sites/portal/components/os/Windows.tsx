// YUGC OS 的窗口：可拖动、最小化、放大、关闭、聚焦；内容有「加入我们」「宣传片」「关于」「组织架构」「论坛最新」「终端」「比赛」「代码仓库」「意见箱」「账号资料」十种。
// 宣传片（#284）是单独的一个窗口，正文是 PromoLazy.tsx 的播放器；最小化、关闭、放大、手机上的底部面板都走这里同一套窗口外框。
// 账号资料（#280）由菜单栏头像打开，正文在 ProfileCard.tsx；它不是桌面应用，不在 Dock 和启动器里。
// 比赛窗口的内容在 competitions/（#265）：它在手机详情页会借标题栏左边的返回键回列表（PhoneNav）。
// 意见箱、加入我们、终端窗口的内容在 FeedbackBox.tsx、JoinBox.tsx、Terminal.tsx，打开时才加载：防刷验证、表单样式和终端的模拟 Linux（#279）不进桌面首屏。
import type { LinkNotice } from "../../lib/linkNotice";
import { Suspense, lazy, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router-dom";
import { appConfig } from "@shared/config";
import type { Account } from "../../lib/account";
import { links } from "../../lib/links";
import { useCodeRepos } from "../../lib/codeRepos";
import { useDepartments } from "../../lib/departments";
import { NEW_TAB_NOTE, agoLabel, type AppId, type OsApp } from "../../lib/osApps";
import WindowLoadFailed from "./WindowLoadFailed";
import { promoWidth } from "../../lib/promoWindow";
import { useForumSnapshot } from "../../lib/snapshots";
import CompetitionsApp, { type PhoneNav } from "./competitions/CompetitionsApp";
import ProfileCard from "./ProfileCard";
import Icon from "../Icon";
import { LazyPromoPlayer } from "../PromoLazy";
import type { PromoEnd } from "../PromoPlayer";

export type WindowId = "join" | "promo" | "about" | "org" | "terminal" | "forum-feed" | "competitions" | "gitlab" | "feedback" | "profile";
export type WindowState = { id: WindowId; z: number; x: number; y: number; minimized: boolean; zoomed: boolean };

export type OpenApp = (id: AppId | "forum-feed", from?: HTMLElement | null) => void;

const META: Record<WindowId, { title: string; width: number }> = {
  join: { title: "加入我们", width: 640 },
  // 宽度按屏幕高度算（promoWidth），这里是电脑上的上限
  promo: { title: "宣传片", width: 860 },
  about: { title: "关于极客班", width: 640 },
  org: { title: "组织架构", width: 760 },
  terminal: { title: "终端", width: 680 },
  "forum-feed": { title: "论坛 · 最新", width: 780 },
  competitions: { title: "比赛", width: 1100 },
  gitlab: { title: "代码仓库", width: 720 },
  feedback: { title: "意见箱", width: 860 },
  profile: { title: "账号资料", width: 560 },
};

/** 宣传片窗口里播放器的回调（YugcOs 里决定写不写「看过」的 cookie、播完关窗口） */
export type PromoActions = {
  onSeen?: () => void;
  onEnd: (reason: PromoEnd) => void;
};
const NO_END = () => undefined;

/** 账号资料窗口要用的登录状态操作（YugcOs 里的 useAccount） */
export type ProfileActions = {
  signInLink: string;
  onPatch: (change: Partial<Account>) => void;
  onReload: () => void;
  onSignOut: () => void;
  /** 从 Google 绑定回来时地址上带的结果（lib/linkNotice.ts），显示在登录方式下面 */
  linkNotice?: LinkNotice | null;
};

const FeedbackBox = lazy(() => import("./FeedbackBox"));
const JoinBox = lazy(() => import("./JoinBox"));
const Terminal = lazy(() => import("./Terminal"));

export function windowWidth(id: WindowId): number {
  return id === "promo" ? promoWidth({ width: window.innerWidth, height: window.innerHeight }) : META[id].width;
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
  /** 桌面读到的登录者：比赛窗口用它决定要不要读「我的参赛」、在队伍与天梯里认出「我」（#239）。 */
  account?: Account | null;
  accountLoaded?: boolean;
  profile?: ProfileActions;
  /** 招新总开关（#284）：桌面读到的状态，「关于」窗口据此不再叫人去写信；「加入我们」窗口每次打开重读开关，读到就用 onApplyOpen 报回桌面。 */
  applyOpen?: boolean;
  onApplyOpen?: (open: boolean) => void;
  /** 「加入我们」窗口在这个浏览器第一次打开时请桌面自动弹出宣传片窗口（#77，条件见 lib/promoWindow.ts 的 promoEntry） */
  onAutoPromo?: () => void;
  promo?: PromoActions;
};

export default function OsWindow({ win, front, onFocus, onClose, onMinimize, onZoom, onMove, onOpen, apps, phone = false, account = null, accountLoaded = true, profile, applyOpen = true, onApplyOpen, onAutoPromo, promo }: Props) {
  // 没登录时账号资料窗口里只有登录、注册，窗口名也跟着说「登录极客班」
  const meta = win.id === "profile" && !account ? { ...META.profile, title: "登录极客班" } : META[win.id];
  const ref = useRef<HTMLElement>(null);
  const width = Math.min(windowWidth(win.id), window.innerWidth - 24);
  /** 手机上应用自己的上一级（比赛详情回列表）；没有时返回键回主屏幕。 */
  const [phoneNav, setPhoneNav] = useState<PhoneNav | null>(null);
  /** 终端把标题换成「用户@yugc: 目录」，读屏仍念窗口名 */
  const [title, setTitle] = useState<string | null>(null);

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
      // 带 data-no-autofocus 的输入框不抢焦点（手机上的比赛搜索框，一打开就弹键盘不友好）
      const target = ref.current?.querySelector<HTMLElement>("input:not([data-no-autofocus])") ?? ref.current?.querySelector<HTMLElement>("a, button:not(.pt-win-lights button)");
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
        style={{ left: win.x, top: win.y, width, zIndex: win.z, ["--win-y" as string]: `${win.y}px` }}
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
            <button type="button" className="pt-phone-back" aria-label={phoneNav?.backLabel ?? "返回主屏幕"} onClick={phoneNav?.onBack ?? onMinimize}>
              <Icon name="arrow-left-line" size={18} />
              <span>{phoneNav?.backText ?? "主屏幕"}</span>
            </button>
          ) : (
            // 三颗糖果珠，图标一直显示，每个按钮的点击区域是 44×44（styles/os.css 的 .pt-win-lights）；放大后第三颗变成「还原」
            <span className="pt-win-lights">
              <button type="button" aria-label="关闭" title="关闭" onClick={onClose}>
                <i>
                  <Icon name="close-line" size={14} />
                </i>
              </button>
              <button type="button" aria-label="最小化" title="最小化" onClick={onMinimize}>
                <i>
                  <Icon name="subtract-line" size={14} />
                </i>
              </button>
              <button type="button" aria-label={win.zoomed ? "还原" : "放大"} title={win.zoomed ? "还原" : "放大"} onClick={onZoom}>
                <i>
                  <Icon name={win.zoomed ? "fullscreen-exit-line" : "fullscreen-line"} size={12} />
                </i>
              </button>
            </span>
          )}
          <b>{title ?? meta.title}</b>
          {phone ? (
            <button type="button" className="pt-phone-close" aria-label="关闭应用" onClick={onClose}>
              <Icon name="close-line" size={18} />
            </button>
          ) : (
            // 和左边三个圆点一样宽，标题才在标题栏正中
            <span aria-hidden="true" />
          )}
        </header>
        <div className={win.id === "competitions" ? "pt-win-body is-flush" : win.id === "promo" ? "pt-win-body is-flush is-promo" : "pt-win-body"}>
          {win.id === "join" && (
            <WindowLoadFailed>
              <Suspense fallback={<p className="pt-empty">正在打开信纸…</p>}>
                <JoinBox onOpen={onOpen} onApplyOpen={onApplyOpen} onAutoPromo={onAutoPromo} />
              </Suspense>
            </WindowLoadFailed>
          )}
          {/* 窗口收起（最小化；手机上被别的窗口盖住）时 active 为 false：播放器暂停，露出来接着播；关掉窗口播放器卸载，停止播放并释放片源 */}
          {win.id === "promo" && <LazyPromoPlayer active={!win.minimized && (!phone || front)} onSeen={promo?.onSeen} onEnd={promo?.onEnd ?? NO_END} />}
          {win.id === "about" && <About onOpen={onOpen} applyOpen={applyOpen} />}
          {win.id === "org" && <OrgChart />}
          {win.id === "forum-feed" && <ForumFeed />}
          {win.id === "profile" && profile && <ProfileCard account={account} {...profile} />}
          {win.id === "competitions" && <CompetitionsApp phone={phone} onPhoneNav={setPhoneNav} account={account} accountLoaded={accountLoaded} />}
          {win.id === "terminal" && (
            <Suspense fallback={<p className="pt-empty">正在打开终端…</p>}>
              <Terminal onOpen={onOpen} onClose={onClose} onTitle={setTitle} apps={apps} account={account} />
            </Suspense>
          )}
          {win.id === "gitlab" && <CodeRepos />}
          {win.id === "feedback" && (
            <Suspense fallback={<p className="pt-empty">正在打开意见箱…</p>}>
              <FeedbackBox />
            </Suspense>
          )}
        </div>
      </section>
    </>
  );
}

function About({ onOpen, applyOpen }: { onOpen: OpenApp; applyOpen: boolean }) {
  const { brand } = appConfig.portal;
  const departments = useDepartments().filter((department) => department.titles.length > 0);
  // 称号名字在控制台改，这里照数据说，不写死（tests/web/portal-org-window.test.tsx 扫源码）
  const titleNames = [...new Set(departments.flatMap((department) => department.titles.map((title) => title.name)))];
  return (
    <div className="pt-about">
      <img src={brand.logo} alt="长江大学计算机科学学院极客班徽标" width={112} height={112} />
      <div>
        <h3>{brand.title}</h3>
        <p>极客班在长江大学计算机科学学院。大家在论坛讨论课程、竞赛和求职，代码放在极客班自己的代码仓库里。</p>
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
            <dd>{departments.length ? `分成${departments.map((department) => department.name).join("、")}，每个部门有${titleNames.join("、")}` : "按部门分工"}</dd>
          </div>
          <div>
            <dt>
              <Icon name="mail-line" size={15} />
              怎么加入
            </dt>
            <dd>{applyOpen ? "注册极客班账号，在「加入我们」写封信，我们用邮件联系你" : "现在不招新"}</dd>
          </div>
        </dl>
        <div className="pt-row-btns">
          {applyOpen && (
            <button type="button" className="pt-btn is-primary" onClick={(e) => onOpen("join", e.currentTarget)}>
              <Icon name="mail-send-line" size={16} /> 加入我们
            </button>
          )}
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

/**
 * 组织架构：AI、算法、硬件、网安、管理五个部门和「无部门」，每个部门一张卡片，底色是它的部门色（SPEC §1），
 * 卡片上按权重列出称号。名字、图标、部门色、说明和称号都在控制台改，数据没到之前显示默认值（lib/departments.ts）。
 */
export function OrgChart() {
  const departments = useDepartments();
  return (
    <div className="pt-orgc">
      <ul className="pt-orgc-depts" aria-label="部门">
        {departments.map((department) => (
          <li key={department.id} data-tone={department.tone}>
            <span className="pt-orgc-icon" aria-hidden="true">
              <Icon name={department.icon} size={24} />
            </span>
            <h3>{department.name}</h3>
            {department.description && <p>{department.description}</p>}
            {department.titles.length > 0 && (
              <ul className="pt-orgc-titles" aria-label={`${department.name}的称号`}>
                {department.titles.map((title) => (
                  <li key={title.id}>{title.name}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <p className="pt-orgc-note">
        <Icon name="lock-line" size={13} /> 注册后是注册用户，填邀请码成为极客班成员；部门和称号由管理员在控制台里分，资料卡上能看到自己的。
      </p>
    </div>
  );
}

/** 代码仓库：自建 GitLab 上的公开项目（#274 的 GET /api/public/gitlab/projects），点项目在新标签页打开；GitLab 连不上时照实说 */
export function CodeRepos() {
  const repos = useCodeRepos();
  const now = Date.now();
  const gitlab = links.gitlab();
  return (
    <div className="pt-repos">
      {repos.status === "loading" && <p className="pt-empty">正在读取公开项目…</p>}
      {repos.status === "error" && <p className="pt-empty">公开项目没加载出来，可以直接去代码仓库看。</p>}
      {repos.status === "unavailable" && <p className="pt-empty">代码仓库暂时连不上，稍后再试，或者直接去代码仓库看。</p>}
      {repos.status === "ready" && repos.projects.length === 0 && <p className="pt-empty">还没有公开的项目。成员登录代码仓库后能看到全部项目。</p>}
      {repos.status === "ready" && repos.projects.length > 0 && (
        <ul className="pt-repos-list" aria-label="公开项目">
          {repos.projects.map((project) => (
            <li key={project.path}>
              <a href={project.url} target="_blank" rel="noopener noreferrer">
                <Icon name="git-repository-line" size={18} />
                <span>
                  <b>{project.name}</b>
                  <small>{project.description || project.path}</small>
                </span>
                {project.activeAt !== null && <time dateTime={new Date(project.activeAt).toISOString()}>{agoLabel(project.activeAt, now)}</time>}
                <span className="pt-sr">{NEW_TAB_NOTE}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <footer>
        <span>极客班自己的 GitLab，成员用极客班账号登录</span>
        <a className="pt-btn is-primary" href={gitlab} target="_blank" rel="noopener noreferrer">
          <Icon name="gitlab-line" size={16} /> 打开代码仓库
          <span className="pt-sr">{NEW_TAB_NOTE}</span>
        </a>
      </footer>
    </div>
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
