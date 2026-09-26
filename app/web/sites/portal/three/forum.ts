// 论坛：每个版块是一个立体对话气泡，围成一圈缓缓转动，可以拖动旋转。
// 悬停气泡会浮起、冒出三个「正在输入」的小点；点击气泡 → 镜头推近、气泡放大 → 进入论坛对应版块；
// 点中间的校徽 → 进入论坛首页。由 pages/Forum3D.tsx 动态加载，链接地址由页面传入。
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Band } from "../lib/cameraMath";
import type { IconName } from "../lib/icons";
import { damp, ease, lerp } from "../lib/motion";
import { Motion, PALETTE, Stage, TEXT_SCALE, bandPose, canvasTexture, drawIcon, loadImage, softShadow, type CanvasTexture } from "./stage";

export type ForumBoard = { slug: string; name: string; desc: string; color: string; icon: IconName };

export type ForumOptions = {
  reducedMotion: boolean;
  logoUrl: string;
  boards: readonly ForumBoard[];
  /** 竖屏时留给 3D 的横带（按钮下沿到版块列表上沿）；横屏返回 null */
  band: () => Band | null;
  /** 悬停的版块变化（-1 表示没有）；页面据此高亮 DOM 列表 */
  onHot: (index: number) => void;
  /** 指针提示：text 为空表示隐藏 */
  onTip: (text: string, x: number, y: number) => void;
  /** 转场的遮罩进度 0..1 */
  onWipe: (value: number) => void;
  /** 转场结束：index 为 -1 表示论坛首页 */
  onOpen: (index: number) => void;
};

export type ForumHandle = {
  readonly stage: Stage;
  focusBoard(index: number): void;
  open(index: number): void;
  goHome(): void;
  /** 回到进场时的样子：撤掉转场（推近的镜头、放大的气泡、遮罩）、悬停与提示，按当前窗口重新取景。
   *  从论坛按后退回来时浏览器可能整页从往返缓存恢复，转场停在最后一帧，页面调用它复位 */
  reset(): void;
  dispose(): void;
};

const RADIUS = 1.75;
const CENTER = new THREE.Vector3(1.7, 0, -0.4);
const SPIN = 0.12;

export async function createForumScene(canvas: HTMLCanvasElement, options: ForumOptions): Promise<ForumHandle> {
  const { reducedMotion, boards } = options;
  const stage = new Stage(canvas, { fov: 32, reducedMotion });
  const { scene, camera } = stage;
  stage.parallax = 0.25;
  const logo = await loadImage(options.logoUrl);

  const ring = new THREE.Group();
  ring.position.copy(CENTER);
  scene.add(ring);
  const bodyMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.35 });
  const bodyGeo = new RoundedBoxGeometry(1.6, 1.0, 0.24, 4, 0.12);
  const capGeo = new RoundedBoxGeometry(1.6, 0.06, 0.245, 2, 0.03);
  const faceGeo = new THREE.PlaneGeometry(1.44, 0.9);
  const dotGeo = new THREE.SphereGeometry(0.045, 14, 10);
  const tailShape = new THREE.Shape();
  tailShape.moveTo(-0.16, 0);
  tailShape.lineTo(0.12, 0);
  tailShape.lineTo(-0.22, -0.26);
  tailShape.closePath();
  const tailGeo = new THREE.ExtrudeGeometry(tailShape, { depth: 0.2, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });

  type Bubble = { group: THREE.Group; face: CanvasTexture<boolean>; dots: THREE.Mesh[]; shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; hover: number; lit: boolean };
  const bubbles: Bubble[] = boards.map((board) => {
    const group = new THREE.Group();
    const face = canvasTexture<boolean>(
      512,
      320,
      (x, w, h, hot) => {
        x.fillStyle = "#ffffff";
        x.fillRect(0, 0, w, h);
        x.fillStyle = board.color;
        x.globalAlpha = 0.12;
        x.beginPath();
        x.roundRect(36, 40, 92, 92, 24);
        x.fill();
        x.globalAlpha = 1;
        drawIcon(x, board.icon, 54, 58, 56, board.color);
        x.textAlign = "left";
        x.fillStyle = PALETTE.ink;
        x.font = '700 50px "PingFang SC", "Hiragino Sans GB", sans-serif';
        x.fillText(board.name, 36, 204);
        x.fillStyle = PALETTE.inkSoft;
        x.font = '28px "PingFang SC", "Hiragino Sans GB", sans-serif';
        x.fillText(board.desc, 36, 256);
        x.fillStyle = board.color;
        x.fillRect(36, 282, hot ? 200 : 64, 6);
      },
      TEXT_SCALE,
    );
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    const front = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ map: face.texture, toneMapped: false }));
    front.position.z = 0.1205;
    const tail = new THREE.Mesh(tailGeo, bodyMat);
    tail.position.set(-0.38, -0.49, -0.1);
    const capMat = new THREE.MeshStandardMaterial({ color: board.color, roughness: 0.4 });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = 0.47;
    const dots = [0, 1, 2].map((k) => {
      const dot = new THREE.Mesh(dotGeo, capMat);
      dot.position.set(0.52 + k * 0.13, 0.72, 0.05);
      dot.scale.setScalar(0.001);
      group.add(dot);
      return dot;
    });
    group.add(body, front, tail, cap);
    // 气泡一直在转：不投实时阴影（每帧重算阴影贴图太贵），用贴地柔影代替
    const shadow = softShadow(1.8, 0.2);
    scene.add(shadow);
    ring.add(group);
    return { group, face, dots, shadow, hover: 0, lit: false };
  });

  const podium = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.14, 48), new THREE.MeshStandardMaterial({ color: PALETTE.cobalt, roughness: 0.35 }));
  podium.position.set(CENTER.x, 0.07, CENTER.z);
  podium.castShadow = true;
  podium.receiveShadow = true;
  scene.add(podium);
  const disc = canvasTexture(512, 512, (x, w) => {
    x.clearRect(0, 0, w, w);
    x.fillStyle = "#ffffff";
    x.beginPath();
    x.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2);
    x.fill();
    if (logo) x.drawImage(logo, 36, 36, w - 72, w - 72);
  });
  const discMat = new THREE.MeshStandardMaterial({ map: disc.texture, roughness: 0.4 });
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 48), [new THREE.MeshStandardMaterial({ color: "#e6e9fb", roughness: 0.4 }), discMat, discMat]);
  coin.rotation.x = Math.PI / 2;
  coin.position.set(CENTER.x, 0.62, CENTER.z);
  coin.scale.setScalar(0.8);
  coin.castShadow = true;
  scene.add(coin);

  // ── 相机 ───────────────────────────────────────────────────────────────
  const camBase = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  const PORTRAIT_DIR = new THREE.Vector3(0, 1.1, 3.2);
  // 气泡环的外轮廓：半径 + 半个气泡宽的圆柱，从桌面到气泡顶
  const ringPoints = Array.from({ length: 32 }, (_, i) => {
    const a = ((i % 16) / 16) * Math.PI * 2;
    return new THREE.Vector3(CENTER.x + Math.sin(a) * (RADIUS + 0.8), i < 16 ? 0 : 1.75, CENTER.z + Math.cos(a) * (RADIUS + 0.8));
  });
  stage.onLayout = (w, h) => {
    // 竖屏：气泡环的外轮廓整体放进按钮与版块列表之间的横带（stage.ts 的 bandPose）；
    // 雾跟着相机距离走，拉远后不会把整个环吞成白色
    const band = options.band();
    camera.fov = band ? 40 : 32;
    camera.updateProjectionMatrix();
    const fog = scene.fog as THREE.Fog | null;
    let offset = { x: 0, y: 0 };
    if (band) {
      const pose = bandPose(ringPoints, PORTRAIT_DIR, camera.fov, w / h, band, 0.96);
      camBase.pos.copy(pose.pos);
      camBase.target.copy(pose.target);
      offset = pose.offset;
      if (fog) {
        fog.near = pose.pos.distanceTo(pose.target) + 2.5;
        fog.far = fog.near + 12;
      }
    } else {
      if (fog) {
        fog.near = 9;
        fog.far = 18;
      }
      camBase.pos.set(0.9, 2.6, 8.4);
      camBase.target.set(0.7, 1.0, -0.4);
    }
    if (!opening) stage.frame(camBase.pos, camBase.target, offset);
  };

  // ── 交互 ───────────────────────────────────────────────────────────────
  let spin = 0;
  let spinVel = reducedMotion ? 0 : SPIN;
  let targetSpin: number | null = null;
  let dragging = false;
  let dragX = 0;
  let moved = 0;
  let hot = -1;
  let coinHot = 0;
  let coinLift = 0;
  let coinSpin = 0;
  /** 转场：elapsed 按夹紧后的帧 dt 累加（秒），卡帧不跳步 */
  let opening: { index: number; elapsed: number; fromPos: THREE.Vector3; fromTarget: THREE.Vector3; fromOffset: { x: number; y: number }; done: boolean } | null = null;
  /** 转场时画面偏移从竖屏取景的值缓到 0，推近的气泡落在画面正中 */
  const flyOffset = { x: 0, y: 0 };
  let lastWipe = 0;
  const groups = bubbles.map((b) => b.group);
  const coinParts: THREE.Object3D[] = [coin, podium];
  const tips = boards.map((board) => `进入「${board.name}」`);
  const bubbleIndex = (object: THREE.Object3D | null): number => {
    let o = object;
    while (o && !groups.includes(o as THREE.Group)) o = o.parent;
    return o ? groups.indexOf(o as THREE.Group) : -1;
  };
  const setHot = (index: number) => {
    if (index === hot) return;
    if (hot >= 0) bubbles[hot].face.redraw(false);
    hot = index;
    if (hot >= 0) bubbles[hot].face.redraw(true);
    options.onHot(hot);
    stage.invalidate();
  };
  const focusBoard = (index: number) => {
    setHot(index);
    const angle = -(index / boards.length) * Math.PI * 2;
    let d = angle - spin;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    targetSpin = spin + d;
    stage.invalidate();
  };
  const startOpening = (index: number) => {
    if (opening) return;
    if (index >= 0) focusBoard(index);
    options.onTip("", 0, 0);
    if (reducedMotion) {
      options.onOpen(index);
      return;
    }
    opening = { index, elapsed: 0, fromPos: stage.basePos.clone(), fromTarget: stage.baseTarget.clone(), fromOffset: { ...stage.baseOffset }, done: false };
    stage.invalidate();
  };
  const reset = () => {
    opening = null;
    lastWipe = 0;
    flyOffset.x = 0;
    flyOffset.y = 0;
    dragging = false;
    targetSpin = null;
    spinVel = reducedMotion ? 0 : SPIN;
    coinHot = 0;
    canvas.style.cursor = "grab";
    setHot(-1);
    options.onTip("", 0, 0);
    options.onWipe(0);
    // resize 会调 onLayout，opening 已清空，镜头回到按窗口算出的取景
    stage.resize();
    stage.invalidate();
  };

  const onDown = (event: PointerEvent) => {
    dragging = true;
    dragX = event.clientX;
    moved = 0;
    canvas.setPointerCapture(event.pointerId);
  };
  const onUp = (event: PointerEvent) => {
    dragging = false;
    if (moved >= 6) return;
    if (stage.pick(event.clientX, event.clientY, coinParts)) return startOpening(-1);
    const hit = stage.pick(event.clientX, event.clientY, groups);
    const index = bubbleIndex(hit?.object ?? null);
    if (index >= 0) startOpening(index);
  };
  const onMove = (event: PointerEvent) => {
    if (opening) return;
    if (dragging) {
      const dx = event.clientX - dragX;
      dragX = event.clientX;
      moved += Math.abs(dx);
      spin += dx * 0.006;
      spinVel = dx * 0.25;
      targetSpin = null;
      stage.invalidate();
      return;
    }
    if (stage.pick(event.clientX, event.clientY, coinParts)) {
      canvas.style.cursor = "pointer";
      coinHot = 1;
      setHot(-1);
      options.onTip("进入论坛首页", event.clientX, event.clientY);
      return;
    }
    coinHot = 0;
    const index = bubbleIndex(stage.pick(event.clientX, event.clientY, groups)?.object ?? null);
    setHot(index);
    canvas.style.cursor = index >= 0 ? "pointer" : "grab";
    options.onTip(index >= 0 ? tips[index] : "", event.clientX, event.clientY);
  };
  const onLeave = () => {
    coinHot = 0;
    options.onTip("", 0, 0);
    stage.invalidate();
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);

  // ── 每帧 ───────────────────────────────────────────────────────────────
  const world = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const camTo = new THREE.Vector3();
  const lookTo = new THREE.Vector3();
  const framePos = new THREE.Vector3();
  const frameTarget = new THREE.Vector3();
  stage.add((dt, time) => {
    let motion: Motion = Motion.Idle;
    if (opening) opening.elapsed += dt;
    const openK = opening ? Math.min(1, opening.elapsed / 0.9) : 0;
    if (!dragging) {
      if (targetSpin !== null) {
        const before = spin;
        spin = damp(spin, targetSpin, 5, dt);
        spinVel = 0;
        if (Math.abs(targetSpin - spin) < 1e-4) spin = targetSpin;
        if (spin !== before) motion = Motion.Active;
      } else {
        spin += spinVel * dt;
        // 缓慢自转是环境动画：随 stage.ambient 淡入淡出，静置后停下
        const rest = SPIN * stage.ambient;
        spinVel = damp(spinVel, rest, 1.5, dt);
        if (Math.abs(spinVel) > 1e-4) motion = Motion.Active;
      }
    }
    ring.rotation.y = spin;
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      const a = (i / boards.length) * Math.PI * 2;
      const goal = i === hot ? 1 : 0;
      if (Math.abs(b.hover - goal) > 1e-3) {
        b.hover = damp(b.hover, goal, 8, dt);
        motion = Motion.Active;
      } else b.hover = goal;
      const bob = Math.sin(time * 1.3 + i * 1.7) * 0.06 * stage.ambient;
      b.group.position.set(Math.sin(a) * RADIUS, 0.95 + bob + b.hover * 0.2, Math.cos(a) * RADIUS);
      b.group.rotation.set(0, a, Math.sin(time * 0.9 + i) * 0.02 * stage.ambient);
      const opened = opening && opening.index === i ? lerp(0, 0.3, ease.back(openK)) : 0;
      b.group.scale.setScalar(0.72 * (1 + b.hover * 0.08) + opened);
      for (let k = 0; k < 3; k++) {
        const s = b.hover * (0.8 + 0.4 * Math.max(0, Math.sin(time * 6 - k * 0.8)));
        b.dots[k].scale.setScalar(Math.max(0.001, s));
      }
      if (b.hover > 0.01) motion = Motion.Active;
      b.group.getWorldPosition(world);
      b.shadow.position.set(world.x, 0.003, world.z);
      b.shadow.material.opacity = 0.9 - b.hover * 0.3;
    }
    coinLift = damp(coinLift, coinHot, 8, dt);
    if (Math.abs(coinLift - coinHot) > 1e-3) motion = Motion.Active;
    coinSpin += dt * (0.6 * stage.ambient + coinLift * 2.4);
    coin.rotation.z = coinSpin;
    coin.position.y = 0.62 + coinLift * 0.12;
    coin.scale.setScalar(0.8 + coinLift * 0.08);

    if (opening) {
      const k = ease.inOut(openK);
      if (opening.index < 0) {
        coin.getWorldPosition(lookTo);
        camTo.copy(lookTo).add(dir.set(0, 0.15, 1.3));
        spinVel = 1.6 * k;
      } else {
        bubbles[opening.index].group.getWorldPosition(lookTo);
        dir.copy(lookTo).setY(0).sub(world.set(CENTER.x, 0, CENTER.z)).normalize();
        camTo.copy(lookTo).addScaledVector(dir, 1.7).add(world.set(0, 0.1, 0));
      }
      framePos.lerpVectors(opening.fromPos, camTo, k);
      frameTarget.lerpVectors(opening.fromTarget, lookTo, k);
      flyOffset.x = opening.fromOffset.x * (1 - k);
      flyOffset.y = opening.fromOffset.y * (1 - k);
      stage.frame(framePos, frameTarget, flyOffset);
      const wipe = Math.max(0, (k - 0.7) / 0.3);
      if (Math.abs(wipe - lastWipe) > 0.01 || (wipe === 1 && lastWipe !== 1)) {
        lastWipe = wipe;
        options.onWipe(wipe);
      }
      if (k >= 1 && !opening.done) {
        opening.done = true;
        options.onOpen(opening.index);
      }
      motion = Motion.Active;
    }
    // 只有校徽升降会改变实时阴影
    if (Math.abs(coinLift - coinHot) > 1e-3) stage.markShadows();
    return motion;
  });

  stage.resize();
  await stage.warmUp();
  stage.invalidate();

  return {
    stage,
    focusBoard,
    open: startOpening,
    goHome: () => startOpening(-1),
    reset,
    dispose() {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      stage.dispose();
    },
  };
}
