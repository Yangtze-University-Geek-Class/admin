// 首页首屏：浅色书桌 + 笔记本电脑（程序化建模，无外部模型）。点击屏幕 → 镜头推近 → 交给 DOM 版 YUGC OS。
// 由 pages/Home.tsx 动态加载；本模块不碰 React，只接收一个 canvas、一个悬停提示元素和几个回调。
//
// 相对原型的性能调整：像素比由 Stage 的调速器管（起步 2，跟不上就降档）、阴影 1024 且只在物体移动时刷新、机器人与热气不投实时阴影
// （贴地柔影代替）、去掉看不出的 clearcoat、键盘按键只更新变化的实例、拾取用代理几何与键盘平面换算、
// 环境动画（热气、悬浮、叶子）只在用户最近有操作时播放，静置几秒后停到静止姿态、循环停止；进入系统桌面后整个循环停下。
// 屏幕拆成三层：静态底图（大贴图，只画一次）+「开机」按钮 + 时钟（两张小贴图，悬停和走时只重画小的），
// 推近时再盖一层与开机画面同色的「幕」渐显，最后一帧与 DOM 开机画面严丝合缝，不重画大贴图、没有跳变。
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { coverDistance, viewOffset, type Band } from "../lib/cameraMath";
import type { LoaderStep } from "../lib/loaderProgress";
import { damp, ease, span } from "../lib/motion";
import { Motion, Stage, TEXT_SCALE, bandPose, boxCorners, canvasTexture, drawEmblem, loadImage, softShadow } from "./stage";

export type DeskOptions = {
  reducedMotion: boolean;
  /** 跟随指针的小提示（「点击开机」等） */
  hint: HTMLElement;
  logoUrl: string;
  /** 点中了屏幕 */
  onEnter: () => void;
  /**
   * 文案在画面下方时（竖屏），视口里留给书桌的横带（按视口高度的比例：顶栏下沿到文案上沿）；
   * 文案在左侧时返回 null，用横屏取景
   */
  band: () => Band | null;
  /** 只有空闲书桌才响应悬停与点击 */
  isIdle: () => boolean;
  report: (step: LoaderStep, text: string) => void;
  cancelled: () => boolean;
};

export type DeskHandle = {
  /** 镜头推近屏幕；onArrive 在屏幕快铺满视口时调用（此时淡入系统桌面） */
  focus(options: { instant: boolean; onArrive: () => void }): Promise<void>;
  /** 从屏幕退回书桌 */
  unfocus(instant: boolean): Promise<void>;
  /** 系统桌面盖住画布时停下渲染循环（镜头还在飞时等它飞完再停，开机画面淡入期间画面不冻住） */
  setActive(active: boolean): void;
  /** 真键盘敲一下，桌上的键盘也按一下 */
  pressKey(): void;
  readonly stage: Stage;
  dispose(): void;
};

const SCREEN_W = 1.1;
const SCREEN_H = 0.6875;
/** 屏幕贴图的逻辑尺寸（绘制坐标）；实际画布按 SCREEN_SCALE 放大 */
const SCREEN_PX_W = 1280;
const SCREEN_PX_H = 800;
const SCREEN_SCALE = 1.6;
const SCREEN_Y = 0.398;
const PAPER = "#f5f4f0";
/** 开机画面的底色（与 styles/portal.css 的 --pt-ice 一致） */
const ICE = "#fbfbfd";

type Pose = { pos: THREE.Vector3; target: THREE.Vector3; fov: number; ox: number; oy: number };

export async function createDesk(canvas: HTMLCanvasElement, options: DeskOptions): Promise<DeskHandle | null> {
  const { reducedMotion, hint, report } = options;
  const stage = new Stage(canvas, { fov: 34, background: PAPER, studio: false, reducedMotion });
  report("env", "灯光已就绪");
  if (options.cancelled()) {
    stage.dispose();
    return null;
  }
  const { scene, camera } = stage;
  scene.environmentIntensity = 0.55;
  stage.parallax = 1; // 由自定义相机装置使用；非 0 表示指针移动时需要重画

  // ── 贴图 ──────────────────────────────────────────────────────────────
  let logo: HTMLImageElement | null = null;
  const wood = canvasTexture(1024, 512, (x, w, h) => {
    x.fillStyle = "#ece2d2";
    x.fillRect(0, 0, w, h);
    let seed = 7;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 220; i++) {
      const y = rand() * h;
      x.strokeStyle = `rgba(150,112,72,${0.025 + rand() * 0.05})`;
      x.lineWidth = 0.4 + rand() * 1.6;
      x.beginPath();
      x.moveTo(0, y);
      for (let X = 0; X <= w; X += 48) x.lineTo(X, y + Math.sin(X * 0.008 + i) * 2.5);
      x.stroke();
    }
  });
  wood.texture.wrapS = wood.texture.wrapT = THREE.RepeatWrapping;
  wood.texture.repeat.set(2, 1);

  // ── 墙、桌面、光 ──────────────────────────────────────────────────────
  const deskTop = new THREE.Mesh(new RoundedBoxGeometry(6.4, 0.1, 3.6, 3, 0.03), new THREE.MeshStandardMaterial({ map: wood.texture, roughness: 0.6 }));
  deskTop.position.set(0, -0.05, 0.3);
  deskTop.receiveShadow = true;
  scene.add(deskTop);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.MeshLambertMaterial({ color: "#eef0f5" }));
  wall.position.set(0, 3.4, -1.5);
  wall.receiveShadow = true;
  scene.add(wall);

  scene.add(new THREE.HemisphereLight("#ffffff", "#e9e1d3", 0.95));
  const sun = new THREE.DirectionalLight("#fff4e4", 2.3);
  sun.position.set(-2.6, 4.4, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: 0.5, far: 12 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const fill = new THREE.DirectionalLight("#dfe6ff", 0.6);
  fill.position.set(3, 2, 2);
  scene.add(fill);

  const cast = <T extends THREE.Object3D>(root: T): T => {
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return root;
  };

  // ── 笔记本电脑 ─────────────────────────────────────────────────────────
  const alu = new THREE.MeshStandardMaterial({ color: "#d4d8e0", metalness: 0.8, roughness: 0.3 });
  const aluDeep = new THREE.MeshStandardMaterial({ color: "#b8bdc9", metalness: 0.7, roughness: 0.45 });
  const laptop = new THREE.Group();
  laptop.position.set(0.05, 0, 0);
  laptop.rotation.y = 0.2;
  scene.add(laptop);
  const base = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.036, 0.8, 2, 0.012), alu);
  base.position.y = 0.018;
  laptop.add(base);
  const well = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.004, 0.37), aluDeep);
  well.position.set(0, 0.035, -0.12);
  laptop.add(well);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.003, 0.25), new THREE.MeshStandardMaterial({ color: "#cdd1da", metalness: 0.6, roughness: 0.22 }));
  pad.position.set(0, 0.0365, 0.2);
  laptop.add(pad);

  const COLS = 13;
  const ROWS = 5;
  const KEY_PITCH_X = 0.077;
  const KEY_PITCH_Z = 0.068;
  const KEY_X0 = -0.462;
  const KEY_Z0 = -0.272;
  const KEY_Y = 0.041;
  const keys = new THREE.InstancedMesh(new RoundedBoxGeometry(0.068, 0.012, 0.058, 2, 0.005), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.5 }), COLS * ROWS);
  keys.receiveShadow = true;
  const keyPress = new Float32Array(COLS * ROWS);
  const m4 = new THREE.Matrix4();
  const tint = new THREE.Color();
  const keyX = (i: number) => KEY_X0 + (i % COLS) * KEY_PITCH_X;
  const keyZ = (i: number) => KEY_Z0 + Math.floor(i / COLS) * KEY_PITCH_Z;
  for (let i = 0; i < COLS * ROWS; i++) {
    const r = Math.floor(i / COLS);
    const c = i % COLS;
    m4.makeTranslation(keyX(i), KEY_Y, keyZ(i));
    keys.setMatrixAt(i, m4);
    keys.setColorAt(i, tint.set(r === 2 && c === 12 ? "#3346c8" : r === 0 && c === 0 ? "#f5a524" : "#f4f5f9"));
  }
  keys.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  laptop.add(keys);

  const lid = new THREE.Group();
  lid.position.set(0, 0.036, -0.395);
  lid.rotation.x = -0.27;
  laptop.add(lid);
  const shell = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.78, 0.022, 2, 0.01), alu);
  shell.position.y = 0.39;
  lid.add(shell);
  const bezel = new THREE.Mesh(new THREE.PlaneGeometry(1.172, 0.752), new THREE.MeshStandardMaterial({ color: "#14172a", roughness: 0.18, metalness: 0.1 }));
  bezel.position.set(0, 0.392, 0.0112);
  lid.add(bezel);

  // 屏幕底图：只画一次（和校徽加载完再补画一次），悬停与走时都不碰它
  const screenTex = canvasTexture(
    SCREEN_PX_W,
    SCREEN_PX_H,
    (x, W, H) => {
      const g = x.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#f9faff");
      g.addColorStop(1, "#e4e9ff");
      x.fillStyle = g;
      x.fillRect(0, 0, W, H);
      x.fillStyle = "rgba(51,70,200,0.10)";
      for (let y = 70; y < H; y += 32) for (let X = 22; X < W; X += 32) x.fillRect(X, y, 2, 2);
      x.fillStyle = "rgba(255,255,255,0.8)";
      x.fillRect(0, 0, W, 44);
      if (logo) drawEmblem(x, logo, 33, 22, 26);
      x.textAlign = "left";
      x.fillStyle = "#1b2140";
      x.font = '600 21px -apple-system, "PingFang SC", sans-serif';
      x.fillText("YUGC OS", 58, 29);
      x.textAlign = "center";
      if (logo) drawEmblem(x, logo, W / 2, 260, 220);
      x.fillStyle = "#1b2140";
      x.font = '700 52px -apple-system, "PingFang SC", sans-serif';
      x.fillText("YUGC OS", W / 2, 448);
      x.fillStyle = "#5b6283";
      x.font = '26px -apple-system, "PingFang SC", sans-serif';
      x.fillText("长江大学极客班", W / 2, 494);
      // 触屏设备没有 Enter 键，不写这行
      if (!window.matchMedia("(hover: none)").matches) {
        x.fillStyle = "#676e8e";
        x.font = '20px -apple-system, "PingFang SC", sans-serif';
        x.fillText("按 Enter 也能开机", W / 2, 716);
      }
    },
    SCREEN_SCALE,
  );
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), new THREE.MeshBasicMaterial({ map: screenTex.texture, toneMapped: false }));
  screen.position.set(0, SCREEN_Y, 0.0116);
  lid.add(screen);
  /** 屏幕贴图上的一块矩形（绘制坐标）→ 盖在屏幕上的小平面 */
  const screenPatch = (left: number, top: number, width: number, height: number, map: THREE.Texture, z: number) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry((SCREEN_W * width) / SCREEN_PX_W, (SCREEN_H * height) / SCREEN_PX_H),
      new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }),
    );
    mesh.position.set(((left + width / 2) / SCREEN_PX_W - 0.5) * SCREEN_W, SCREEN_Y + (0.5 - (top + height / 2) / SCREEN_PX_H) * SCREEN_H, z);
    mesh.renderOrder = 1;
    lid.add(mesh);
    return mesh;
  };
  // 「开机」按钮（悬停时加深、外面一圈光晕）
  const buttonTex = canvasTexture<boolean>(
    344,
    94,
    (x, w, h, hot) => {
      x.clearRect(0, 0, w, h);
      if (hot) {
        x.fillStyle = "rgba(51,70,200,0.16)";
        x.beginPath();
        x.roundRect(0, 0, w, h, h / 2);
        x.fill();
      }
      x.fillStyle = hot ? "#2436b8" : "#3346c8";
      x.beginPath();
      x.roundRect(12, 12, w - 24, h - 24, (h - 24) / 2);
      x.fill();
      x.fillStyle = "#fff";
      x.textAlign = "center";
      x.font = '600 28px -apple-system, "PingFang SC", sans-serif';
      x.fillText("开机", w / 2, 58);
    },
    TEXT_SCALE,
  );
  screenPatch(SCREEN_PX_W / 2 - 172, 548, 344, 94, buttonTex.texture, 0.0118);
  // 顶栏右侧的时钟：每 20 秒只重画这一小块
  const clockTex = canvasTexture(
    120,
    44,
    (x, w) => {
      x.clearRect(0, 0, w, 44);
      x.fillStyle = "#5b6283";
      x.font = '20px "SF Mono", Menlo, monospace';
      x.textAlign = "right";
      x.fillText(new Date().toTimeString().slice(0, 5), w - 14, 29);
    },
    TEXT_SCALE,
  );
  screenPatch(SCREEN_PX_W - 130, 0, 120, 44, clockTex.texture, 0.0118);
  // 推近时渐显的「幕」：与开机画面同色，盖住屏幕内容
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), new THREE.MeshBasicMaterial({ color: ICE, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  veil.position.set(0, SCREEN_Y, 0.012);
  veil.renderOrder = 2;
  veil.visible = false;
  lid.add(veil);
  const setVeil = (opacity: number) => {
    veil.material.opacity = opacity;
    veil.visible = opacity > 0.001;
  };
  const webcam = new THREE.Mesh(new THREE.CircleGeometry(0.006, 12), new THREE.MeshBasicMaterial({ color: "#2b3150" }));
  webcam.position.set(0, 0.758, 0.0114);
  lid.add(webcam);
  cast(laptop);
  keys.castShadow = false;
  lid.traverse((o) => {
    if (o !== shell && o !== bezel) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  let screenHot = false;

  // ── 桌面小物 ───────────────────────────────────────────────────────────
  const mug = new THREE.Group();
  mug.position.set(1.08, 0, 0.36);
  scene.add(mug);
  const ceramic = new THREE.MeshStandardMaterial({ color: "#fbfbfd", roughness: 0.22 });
  const mugBody = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.105, 0.26, 36, 1, true), ceramic);
  mugBody.position.y = 0.13;
  const mugIn = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.097, 0.25, 36, 1, true), new THREE.MeshStandardMaterial({ color: "#f1f1f4", side: THREE.BackSide, roughness: 0.3 }));
  mugIn.position.y = 0.135;
  const mugBottom = new THREE.Mesh(new THREE.CircleGeometry(0.105, 36), ceramic);
  mugBottom.rotation.x = -Math.PI / 2;
  mugBottom.position.y = 0.002;
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.104, 36), new THREE.MeshStandardMaterial({ color: "#6b4630", roughness: 0.15 }));
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = 0.215;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.1162, 0.1142, 0.03, 36, 1, true), new THREE.MeshStandardMaterial({ color: "#3346c8", roughness: 0.35 }));
  band.position.y = 0.17;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.016, 10, 24, Math.PI), ceramic);
  handle.rotation.z = -Math.PI / 2;
  handle.position.set(0.112, 0.13, 0);
  mug.add(mugBody, mugIn, mugBottom, coffee, band, handle);
  mug.rotation.y = -0.9;
  cast(mug);
  const steamTex = canvasTexture(128, 128, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.clearRect(0, 0, w, w);
    x.fillStyle = g;
    x.fillRect(0, 0, w, w);
  });
  const steam = Array.from({ length: 5 }, (_, i) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex.texture, transparent: true, depthWrite: false, opacity: 0 }));
    sprite.userData.phase = i / 5;
    mug.add(sprite);
    return sprite;
  });
  let steamBurst = 0;

  const plant = new THREE.Group();
  plant.position.set(-1.32, 0, -0.62);
  scene.add(plant);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.115, 0.26, 32), new THREE.MeshStandardMaterial({ color: "#f6f3ee", roughness: 0.45 }));
  pot.position.y = 0.13;
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.14, 24), new THREE.MeshStandardMaterial({ color: "#5a4636", roughness: 1 }));
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = 0.25;
  plant.add(pot, soil);
  const leafGeo = new THREE.SphereGeometry(1, 16, 10);
  const leafLight = new THREE.MeshStandardMaterial({ color: "#6db287", roughness: 0.55 });
  const leafDark = new THREE.MeshStandardMaterial({ color: "#4f9a6f", roughness: 0.55 });
  const leaves: THREE.Group[] = [];
  for (let i = 0; i < 9; i++) {
    const pivot = new THREE.Group();
    pivot.position.y = 0.25;
    pivot.rotation.y = (i / 9) * Math.PI * 2 + (i % 2) * 0.3;
    const leaf = new THREE.Mesh(leafGeo, i % 3 ? leafLight : leafDark);
    const len = 0.2 + (i % 3) * 0.06;
    leaf.scale.set(0.045, len, 0.012);
    leaf.position.y = len;
    pivot.add(leaf);
    pivot.userData.tilt = 0.35 + (i % 3) * 0.18;
    pivot.rotation.z = pivot.userData.tilt as number;
    plant.add(pivot);
    leaves.push(pivot);
  }
  cast(plant);
  let plantWiggle = 0;

  // NANO 的小机器人：白色圆头、深蓝面罩、蓝色眼睛、两侧耳环。悬浮着，用贴地柔影代替实时阴影。
  const robot = new THREE.Group();
  robot.position.set(-0.86, 0.3, 0.42);
  scene.add(robot);
  const head = new THREE.Group();
  robot.add(head);
  const white = new THREE.MeshStandardMaterial({ color: "#fbfcff", roughness: 0.25 });
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 20), white));
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.1335, 32, 20, Math.PI * 0.16, Math.PI * 0.68, Math.PI * 0.3, Math.PI * 0.4),
    new THREE.MeshStandardMaterial({ color: "#1b2350", roughness: 0.12, metalness: 0.3 }),
  );
  head.add(visor);
  const eyeMat = new THREE.MeshBasicMaterial({ color: "#8fd3ff", toneMapped: false });
  const eyes = [-0.042, 0.042].map((x) => {
    const eye = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.024, 4, 10), eyeMat);
    eye.position.set(x, 0.012, 0.128);
    head.add(eye);
    return eye;
  });
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 6, 16, Math.PI), eyeMat);
  mouth.position.set(0, -0.035, 0.127);
  mouth.rotation.z = Math.PI;
  head.add(mouth);
  const earDot = new THREE.MeshStandardMaterial({ color: "#3346c8", roughness: 0.4 });
  for (const side of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.013, 12, 28), white);
    ring.position.x = side * 0.128;
    ring.rotation.y = Math.PI / 2;
    head.add(ring);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.04, 20), earDot);
    dot.position.x = side * 0.131;
    dot.rotation.y = (side * Math.PI) / 2;
    head.add(dot);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.07, 8), white);
  antenna.position.y = 0.16;
  head.add(antenna);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 8), new THREE.MeshBasicMaterial({ color: "#f5a524", toneMapped: false }));
  bulb.position.y = 0.2;
  head.add(bulb);
  const robotShadow = softShadow(0.36, 0.35);
  robotShadow.position.set(-0.86, 0.002, 0.42);
  scene.add(robotShadow);
  let robotHop = 0;
  let blinkAt = 2.5;

  const notebook = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.022, 0.31, 2, 0.006), new THREE.MeshStandardMaterial({ color: "#3346c8", roughness: 0.55 }));
  notebook.position.set(-0.52, 0.011, 0.78);
  notebook.rotation.y = 0.35;
  scene.add(cast(notebook));
  const pencil = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.34, 6), new THREE.MeshStandardMaterial({ color: "#f5a524", roughness: 0.5 }));
  pencil.rotation.set(0, 0.1, Math.PI / 2);
  pencil.position.set(-0.5, 0.032, 0.78);
  scene.add(cast(pencil));

  const note = (text: string, color: string, size = 0.2) => {
    const tex = canvasTexture(
      256,
      256,
      (x, W) => {
        x.fillStyle = color;
        x.fillRect(0, 0, W, W);
        x.fillStyle = "rgba(0,0,0,0.05)";
        x.fillRect(0, 0, W, 34);
        x.fillStyle = "#1b2140";
        x.font = '600 30px "SF Mono", Menlo, "PingFang SC", monospace';
        x.textAlign = "center";
        text.split("\n").forEach((line, i) => x.fillText(line, W / 2, 120 + i * 44));
      },
      TEXT_SCALE,
    );
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: tex.texture, roughness: 0.9 }));
    mesh.receiveShadow = true;
    return mesh;
  };
  const n1 = note("TODO\n写 README", "#ffe27a");
  n1.rotation.set(-Math.PI / 2, 0, -0.25);
  n1.position.set(0.78, 0.0015, 0.66);
  scene.add(n1);
  const n2 = note("git pull", "#dfe5ff", 0.17);
  n2.rotation.set(-Math.PI / 2, 0, 0.18);
  n2.position.set(0.96, 0.0016, 0.86);
  scene.add(n2);

  const poster = canvasTexture(
    512,
    640,
    (x) => {
      x.fillStyle = "#fbfaf7";
      x.fillRect(0, 0, 512, 640);
      if (logo) drawEmblem(x, logo, 256, 250, 300);
      x.fillStyle = "#1b2140";
      x.textAlign = "center";
      x.font = '700 40px "PingFang SC", "Hiragino Sans GB", sans-serif';
      x.fillText("长江大学极客班", 256, 500);
    },
    TEXT_SCALE,
  );
  const frame = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.9, 0.03, 2, 0.008), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.5 }));
  frame.position.set(-0.55, 0.92, -1.48);
  frame.scale.setScalar(0.8);
  scene.add(cast(frame));
  const posterMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.8), new THREE.MeshStandardMaterial({ map: poster.texture, roughness: 0.8 }));
  posterMesh.position.set(-0.55, 0.92, -1.463);
  posterMesh.scale.setScalar(0.8);
  scene.add(posterMesh);
  report("scene", "书桌已摆好");

  // ── 镜头 ───────────────────────────────────────────────────────────────
  let idle: Pose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 33, ox: 0, oy: 0 };
  const pose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), shift: 1 };
  let focused = false;
  /** 指针视差的权重：镜头飞行时为 0，落回书桌后缓缓回到 1，飞行结束的那一帧不会被视差「拽」一下 */
  let parallaxK = 1;
  /** 外部希望循环运行吗（系统桌面盖住画布时为 false）；飞行中先不停，飞完再停 */
  let wantActive = true;
  const focusPos = new THREE.Vector3();
  const focusTarget = new THREE.Vector3();
  const tmpNormal = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const computeFocus = () => {
    scene.updateMatrixWorld(true);
    screen.getWorldPosition(focusTarget);
    tmpNormal.set(0, 0, 1).applyQuaternion(screen.getWorldQuaternion(tmpQuat));
    const d = coverDistance(camera.fov, camera.aspect, SCREEN_W, SCREEN_H, 0.88);
    focusPos.copy(focusTarget).addScaledVector(tmpNormal, d);
  };
  const offset = { x: 0, y: 0 };
  const applyCamera = () => {
    camera.position.copy(pose.pos);
    camera.lookAt(pose.target);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (pose.shift > 0.001) {
      viewOffset(w, h, idle.ox, idle.oy, pose.shift, offset);
      camera.setViewOffset(w, h, offset.x, offset.y, w, h);
    } else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };
  // 竖屏：电脑落在顶栏与文案之间那条横带的正中，横向尽量占满（stage.ts 的 bandPose 按透视算距离与偏移）；
  // 手机、竖放平板、分屏窗口都用同一套算法，不为每种比例单独调数。取机身与屏幕外壳贴身的角点，四周留 6%
  const PORTRAIT_FOV = 40;
  const PORTRAIT_DIR = new THREE.Vector3(1.0, 2.0, 3.3);
  const portraitPose = (aspect: number, band: Band): Pose => {
    scene.updateMatrixWorld(true);
    base.geometry.computeBoundingBox();
    shell.geometry.computeBoundingBox();
    const points = [...boxCorners(base.geometry.boundingBox!, base.matrixWorld), ...boxCorners(shell.geometry.boundingBox!, shell.matrixWorld)];
    const { pos, target, offset } = bandPose(points, PORTRAIT_DIR, PORTRAIT_FOV, aspect, band, 0.94);
    return { pos, target, fov: PORTRAIT_FOV, ox: offset.x, oy: offset.y };
  };
  stage.onLayout = (w, h) => {
    const band = options.band();
    // 竖屏镜头从高处俯看，墙上的海报会落在顶栏品牌字后面（校徽也和品牌重复），竖屏不挂
    frame.visible = posterMesh.visible = band === null;
    idle = band
      ? portraitPose(w / h, band)
      : { pos: new THREE.Vector3(2.25, 1.6, 2.75), target: new THREE.Vector3(-0.1, 0.36, 0.0), fov: 33, ox: -0.17, oy: 0.02 };
    camera.fov = idle.fov;
    camera.aspect = w / h;
    if (focused) {
      computeFocus();
      pose.pos.copy(focusPos);
      pose.target.copy(focusTarget);
      pose.shift = 0;
    } else if (!anim) {
      pose.pos.copy(idle.pos);
      pose.target.copy(idle.target);
      pose.shift = 1;
    }
    applyCamera();
  };

  type Anim = {
    /** 已播放的毫秒数（按夹紧后的帧 dt 累加，卡帧不跳步） */
    elapsed: number;
    ms: number;
    fromPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    fromShift: number;
    toPos: THREE.Vector3;
    toTarget: THREE.Vector3;
    toShift: number;
    onProgress?: (p: number) => void;
    done: () => void;
  };
  let anim: Anim | null = null;
  const fly = (toPos: THREE.Vector3, toTarget: THREE.Vector3, toShift: number, ms: number, onProgress?: (p: number) => void) =>
    new Promise<void>((resolve) => {
      anim = { elapsed: 0, ms, fromPos: pose.pos.clone(), fromTarget: pose.target.clone(), fromShift: pose.shift, toPos: toPos.clone(), toTarget: toTarget.clone(), toShift, onProgress, done: resolve };
      stage.invalidate();
    });

  stage.rig = (dt) => {
    let moving = false;
    if (anim) {
      anim.elapsed += dt * 1000;
      const p = Math.min(1, anim.elapsed / anim.ms);
      const e = ease.inOut(p);
      pose.pos.lerpVectors(anim.fromPos, anim.toPos, e);
      pose.target.lerpVectors(anim.fromTarget, anim.toTarget, e);
      pose.shift = anim.fromShift + (anim.toShift - anim.fromShift) * e;
      anim.onProgress?.(p);
      parallaxK = 0;
      moving = true;
      if (p >= 1) {
        const done = anim.done;
        anim = null;
        done();
        if (!wantActive) stage.setPaused(true);
      }
    } else if (!focused && !reducedMotion) {
      if (parallaxK < 0.999) {
        parallaxK = damp(parallaxK, 1, 3, dt);
        moving = true;
      } else parallaxK = 1;
      const s = stage.smooth;
      const k = parallaxK;
      pose.pos.set(idle.pos.x + s.x * 0.22 * k, idle.pos.y + s.y * 0.1 * k, idle.pos.z - s.x * 0.08 * k);
      pose.target.copy(idle.target);
    }
    applyCamera();
    return moving;
  };

  // ── 拾取：屏幕是两个三角形；其余物体用包围盒；键盘按平面换算格子 ────────
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hits: THREE.Intersection[] = [];
  const box = new THREE.Box3();
  const hitPoint = new THREE.Vector3();
  const keyLocal = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const keyPlane = new THREE.Plane();
  const planeNormal = new THREE.Vector3();
  const planePoint = new THREE.Vector3();
  type Target = { name: "screen" | "robot" | "mug" | "plant"; hint: string };
  const TARGETS: Array<Target & { object: THREE.Object3D; exact?: boolean }> = [
    { name: "screen", hint: "打开电脑", object: lid, exact: true },
    { name: "robot", hint: "点一下会跳", object: robot },
    { name: "mug", hint: "点一下冒热气", object: mug },
    { name: "plant", hint: "点一下会晃", object: plant },
  ];
  const screenParts: THREE.Object3D[] = [screen, bezel, shell];
  const pick = (clientX: number, clientY: number, touchKeys: boolean): Target | null => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (touchKeys) {
      // 键盘所在平面：笔记本局部 y = KEY_Y
      laptop.updateMatrixWorld();
      planeNormal.set(0, 1, 0).transformDirection(laptop.matrixWorld);
      planePoint.set(0, KEY_Y, 0).applyMatrix4(laptop.matrixWorld);
      keyPlane.setFromNormalAndCoplanarPoint(planeNormal, planePoint);
      if (ray.ray.intersectPlane(keyPlane, hitPoint)) {
        keyLocal.copy(hitPoint).applyMatrix4(inverse.copy(laptop.matrixWorld).invert());
        const c = Math.round((keyLocal.x - KEY_X0) / KEY_PITCH_X);
        const r = Math.round((keyLocal.z - KEY_Z0) / KEY_PITCH_Z);
        if (c >= 0 && c < COLS && r >= 0 && r < ROWS) press(r * COLS + c);
      }
    }
    for (let i = 0; i < TARGETS.length; i++) {
      const target = TARGETS[i];
      if (target.exact) {
        hits.length = 0;
        ray.intersectObjects(screenParts, false, hits);
        if (hits.length) return target;
        continue;
      }
      box.setFromObject(target.object);
      if (ray.ray.intersectsBox(box)) return target;
    }
    return null;
  };

  let dirtyMin = Infinity;
  let dirtyMax = -1;
  const press = (i: number) => {
    keyPress[i] = 1;
    stage.invalidate();
  };

  let hot: Target | null = null;
  let pointerX = 0;
  let pointerY = 0;
  let pendingPick = false;
  const setHot = (next: Target | null) => {
    if (next?.name === hot?.name) return;
    if ((next?.name === "screen") !== (hot?.name === "screen")) {
      screenHot = next?.name === "screen";
      buttonTex.redraw(screenHot);
    }
    hot = next;
    canvas.classList.toggle("is-hot", Boolean(hot));
    hint.classList.toggle("is-on", Boolean(hot));
    if (hot) hint.textContent = hot.hint;
  };
  const onMove = (event: PointerEvent) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!options.isIdle()) return;
    pendingPick = true; // 拾取放到下一帧的更新里做，一帧最多一次
    hint.style.transform = `translate(${pointerX}px, ${pointerY}px) translate(-50%, -140%)`;
    stage.invalidate();
  };
  const onLeave = () => {
    setHot(null);
    pendingPick = false;
  };
  const onClick = (event: MouseEvent) => {
    if (!options.isIdle()) return;
    const target = pick(event.clientX, event.clientY, false);
    if (target?.name === "screen") options.onEnter();
    else if (target?.name === "robot") robotHop = 1;
    else if (target?.name === "mug") steamBurst = 1;
    else if (target?.name === "plant") plantWiggle = 1;
    stage.invalidate();
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("click", onClick);

  // 屏幕上的时钟：每 20 秒重画一次那一小块贴图（只在书桌可见时）
  const clock = window.setInterval(() => {
    if (!stage.isPaused && !focused) {
      clockTex.redraw();
      stage.invalidate();
    }
  }, 20000);

  // ── 每帧更新：返回这一帧之后还要不要继续画 ─────────────────────────────
  stage.add((dt, time) => {
    let motion: Motion = Motion.Idle;
    if (pendingPick) {
      pendingPick = false;
      setHot(pick(pointerX, pointerY, true));
    }
    // 环境动画幅度：用户最近有操作时为 1，静置后缓缓归零；推近屏幕时直接归零
    const amb = focused ? 0 : stage.ambient;

    // 机器人：悬浮、看向指针、偶尔眨眼、被点会跳一下
    if (robotHop > 0) {
      robotHop = Math.max(0, robotHop - dt * 1.6);
      motion = Motion.Active;
    }
    const bob = Math.sin(time * 1.6) * 0.018 * amb;
    robot.position.y = 0.3 + bob + Math.sin(robotHop * Math.PI) * 0.14;
    robot.rotation.z = Math.sin(robotHop * Math.PI * 2) * 0.12;
    const s = stage.smooth;
    const yaw = Math.atan2(camera.position.x + s.x * 1.2 - robot.position.x, camera.position.z - robot.position.z);
    const k = 1 - Math.exp(-4 * dt);
    const dYaw = yaw - head.rotation.y;
    const dPitch = -s.y * 0.35 - head.rotation.x;
    head.rotation.y += dYaw * k;
    head.rotation.x += dPitch * k;
    if (Math.abs(dYaw) > 0.002 || Math.abs(dPitch) > 0.002) motion = Motion.Active;
    if (amb > 0.5 && time > blinkAt) {
      const closed = time < blinkAt + 0.12;
      eyes[0].scale.y = eyes[1].scale.y = closed ? 0.15 : 1;
      if (!closed) blinkAt = time + 2.5 + Math.random() * 3;
    }
    robotShadow.material.opacity = 1 - (robot.position.y - 0.3) * 3;

    // 键盘：只更新按下中的键，并只上传变化的实例区间
    dirtyMin = Infinity;
    dirtyMax = -1;
    for (let i = 0; i < keyPress.length; i++) {
      if (keyPress[i] <= 0) continue;
      keyPress[i] *= Math.pow(0.02, dt);
      if (keyPress[i] < 0.001) keyPress[i] = 0;
      m4.makeTranslation(keyX(i), KEY_Y - keyPress[i] * 0.007, keyZ(i));
      keys.setMatrixAt(i, m4);
      if (i < dirtyMin) dirtyMin = i;
      if (i > dirtyMax) dirtyMax = i;
    }
    if (dirtyMax >= 0) {
      keys.instanceMatrix.clearUpdateRanges();
      keys.instanceMatrix.addUpdateRange(dirtyMin * 16, (dirtyMax - dirtyMin + 1) * 16);
      keys.instanceMatrix.needsUpdate = true;
      motion = Motion.Active;
    }

    // 热气（环境动画）；被点过会冒得更多
    if (steamBurst > 0) {
      steamBurst = Math.max(0, steamBurst - dt * 0.5);
      motion = Motion.Active;
    }
    for (let i = 0; i < steam.length; i++) {
      const sprite = steam[i];
      const phase = sprite.userData.phase as number;
      const p = (time * (0.22 + steamBurst * 0.5) + phase) % 1;
      sprite.position.set(Math.sin(time * 1.3 + phase * 9) * 0.03, 0.26 + p * 0.42, 0);
      const size = 0.09 + p * 0.16;
      sprite.scale.set(size, size, 1);
      sprite.material.opacity = Math.sin(p * Math.PI) * (0.32 * amb + steamBurst * 0.72);
    }

    // 植物：被点会抖一抖；抖动时叶子的影子要跟着刷新
    if (plantWiggle > 0) {
      plantWiggle = Math.max(0, plantWiggle - dt * 0.9);
      stage.markShadows();
      motion = Motion.Active;
    }
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      const sway = Math.sin(time * 1.2 + i) * 0.02 * amb;
      leaf.rotation.z = (leaf.userData.tilt as number) + sway + Math.sin(time * 18 + i) * 0.12 * plantWiggle;
    }

    return motion;
  });

  // ── 就绪：校徽贴图、着色器编译、第一帧 ─────────────────────────────────
  logo = await loadImage(options.logoUrl);
  if (options.cancelled()) {
    dispose();
    return null;
  }
  screenTex.redraw();
  poster.redraw();
  report("emblem", "校徽已加载");
  stage.resize();
  await stage.warmUp([veil]);
  if (options.cancelled()) {
    dispose();
    return null;
  }
  report("compile", "画面预热完成");
  await stage.nextFrame();
  if (options.cancelled()) {
    dispose();
    return null;
  }
  report("frame", "准备好了");

  function dispose() {
    window.clearInterval(clock);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerleave", onLeave);
    canvas.removeEventListener("click", onClick);
    canvas.classList.remove("is-hot");
    hint.classList.remove("is-on");
    stage.dispose();
  }

  return {
    stage,
    async focus({ instant, onArrive }) {
      setHot(null);
      computeFocus();
      focused = true;
      if (instant || reducedMotion) {
        anim = null;
        setVeil(1);
        pose.pos.copy(focusPos);
        pose.target.copy(focusTarget);
        pose.shift = 0;
        applyCamera();
        await stage.nextFrame();
        onArrive();
        return;
      }
      let arrived = false;
      // 幕在镜头飞到 30%–75% 之间渐显；82% 时屏幕已经铺满视口，交给 DOM 开机画面（同色，看不出交接）
      await fly(focusPos, focusTarget, 0, 1350, (p) => {
        setVeil(ease.inOut(span(p, 0.3, 0.75)));
        if (!arrived && p > 0.82) {
          arrived = true;
          onArrive();
        }
      });
      if (!arrived) onArrive();
    },
    async unfocus(instant) {
      focused = false;
      screenHot = false;
      buttonTex.redraw(false);
      stage.setPaused(false);
      if (instant || reducedMotion) {
        anim = null;
        setVeil(0);
        parallaxK = 1;
        pose.pos.copy(idle.pos);
        pose.target.copy(idle.target);
        pose.shift = 1;
        applyCamera();
        stage.invalidate();
        return;
      }
      // 退回时幕在前 40% 渐隐（此时 DOM 桌面也在淡出），镜头落回书桌后视差再缓缓接上
      await fly(idle.pos, idle.target, 1, 1100, (p) => setVeil(1 - ease.inOut(span(p, 0.05, 0.45))));
    },
    setActive(active) {
      wantActive = active;
      if (active || !anim) stage.setPaused(!active);
    },
    pressKey() {
      if (focused) return;
      press(Math.floor(Math.random() * keyPress.length));
    },
    dispose,
  };
}
