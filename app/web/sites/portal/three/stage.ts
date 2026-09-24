// 官网 3D 场景共用的「小摄影棚」：渲染器、按需渲染循环、指针视差、资源释放。
// 纯 three.js，不依赖 React；由各页面组件用 import() 动态加载，所以 three 不进首屏包。
//
// 性能约束（docs/services/web/portal.md「性能预算」）：
//   · 像素比起步 min(devicePixelRatio, 2)，由 ../lib/pixelRatio.ts 的调速器按帧间隔自动降档（2 → 1.5 → 1.25），
//     同一会话只降不升（降到的档位记在 sessionStorage，换场景也从这一档起步）；
//   · 阴影贴图 1024，且 shadowMap.autoUpdate = false，只有物体真的动了才刷新；
//   · 按需渲染：没有动画、指针没动时整个循环停下（不再每帧 render）；
//     「环境动画」（热气、机器人悬浮、气泡转圈）只在用户最近有操作时播放（engaged），
//     无操作 settleMs 后缓缓停到静止姿态，循环随之完全停止；标签页隐藏、画布离开视口、被外部 pause 时同样停止；
//   · 动画进行中每个 rAF 都画：不做「隔帧跳过」式限速（实测在 Chromium 里，画 / 不画交替的 rAF 会让下一帧被推迟到约 1s，反而卡顿）；
//   · 循环里不分配对象（Vector3 等都预先建好；更新函数存在数组里，逐帧遍历不创建迭代器）。
//   · 带字的程序化贴图按 2 倍左右的分辨率画（canvasTexture 的 scale），各向异性过滤取显卡上限（封顶 8），斜着看也清楚。
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { fitInBand, type Band } from "../lib/cameraMath";
import { ICONS, type IconName } from "../lib/icons";
import { damp } from "../lib/motion";
import { PixelRatioGovernor, initialPixelRatio } from "../lib/pixelRatio";

/** 本会话降到的像素比档位（只降不升，换场景也沿用） */
const RATIO_KEY = "yugc:pixel-ratio";
function sessionRatioCap(): number | null {
  try {
    const value = Number(sessionStorage.getItem(RATIO_KEY));
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}
function rememberRatioCap(value: number) {
  try {
    sessionStorage.setItem(RATIO_KEY, String(value));
  } catch {
    /* 隐私模式下 sessionStorage 不可写时忽略：本页照样降档，只是下个场景重新测 */
  }
}

/** 程序化贴图的各向异性过滤：第一个 Stage 建好后按显卡能力设置（封顶 8） */
let textureAnisotropy = 4;
/** 本会话见过的最短帧间隔（估计屏幕刷新间隔），跨场景沿用 */
let sessionRefreshMs = Infinity;

export const PALETTE = {
  paper: "#f6f5f1",
  paperCool: "#f4f6fb",
  ink: "#1b2140",
  inkSoft: "#5b6283",
  cobalt: "#3346c8",
  cobaltDeep: "#2a3bb0",
  cobaltSoft: "#e6e9fb",
  amber: "#f5a524",
  green: "#1fa971",
  red: "#e5484d",
  line: "rgba(27,33,64,0.12)",
} as const;

/**
 * 每个更新函数返回这一帧之后还需不需要继续渲染：Idle 已经静止；Active 还在动（下一帧继续画）。
 * 装饰性的环境动画用 stage.ambient（0..1，随用户是否在操作缓入缓出）调节幅度，幅度归零后返回 Idle。
 */
export const Motion = { Idle: 0, Active: 1 } as const;
export type Motion = (typeof Motion)[keyof typeof Motion];

export type Updater = (dt: number, time: number) => Motion;

export type StageOptions = {
  fov?: number;
  background?: string;
  /** 影棚无缝背景（地面向后弯成背墙）+ 三盏灯；书桌场景自己布光时关掉 */
  studio?: boolean;
  /** 用户停止操作多久后，环境动画停到静止姿态（毫秒） */
  settleMs?: number;
  /** 像素比上限（默认 2）；实际值由调速器按帧间隔往下调 */
  pixelRatioCap?: number;
  reducedMotion?: boolean;
};

export class Stage {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly reducedMotion: boolean;
  /** 指针在画布上的 NDC 坐标；离开画布时回到 0 */
  readonly pointer = new THREE.Vector2();
  /** 平滑后的指针，用于视差 */
  readonly smooth = new THREE.Vector2();
  parallax = 0.12;
  /** 相机基准位姿；默认相机装置在此基础上叠加视差 */
  readonly basePos = new THREE.Vector3(0, 2, 8);
  readonly baseTarget = new THREE.Vector3();
  /** 画面偏移（视口宽高的比例，交给 setViewOffset）：竖屏把主体挪到文案与列表之间的横带里 */
  readonly baseOffset = { x: 0, y: 0 };
  /** 自定义相机装置（书桌场景用）；返回 true 表示相机还在动 */
  rig: ((dt: number) => boolean) | null = null;
  onLayout: ((width: number, height: number) => void) | null = null;
  /** 渲染计数，供性能验收读取 */
  renders = 0;
  /** 像素比调速器：连续绘制时按帧间隔决定要不要降一档 */
  readonly governor: PixelRatioGovernor;
  /** 为 false 时不给调速器喂帧（例如首页加载动画还盖在画布上，那时的帧耗时不全是 3D 的） */
  governing = true;

  /** 环境动画幅度 0..1：用户最近有操作时趋向 1，停止操作 settleMs 后趋向 0 */
  ambient = 1;
  private readonly updaters: Updater[] = [];
  private readonly settleMs: number;
  private lastInput = performance.now();
  private raf = 0;
  private lastRender = 0;
  private visible = true;
  private paused = false;
  private disposed = false;
  private shadowDirty = true;
  private readonly io: IntersectionObserver;
  private readonly envTarget: THREE.WebGLRenderTarget;
  private readonly onPointerMove = (event: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.poke();
  };
  /** 任何用户操作（指针、滚轮、按键）都让环境动画恢复 */
  private readonly onActivity = () => this.poke();
  private readonly onPointerLeave = () => {
    this.pointer.set(0, 0);
    this.invalidate();
  };
  private readonly onResize = () => this.resize();
  private readonly onVisibility = () => {
    if (!document.hidden) this.invalidate();
  };

  constructor(canvas: HTMLCanvasElement, options: StageOptions = {}) {
    const { fov = 32, background = PALETTE.paper, studio = true, settleMs = 8000, pixelRatioCap = 2, reducedMotion = false } = options;
    this.canvas = canvas;
    this.reducedMotion = reducedMotion;
    this.settleMs = settleMs;
    if (reducedMotion) this.ambient = 0;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    const ratio = initialPixelRatio(window.devicePixelRatio || 1, sessionRatioCap(), pixelRatioCap);
    this.renderer.setPixelRatio(ratio);
    // 前 30 帧里有着色器编译与贴图上传，不算进调速窗口
    this.governor = new PixelRatioGovernor(ratio, { warmupFrames: 30, refreshMs: sessionRefreshMs });
    this.probeRefresh();
    textureAnisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.scene.background = new THREE.Color(background);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.5;

    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 60);
    if (studio) this.buildStudio(background);

    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("pointerdown", this.onActivity, { passive: true });
    window.addEventListener("keydown", this.onActivity, { passive: true });
    window.addEventListener("wheel", this.onActivity, { passive: true });
    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.io = new IntersectionObserver(([entry]) => {
      this.visible = Boolean(entry?.isIntersecting);
      if (this.visible) this.invalidate();
    });
    this.io.observe(canvas);
    if (import.meta.env.DEV) (window as unknown as { __yugcStage?: Stage }).__yugcStage = this;
    this.resize();
  }

  /** 用几十个空 rAF 估计屏幕刷新间隔（此时通常只有加载动画在跑），供调速器判断预算 */
  private probeRefresh(frames = 40) {
    let last = 0;
    let left = frames;
    const step = (now: number) => {
      if (this.disposed) return;
      if (last) {
        const interval = now - last;
        this.governor.noteRefresh(interval);
        if (interval >= 4 && interval < sessionRefreshMs) sessionRefreshMs = interval;
      }
      last = now;
      if (--left > 0) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private buildStudio(background: string) {
    // 无缝影棚背景：一张平面沿 z 方向弯成「地面 → 圆弧 → 背墙」。
    const R = 2.2;
    const depth = 3.2;
    const height = 7;
    const geometry = new THREE.PlaneGeometry(24, 1, 1, 40);
    const position = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const v = position.getY(i) + 0.5;
      const s = v * (depth + (Math.PI * R) / 2 + height);
      let y: number;
      let z: number;
      if (s < depth) {
        y = 0;
        z = 3 - s;
      } else if (s < depth + (Math.PI * R) / 2) {
        const a = (s - depth) / R;
        y = R - Math.cos(a) * R;
        z = 3 - depth - Math.sin(a) * R;
      } else {
        y = R + (s - depth - (Math.PI * R) / 2);
        z = 3 - depth - R;
      }
      position.setXYZ(i, position.getX(i), y, z);
    }
    geometry.computeVertexNormals();
    const cyclorama = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: background }));
    cyclorama.receiveShadow = true;
    this.scene.add(cyclorama);
    this.scene.fog = new THREE.Fog(background, 9, 18);

    this.scene.add(new THREE.HemisphereLight("#ffffff", "#ece6dc", 1.0));
    const key = new THREE.DirectionalLight("#fff6ea", 2.1);
    key.position.set(-3, 5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 16 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight("#dfe6ff", 0.7);
    rim.position.set(4, 3, -2);
    this.scene.add(rim);
  }

  add(updater: Updater): () => void {
    this.updaters.push(updater);
    this.invalidate();
    return () => {
      const index = this.updaters.indexOf(updater);
      if (index >= 0) this.updaters.splice(index, 1);
    };
  }

  /** 相机基准位姿（复制，不持有传入对象）；立即生效，同一帧里后续计算拿到的就是新相机 */
  frame(position: THREE.Vector3, target: THREE.Vector3, offset?: { x: number; y: number }) {
    this.basePos.copy(position);
    this.baseTarget.copy(target);
    if (offset) {
      this.baseOffset.x = offset.x;
      this.baseOffset.y = offset.y;
    }
    if (!this.rig) this.applyBaseCamera();
    this.invalidate();
  }

  /** 默认相机装置：基准位姿 + 指针视差 */
  applyBaseCamera() {
    const p = this.reducedMotion ? 0 : this.parallax;
    this.camera.position.set(this.basePos.x + this.smooth.x * p, this.basePos.y + this.smooth.y * p * 0.5, this.basePos.z);
    this.camera.lookAt(this.baseTarget);
    const { x, y } = this.baseOffset;
    const view = this.camera.view;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if ((x || y) && w && h) {
      if (!view?.enabled || view.offsetX !== x * w || view.offsetY !== y * h || view.fullWidth !== w || view.fullHeight !== h) this.camera.setViewOffset(w, h, x * w, y * h, w, h);
    } else if (view?.enabled) this.camera.clearViewOffset();
    this.camera.updateMatrixWorld();
  }

  /** 物体移动后调用：下一帧重新渲染阴影贴图 */
  markShadows() {
    this.shadowDirty = true;
  }

  /** 暂停后循环完全停下（画布保留最后一帧）；恢复时补画一帧 */
  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused) this.invalidate();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * 请求再画一帧（指针、布局、外部状态变化时调用）。任何时刻最多只有一个待执行的 rAF：
   * 在 tick 内部（更新函数里）调用时只做标记，由 tick 结尾统一决定是否续帧，避免回调成倍增长。
   */
  invalidate() {
    if (this.disposed) return;
    if (this.ticking) {
      this.again = true;
      return;
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private ticking = false;
  private again = false;
  private readonly frameWaiters: Array<() => void> = [];

  /** 在下一次 rAF 里画一帧，画完后 resolve（所有绘制都走 rAF，不在 rAF 之外直接 render） */
  nextFrame(): Promise<void> {
    return new Promise((resolve) => {
      this.frameWaiters.push(resolve);
      this.invalidate();
    });
  }

  /** 用户有操作：环境动画恢复播放 */
  poke() {
    this.lastInput = performance.now();
    this.invalidate();
  }

  /** 用户是否「最近在操作」：决定环境动画要不要播放 */
  get engaged(): boolean {
    return !this.reducedMotion && performance.now() - this.lastInput < this.settleMs;
  }

  private readonly tick = (now: number) => {
    this.raf = 0;
    if (this.disposed || this.paused || !this.visible || document.hidden) {
      this.lastRender = 0;
      // 暂停时不画，但等待「下一帧」的调用方不能永远挂着
      if (this.frameWaiters.length) for (const resolve of this.frameWaiters.splice(0)) resolve();
      return;
    }
    this.ticking = true;
    this.again = false;
    const dt = this.lastRender ? Math.min(0.05, (now - this.lastRender) / 1000) : 1 / 60;
    // 连续绘制的帧间隔喂给调速器：GPU 跟不上时降一档像素比
    if (this.lastRender && this.governing) {
      const interval = now - this.lastRender;
      if (interval >= 4 && interval < sessionRefreshMs) sessionRefreshMs = interval;
      const next = this.governor.sample(interval);
      if (next !== null) {
        this.renderer.setPixelRatio(next);
        rememberRatioCap(next);
      }
    }
    // 环境动画幅度：操作中淡入、停止操作后约 1.5s 淡出到静止
    const goal = this.engaged ? 1 : 0;
    const ambientMoving = Math.abs(this.ambient - goal) > 0.002;
    this.ambient = ambientMoving ? damp(this.ambient, goal, 2.5, dt) : goal;

    let motion: Motion = ambientMoving || this.ambient > 0 ? Motion.Active : Motion.Idle;
    const dx = this.pointer.x - this.smooth.x;
    const dy = this.pointer.y - this.smooth.y;
    if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) {
      const k = 1 - Math.exp(-3 * dt);
      this.smooth.x += dx * k;
      this.smooth.y += dy * k;
      if (!this.reducedMotion && this.parallax > 0) motion = Motion.Active;
    }
    if (this.rig) {
      if (this.rig(dt)) motion = Motion.Active;
    } else this.applyBaseCamera();
    for (let i = 0; i < this.updaters.length; i++) {
      const m = this.updaters[i](dt, now / 1000);
      if (m > motion) motion = m;
    }

    this.lastRender = now;
    this.renderNow();
    this.ticking = false;
    if (this.frameWaiters.length) for (const resolve of this.frameWaiters.splice(0)) resolve();
    if (motion !== Motion.Idle || this.again) this.raf = requestAnimationFrame(this.tick);
    else this.lastRender = 0;
  };

  resize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.onLayout?.(width, height);
    this.markShadows();
    this.invalidate();
  }

  /**
   * 着色器预编译 + 首帧，用于真实加载进度。three 只编译可见物体：hidden 里的物体（稍后才出现的火漆、推近时的幕）
   * 在编译期间临时显示，免得它们第一次出现的那一帧才编译着色器、卡一下。
   */
  async warmUp(hidden: readonly THREE.Object3D[] = []): Promise<void> {
    for (const object of hidden) object.visible = true;
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      this.renderer.compile(this.scene, this.camera);
    } finally {
      for (const object of hidden) object.visible = false;
    }
  }

  renderNow() {
    if (this.shadowDirty) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
    }
    this.renderer.render(this.scene, this.camera);
    this.renders++;
  }

  /** 屏幕坐标 → 射线命中（raycaster 复用） */
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly hits: THREE.Intersection[] = [];
  pick(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    this.hits.length = 0;
    this.ray.intersectObjects(objects, true, this.hits);
    return this.hits[0] ?? null;
  }

  /** 3D 点 → 画布内 CSS 像素 */
  private readonly projected = new THREE.Vector3();
  project(point: THREE.Vector3, out: { x: number; y: number }): { x: number; y: number } {
    this.projected.copy(point).project(this.camera);
    out.x = (this.projected.x * 0.5 + 0.5) * this.canvas.clientWidth;
    out.y = (-this.projected.y * 0.5 + 0.5) * this.canvas.clientHeight;
    return out;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const resolve of this.frameWaiters.splice(0)) resolve();
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("pointerdown", this.onActivity);
    window.removeEventListener("keydown", this.onActivity);
    window.removeEventListener("wheel", this.onActivity);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.io.disconnect();
    this.updaters.length = 0;
    disposeTree(this.scene);
    this.envTarget.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (import.meta.env.DEV) {
      const holder = window as unknown as { __yugcStage?: Stage };
      if (holder.__yugcStage === this) delete holder.__yugcStage;
    }
  }
}

/** 释放一棵对象树里的几何体、材质与贴图 */
export function disposeTree(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    for (const m of list) {
      for (const value of Object.values(m)) if (value instanceof THREE.Texture) textures.add(value);
      m.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
}

export type CanvasTexture<T> = {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  redraw: (arg?: T) => void;
};

/** 带字贴图的超采样倍数：屏幕上占几百像素、会被推近或斜着看的贴图用它，文字边缘不糊 */
export const TEXT_SCALE = 2;

/**
 * 程序化贴图：画在 2D canvas 上，redraw 时只更新这一张贴图。
 * width/height 是绘制用的逻辑尺寸；scale > 1 时画布按倍数放大、坐标系同步缩放，draw 里的坐标不用改。
 */
export function canvasTexture<T = undefined>(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number, arg?: T) => void,
  scale = 1,
): CanvasTexture<T> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = textureAnisotropy;
  const ctx = canvas.getContext("2d");
  const redraw = (arg?: T) => {
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    draw(ctx, width, height, arg);
    texture.needsUpdate = true;
  };
  redraw();
  return { texture, canvas, redraw };
}

/** 贴地的柔和投影（径向渐变），给会动的物体用，代替实时阴影 */
export function softShadow(size = 1, strength = 0.28): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const { texture } = canvasTexture(128, 128, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, `rgba(27,33,64,${strength})`);
    g.addColorStop(1, "rgba(27,33,64,0)");
    x.clearRect(0, 0, w, w);
    x.fillStyle = g;
    x.fillRect(0, 0, w, w);
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = -1;
  return mesh;
}

/** 把 Remix 图标画到 2D canvas（贴图用）：x、y 为左上角，size 为像素边长 */
export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  for (const d of ICONS[name]) ctx.fill(new Path2D(d));
  ctx.restore();
}

/** 把校徽画成圆形（裁掉 PNG 四角的白底），cx、cy 为圆心，size 为直径 */
export function drawEmblem(ctx: CanvasRenderingContext2D, image: HTMLImageElement, cx: number, cy: number, size: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.49, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(image, cx - size / 2, cy - size / 2, size, size);
  ctx.restore();
}

/** 包围盒的 8 个角；传 matrix 时先把盒子（物体局部坐标）变换到世界坐标，得到的是贴着物体的斜盒子而不是更大的轴对齐盒 */
export function boxCorners(box: THREE.Box3, matrix?: THREE.Matrix4): THREE.Vector3[] {
  return Array.from({ length: 8 }, (_, i) => {
    const corner = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    return matrix ? corner.applyMatrix4(matrix) : corner;
  });
}

/**
 * 竖屏取景：从 dir（从主体指向相机的方向）看过去，求出让这些世界坐标点完整落在横带 band 里的相机位置与画面偏移。
 * 投影与距离的算法在 lib/cameraMath.ts 的 fitInBand（有单测）；这里只把点换到镜头坐标系。
 */
export function bandPose(points: readonly THREE.Vector3[], dir: THREE.Vector3, fovDeg: number, aspect: number, band: Band, fill = 1) {
  const back = dir.clone().normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right);
  const target = new THREE.Box3().setFromPoints(points as THREE.Vector3[]).getCenter(new THREE.Vector3());
  const rel = new THREE.Vector3();
  const local = points.map((point) => {
    rel.copy(point).sub(target);
    return { r: rel.dot(right), u: rel.dot(up), b: rel.dot(back) };
  });
  const { distance, ox, oy } = fitInBand(local, fovDeg, aspect, band, fill);
  return { pos: target.clone().addScaledVector(back, distance), target, offset: { x: ox, y: oy } };
}

/** 读取一张图片；失败时返回 null（贴图照常画，只是少了校徽） */
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export { damp };
