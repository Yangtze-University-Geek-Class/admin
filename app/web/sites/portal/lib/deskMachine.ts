// 首页「书桌 → 开机 → YUGC OS」的状态机（纯函数，tests/web/portal-desk.test.ts 覆盖）。
//
//   loading ──ready──▶ idle ──enter──▶ focusing ──arrived──▶ booting ──bootDone──▶ desktop
//      │                 ▲                 │ (instant)                                │
//      │                 └──returned── returning ◀──────────────back──────────────────┘
//      └──resume / fallback──▶ desktop（从 3D 场景页返回、或没有 WebGL 时直接进桌面）
//
// 场景（three.js）、HUD、开机画面和桌面各自只读 deskView() 给出的可见性，不自己判断状态。

export type DeskState = "loading" | "idle" | "focusing" | "booting" | "desktop" | "returning";

export type DeskEvent =
  | { type: "ready" }
  | { type: "resume" }
  | { type: "fallback" }
  | { type: "enter"; instant?: boolean }
  | { type: "arrived" }
  | { type: "bootDone" }
  | { type: "back" }
  | { type: "returned" };

export function nextDeskState(state: DeskState, event: DeskEvent): DeskState {
  switch (event.type) {
    case "ready":
      return state === "loading" ? "idle" : state;
    case "resume":
      return state === "loading" ? "desktop" : state;
    case "fallback":
      return "desktop";
    case "enter":
      if (state !== "idle") return state;
      return event.instant ? "desktop" : "focusing";
    case "arrived":
      return state === "focusing" ? "booting" : state;
    case "bootDone":
      return state === "booting" || state === "focusing" ? "desktop" : state;
    case "back":
      return state === "desktop" ? "returning" : state;
    case "returned":
      return state === "returning" ? "idle" : state;
  }
}

export type DeskView = {
  /** 书桌上的标题、按钮与悬停提示 */
  hud: boolean;
  /** YUGC OS 覆盖层（含开机画面）是否挂在前面 */
  os: boolean;
  /** 开机画面是否在播 */
  boot: boolean;
  /** 桌面（菜单栏、组件、Dock）是否可交互 */
  desktop: boolean;
  /** three.js 画布是否需要继续渲染；为 false 时渲染循环整体停下 */
  render: boolean;
};

export function deskView(state: DeskState): DeskView {
  return {
    hud: state === "idle",
    os: state === "booting" || state === "desktop",
    boot: state === "booting",
    desktop: state === "desktop",
    // 开机画面与桌面都是不透明的全屏层，盖住画布时不必再画 3D。
    render: state === "loading" || state === "idle" || state === "focusing" || state === "returning",
  };
}
