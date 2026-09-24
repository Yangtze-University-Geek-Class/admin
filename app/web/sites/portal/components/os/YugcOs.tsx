// YUGC OS：开机后的「极客班内部系统」，按桌面操作系统来排：菜单栏（系统菜单 / 前台应用 / 搜索 / 时钟）、
// 极客娘壁纸、左上角一列应用图标、右上角「新来的看这里」便签、可拖动窗口、带名字的 Dock、⌘K 启动器。
// 加入我们、论坛、GitHub 组织都是桌面上的应用；便签按顺序告诉新来的人怎么加入。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { appConfig } from "@shared/config";
import { links } from "../../lib/links";
import { OS_APPS, appById, appByKey, filterCommands, launcherCommands, moveSelection, type AppId, type OsApp } from "../../lib/osApps";
import Icon from "../Icon";
import OsWindow, { windowWidth, type WindowId, type WindowState } from "./Windows";
import { WALLPAPERS, readWallpaperChoice, saveWallpaperChoice, type Wallpaper } from "../../lib/wallpapers";
import WallpaperLayer from "./Wallpaper";
import { AppGlyph, DesktopIcons, StartNote } from "./Widgets";

type Props = {
  /** 桌面是否在前台（开机画面播完）；为 false 时不响应快捷键 */
  active: boolean;
  onBack: () => void;
};

type MenuName = "system" | "go" | "window" | "help";

const NOTE_KEY = "yugc:start-note";

export default function YugcOs({ active, onBack }: Props) {
  const navigate = useNavigate();
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
  const [picker, setPicker] = useState(false);
  const pickerBox = useRef<HTMLDivElement>(null);
  // 打开面板时把焦点放到当前壁纸上；preventScroll：autoFocus 会让浏览器滚动整个桌面去「露出」按钮，桌面整体上移
  useEffect(() => {
    if (picker) pickerBox.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  }, [picker]);
  const chooseWallpaper = (next: Wallpaper) => {
    setWallpaper(next);
    saveWallpaperChoice(next.id);
  };
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
          window.location.assign(links.console());
          return;
        case "panel":
          setPicker(true);
          return;
        case "scene":
          return launchScene(app, from);
      }
    },
    [launchScene, navigate, openWindow],
  );

  const commands = useMemo(() => launcherCommands(), []);
  const shown = useMemo(() => filterCommands(commands, query), [commands, query]);
  const runCommand = (id: string) => {
    setLauncher(false);
    if (id.startsWith("app:")) return open(id.slice(4) as AppId);
    if (id === "forum-home") return window.location.assign(links.forumHome());
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

  // 键盘：⌘K 启动器、Esc 逐层关闭、1/2/3 打开主入口
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
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
        if (launcher) return setLauncher(false);
        if (front) return closeWindow(front.id);
        return onBack();
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const app = appByKey(event.key);
      if (app) open(app.id, root.current?.querySelector<HTMLElement>(`[data-cta="${app.id}"]`));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, front, launcher, menu, onBack, open]);

  useEffect(() => {
    if (launcher) launcherInput.current?.focus();
  }, [launcher]);

  const MENUS: Record<MenuName, Array<{ label: string; run: () => void; key?: string } | null>> = {
    system: [{ label: "关于极客班", run: () => open("about") }, { label: "组织架构", run: () => open("org") }, null, { label: "回到书桌", run: onBack, key: "Esc" }],
    go: OS_APPS.map((app) => ({ label: app.name, run: () => open(app.id), key: app.key })),
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
  };
  const toggleMenu = (name: MenuName, anchor: HTMLElement) => {
    setMenu((current) => (current?.name === name ? null : { name, left: anchor.getBoundingClientRect().left }));
  };

  const time = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false });

  return (
    <div className="pt-os-shell" ref={root} onPointerDown={(event) => !(event.target as HTMLElement).closest(".pt-menu, [data-menu]") && setMenu(null)}>
      <header className="pt-mb" aria-label="菜单栏">
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
        <span className="pt-mb-clock">{time}</span>
      </header>
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
                {item.key && <kbd>{item.key}</kbd>}
              </button>
            ) : (
              <hr key={`sep-${index}`} />
            ),
          )}
        </div>
      )}

      <main className="pt-dt" onPointerDown={(event) => event.target === event.currentTarget && setSelectedIcon(null)}>
        <WallpaperLayer wallpaper={wallpaper} active={active} />
        <h1 className="pt-sr">长江大学极客班 · YUGC OS</h1>
        <DesktopIcons selected={selectedIcon} onSelect={setSelectedIcon} onOpen={open} />
        {note && <StartNote onOpen={open} onClose={() => toggleNote(false)} />}

        <div className="pt-windows">
          {wins.map((win) => (
            <OsWindow
              key={win.id}
              win={win}
              front={front?.id === win.id}
              onFocus={() => focusWindow(win.id)}
              onClose={() => closeWindow(win.id)}
              onMinimize={() => patchWindow(win.id, { minimized: true })}
              onZoom={() => patchWindow(win.id, { zoomed: !win.zoomed })}
              onMove={(x, y) => patchWindow(win.id, { x, y })}
              onOpen={open}
            />
          ))}
        </div>
      </main>

      <nav className="pt-dock" aria-label="Dock">
        <button type="button" className="pt-dk is-back" aria-label="回到书桌" onClick={onBack}>
          <Icon name="arrow-left-line" size={20} />
          <span className="pt-dk-label" aria-hidden="true">
            回到书桌 <kbd>Esc</kbd>
          </span>
        </button>
        <span className="pt-dk-sep" aria-hidden="true" />
        {OS_APPS.map((app) => (
          <button
            key={app.id}
            type="button"
            className={["pt-dk", app.key ? "" : "is-extra", wins.some((w) => w.id === app.id) ? "is-running" : ""].filter(Boolean).join(" ")}
            aria-label={app.name}
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
        <div className="pt-picker" role="dialog" aria-modal="true" aria-label="更换壁纸" onPointerDown={(e) => e.target === e.currentTarget && setPicker(false)} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setPicker(false))}>
          <div className="pt-picker-box" ref={pickerBox}>
            <header>
              <h2>更换壁纸</h2>
              <button type="button" className="pt-note-close" aria-label="关闭" onClick={() => setPicker(false)}>
                <Icon name="close-line" size={14} />
              </button>
            </header>
            <ul role="radiogroup" aria-label="壁纸">
              {WALLPAPERS.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={wallpaper.id === item.id}
                    className={wallpaper.id === item.id ? "is-on" : undefined}
                    onClick={() => chooseWallpaper(item)}
                  >
                    <img src={item.thumb} alt="" width={160} height={90} loading="lazy" />
                    <span>
                      {item.name}
                      {item.video && <small>动态</small>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {launcher && (
        <div className="pt-launcher" role="dialog" aria-modal="true" aria-label="启动器" onPointerDown={(e) => e.target === e.currentTarget && setLauncher(false)}>
          <div className="pt-ln-box">
            <label className="pt-ln-input">
              <Icon name="search-line" size={18} />
              <input
                ref={launcherInput}
                value={query}
                placeholder="搜索应用或命令，比如「论坛」「文档」"
                autoComplete="off"
                role="combobox"
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
                  } else if (e.key === "Enter" && shown[selected]) runCommand(shown[selected].id);
                  else if (e.key === "Escape") {
                    e.stopPropagation();
                    setLauncher(false);
                  }
                }}
              />
            </label>
            <ul id="pt-ln-list" role="listbox" aria-label="结果">
              {shown.map((command, index) => (
                <li
                  key={command.id}
                  id={`pt-ln-${command.id}`}
                  role="option"
                  aria-selected={index === selected}
                  onPointerEnter={() => setSelected(index)}
                  onClick={() => runCommand(command.id)}
                >
                  <Icon name={command.icon} size={17} />
                  <b>{command.label}</b>
                  <span>{command.hint}</span>
                </li>
              ))}
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
        </div>
      )}

      {flight && (
        <div className="pt-flight" aria-hidden="true" style={{ left: flight.x - 36, top: flight.y - 36, ["--tint" as string]: flight.app.tint }}>
          <Icon name={flight.app.icon} size={30} />
        </div>
      )}
    </div>
  );
}
