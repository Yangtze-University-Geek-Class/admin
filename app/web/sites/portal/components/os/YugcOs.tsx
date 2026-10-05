// YUGC OS：开机后的「极客班内部系统」，按桌面操作系统来排：菜单栏（系统菜单 / 前台应用 / 搜索 / 时钟）、
// 极客娘壁纸、左上角一列应用图标、右上角「新来的看这里」便签、可拖动窗口、带名字的 Dock、⌘K 启动器。
// 加入我们、论坛、GitHub 组织都是桌面上的应用；便签按顺序告诉新来的人怎么加入。「宣传片」在桌面上重看（#77），不影响「只自动播一次」。
// 论坛和 GitHub 组织点一下直达（#185）：论坛在当前标签页进论坛首页，GitHub 组织在新标签页打开，不经过 /forum-3d、/github 场景页。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { appConfig } from "@shared/config";
import Modal from "@shared/ui/Modal";
import { PHONE_QUERY, PORTRAIT_QUERY, useMediaQuery } from "../../lib/useMediaQuery";
import { signInHref, useAccount } from "../../lib/account";
import { RESUME_DESKTOP, links } from "../../lib/links";
import { NEW_TAB_NOTE, appById, appByKey, appLink, filterCommands, followAppLink, launcherCommands, moveSelection, opensNewTab, visibleApps, type AppId, type OsApp } from "../../lib/osApps";
import { browserEstimate, choosePlayback, detectCapabilities, hasSeenPromo, preconnectPromo, prefetchPromoStart } from "../../lib/promo";
import Icon from "../Icon";
import OsWindow, { windowWidth, type WindowId, type WindowState } from "./Windows";
import { WALLPAPERS, prefetchWallpapersWhenIdle, readWallpaperChoice, saveWallpaperChoice, wallpaperForScreen, type Box, type Wallpaper } from "../../lib/wallpapers";
import WallpaperLayer from "./Wallpaper";
import { AppGlyph, DesktopIcons, StartNote } from "./Widgets";
import { LazyPromoPlayer } from "../PromoLazy";


type Props = {
  /** 桌面是否在前台（开机画面播完）；为 false 时不响应快捷键 */
  active: boolean;
  onBack: () => void;
};

type MenuName = "system" | "go" | "window" | "help" | "account";

const NOTE_KEY = "yugc:start-note";

export default function YugcOs({ active, onBack }: Props) {
  const phone = useMediaQuery(PHONE_QUERY);
  const portrait = useMediaQuery(PORTRAIT_QUERY);
  const phoneWallpaper = phone && portrait;
  const navigate = useNavigate();
  const { account, loaded, signOut } = useAccount();
  // 控制台只给 console_link 为 true 的人：其他人的桌面、Dock、菜单、启动器、终端里都没有它。
  const consoleLink = account?.consoleLink === true;
  const apps = useMemo(() => visibleApps(consoleLink), [consoleLink]);
  const [now, setNow] = useState(() => new Date());
  const [wins, setWins] = useState<WindowState[]>([]);
  const [menu, setMenu] = useState<{ name: MenuName; left: number } | null>(null);
  const [launcher, setLauncher] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [flight, setFlight] = useState<{ app: OsApp; x: number; y: number } | null>(null);
  const [selectedIcon, setSelectedIcon] = useState<AppId | null>(null);
  // 便签收起后本次浏览不再自动出现（菜单栏「帮助」里能重新打开）
  const [note, setNote] = useState(() => {
    try {
      return sessionStorage.getItem(NOTE_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  const [wallpaper, setWallpaper] = useState<Wallpaper>(() => readWallpaperChoice());
  // 新壁纸从点的那张缩略图展开（#147）
  const [wallpaperFrom, setWallpaperFrom] = useState<Box | null>(null);
  const [picker, setPicker] = useState(false);
  const [promo, setPromo] = useState(false);
  const [phoneGuide, setPhoneGuide] = useState(false);
  const [phoneSettings, setPhoneSettings] = useState(false);
  const searchFocus = useRef<HTMLButtonElement>(null);
  const swipe = useRef<{ x: number; y: number; at: number } | null>(null);
  const wallpaperFocus = useRef<HTMLButtonElement>(null);
  const pickerBox = useRef<HTMLDivElement>(null);
  /** 当前标签页去了论坛或控制台，离开前在历史记录上记了「回来直接进桌面」 */
  const leftForSite = useRef(false);
  // 打开面板时把焦点放到当前壁纸上；preventScroll：autoFocus 会让浏览器滚动整个桌面去「露出」按钮，桌面整体上移
  useEffect(() => {
    if (picker) pickerBox.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  }, [picker]);
  const chooseWallpaper = (next: Wallpaper, button: HTMLElement) => {
    const { left, top, width, height } = (button.querySelector("img") ?? button).getBoundingClientRect();
    setWallpaperFrom({ left, top, width, height });
    setWallpaper(next);
    saveWallpaperChoice(next.id);
  };
  // 桌面空闲后预取其余壁纸，之后换壁纸不用等下载；开了省流量或 2G 时不预取（lib/wallpapers.ts）
  const wallpaperId = useRef(wallpaper.id);
  wallpaperId.current = wallpaper.id;
  useEffect(() => (active ? prefetchWallpapersWhenIdle(wallpaperId.current, phoneWallpaper) : undefined), [active, phoneWallpaper]);
  const toggleNote = (show: boolean) => {
    setNote(show);
    try {
      sessionStorage.setItem(NOTE_KEY, show ? "open" : "closed");
    } catch {
      /* 隐私模式下写不了：只影响刷新后是否再次显示 */
    }
  };
  const zTop = useRef(20);
  const cascade = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const launcherInput = useRef<HTMLInputElement>(null);
  const homeFocusNeeded = useRef(false);

  // 桌面变为可交互时（开机结束、跳过动画、从场景页返回），把焦点放进桌面：
  // 触发开机的按钮所在的书桌层此时已 inert，不移焦点的话键盘用户会落在 <body> 上。
  useEffect(() => {
    if (!active) return;
    const current = document.activeElement;
    if (current && current !== document.body && root.current?.contains(current)) return;
    root.current?.querySelector<HTMLElement>('[data-cta="join"]')?.focus({ preventScroll: true });
  }, [active]);

  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, [active]);

  const front = useMemo(() => wins.filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0] ?? null, [wins]);
  const frontName = front ? { about: "关于极客班", org: "组织架构", terminal: "终端", "forum-feed": "论坛" }[front.id] : "桌面";
  useEffect(() => {
    if (!homeFocusNeeded.current || front) return;
    homeFocusNeeded.current = false;
    root.current?.querySelector<HTMLElement>('[data-cta="join"]')?.focus({ preventScroll: true });
  }, [front, wins]);

  const openWindow = useCallback((id: WindowId) => {
    setWins((current) => {
      const existing = current.find((w) => w.id === id);
      const z = ++zTop.current;
      if (existing) return current.map((w) => (w.id === id ? { ...w, z, minimized: false } : w));
      const n = cascade.current++ % 4;
      const width = Math.min(windowWidth(id), window.innerWidth - 24);
      const x = Math.max(12, Math.min(window.innerWidth - width - 140, window.innerWidth * 0.3 + n * 40));
      const y = 64 + n * 36;
      return [...current, { id, z, x, y, minimized: false, zoomed: false }];
    });
  }, []);

  const launchScene = useCallback(
    (app: OsApp, from?: HTMLElement | null) => {
      if (app.open.kind !== "scene") return;
      const path = app.open.path;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        navigate(path);
        return;
      }
      const rect = from?.getBoundingClientRect();
      setFlight({ app, x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2, y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2 });
      window.setTimeout(() => navigate(path), 520);
    },
    [navigate],
  );

  const open = useCallback(
    (id: AppId | "forum-feed", from?: HTMLElement | null) => {
      setMenu(null);
      if (id === "forum-feed") return openWindow("forum-feed");
      const app = appById(id);
      if (!app) return;
      switch (app.open.kind) {
        case "window":
          return openWindow(app.id as WindowId);
        case "route":
          return navigate(app.open.path);
        case "site":
        case "external": {
          // 点下去当场打开，不播图标飞行：新标签页放进计时器里可能被当成弹窗拦掉；整页跳走后从论坛后退、
          // 页面从往返缓存恢复时，飞行图标也不会停在屏幕上
          const link = appLink(app);
          if (!link) return;
          // 当前标签页整页跳走（论坛、控制台）：先在这条历史记录上记下「回来直接进桌面」。浏览器没用往返缓存时，
          // 后退会重新加载首页，Home 读到它就跳过加载动画和书桌，和从场景页返回一样；用了往返缓存时由下面的 pageshow 清掉
          if (!link.newTab) {
            navigate(".", { replace: true, state: RESUME_DESKTOP });
            leftForSite.current = true;
          }
          followAppLink(link);
          return;
        }
        case "panel":
          if (app.open.panel === "promo") setPromo(true);
          else setPicker(true);
          return;
        case "scene":
          return launchScene(app, from);
      }
    },
    [launchScene, navigate, openWindow],
  );

  // 去论坛后从往返缓存回来：桌面原样还在，把离开前记下的「回来直接进桌面」清掉，之后刷新照常从书桌开始
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted || !leftForSite.current) return;
      leftForSite.current = false;
      navigate(".", { replace: true, state: null });
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [navigate]);

  const commands = useMemo(() => launcherCommands(apps), [apps]);
  const shown = useMemo(() => filterCommands(commands, query), [commands, query]);
  const runCommand = (id: string) => {
    setLauncher(false);
    if (id.startsWith("app:")) return open(id.slice(4) as AppId);
    if (id === "forum-feed") return open("forum-feed");
    if (id === "docs") return navigate("/docs");
    if (id === "back") return onBack();
  };

  const closeWindow = (id: WindowId) => setWins((current) => current.filter((w) => w.id !== id));
  const patchWindow = (id: WindowId, patch: Partial<WindowState>) => setWins((current) => current.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const focusWindow = (id: WindowId) => {
    if (front?.id === id) return;
    patchWindow(id, { z: ++zTop.current });
  };
  const returnHome = () => {
    homeFocusNeeded.current = true;
    setWins((current) => current.map((w) => ({ ...w, minimized: true })));
  };
  const search = () => {
    setQuery("");
    setSelected(0);
    setLauncher(true);
  };

  // 键盘：⌘K 启动器、Esc 逐层关闭、1/2/3 打开主入口
  useEffect(() => {
    if (!active || promo) return;
    const onKey = (event: KeyboardEvent) => {
      // 原生 dialog 的 inert 不会阻止 window 监听器，弹层快捷键交给弹层自身。
      if (launcher || picker || phoneGuide || phoneSettings) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setLauncher((value) => !value);
        setQuery("");
        setSelected(0);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea")) {
        if (event.key === "Escape" && target !== launcherInput.current) target.blur();
        return;
      }
      if (event.key === "Escape") {
        if (menu) return setMenu(null);
        if (front) {
          if (phone) return returnHome();
          return closeWindow(front.id);
        }
        return onBack();
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // 按住不放时浏览器自动重复的按键不算再按一次：1/2/3 只打开一次；焦点在 Dock、便签、菜单的按钮上按住回车，
      // 拦掉默认动作，浏览器就不会每次重复都补一次点击。GitHub 组织每打开一次就多一个新标签页
      if (event.repeat) {
        if (event.key === "Enter") event.preventDefault();
        return;
      }
      const app = appByKey(event.key);
      if (app) open(app.id, root.current?.querySelector<HTMLElement>(`[data-cta="${app.id}"]`));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, front, launcher, menu, onBack, open, phone, phoneGuide, phoneSettings, picker, promo]);

  useEffect(() => {
    if (launcher) launcherInput.current?.focus();
  }, [launcher]);

  // 还没看过宣传片的人接下来多半点「加入我们」：桌面出现时就和 CDN 握手，空闲时预取「加入我们」页、播放器、
  // hls.js 分包和起播那一段（#77 验收：点下去 1 秒内出第一帧）。开了省流量就只握手。
  useEffect(() => {
    if (!active || hasSeenPromo(document.cookie)) return;
    preconnectPromo();
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    let cancelled = false;
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1200));
    idle(() => {
      if (cancelled) return;
      void Promise.all([import("../../pages/JoinUs"), import("../PromoPlayer"), import("hls.js/light")])
        .then(() => detectCapabilities(document.createElement("video")))
        .then((caps) => {
          const choice = choosePlayback(caps);
          if (choice && !cancelled) return prefetchPromoStart(choice.codec, browserEstimate(caps.touch));
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  // 宣传片盖住桌面时桌面不可聚焦、不可点（播放层挂在桌面外面）
  useEffect(() => {
    if (root.current) root.current.inert = promo;
  }, [promo]);
  const closePromo = () => {
    setPromo(false);
    window.setTimeout(() => root.current?.querySelector<HTMLElement>('[data-cta="promo"]')?.focus({ preventScroll: true }), 0);
  };

  const MENUS: Record<MenuName, Array<{ label: string; run: () => void; key?: string; note?: string } | null>> = {
    system: [{ label: "关于极客班", run: () => open("about") }, { label: "组织架构", run: () => open("org") }, null, { label: "回到书桌", run: onBack, key: "Esc" }],
    go: apps.map((app) => ({ label: app.name, run: () => open(app.id), key: app.key, note: opensNewTab(app) ? NEW_TAB_NOTE : undefined })),
    window: [
      { label: "更换壁纸…", run: () => setPicker(true) },
      { label: "全部最小化", run: () => setWins((current) => current.map((w) => ({ ...w, minimized: true }))) },
      { label: "关闭全部", run: () => setWins([]) },
    ],
    help: [
      { label: "新来的看这里", run: () => toggleNote(true) },
      { label: "打开终端", run: () => open("terminal") },
      { label: "文档", run: () => navigate("/docs") },
      { label: "搜索应用和命令", run: () => setLauncher(true), key: "⌘K" },
    ],
    // 控制台只给在里面能管点什么的人（/auth/me 的 console_link），普通成员的菜单里没有这一项。
    account: [
      { label: "论坛", run: () => window.location.assign(links.forumHome()) },
      ...(consoleLink ? [{ label: "控制台", run: () => window.location.assign(links.console()) }] : []),
      null,
      { label: "退出", run: () => void signOut() },
    ],
  };
  const toggleMenu = (name: MenuName, anchor: HTMLElement) => {
    // 菜单宽约 220px：靠右的菜单（头像）往左收，不出屏幕
    const left = Math.min(anchor.getBoundingClientRect().left, window.innerWidth - 228);
    setMenu((current) => (current?.name === name ? null : { name, left }));
  };

  const time = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false });
  const phoneTime = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <>
      <div className={phone ? "pt-os-shell is-phone" : "pt-os-shell"} ref={root} onPointerDown={(event) => !(event.target as HTMLElement).closest(".pt-menu, [data-menu]") && setMenu(null)}>
        {phone ? <header className="pt-phone-status" aria-label="手机状态栏">
          <time>{phoneTime}</time>
          <button type="button" className="pt-phone-system" aria-label="YUGC OS 系统设置" aria-haspopup="dialog" onClick={() => setPhoneSettings(true)}>YUGC OS</button>
          {account ? <button type="button" className="pt-phone-account" data-menu aria-label={`账号：${account.login}`} aria-haspopup="menu" aria-expanded={menu?.name === "account"} onClick={(e) => toggleMenu("account", e.currentTarget)}>
            {account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : <Icon name="user-line" size={18} />}
          </button> : loaded ? <a className="pt-phone-signin" href={signInHref()}><Icon name="github-line" size={18} /> 登录<span className="pt-sr">，用 GitHub 登录</span></a> : <span />}
        </header> : <header className="pt-mb" aria-label="菜单栏">
          <button type="button" className="pt-mb-logo" data-menu aria-label="系统菜单" aria-haspopup="menu" aria-expanded={menu?.name === "system"} onClick={(e) => toggleMenu("system", e.currentTarget)}>
            <img src={appConfig.portal.brand.logo} alt="" />
          </button>
          <b className="pt-mb-app">{frontName}</b>
          {(["go", "window", "help"] as const).map((name) => (
            <button key={name} type="button" className="pt-mb-item" data-menu aria-haspopup="menu" aria-expanded={menu?.name === name} onClick={(e) => toggleMenu(name, e.currentTarget)}>
              {{ go: "前往", window: "窗口", help: "帮助" }[name]}
            </button>
          ))}
          <span className="pt-mb-spacer" />
          <button type="button" className="pt-mb-search" onClick={() => setLauncher(true)}>
            <Icon name="search-line" size={14} />
            <span>搜索</span>
            <kbd>⌘K</kbd>
          </button>
          <span className="pt-mb-stat" aria-hidden="true">
            <Icon name="wifi-line" size={15} />
          </span>
          {/* 全站唯一的登录入口：用 GitHub 登录，登录后默认进论坛；登录后换成头像菜单（论坛 / 控制台（仅 console_link）/ 退出） */}
          {account ? (
            <button type="button" className="pt-mb-account" data-menu aria-haspopup="menu" aria-expanded={menu?.name === "account"} onClick={(e) => toggleMenu("account", e.currentTarget)}>
              {account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : <Icon name="user-line" size={15} />}
              <span>{account.login}</span>
            </button>
          ) : (
            loaded && (
              <a className="pt-mb-signin" href={signInHref()}>
                <Icon name="github-line" size={15} />
                <span>用 GitHub 登录</span>
              </a>
            )
          )}
          <span className="pt-mb-clock">{time}</span>
        </header>}
        {menu && (
          <div className="pt-menu" role="menu" style={{ left: menu.left }}>
            {MENUS[menu.name].map((item, index) =>
              item ? (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  autoFocus={index === 0}
                  onClick={() => {
                    setMenu(null);
                    item.run();
                  }}
                >
                  {item.label}
                  {item.note && <span className="pt-sr">{item.note}</span>}
                  {item.key && <kbd>{item.key}</kbd>}
                </button>
              ) : (
                <hr key={`sep-${index}`} />
              ),
            )}
          </div>
        )}

        <main className="pt-dt"
          onPointerDown={(event) => event.target === event.currentTarget && setSelectedIcon(null)}
          onTouchStart={(event) => {
            swipe.current = null;
            if (!phone || !active || front || launcher || picker || phoneGuide || phoneSettings || promo || event.touches.length !== 1 || event.currentTarget.scrollTop !== 0) return;
            if ((event.target as HTMLElement).closest("button, a, input, textarea, dialog")) return;
            const touch = event.touches[0];
            swipe.current = { x: touch.clientX, y: touch.clientY, at: performance.now() };
          }}
          onTouchCancel={() => { swipe.current = null; }}
          onTouchEnd={(event) => {
            const start = swipe.current;
            swipe.current = null;
            const end = event.changedTouches[0];
            if (!start || !end || event.touches.length || front || event.currentTarget.scrollTop !== 0) return;
            if (performance.now() - start.at > 600 || end.clientY - start.y < 64 || Math.abs(end.clientX - start.x) > 40) return;
            searchFocus.current?.focus({ preventScroll: true });
            search();
          }}>
          <WallpaperLayer wallpaper={wallpaperForScreen(wallpaper, phoneWallpaper)} from={wallpaperFrom} />
          <h1 className="pt-sr">长江大学极客班 · YUGC OS</h1>
          <div className="pt-home-apps" ref={(node) => { if (node) node.inert = phone && !!front; }}>
            {phone && <div className="pt-phone-heading"><h2>极客班</h2><button type="button" onClick={() => setPhoneGuide(true)}>新来的看这里 <Icon name="arrow-right-s-line" size={14} /></button></div>}
            <DesktopIcons apps={apps} selected={selectedIcon} onSelect={setSelectedIcon} onOpen={open} phone={phone} />
            {!phone && note && <StartNote onOpen={open} onClose={() => toggleNote(false)} />}
          </div>

          <div className="pt-windows">
            {wins.map((win) => (
              <OsWindow
                key={win.id}
                win={win}
                front={front?.id === win.id}
                onFocus={() => focusWindow(win.id)}
                onClose={() => {
                  closeWindow(win.id);
                  if (phone) {
                    returnHome();
                    window.setTimeout(() => root.current?.querySelector<HTMLElement>(`[data-cta="${win.id}"]`)?.focus({ preventScroll: true }), 0);
                  }
                }}
                onMinimize={() => phone ? returnHome() : patchWindow(win.id, { minimized: true })}
                onZoom={() => patchWindow(win.id, { zoomed: !win.zoomed })}
                onMove={(x, y) => patchWindow(win.id, { x, y })}
                onOpen={open}
                apps={apps}
                phone={phone}
              />
            ))}
          </div>
        </main>

        {phone && !front && <button ref={searchFocus} type="button" className="pt-phone-search" onClick={search}><span><Icon name="search-line" size={14} /> 搜索</span></button>}
        <nav className="pt-dock" aria-label="Dock">
          <button type="button" className="pt-dk is-back" aria-label={phone ? "返回主屏幕" : "回到书桌"} onClick={phone ? returnHome : onBack}>
            <Icon name={phone ? "home-4-line" : "arrow-left-line"} size={20} />
            <span className="pt-dk-label" aria-hidden="true">
              {phone ? "主屏幕" : <>回到书桌 <kbd>Esc</kbd></>}
            </span>
          </button>
          <span className="pt-dk-sep" aria-hidden="true" />
          {(phone ? apps.filter((app) => app.key) : apps).map((app) => (
            <button
              key={app.id}
              type="button"
              className={["pt-dk", app.key ? "" : "is-extra", wins.some((w) => w.id === app.id) ? "is-running" : ""].filter(Boolean).join(" ")}
              aria-label={opensNewTab(app) ? app.name + NEW_TAB_NOTE : app.name}
              onClick={(e) => open(app.id, e.currentTarget)}
            >
              <AppGlyph app={app} size={20} />
              <span className="pt-dk-label" aria-hidden="true">
                {app.name}
                {app.key && <kbd>{app.key}</kbd>}
              </span>
              <i className="pt-dk-dot" aria-hidden="true" />
            </button>
          ))}
        </nav>

        {picker && (
          <Modal title="更换壁纸" className={`pt-root pt-os-modal pt-picker-modal${phone ? " is-phone" : ""}`} onClose={() => setPicker(false)} initialFocusRef={wallpaperFocus}>
            <div className="pt-picker-box" ref={pickerBox}>
              {!phone && <header>
                <h2>更换壁纸</h2>
                <button type="button" className="pt-note-close" aria-label="关闭对话框" onClick={() => setPicker(false)}>
                  <Icon name="close-line" size={14} />
                </button>
              </header>}
              <ul role="radiogroup" aria-label="壁纸">
                {WALLPAPERS.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={wallpaper.id === item.id}
                      ref={wallpaper.id === item.id ? wallpaperFocus : undefined}
                      onKeyDown={(e) => {
                        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
                        e.preventDefault();
                        const direction = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
                        const next = WALLPAPERS[(WALLPAPERS.indexOf(item) + direction + WALLPAPERS.length) % WALLPAPERS.length];
                        const button = pickerBox.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[WALLPAPERS.indexOf(next)];
                        if (button) { chooseWallpaper(next, button); button.focus(); }
                      }}
                      className={wallpaper.id === item.id ? "is-on" : undefined}
                      onClick={(event) => chooseWallpaper(item, event.currentTarget)}
                    >
                      <img src={wallpaperForScreen(item, phoneWallpaper).thumb} alt="" width={phoneWallpaper ? 90 : 160} height={phoneWallpaper ? 195 : 90} loading="lazy" />
                      <span>{item.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </Modal>
        )}

        {launcher && (
          <Modal title="启动器" className={`pt-root pt-os-modal pt-launcher-modal${phone ? " is-phone" : ""}`} onClose={() => setLauncher(false)} initialFocusRef={launcherInput}>
            <div className="pt-ln-box">
              <label className="pt-ln-input">
                <Icon name="search-line" size={18} />
                <input
                  ref={launcherInput}
                  value={query}
                  placeholder="搜索应用或命令，比如「论坛」「文档」"
                  autoComplete="off"
                  role="combobox"
                  aria-label="搜索应用或命令"
                  aria-expanded="true"
                  aria-controls="pt-ln-list"
                  aria-activedescendant={shown[selected] ? `pt-ln-${shown[selected].id}` : undefined}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelected(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      setSelected((current) => moveSelection(current, e.key === "ArrowDown" ? 1 : -1, shown.length));
                    } else if (e.key === "Enter" && shown[selected]) {
                      e.preventDefault();
                      runCommand(shown[selected].id);
                    }
                    else if (e.key === "Escape") {
                      e.stopPropagation();
                      setLauncher(false);
                    }
                  }}
                />
              </label>
              <ul id="pt-ln-list" role="listbox" aria-label="结果">
                {shown.map((command, index) => {
                  const app = command.id.startsWith("app:") ? appById(command.id.slice(4) as AppId) : undefined;
                  return (
                    <li
                      key={command.id}
                      id={`pt-ln-${command.id}`}
                      role="option"
                      aria-selected={index === selected}
                      onPointerEnter={() => setSelected(index)}
                      onClick={() => runCommand(command.id)}
                    >
                      <Icon name={command.icon} size={17} />
                      <b>
                        {command.label}
                        {app && opensNewTab(app) && <span className="pt-sr">{NEW_TAB_NOTE}</span>}
                      </b>
                      <span>{command.hint}</span>
                    </li>
                  );
                })}
                {shown.length === 0 && <li className="pt-empty">没找到「{query.trim()}」。试试「论坛」或「加入」</li>}
              </ul>
              <footer>
                <span>
                  <kbd>
                    <Icon name="arrow-up-s-line" size={11} />
                  </kbd>
                  <kbd>
                    <Icon name="arrow-down-s-line" size={11} />
                  </kbd>
                  选择
                </span>
                <span>
                  <kbd>Enter</kbd> 打开
                </span>
                <span>
                  <kbd>Esc</kbd> 关闭
                </span>
              </footer>
            </div>
          </Modal>
        )}
        {phoneGuide && <Modal title="新来的看这里" className="pt-root pt-os-modal pt-phone-guide is-phone" onClose={() => setPhoneGuide(false)}>
          <StartNote phone onOpen={(id, from) => { setPhoneGuide(false); open(id, from); }} onClose={() => setPhoneGuide(false)} />
        </Modal>}
        {phoneSettings && <Modal title="系统设置" className={`pt-root pt-os-modal pt-phone-settings${phone ? " is-phone" : ""}`} onClose={() => setPhoneSettings(false)}>
          <div className="pt-phone-settings-list">
            <button type="button" onClick={() => { setPhoneSettings(false); setPicker(true); }}><Icon name="image-line" size={20} /> 更换壁纸 <Icon name="arrow-right-s-line" size={18} /></button>
            <button type="button" onClick={() => { setPhoneSettings(false); onBack(); }}><Icon name="arrow-left-line" size={20} /> 回到书桌 <Icon name="arrow-right-s-line" size={18} /></button>
          </div>
        </Modal>}

        {flight && (
          <div className="pt-flight" aria-hidden="true" style={{ left: flight.x - 36, top: flight.y - 36, ["--tint" as string]: flight.app.tint }}>
            <Icon name={flight.app.icon} size={30} />
          </div>
        )}
      </div>
      {promo && <LazyPromoPlayer mode="replay" onClose={closePromo} />}
    </>
  );
}
