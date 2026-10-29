// YUGC OS：开机后的「极客班内部系统」，按桌面操作系统来排：菜单栏（YUGC 标志即系统菜单 / 前台应用 / 搜索 / 时钟 / 头像）、
// 壁纸（默认「晴空」，接着开机动画的最后一帧画）、左上角一列应用图标、「新来的看这里」便签、可拖动窗口、带名字的 Dock、⌘K 启动器。
// 头像点开「账号资料」窗口（#280 起是桌面窗口，正文在 ProfileCard.tsx）：访客在那里登录、注册，登录后改资料、绑定登录方式、填邀请码、退出。
// 加入我们、论坛、代码仓库（自建 GitLab，#270）都是桌面上的应用；便签按顺序告诉新来的人怎么加入。「宣传片」是桌面里的一个窗口（#284，原来是全屏层），
// 「加入我们」第一次打开时自动弹出一次（#77），自己点开重看不影响「只自动播一次」。
// 论坛点一下直达论坛首页（#185），不经过 /forum-3d 场景页；代码仓库整页直达（#311），和论坛一样不开窗口。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Modal from "@shared/ui/Modal";
import { PHONE_QUERY, PORTRAIT_QUERY, useMediaQuery } from "../../lib/useMediaQuery";
import { signInHref, useAccount } from "../../lib/account";
import { useApplyOpen } from "../../lib/applyOpen";
import { reportEvent } from "../../lib/events";
import { linkNoticeOf, type LinkNotice } from "../../lib/linkNotice";
import { noteSeenHere, rememberNoteHere, rememberNoteOnAccount } from "../../lib/startNote";
import { appById, appByKey, appLink, filterCommands, followAppLink, launcherCommands, moveSelection, visibleApps, type AppId } from "../../lib/osApps";
import { browserEstimate, choosePlayback, detectCapabilities, hasSeenPromo, preconnectPromo, prefetchPromoStart, promoCookie } from "../../lib/promo";
import { promoTop } from "../../lib/promoWindow";
import Icon from "../Icon";
import OsWindow, { windowWidth, type PromoActions, type WindowId, type WindowState } from "./Windows";
import { WALLPAPERS, prefetchWallpapersWhenIdle, readWallpaperChoice, saveWallpaperChoice, wallpaperForScreen, type Box, type Wallpaper } from "../../lib/wallpapers";
import WallpaperLayer from "./Wallpaper";
import { SkyThumb, type SkyBand } from "./SkyWallpaper";
import { AppGlyph, DesktopIcons, StartNote } from "./Widgets";
import "../../styles/os.css";

type MenuName = "system" | "go" | "window" | "help";

type Props = {
  /** 系统菜单和手机设置里的「重播开机动画」 */
  onReplayBoot?: () => void;
  /** 刚播完开机动画时：它的起点和它卸掉没有，「晴空」壁纸用来接上最后一帧 */
  boot?: { epoch: number; settled: boolean } | null;
};

/** YUGC 标志：四个字母用各自的品牌色（SPEC §1） */
const WORDMARK = ["Y", "U", "G", "C"] as const;

/** 首页（pages/Home.tsx）在开机动画就绪后或直接进站时挂载；开机动画还盖在上面时外层是 inert。 */
export default function YugcOs({ onReplayBoot, boot = null }: Props) {
  const phone = useMediaQuery(PHONE_QUERY);
  const portrait = useMediaQuery(PORTRAIT_QUERY);
  const phoneWallpaper = phone && portrait;
  const navigate = useNavigate();
  // 登录后回到当前页面：订阅路由变化，让 signInHref() 按浏览器当前地址（含开发态的 /sites/portal 前缀）重算 return_to，交给资料卡
  const location = useLocation();
  const signInLink = signInHref();
  const { account, loaded, signOut, patch, reload } = useAccount();
  // 控制台只给 console_link 为 true 的人：其他人的桌面、Dock、资料卡、启动器、终端里都没有它。
  const consoleLink = account?.consoleLink === true;
  // 招新总开关（#284）：关着时图标说明、便签、「关于」窗口都不再叫人去报名；「加入我们」窗口每次打开重读，读到的值通过 setApplyOpen 同步回来
  const [applyOpen, setApplyOpen] = useApplyOpen();
  const apps = useMemo(() => visibleApps(consoleLink, applyOpen), [consoleLink, applyOpen]);
  const [now, setNow] = useState(() => new Date());
  const [wins, setWins] = useState<WindowState[]>([]);
  const [menu, setMenu] = useState<{ name: MenuName; left: number } | null>(null);
  const [launcher, setLauncher] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [selectedIcon, setSelectedIcon] = useState<AppId | null>(null);
  // 便签：auto 是还没看过、按账号上的记录决定；open 是「帮助」里打开或点过其中一步（点完不收起）；closed 是收起了
  const [noteMode, setNoteMode] = useState<"auto" | "open" | "closed">(() => (noteSeenHere() ? "closed" : "auto"));
  const note = noteMode === "open" || (noteMode === "auto" && !account?.prefs.startNoteSeenAt);
  const [wallpaper, setWallpaper] = useState<Wallpaper>(() => readWallpaperChoice());
  // 新壁纸从点的那张缩略图展开（#147）
  const [wallpaperFrom, setWallpaperFrom] = useState<Box | null>(null);
  const [picker, setPicker] = useState(false);
  const [phoneGuide, setPhoneGuide] = useState(false);
  const [phoneSettings, setPhoneSettings] = useState(false);
  const [linkNotice, setLinkNotice] = useState<LinkNotice | null>(null);
  const searchFocus = useRef<HTMLButtonElement>(null);
  const swipe = useRef<{ x: number; y: number; at: number } | null>(null);
  const wallpaperFocus = useRef<HTMLButtonElement>(null);
  const pickerBox = useRef<HTMLDivElement>(null);
  // 打开面板时把焦点放到当前壁纸上；preventScroll：autoFocus 会让浏览器滚动整个桌面去「露出」按钮，桌面整体上移
  useEffect(() => {
    if (picker) pickerBox.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  }, [picker]);
  const chooseWallpaper = (next: Wallpaper, button: HTMLElement) => {
    const { left, top, width, height } = (button.querySelector("img, canvas") ?? button).getBoundingClientRect();
    setWallpaperFrom({ left, top, width, height });
    setWallpaper(next);
    saveWallpaperChoice(next.id);
  };
  // 桌面空闲后预取其余壁纸，之后换壁纸不用等下载；开了省流量或 2G 时不预取（lib/wallpapers.ts）
  const wallpaperId = useRef(wallpaper.id);
  wallpaperId.current = wallpaper.id;
  useEffect(() => prefetchWallpapersWhenIdle(wallpaperId.current, phoneWallpaper), [phoneWallpaper]);
  // 账号上记过、这个浏览器还没记：补记到本地，下次在这里打开时登录信息回来之前也不会先闪出便签
  const seenOnAccount = account?.prefs.startNoteSeenAt ?? null;
  useEffect(() => {
    if (seenOnAccount && !noteSeenHere()) rememberNoteHere(seenOnAccount);
  }, [seenOnAccount]);
  /** 关掉便签或点了其中一步都算看过：本地和账号（已登录时）一起记 */
  const markNoteSeen = () => {
    const at = Date.now();
    rememberNoteHere(at);
    if (!account || account.prefs.startNoteSeenAt) return;
    patch({ prefs: { startNoteSeenAt: at } });
    void rememberNoteOnAccount(at);
  };
  const closeNote = () => {
    markNoteSeen();
    setNoteMode("closed");
    reportEvent("os.note.dismissed");
  };
  const openFromNote = (id: AppId | "forum-feed", from?: HTMLElement | null) => {
    markNoteSeen();
    setNoteMode((mode) => (mode === "closed" ? mode : "open"));
    open(id, from);
  };
  const zTop = useRef(20);
  const cascade = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const launcherInput = useRef<HTMLInputElement>(null);
  const homeFocusNeeded = useRef(false);

  // 桌面一挂载（开机结束、跳过动画）就把焦点放进去：触发开机的按钮所在的开机动画层这时已经卸载，
  // 不移焦点的话键盘用户会落在 <body> 上。
  useEffect(() => {
    const current = document.activeElement;
    if (current && current !== document.body && root.current?.contains(current)) return;
    root.current?.querySelector<HTMLElement>('[data-cta="join"]')?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时对焦一次
  }, []);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const front = useMemo(() => wins.filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0] ?? null, [wins]);
  const atHome = front === null;
  // 「晴空」壁纸里留给极客娘的一段，她滑到这里，不压着桌面上的东西：手机竖屏是图标下沿到搜索框上沿；
  // 横屏（电脑、手机横着拿）是菜单栏或状态栏下沿到 Dock 上沿，她只在坐的窗口会被 Dock 挡住时缩小（SkyWallpaper.tsx 的 landFit）
  const [band, setBand] = useState<SkyBand | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const shell = root.current;
      if (!shell) return;
      let next: SkyBand;
      if (phoneWallpaper) {
        const icons = shell.querySelector(".pt-icons")?.getBoundingClientRect();
        const floor = shell.querySelector(".pt-phone-search, .pt-dock")?.getBoundingClientRect();
        // 开着应用时主屏是收起的（量不到），回到主屏再量
        if (!icons || !floor || (icons.height === 0 && icons.bottom === 0 && floor.top > 0)) return;
        next = { top: Math.round(icons.bottom + 12), bottom: Math.round(floor.top - 4) };
      } else {
        const bar = shell.querySelector(".pt-mb, .pt-phone-status")?.getBoundingClientRect();
        const dock = shell.querySelector(".pt-dock")?.getBoundingClientRect();
        if (!bar || !dock || dock.height === 0) return;
        next = { top: Math.round(bar.bottom + 8), bottom: Math.round(dock.top - 8) };
      }
      setBand((current) => (current && current.top === next.top && current.bottom === next.bottom ? current : next));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [phoneWallpaper, apps.length, loaded, atHome]);
  const frontName = front ? { join: "加入我们", promo: "宣传片", about: "关于极客班", org: "组织架构", competitions: "比赛", terminal: "终端", "forum-feed": "论坛", gitlab: "代码仓库", feedback: "意见箱", profile: account ? "账号资料" : "登录极客班" }[front.id] : "桌面";
  const profileOpen = wins.some((w) => w.id === "profile" && !w.minimized);
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
      const width = Math.min(windowWidth(id), window.innerWidth - 24);
      // 账号资料从菜单栏右边的头像打开，窗口也开在右上角，顶边和拖动时能到的最高处一样
      if (id === "profile") return [...current, { id, z, x: Math.max(12, window.innerWidth - width - 16), y: 44, minimized: false, zoomed: false }];
      const n = cascade.current++ % 4;
      const x = Math.max(12, Math.min(window.innerWidth - width - 140, window.innerWidth * 0.3 + n * 40));
      // 宣传片窗口的高度是画面 16:9 加标题栏，层叠位置太靠下时往上提，免得被窗口的 max-height 截掉下半截画面
      const y = id === "promo" ? promoTop({ width: window.innerWidth, height: window.innerHeight }, 64 + n * 36) : 64 + n * 36;
      return [...current, { id, z, x, y, minimized: false, zoomed: false }];
    });
  }, []);

  // 宣传片窗口（#284）：是「加入我们」第一次打开时自动弹的（auto），还是自己点开的。只有自动弹的那次才写「看过」的 cookie（#77：桌面上重看不写）；
  // 加载失败（failed）不记，下次再试。自己关掉（右上角关闭、Esc、关闭全部）和播放开始、播完一样算看过。
  const winsNow = useRef(wins);
  winsNow.current = wins;
  const promoAuto = useRef(false);
  const promoFailed = useRef(false);
  const promoOpen = () => winsNow.current.some((w) => w.id === "promo");
  const markPromoSeen = useCallback(() => {
    if (promoAuto.current) document.cookie = promoCookie(window.location.protocol === "https:");
  }, []);
  /** 打开宣传片窗口：窗口已经开着就只是带到最前面，不改它是怎么开的 */
  const openPromo = useCallback(
    (auto: boolean) => {
      if (!winsNow.current.some((w) => w.id === "promo")) {
        promoAuto.current = auto;
        promoFailed.current = false;
      }
      openWindow("promo");
    },
    [openWindow],
  );
  const promoActions: PromoActions = {
    onSeen: markPromoSeen,
    onEnd: (reason) => {
      if (reason === "failed") promoFailed.current = true;
      // 播完自动关；放不了、加载失败、静音也不让播时窗口留着，画面上有说明（停在封面的可以点画面播）
      if (reason === "ended") closeWindow("promo");
    },
  };

  // ?open=<窗口应用的 id>：控制台给的意见箱链接、旧地址 /feedback 跳过来时直接打开对应窗口（#275），打开后把参数从地址里去掉
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("open");
    // link=<结果>&provider=google：资料窗口里绑定 Google 走完授权回来（#291）。打开资料窗口，把结果写在登录方式下面
    const linked = params.get("link");
    const linkedProvider = params.get("provider");
    if (id === null && linked === null) return;
    params.delete("open");
    if (linked !== null) {
      params.delete("link");
      params.delete("provider");
    }
    const rest = params.toString();
    navigate({ search: rest ? `?${rest}` : "" }, { replace: true });
    const notice = linkNoticeOf(linked, linkedProvider);
    if (id === "profile" || notice) {
      if (notice) setLinkNotice(notice);
      openWindow("profile");
      return;
    }
    if (!apps.some((app) => app.id === id && app.open.kind === "window")) return;
    if (id === "promo") openPromo(false);
    else openWindow(id as WindowId);
  }, [location.search, apps, navigate, openWindow, openPromo]);

  const open = useCallback(
    (id: AppId | "forum-feed", from?: HTMLElement | null) => {
      setMenu(null);
      reportEvent("os.app.open", { target_type: "app", target_id: id });
      if (id === "forum-feed") return openWindow("forum-feed");
      const app = appById(id);
      if (!app) return;
      switch (app.open.kind) {
        case "window":
          return app.id === "promo" ? openPromo(false) : openWindow(app.id as WindowId);
        case "site": {
          // 点下去当场整页跳走，不播图标飞行。不用再记「回来直接进桌面」——桌面现在是默认状态，刷新或后退回首页照样直接进桌面
          // （pages/Home.tsx 按 yugc:boot-day 判断，不读路由 state）。
          const link = appLink(app);
          if (!link) return;
          followAppLink(link);
          return;
        }
        case "panel":
          setPicker(true);
          return;
      }
    },
    [openWindow, openPromo],
  );

  const commands = useMemo(() => launcherCommands(apps), [apps]);
  const shown = useMemo(() => filterCommands(commands, query), [commands, query]);
  const runCommand = (id: string) => {
    setLauncher(false);
    if (id.startsWith("app:")) return open(id.slice(4) as AppId);
    if (id === "forum-feed") return open("forum-feed");
    if (id === "docs") return navigate("/docs");
  };

  function closeWindow(id: WindowId) {
    if (id === "promo" && !promoFailed.current) markPromoSeen();
    setWins((current) => current.filter((w) => w.id !== id));
  }
  /** 账号资料窗口关掉后焦点回到打开它的头像（菜单栏或手机状态栏） */
  const focusAvatar = () => window.setTimeout(() => root.current?.querySelector<HTMLElement>(".pt-mb-avatar, .pt-phone-account")?.focus({ preventScroll: true }), 0);
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
          closeWindow(front.id);
          if (front.id === "profile") focusAvatar();
          return;
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // 按住不放时浏览器自动重复的按键不算再按一次：1/2/3 只打开一次；焦点在 Dock、便签、菜单的按钮上按住回车，
      // 拦掉默认动作，浏览器就不会每次重复都补一次点击（不然同一个窗口要开好几次，论坛也会被跳转好几次）
      if (event.repeat) {
        if (event.key === "Enter") event.preventDefault();
        return;
      }
      const app = appByKey(event.key);
      if (app) open(app.id, root.current?.querySelector<HTMLElement>(`[data-cta="${app.id}"]`));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [front, launcher, menu, open, phone, phoneGuide, phoneSettings, picker]);

  useEffect(() => {
    if (launcher) launcherInput.current?.focus();
  }, [launcher]);

  // 还没看过宣传片的人接下来多半点「加入我们」：桌面出现时就和 CDN 握手，空闲时预取「加入我们」页、播放器、
  // hls.js 分包和起播那一段（#77 验收：点下去 1 秒内出第一帧）。开了省流量就只握手。
  useEffect(() => {
    if (hasSeenPromo(document.cookie)) return;
    preconnectPromo();
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    let cancelled = false;
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1200));
    idle(() => {
      if (cancelled) return;
      void Promise.all([import("./JoinBox"), import("../PromoPlayer"), import("hls.js/light")])
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时判断一次要不要预取
  }, []);

  const MENUS: Record<MenuName, Array<{ label: string; run: () => void; key?: string } | null>> = {
    system: [{ label: "关于极客班", run: () => open("about") }, { label: "组织架构", run: () => open("org") }, ...(onReplayBoot ? [null, { label: "重播开机动画", run: onReplayBoot }] : [])],
    go: apps.map((app) => ({ label: app.name, run: () => open(app.id), key: app.key })),
    window: [
      { label: "更换壁纸…", run: () => setPicker(true) },
      { label: "全部最小化", run: () => setWins((current) => current.map((w) => ({ ...w, minimized: true }))) },
      { label: "关闭全部", run: () => { if (promoOpen()) closeWindow("promo"); setWins([]); } },
    ],
    help: [
      { label: "新来的看这里", run: () => setNoteMode("open") },
      { label: "打开终端", run: () => open("terminal") },
      { label: "文档", run: () => navigate("/docs") },
      { label: "搜索应用和命令", run: () => setLauncher(true), key: "⌘K" },
    ],
  };
  const toggleMenu = (name: MenuName, anchor: HTMLElement) => {
    // 菜单宽约 220px：靠右时往左收，不出屏幕
    const left = Math.min(anchor.getBoundingClientRect().left, window.innerWidth - 228);
    setMenu((current) => (current?.name === name ? null : { name, left }));
  };

  const time = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false });
  const phoneTime = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <>
      <div className={phone ? "pt-os-shell is-phone" : "pt-os-shell"} ref={root} onPointerDown={(event) => !(event.target as HTMLElement).closest(".pt-menu, [data-menu]") && setMenu(null)}>
        {/* 壁纸铺满整个屏幕（菜单栏是半透明的），和开机动画的画布一样大，最后一帧才对得上 */}
        <WallpaperLayer wallpaper={wallpaperForScreen(wallpaper, phoneWallpaper)} from={wallpaperFrom} sky={{ epoch: boot?.epoch ?? null, settled: boot?.settled ?? true, band }} />
        {phone ? <header className="pt-phone-status" aria-label="手机状态栏">
          <time>{phoneTime}</time>
          <button type="button" className="pt-phone-system" aria-label="YUGC OS 系统设置" aria-haspopup="dialog" onClick={() => setPhoneSettings(true)}>YUGC OS</button>
          {/* 和电脑菜单栏一样只放头像：访客点开也是账号资料窗口（登录、注册和一句说明），不直接跳走 */}
          {account || loaded ? <button type="button" className="pt-phone-account" aria-label={account ? `账号：${account.login}` : "登录或注册"} aria-haspopup="dialog" aria-expanded={profileOpen} onClick={() => openWindow("profile")}>
            <Avatar src={account?.avatarUrl} />
          </button> : <span />}
        </header> : <header className="pt-mb" aria-label="菜单栏">
          <button type="button" className="pt-mb-logo" data-menu aria-label="系统菜单" aria-haspopup="menu" aria-expanded={menu?.name === "system"} onClick={(e) => toggleMenu("system", e.currentTarget)}>
            <span className="pt-wordmark" aria-hidden="true">
              {WORDMARK.map((letter) => (
                <span key={letter} data-tone={letter.toLowerCase()}>{letter}</span>
              ))}
            </span>
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
          <span className="pt-mb-clock">{time}</span>
          {/* 头像：账号资料窗口的入口，也是全站唯一的登录入口（窗口里去极客班内部登录页，登录后回到当前页面） */}
          {(account || loaded) && (
            <button type="button" className="pt-mb-avatar" aria-label={account ? `账号：${account.login}` : "登录或注册"} aria-haspopup="dialog" aria-expanded={profileOpen} onClick={() => openWindow("profile")}>
              <Avatar src={account?.avatarUrl} />
            </button>
          )}
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
            if (!phone || front || launcher || picker || phoneGuide || phoneSettings || event.touches.length !== 1 || event.currentTarget.scrollTop !== 0) return;
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
          <h1 className="pt-sr">长江大学极客班 · YUGC OS</h1>
          <div className="pt-home-apps" ref={(node) => { if (node) node.inert = phone && !!front; }}>
            {phone && <div className="pt-phone-heading"><h2>极客班</h2><button type="button" onClick={() => setPhoneGuide(true)}>新来的看这里 <Icon name="arrow-right-s-line" size={14} /></button></div>}
            <DesktopIcons apps={apps} selected={selectedIcon} onSelect={setSelectedIcon} onOpen={open} phone={phone} />
            {!phone && note && <StartNote onOpen={openFromNote} onClose={closeNote} applyOpen={applyOpen} />}
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
                  // 账号资料窗口关掉后焦点回到头像；其余窗口在手机上回到主屏幕上的图标
                  if (win.id === "profile") focusAvatar();
                  // 宣传片是从别的窗口里打开的（「加入我们」第一次打开自动弹，或信纸上点的「看宣传片」）：手机上关掉后露出下面那个窗口，不一起收到主屏幕
                  if (phone && !(win.id === "promo" && wins.some((w) => w.id !== "promo" && !w.minimized))) {
                    returnHome();
                    if (win.id !== "profile") window.setTimeout(() => root.current?.querySelector<HTMLElement>(`[data-cta="${win.id}"]`)?.focus({ preventScroll: true }), 0);
                  }
                }}
                onMinimize={() => phone ? returnHome() : patchWindow(win.id, { minimized: true })}
                onZoom={() => patchWindow(win.id, { zoomed: !win.zoomed })}
                onMove={(x, y) => patchWindow(win.id, { x, y })}
                account={account}
                accountLoaded={loaded}
                onOpen={open}
                apps={apps}
                phone={phone}
                applyOpen={applyOpen}
                onApplyOpen={setApplyOpen}
                onAutoPromo={() => openPromo(true)}
                promo={win.id === "promo" ? promoActions : undefined}
                profile={win.id === "profile" ? { signInLink, onPatch: patch, onReload: reload, onSignOut: () => void signOut().then(() => closeWindow("profile")), linkNotice } : undefined}
              />
            ))}
          </div>
        </main>

        {phone && !front && <button ref={searchFocus} type="button" className="pt-phone-search" onClick={search}><span><Icon name="search-line" size={14} /> 搜索</span></button>}
        <nav className="pt-dock" aria-label="Dock">
          {phone && (
            <>
              <button type="button" className="pt-dk is-back" aria-label="返回主屏幕" onClick={returnHome}>
                <Icon name="home-4-line" size={20} />
                <span className="pt-dk-label" aria-hidden="true">主屏幕</span>
              </button>
              <span className="pt-dk-sep" aria-hidden="true" />
            </>
          )}
          {(phone ? apps.filter((app) => app.key) : apps).map((app) => (
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
          <Modal title="更换壁纸" className={`pt-root pt-os-modal pt-picker-modal${phone ? " is-phone" : ""}${phoneWallpaper ? " is-tall" : ""}`} onClose={() => setPicker(false)} initialFocusRef={wallpaperFocus}>
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
                      {item.kind === "sky" ? (
                        <SkyThumb width={phoneWallpaper ? 90 : 160} height={phoneWallpaper ? 195 : 90} band={phoneWallpaper ? band : null} />
                      ) : (
                        <img src={phoneWallpaper ? item.phone.thumb : item.thumb} alt="" width={phoneWallpaper ? 90 : 160} height={phoneWallpaper ? 195 : 90} loading="lazy" />
                      )}
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
          </Modal>
        )}
        {phoneGuide && <Modal title="新来的看这里" className="pt-root pt-os-modal pt-phone-guide is-phone" onClose={() => { setPhoneGuide(false); markNoteSeen(); reportEvent("os.note.dismissed"); }}>
          <StartNote phone applyOpen={applyOpen} onOpen={(id, from) => { setPhoneGuide(false); markNoteSeen(); open(id, from); }} onClose={() => setPhoneGuide(false)} />
        </Modal>}
        {phoneSettings && <Modal title="系统设置" className={`pt-root pt-os-modal pt-phone-settings${phone ? " is-phone" : ""}`} onClose={() => setPhoneSettings(false)}>
          <div className="pt-phone-settings-list">
            <button type="button" onClick={() => { setPhoneSettings(false); setPicker(true); }}><Icon name="image-line" size={20} /> 更换壁纸 <Icon name="arrow-right-s-line" size={18} /></button>
            {onReplayBoot && <button type="button" onClick={() => { setPhoneSettings(false); onReplayBoot(); }}><Icon name="restart-line" size={20} /> 重播开机动画 <Icon name="arrow-right-s-line" size={18} /></button>}
          </div>
        </Modal>}

      </div>
    </>
  );
}

/** 菜单栏和手机状态栏上的头像（28px 圆）：没有头像图时是一个人形图标 */
function Avatar({ src }: { src?: string | null }) {
  return <span className="pt-avatar">{src ? <img src={src} alt="" /> : <Icon name="user-3-line" size={16} />}</span>;
}
