// 首页首屏：浅色书桌 + 横屏笔记本 / 竖屏 iPhone 模型。点击屏幕 → 镜头推近 → 交给 DOM 版 YUGC OS。
// 由 pages/Home.tsx 动态加载；本模块不碰 React，只接收一个 canvas、一个悬停提示元素和几个回调。
//
// 相对原型的性能调整：像素比由 Stage 的调速器管（起步 2，跟不上就降档）、阴影 1024 且只在物体移动时刷新、机器人与热气不投实时阴影
// （贴地柔影代替）、去掉看不出的 clearcoat、键盘按压只更新按住中的键并一次 flush、拾取用代理几何与键盘按真实键矩形换算，
// 环境动画（热气、悬浮、叶子）只在用户最近有操作时播放，静置几秒后停到静止姿态、循环停止；进入系统桌面后整个循环停下。
// 屏幕拆成三层：静态底图（大贴图，只画一次）+「开机」按钮 + 时钟（两张小贴图，悬停和走时只重画小的），
// 推近时再盖一层与开机画面同色的「幕」渐显，最后一帧与 DOM 开机画面严丝合缝，不重画大贴图、没有跳变。
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { coverDistance, viewOffset, type Band } from "../lib/cameraMath";
import type { LoaderStep } from "../lib/loaderProgress";
import { damp, ease, span } from "../lib/motion";
import { LAPTOP_DISPLAY, createLaptop } from "./laptop";
import { loadPhone } from "./phone";
import { createCoaster, createMug, createNotebook, createPencil, createPlant, createPortrait } from "./props";
import { Motion, PALETTE, Stage, TEXT_SCALE, bandPose, boxCorners, canvasTexture, drawEmblem, loadImage, softShadow } from "./stage";

export type DeskOptions = {
  reducedMotion: boolean;
  /** 跟随指针的小提示（「点击开机」等） */
  hint: HTMLElement;
  logoUrl: string;
  /** 墙上挂画用的极客娘画像（整幅不透明插画） */
  portraitUrl: string;
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

/** 屏幕几何与位置取 laptop.ts 的模型常量，集成不再单独调 */
const SCREEN_W = LAPTOP_DISPLAY.width;
const SCREEN_H = LAPTOP_DISPLAY.height;
/** 屏幕贴图的逻辑尺寸（绘制坐标）；实际画布按 SCREEN_SCALE 放大 */
const SCREEN_PX_W = 1280;
const SCREEN_PX_H = 800;
const SCREEN_SCALE = 1.6;
const SCREEN_Y = LAPTOP_DISPLAY.y;
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
  let portrait: HTMLImageElement | null = null;
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

  // ── 笔记本电脑（建模在 laptop.ts：圆角薄壳、错列深色键盘、铰链与端口细节）──
  const { laptop, lid, shell, bezel, display, keyboard } = createLaptop();
  scene.add(laptop);
  /** 每个键的按压量 0..1，逐帧阻尼后交给 keyboard.setPressed */
  const keyPress = new Float32Array(keyboard.keys.length);

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
  const screen = new THREE.Mesh(display, new THREE.MeshBasicMaterial({ map: screenTex.texture, toneMapped: false }));
  screen.name = "laptop-screen";
  screen.position.set(0, SCREEN_Y, LAPTOP_DISPLAY.z);
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
  const veil = new THREE.Mesh(display.clone(), new THREE.MeshBasicMaterial({ color: ICE, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  veil.name = "laptop-veil";
  veil.position.set(0, SCREEN_Y, LAPTOP_DISPLAY.z + 0.0004);
  veil.renderOrder = 2;
  veil.visible = false;
  lid.add(veil);
  const setVeil = (opacity: number) => {
    veil.material.opacity = opacity;
    veil.visible = opacity > 0.001;
    phoneVeil.material.opacity = opacity;
    phoneVeil.visible = opacity > 0.001;
  };
  cast(laptop);
  for (const v of keyboard.visuals) v.castShadow = false;
  lid.traverse((o) => {
    if (o !== shell && o !== bezel) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  let screenHot = false;

  // 手机屏幕在局部 XY 平面，整个机身平放到桌面，法线朝上。
  const device = await loadPhone(0.62).catch(error => {
    stage.dispose();
    throw error;
  });
  const { phone, bounds: phoneBounds } = device;
  phone.position.set(0.05, -phoneBounds.min.z + 0.003, 0.12);
  phone.rotation.set(-Math.PI / 2, 0, -0.12);
  scene.add(phone);
  if (options.cancelled()) {
    stage.dispose();
    return null;
  }
  const phoneTex = canvasTexture(620, Math.round(620 * device.size.y / device.size.x), (x, W, H) => {
    x.clearRect(0, 0, W, H);
    const gradient = x.createLinearGradient(0, 0, W, H);
    gradient.addColorStop(0, ICE);
    gradient.addColorStop(1, PALETTE.cobaltSoft);
    x.fillStyle = gradient;
    x.fillRect(0, 0, W, H);
    x.fillStyle = PALETTE.ink;
    x.textAlign = "left";
    x.font = '600 30px "SF Mono", Menlo, monospace';
    x.fillText(new Date().toTimeString().slice(0, 5), 44, 64);
    if (logo) drawEmblem(x, logo, W / 2, 440, 230);
    x.textAlign = "center";
    x.fillStyle = PALETTE.ink;
    x.font = '700 56px "PingFang SC", sans-serif';
    x.fillText("YUGC OS", W / 2, 636);
    x.fillStyle = PALETTE.inkSoft;
    x.font = '28px "PingFang SC", sans-serif';
    x.fillText("长江大学极客班", W / 2, 692);
    x.fillText("点一下，打开手机", W / 2, 1000);
    x.fillStyle = PALETTE.ink;
    x.beginPath();
    x.roundRect(W / 2 - 90, H - 44, 180, 8, 4);
    x.fill();
  }, TEXT_SCALE);
  const phoneScreenW = device.size.x;
  const phoneScreenH = device.size.y;
  const phoneScreen = new THREE.Mesh(device.display, new THREE.MeshBasicMaterial({ map: phoneTex.texture, toneMapped: false }));
  phoneScreen.name = "phone-screen";
  phoneScreen.position.copy(device.center);
  phoneScreen.position.z += 0.0002;
  phone.add(phoneScreen);
  const phoneButton = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.093), new THREE.MeshBasicMaterial({ map: buttonTex.texture, transparent: true, depthWrite: false, toneMapped: false }));
  phoneButton.position.set(0, -0.23, phoneScreen.position.z + 0.0002);
  phone.add(phoneButton);
  const phoneVeil = new THREE.Mesh(device.display.clone(), veil.material.clone());
  phoneVeil.position.copy(phoneScreen.position);
  phoneVeil.position.z += 0.0006;
  phoneVeil.renderOrder = 2;
  phoneVeil.visible = false;
  phone.add(phoneVeil);
  let phoneMode = false;

  // ── 桌面小物 ───────────────────────────────────────────────────────────
  const coaster = createCoaster();
  coaster.position.set(1.08, 0, 0.36);
  scene.add(coaster);
  const mug = createMug();
  mug.position.set(1.08, 0.008, 0.36);
  mug.rotation.y = -0.9;
  scene.add(mug);
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

  const { group: plant, leaves } = createPlant();
  plant.position.set(-1.32, 0, -0.62);
  plant.scale.setScalar(1.2);
  scene.add(plant);
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

  const notebook = createNotebook();
  notebook.position.set(-0.52, 0, 0.78);
  notebook.rotation.y = 0.35;
  scene.add(cast(notebook));
  const pencil = createPencil();
  pencil.rotation.y = 0.1;
  pencil.position.set(-0.5, 0.0317, 0.78);
  scene.add(cast(pencil));

  // 便签：纸面带明暗渐变与粘条，下沿微微翘起；每张下面垫一层柔影（不投实时阴影）
  const noteShadowTex = canvasTexture(64, 64, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, "rgba(40,30,20,0.34)");
    g.addColorStop(0.6, "rgba(40,30,20,0.12)");
    g.addColorStop(1, "rgba(40,30,20,0)");
    x.clearRect(0, 0, w, w);
    x.fillStyle = g;
    x.fillRect(0, 0, w, w);
  });
  const note = (text: string, color: string, size = 0.2) => {
    const tex = canvasTexture(
      256,
      256,
      (x, W) => {
        x.fillStyle = color;
        x.fillRect(0, 0, W, W);
        const shade = x.createLinearGradient(0, 0, 0, W);
        shade.addColorStop(0, "rgba(255,255,255,0.22)");
        shade.addColorStop(0.55, "rgba(255,255,255,0)");
        shade.addColorStop(1, "rgba(60,40,0,0.12)");
        x.fillStyle = shade;
        x.fillRect(0, 0, W, W);
        x.fillStyle = "rgba(0,0,0,0.06)";
        x.fillRect(0, 0, W, 34);
        x.fillStyle = "rgba(0,0,0,0.05)";
        x.fillRect(0, 34, W, 2);
        x.fillStyle = "#1b2140";
        x.font = '600 30px "SF Mono", Menlo, "PingFang SC", monospace';
        x.textAlign = "center";
        text.split("\n").forEach((line, i) => x.fillText(line, W / 2, 120 + i * 44));
      },
      TEXT_SCALE,
    );
    const geo = new THREE.PlaneGeometry(size, size, 10, 10);
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const half = size / 2;
    for (let i = 0; i < pos.count; i++) {
      // 本地 -y 是平放后朝向观众的下沿：越靠近下沿越翘，z 对应世界向上
      const edge = Math.max(0, (-pos.getY(i) / half - 0.15) / 0.85);
      const side = Math.abs(pos.getX(i) / half);
      pos.setZ(i, 0.012 * edge * edge * (1 - 0.35 * side));
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex.texture, roughness: 0.9 }));
    mesh.receiveShadow = true;
    return mesh;
  };
  const noteShadow = (paper: THREE.Mesh, size: number) => {
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.4, size * 1.4), new THREE.MeshBasicMaterial({ map: noteShadowTex.texture, transparent: true, depthWrite: false }));
    shadow.rotation.set(-Math.PI / 2, 0, paper.rotation.z);
    shadow.position.set(paper.position.x + 0.006, 0.0008, paper.position.z + 0.01);
    scene.add(shadow);
  };
  const n1 = note("TODO\n写 README", "#ffe27a");
  n1.rotation.set(-Math.PI / 2, 0, -0.25);
  n1.position.set(0.78, 0.0015, 0.66);
  scene.add(n1);
  noteShadow(n1, 0.2);
  const n2 = note("git pull", "#dfe5ff", 0.17);
  n2.rotation.set(-Math.PI / 2, 0, 0.18);
  n2.position.set(0.96, 0.0016, 0.86);
  scene.add(n2);
  noteShadow(n2, 0.17);

  // 挂画：生成的极客娘画像整幅铺满（cover）；加载失败时用浅色底 + 校徽
  const POSTER_W = 512;
  const POSTER_H = 692;
  const poster = canvasTexture(
    POSTER_W,
    POSTER_H,
    (x) => {
      const bg = x.createLinearGradient(0, 0, 0, POSTER_H);
      bg.addColorStop(0, "#eaf0ff");
      bg.addColorStop(1, "#fbfaf7");
      x.fillStyle = bg;
      x.fillRect(0, 0, POSTER_W, POSTER_H);
      if (portrait) {
        const k = Math.max(POSTER_W / portrait.naturalWidth, POSTER_H / portrait.naturalHeight);
        const w = portrait.naturalWidth * k;
        const h = portrait.naturalHeight * k;
        x.drawImage(portrait, (POSTER_W - w) / 2, (POSTER_H - h) / 2, w, h);
      } else if (logo) {
        drawEmblem(x, logo, POSTER_W / 2, POSTER_H / 2, 300);
      }
    },
    TEXT_SCALE,
  );
  const { group: frame, poster: posterMesh } = createPortrait(poster.texture);
  frame.position.set(-0.55, 0.92, -1.49);
  frame.scale.setScalar(0.9);
  scene.add(cast(frame));
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
    const activeScreen = phoneMode ? phoneScreen : screen;
    activeScreen.getWorldPosition(focusTarget);
    tmpNormal.set(0, 0, 1).applyQuaternion(activeScreen.getWorldQuaternion(tmpQuat));
    const d = coverDistance(camera.fov, camera.aspect, phoneMode ? phoneScreenW : SCREEN_W, phoneMode ? phoneScreenH : SCREEN_H, 0.88);
    focusPos.copy(focusTarget).addScaledVector(tmpNormal, d);
  };
  const offset = { x: 0, y: 0 };
  const applyCamera = () => {
    camera.position.copy(pose.pos);
    if (phoneMode) camera.up.set(0, 0, -1);
    else camera.up.set(0, 1, 0);
    camera.lookAt(pose.target);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (pose.shift > 0.001) {
      viewOffset(w, h, idle.ox, idle.oy, pose.shift, offset);
      camera.setViewOffset(w, h, offset.x, offset.y, w, h);
    } else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };
  // 竖屏手机放进顶栏与文案之间的横带，按机身角点取景；不为每种屏幕比例单独调相机。
  const PORTRAIT_FOV = 40;
  const PORTRAIT_DIR = new THREE.Vector3(0, 3.4, 2.4);
  const portraitPose = (aspect: number, band: Band): Pose => {
    scene.updateMatrixWorld(true);
    const points = boxCorners(phoneBounds, phone.matrixWorld);
    const { pos, target, offset } = bandPose(points, PORTRAIT_DIR, PORTRAIT_FOV, aspect, band, 0.88);
    return { pos, target, fov: PORTRAIT_FOV, ox: offset.x, oy: offset.y };
  };
  stage.onLayout = (w, h) => {
    const band = options.band();
    phoneMode = band !== null;
    phone.visible = phoneMode;
    laptop.visible = !phoneMode;
    TARGETS[0].hint = phoneMode ? "打开手机" : "打开电脑";
    setHot(null);
    // 竖屏镜头从高处俯看，墙上的海报会落在顶栏品牌字后面（校徽也和品牌重复），竖屏不挂
    frame.visible = posterMesh.visible = band === null;
    idle = band
      ? portraitPose(w / h, band)
      : { pos: new THREE.Vector3(2.25, 1.6, 2.75), target: new THREE.Vector3(-0.1, 0.36, 0.0), fov: 33, ox: -0.17, oy: 0.02 };
    camera.fov = idle.fov;
    camera.aspect = w / h;
    if (anim) {
      // 旋转过程中重定向剩余飞行，不回到旧设备的坐标，也不重复开机回调。
      if (focused) computeFocus();
      anim.toPos.copy(focused ? focusPos : idle.pos);
      anim.toTarget.copy(focused ? focusTarget : idle.target);
    } else if (focused) {
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

  // ── 拾取：屏幕用模型的圆角几何；其余物体用包围盒；键盘按平面换算到真实键矩形 ────
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
    if (touchKeys && !phoneMode) {
      // 键盘所在平面：笔记本局部 y = keyboard.y；变宽按键按真实矩形命中
      laptop.updateMatrixWorld();
      planeNormal.set(0, 1, 0).transformDirection(laptop.matrixWorld);
      planePoint.set(0, keyboard.y, 0).applyMatrix4(laptop.matrixWorld);
      keyPlane.setFromNormalAndCoplanarPoint(planeNormal, planePoint);
      if (ray.ray.intersectPlane(keyPlane, hitPoint)) {
        keyLocal.copy(hitPoint).applyMatrix4(inverse.copy(laptop.matrixWorld).invert());
        const rects = keyboard.keys;
        for (let i = 0; i < rects.length; i++) {
          const k = rects[i];
          if (Math.abs(keyLocal.x - k.x) * 2 <= k.width && Math.abs(keyLocal.z - k.z) * 2 <= k.depth) {
            press(i);
            break;
          }
        }
      }
    }
    for (let i = 0; i < TARGETS.length; i++) {
      const target = TARGETS[i];
      if (target.exact) {
        hits.length = 0;
        ray.intersectObjects(phoneMode ? phoneParts : screenParts, false, hits);
        if (hits.length) return target;
        continue;
      }
      box.setFromObject(target.object);
      if (ray.ray.intersectsBox(box)) return target;
    }
    return null;
  };
  const phoneParts: THREE.Object3D[] = [phoneScreen, ...device.pickParts];

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
      if (phoneMode) phoneTex.redraw();
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

    // 键盘：只更新按住中的键，逐帧阻尼；这一帧有变化就 flush 一次上传
    let keyMoving = false;
    for (let i = 0; i < keyPress.length; i++) {
      if (keyPress[i] <= 0) continue;
      keyPress[i] *= Math.pow(0.02, dt);
      if (keyPress[i] < 0.001) keyPress[i] = 0;
      keyboard.setPressed(i, keyPress[i]);
      keyMoving = true;
    }
    if (keyMoving) {
      keyboard.flush();
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
  [logo, portrait] = await Promise.all([loadImage(options.logoUrl), loadImage(options.portraitUrl)]);
  if (options.cancelled()) {
    dispose();
    return null;
  }
  screenTex.redraw();
  phoneTex.redraw();
  poster.redraw();
  report("emblem", "校徽已加载");
  stage.resize();
  await stage.warmUp([veil, phoneVeil, phoneMode ? laptop : phone]);
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
      if (focused || phoneMode) return;
      press(Math.floor(Math.random() * keyPress.length));
    },
    dispose,
  };
}
