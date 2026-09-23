import { describe, expect, it } from "vitest";
import { deskView, nextDeskState, type DeskEvent, type DeskState } from "../../app/web/sites/portal/lib/deskMachine";
import { LOADER_STEPS, approach, loaderFinished, loaderGoal, loaderMinDuration, percentLabel, petalLit } from "../../app/web/sites/portal/lib/loaderProgress";

const run = (events: DeskEvent[], from: DeskState = "loading") => events.reduce(nextDeskState, from);

describe("首页状态机", () => {
  it("正常路径：加载 → 书桌 → 推近 → 开机 → 桌面 → 回到书桌", () => {
    expect(run([{ type: "ready" }])).toBe("idle");
    expect(run([{ type: "ready" }, { type: "enter" }])).toBe("focusing");
    expect(run([{ type: "ready" }, { type: "enter" }, { type: "arrived" }])).toBe("booting");
    expect(run([{ type: "ready" }, { type: "enter" }, { type: "arrived" }, { type: "bootDone" }])).toBe("desktop");
    expect(run([{ type: "ready" }, { type: "enter" }, { type: "arrived" }, { type: "bootDone" }, { type: "back" }])).toBe("returning");
    expect(run([{ type: "ready" }, { type: "enter" }, { type: "arrived" }, { type: "bootDone" }, { type: "back" }, { type: "returned" }])).toBe("idle");
  });

  it("跳过动画直接进桌面；推近途中跳过也能结束开机", () => {
    expect(run([{ type: "ready" }, { type: "enter", instant: true }])).toBe("desktop");
    expect(run([{ type: "ready" }, { type: "enter" }, { type: "bootDone" }])).toBe("desktop");
  });

  it("从场景页返回或没有 WebGL 时直接进桌面，之后到来的 ready 不会把桌面打回书桌", () => {
    expect(run([{ type: "resume" }])).toBe("desktop");
    expect(run([{ type: "resume" }, { type: "ready" }])).toBe("desktop");
    expect(run([{ type: "fallback" }])).toBe("desktop");
    expect(run([{ type: "ready" }, { type: "fallback" }])).toBe("desktop");
  });

  it("不合时宜的事件被忽略：加载中不能开机，桌面上不能再开机，书桌上不能返回", () => {
    expect(run([{ type: "enter" }])).toBe("loading");
    expect(run([{ type: "back" }], "idle")).toBe("idle");
    expect(run([{ type: "enter" }], "desktop")).toBe("desktop");
    expect(run([{ type: "arrived" }], "idle")).toBe("idle");
    expect(run([{ type: "returned" }], "desktop")).toBe("desktop");
  });

  it("系统层盖住画布时 3D 循环停止；书桌与过渡期间才渲染", () => {
    expect(deskView("desktop")).toEqual({ hud: false, os: true, boot: false, desktop: true, render: false });
    expect(deskView("booting").render).toBe(false);
    expect(deskView("idle")).toMatchObject({ hud: true, os: false, render: true });
    expect(deskView("focusing")).toMatchObject({ hud: false, render: true });
    expect(deskView("returning").render).toBe(true);
  });
});

describe("加载进度", () => {
  it("最短展示时长：首次约 2.1s、同一会话再次 0.5s、减少动态效果跳过", () => {
    expect(loaderMinDuration({ reducedMotion: false, seenThisSession: false })).toBeGreaterThanOrEqual(2000);
    expect(loaderMinDuration({ reducedMotion: false, seenThisSession: true })).toBe(500);
    expect(loaderMinDuration({ reducedMotion: true, seenThisSession: false })).toBe(0);
  });

  it("显示进度不超过真实进度，也不超过时间进度", () => {
    expect(loaderGoal(0.3, 5000, 2100)).toBe(0.3);
    expect(loaderGoal(1, 1050, 2100)).toBeCloseTo(0.5);
    expect(loaderGoal(1, 5000, 2100)).toBe(1);
    expect(loaderGoal(1.7, 5000, 2100)).toBe(1);
    expect(loaderGoal(-1, 5000, 2100)).toBe(0);
    expect(loaderGoal(0.62, 0, 0)).toBe(0.62);
  });

  it("平滑趋近最终真正到达目标，且真实进度到 1 前不会结束", () => {
    let shown = 0;
    for (let i = 0; i < 200; i++) shown = approach(shown, 1);
    expect(shown).toBe(1);
    expect(loaderFinished(1, 0.9)).toBe(false);
    expect(loaderFinished(0.99, 1)).toBe(false);
    expect(loaderFinished(1, 1)).toBe(true);
    expect(approach(0.8, 0.5)).toBe(0.5);
  });

  it("真实步骤单调递增，最后一步（第一帧画出）才是 100%", () => {
    const values = Object.values(LOADER_STEPS);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values.at(-1)).toBe(1);
    expect(values.filter((value) => value >= 1)).toHaveLength(1);
  });

  it("百分比三位数、花瓣按进度逐片点亮", () => {
    expect(percentLabel(0.07)).toBe("007");
    expect(percentLabel(1)).toBe("100");
    expect(percentLabel(2)).toBe("100");
    const lit = (p: number) => [0, 1, 2, 3, 4, 5].filter((i) => petalLit(p, i)).length;
    expect(lit(0)).toBe(0);
    expect(lit(0.5)).toBe(3);
    expect(lit(1)).toBe(6);
  });
});
