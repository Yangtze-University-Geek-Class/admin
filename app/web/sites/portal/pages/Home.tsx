// 官网首页：加载动画 → 3D 书桌 → 点电脑开机 → YUGC OS 桌面。
// 状态机在 ../lib/deskMachine.ts；three.js 书桌在 ../three/desk.ts，用 import() 按需加载（不进首屏包）；
// 系统桌面是普通 DOM（../components/os/YugcOs.tsx），盖住画布时 3D 渲染循环整体停下。
// 从 3D 场景页「回到桌面」时带着路由 state，直接回到系统桌面，不再从书桌开始。
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { appConfig } from "@shared/config";
import Emblem from "../components/Emblem";
import Icon from "../components/Icon";
import Loader, { type LoaderApi } from "../components/Loader";
import YugcOs from "../components/os/YugcOs";
import { deskView, nextDeskState, type DeskEvent, type DeskState } from "../lib/deskMachine";
import { wantsDesktop } from "../lib/links";
import { LOADER_STEPS, type LoaderStep } from "../lib/loaderProgress";
import { useInert, useReducedMotion } from "../lib/useReducedMotion";
import type { DeskHandle } from "../three/desk";
import "../styles/portal.css";
import "../styles/desk.css";
import "../styles/os.css";

const BOOT_LINES: Array<[string, string]> = [
  ["mount", "/campus/yangtzeu"],
  ["load", "nano.driver"],
  ["link", "github.com/Yangtze-University-Geek-Class"],
  ["start", "forum.service"],
  ["ready", "8 apps · 加入我们 / 论坛 / GitHub"],
];

export default function Home() {
  const reducedMotion = useReducedMotion();
  const location = useLocation();
  const navigate = useNavigate();
  const resume = useRef(wantsDesktop(location.state));
  const [state, dispatch] = useReducer((current: DeskState, event: DeskEvent) => nextDeskState(current, event), "loading");
  const view = deskView(state);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [loaderVisible, setLoaderVisible] = useState(!resume.current);
  const [bootRun, setBootRun] = useState(0);
  const [bootLines, setBootLines] = useState(0);
  const [nanoUp, setNanoUp] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const desk = useRef<DeskHandle | null>(null);
  const loader = useRef<LoaderApi | null>(null);
  const pending = useRef<Array<[number, string]>>([]);
  const timers = useRef<number[]>([]);
  const enterButton = useRef<HTMLButtonElement>(null);
  const hudRef = useInert<HTMLDivElement>(!view.hud);
  const osRef = useInert<HTMLDivElement>(!view.os);

  const report = useCallback((step: LoaderStep, text: string) => {
    const value = LOADER_STEPS[step];
    if (loader.current) loader.current.progress(value, text);
    else pending.current.push([value, text]);
  }, []);
  const onLoaderApi = useCallback((api: LoaderApi) => {
    loader.current = api;
    for (const [value, text] of pending.current) api.progress(value, text);
    pending.current = [];
  }, []);

  // 从场景页返回：直接进系统桌面（书桌在后台照常搭好）；清掉路由 state，刷新页面不会一直停在桌面
  useEffect(() => {
    if (!resume.current) return;
    dispatch({ type: "resume" });
    navigate(".", { replace: true, state: null });
  }, [navigate]);
  const enterRef = useRef<(instant: boolean) => void>(() => undefined);

  // 加载 three 分包并搭书桌；卸载时释放全部 GPU 资源
  useEffect(() => {
    let cancelled = false;
    report("start", "mount /campus/yangtzeu");
    (async () => {
      try {
        const module = await import("../three/desk");
        if (cancelled || !canvas.current || !hint.current) return;
        report("chunk", "load three.js · desk scene");
        const handle = await module.createDesk(canvas.current, {
          reducedMotion,
          hint: hint.current,
          logoUrl: appConfig.portal.brand.logo,
          onEnter: () => enterRef.current(false),
          isIdle: () => stateRef.current === "idle",
          report,
          cancelled: () => cancelled,
        });
        if (cancelled || !handle) {
          handle?.dispose();
          return;
        }
        desk.current = handle;
        if (stateRef.current === "desktop") {
          await handle.focus({ instant: true, onArrive: () => undefined });
          handle.setActive(false);
        } else dispatch({ type: "ready" });
      } catch {
        // 没有 WebGL（或分包加载失败）：直接给系统桌面，三个入口照常可用
        if (cancelled) return;
        report("frame", "webgl unavailable · static desktop");
        dispatch({ type: "fallback" });
      }
    })();
    return () => {
      cancelled = true;
      timers.current.forEach(window.clearTimeout);
      desk.current?.dispose();
      desk.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时建一次场景
  }, []);

  // 桌面盖住画布时停下渲染循环；回到书桌时恢复
  useEffect(() => {
    desk.current?.setActive(view.render);
  }, [view.render]);

  const clearTimers = () => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
  };

  const finishBoot = useCallback(() => {
    clearTimers();
    setBootLines(BOOT_LINES.length);
    dispatch({ type: "bootDone" });
  }, []);

  const startBoot = useCallback(() => {
    dispatch({ type: "arrived" });
    setBootRun((n) => n + 1);
    setBootLines(0);
    setNanoUp(false);
    BOOT_LINES.forEach((_, i) => timers.current.push(window.setTimeout(() => setBootLines(i + 1), 1050 + i * 250)));
    timers.current.push(window.setTimeout(() => setNanoUp(true), 1150));
    timers.current.push(window.setTimeout(finishBoot, 3100));
  }, [finishBoot]);

  const enter = useCallback(
    (instant: boolean) => {
      if (stateRef.current !== "idle") return;
      const handle = desk.current;
      const skip = instant || reducedMotion || !handle;
      dispatch({ type: "enter", instant: skip });
      if (!handle) return;
      void handle.focus({
        instant: skip,
        onArrive: () => {
          if (!skip) startBoot();
        },
      });
    },
    [reducedMotion, startBoot],
  );
  enterRef.current = enter;

  const back = useCallback(() => {
    if (stateRef.current !== "desktop") return;
    clearTimers();
    setNanoUp(false);
    const handle = desk.current;
    dispatch({ type: "back" });
    if (!handle) {
      dispatch({ type: "returned" });
      return;
    }
    void handle.unfocus(reducedMotion).then(() => {
      dispatch({ type: "returned" });
      window.setTimeout(() => enterButton.current?.focus({ preventScroll: true }), 0);
    });
  }, [reducedMotion]);

  // 书桌上的键盘：Enter/空格开机；其他键让桌上的键盘也按一下。开机画面播放时任意键跳过。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const current = stateRef.current;
      if (current === "booting") {
        finishBoot();
        return;
      }
      if (current !== "idle") return;
      const target = event.target as HTMLElement | null;
      if ((event.key === "Enter" || event.key === " ") && !target?.closest("button, a, input, textarea")) {
        event.preventDefault();
        enter(false);
        return;
      }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) desk.current?.pressKey();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enter, finishBoot]);

  const { brand } = appConfig.portal;
  return (
    <div className="pt-root pt-home" data-state={state}>
      {loaderVisible && <Loader reducedMotion={reducedMotion} onApi={onLoaderApi} onDone={() => setLoaderVisible(false)} />}
      <canvas ref={canvas} className="pt-desk-canvas" aria-hidden="true" />

      <div ref={hudRef} className={view.hud ? "pt-hud" : "pt-hud is-off"}>
        <div className="pt-hud-top">
          <span className="pt-brand">
            <img src={brand.logo} alt="" width={34} height={34} />
            <span>
              <b>{brand.title}</b>
              <small>{brand.subtitle}</small>
            </span>
          </span>
          <span className="pt-status">
            <i aria-hidden="true" />
            RECRUITING · 我们正在招人
          </span>
        </div>
        <section className="pt-hud-copy" aria-labelledby="pt-home-title">
          <p className="pt-kicker">~/yugc $ ./boot</p>
          <h1 id="pt-home-title">
            <span>在校园里，</span>
            <br />
            <span className="is-accent">把想法写成能跑的东西。</span>
          </h1>
          <p>长江大学的 AI Native 技术社团：写代码、做项目、一起复盘。点一下桌上的电脑，开机进去看看。</p>
          <div className="pt-hud-actions">
            <button ref={enterButton} type="button" className="pt-enter" onClick={() => enter(false)}>
              <Icon name="shut-down-line" size={16} /> 打开电脑 <kbd>Enter</kbd>
            </button>
            <button type="button" className="pt-skip" onClick={() => enter(true)}>
              跳过动画
            </button>
          </div>
        </section>
      </div>
      <div className="pt-desk-tip" ref={hint} aria-hidden="true" />

      <div ref={osRef} className={view.os ? "pt-os is-on" : "pt-os"} aria-hidden={!view.os}>
        <div
          className={view.boot ? "pt-boot is-on" : "pt-boot"}
          aria-hidden="true"
          onClick={() => stateRef.current === "booting" && finishBoot()}
        >
          <div className="pt-boot-inner" key={bootRun}>
            <Emblem variant="boot" className="pt-boot-emblem" />
            <div className="pt-boot-title">YUGC&nbsp;OS</div>
            <div className="pt-boot-lines">
              {BOOT_LINES.map(([key, value], i) => (
                <div key={key} className={i < bootLines ? "is-on" : undefined}>
                  <b>[ OK ]</b> {key} {value}
                </div>
              ))}
            </div>
            <div className="pt-boot-bar">
              <i style={{ width: `${(bootLines / BOOT_LINES.length) * 100}%` }} />
            </div>
          </div>
          <div className={nanoUp ? "pt-nano is-up" : "pt-nano"}>
            <div className="pt-nano-bubble">欢迎来到极客班</div>
            <img src="/portal/nano-wave-560.webp" alt="" width={560} height={943} />
          </div>
        </div>
        {(view.desktop || state === "booting") && <YugcOs active={view.desktop} onBack={back} />}
      </div>
    </div>
  );
}
