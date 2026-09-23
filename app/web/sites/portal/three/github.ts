// GitHub 组织：一块悬浮的「贡献日历」地形——53 周 × 7 天的小方块，从地面依次升起成一座天际线。
// 前方一台小终端逐字敲出 `gh org view`；公开仓库是天际线上立起的楼牌。点「打开 GitHub」时方块像瀑布一样依次熄灭。
// 方块高度是装饰性的（种子随机，页面上标「示意」），不冒充真实提交数据；仓库列表来自快照 JSON。
// 由 pages/GithubScene.tsx 动态加载。
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { RepoSnapshot } from "../lib/osApps";
import { damp, ease, span } from "../lib/motion";
import { DAYS, LEVEL_COLORS, WEEKS, decorativeLevels } from "../lib/skyline";
import { Motion, PALETTE, Stage, TEXT_SCALE, canvasTexture, softShadow } from "./stage";

export type GithubOptions = {
  reducedMotion: boolean;
  repos: readonly RepoSnapshot[];
  /** 离场瀑布播完 */
  onLeft: () => void;
};

export type GithubHandle = {
  readonly stage: Stage;
  leave(): void;
  dispose(): void;
};

const CELL = 0.11;
const GAP = 0.024;
const COUNT = WEEKS * DAYS;

export async function createGithubScene(canvas: HTMLCanvasElement, options: GithubOptions): Promise<GithubHandle> {
  const { reducedMotion, repos } = options;
  const stage = new Stage(canvas, { fov: 30, reducedMotion });
  const { scene, camera } = stage;
  stage.parallax = 0.3;

  const { heights, levels } = decorativeLevels();
  const board = new THREE.Group();
  board.rotation.y = -0.38;
  board.position.set(1.5, 0.2, -0.9);
  board.scale.setScalar(0.72);
  scene.add(board);
  const W = WEEKS * (CELL + GAP);
  const D = DAYS * (CELL + GAP);
  const slab = new THREE.Mesh(new RoundedBoxGeometry(W + 0.3, 0.08, D + 0.3, 3, 0.04), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.4 }));
  slab.position.y = -0.04;
  slab.receiveShadow = true;
  slab.castShadow = true;
  board.add(slab);
  const cells = new THREE.InstancedMesh(new RoundedBoxGeometry(CELL, 1, CELL, 1, 0.018), new THREE.MeshStandardMaterial({ roughness: 0.45 }), COUNT);
  cells.castShadow = true;
  cells.receiveShadow = true;
  cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  board.add(cells);
  const color = new THREE.Color();
  for (let i = 0; i < COUNT; i++) cells.setColorAt(i, color.set(LEVEL_COLORS[levels[i]]));
  const m4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const cellX = (i: number) => -W / 2 + (CELL + GAP) * (Math.floor(i / DAYS) + 0.5);
  const cellZ = (i: number) => -D / 2 + (CELL + GAP) * ((i % DAYS) + 0.5);
  /** 每格当前写入矩阵的高度；只有变化超过阈值的格子才重写 */
  const shown = new Float32Array(COUNT).fill(-1);
  const hoverLift = new Float32Array(COUNT);
  let dirtyMin = Infinity;
  let dirtyMax = -1;
  const setCell = (i: number, h: number) => {
    const height = Math.max(0.001, h);
    if (Math.abs(shown[i] - height) < 0.0005) return;
    shown[i] = height;
    scale.set(1, height, 1);
    pos.set(cellX(i), height / 2, cellZ(i));
    m4.compose(pos, quat, scale);
    cells.setMatrixAt(i, m4);
    if (i < dirtyMin) dirtyMin = i;
    if (i > dirtyMax) dirtyMax = i;
  };
  const boardShadow = softShadow(9, 0.14);
  boardShadow.position.set(1.5, 0.002, -0.9);
  boardShadow.scale.set(0.72, 0.26, 0.72);
  scene.add(boardShadow);

  // 楼牌：公开仓库名立在地形较高的几座「楼」上
  const tallest = Array.from(heights.keys()).sort((a, b) => heights[b] - heights[a]);
  const signs = repos.slice(0, 4).map((repo, k) => {
    const index = tallest[k * 17 + 3] ?? 0;
    const tex = canvasTexture(
      512,
      128,
      (x, w, h) => {
        x.clearRect(0, 0, w, h);
        x.fillStyle = "#ffffff";
        x.beginPath();
        x.roundRect(4, 4, w - 8, h - 8, 26);
        x.fill();
        x.strokeStyle = "rgba(27,33,64,0.12)";
        x.lineWidth = 3;
        x.stroke();
        x.fillStyle = repo.language === "Rust" ? "#dea584" : PALETTE.cobalt;
        x.beginPath();
        x.arc(46, h / 2, 12, 0, Math.PI * 2);
        x.fill();
        x.fillStyle = PALETTE.ink;
        x.font = '600 40px "SF Mono", Menlo, monospace';
        x.fillText(repo.name, 74, h / 2 + 14);
      },
      TEXT_SCALE,
    );
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.texture, depthWrite: false, transparent: true }));
    sprite.scale.set(0.9, 0.225, 1);
    board.add(sprite);
    return { sprite, index };
  });

  // 小终端（左前方）
  const term = new THREE.Group();
  term.position.set(-0.9, 0, 1.55);
  term.rotation.y = 0.28;
  term.scale.setScalar(0.62);
  scene.add(term);
  const shellMat = new THREE.MeshStandardMaterial({ color: "#f4f5f9", roughness: 0.3 });
  const tBody = new THREE.Mesh(new RoundedBoxGeometry(1.5, 1.0, 0.14, 3, 0.06), shellMat);
  tBody.position.y = 0.72;
  const tStand = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.05, 0.36, 2, 0.02), shellMat);
  tStand.position.set(0, 0.025, 0.02);
  const tNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.24, 12), shellMat);
  tNeck.position.y = 0.16;
  // 真终端里的内容：命令与输出都照实写（仓库数来自快照）
  const SCRIPT = [
    "$ gh repo list Yangtze-University-Geek-Class",
    ...repos.slice(0, 3).map((repo) => `${repo.name.padEnd(10)} ${repo.language ?? "-"}`),
    `${repos.length} 个公开仓库（快照）`,
  ];
  const TOTAL = SCRIPT.join("\n").length;
  const screenTex = canvasTexture<{ typed: number; cursor: boolean }>(768, 480, (x, w, h, arg) => {
    const typed = arg?.typed ?? 0;
    x.fillStyle = "#fbfbfd";
    x.fillRect(0, 0, w, h);
    x.fillStyle = "#eef0f6";
    x.fillRect(0, 0, w, 44);
    ["#ff6b5e", "#ffbd2e", "#29c940"].forEach((c, k) => {
      x.fillStyle = c;
      x.beginPath();
      x.arc(28 + k * 26, 22, 8, 0, Math.PI * 2);
      x.fill();
    });
    x.fillStyle = PALETTE.inkSoft;
    x.font = '20px "SF Mono", Menlo, monospace';
    x.textAlign = "center";
    x.fillText("zsh", w / 2, 29);
    x.textAlign = "left";
    x.font = '24px "SF Mono", Menlo, monospace';
    const lines: string[] = [];
    let left = typed;
    for (const line of SCRIPT) {
      if (left <= 0) break;
      lines.push(line.slice(0, left));
      left -= line.length + 1;
    }
    lines.forEach((line, k) => {
      x.fillStyle = line.startsWith("$") ? PALETTE.cobalt : PALETTE.ink;
      x.fillText(line, 28, 94 + k * 38);
    });
    if (arg?.cursor) {
      const last = lines[lines.length - 1] ?? "";
      x.fillStyle = PALETTE.amber;
      x.fillRect(28 + x.measureText(last).width + 4, 72 + Math.max(0, lines.length - 1) * 38, 12, 26);
    }
  });
  const tScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.85), new THREE.MeshBasicMaterial({ map: screenTex.texture, toneMapped: false }));
  tScreen.position.set(0, 0.72, 0.0705);
  term.add(tBody, tStand, tNeck, tScreen);
  term.traverse((m) => {
    if ((m as THREE.Mesh).isMesh && m !== tScreen) m.castShadow = true;
  });
  const termShadow = softShadow(0.9, 0.22);
  termShadow.position.set(-0.9, 0.002, 1.55);
  scene.add(termShadow);

  // 相机
  stage.onLayout = (w, h) => {
    const narrow = w / h < 0.9;
    camera.fov = narrow ? 52 : 30;
    camera.updateProjectionMatrix();
    // 竖屏：镜头对准天际线中心（地形中心在 x=1.5, z=-0.9），拉远到整块地形入画；雾往后推，远处不发白
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.near = narrow ? 14 : 9;
      fog.far = narrow ? 26 : 18;
    }
    if (narrow) stage.frame(new THREE.Vector3(1.5, 5.2, 10.6), new THREE.Vector3(1.5, 0.35, -0.9));
    else stage.frame(new THREE.Vector3(0.2, 3.4, 8.6), new THREE.Vector3(0.2, 0.55, -0.2));
  };

  // 悬停：方块附近微微抬起
  let hoverCell = -1;
  const cellParts: THREE.Object3D[] = [cells];
  const onMove = (event: PointerEvent) => {
    const hit = stage.pick(event.clientX, event.clientY, cellParts);
    const next = hit?.instanceId ?? -1;
    if (next !== hoverCell) {
      hoverCell = next;
      stage.invalidate();
    }
    canvas.style.cursor = hoverCell >= 0 ? "crosshair" : "default";
  };
  const onLeave = () => {
    hoverCell = -1;
    stage.invalidate();
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);

  // 升起与离场按夹紧后的帧 dt 累加计时，卡帧不跳步
  let clock = 0;
  let leaving: { t0: number; done: boolean } | null = null;
  let typed = -1;
  let cursorOn = true;
  let breathing = !reducedMotion;
  let lastBreathe = 0;

  stage.add((dt, time) => {
    clock += dt;
    const p = clock;
    const lp = leaving ? clock - leaving.t0 : 0;
    let motion: Motion = Motion.Idle;
    const risingDone = reducedMotion || p > WEEKS * 0.018 + 0.6;
    const hw = hoverCell >= 0 ? Math.floor(hoverCell / DAYS) : -99;
    const hd = hoverCell >= 0 ? hoverCell % DAYS : -99;
    // 「呼吸」是环境动画：幅度随 stage.ambient 淡入淡出；只重写高度真的变了的格子
    const breath = breathing ? stage.ambient : 0;
    const breatheNow = breath > 0.001 || lastBreathe > 0;
    lastBreathe = breath;
    let hoverActive = false;
    dirtyMin = Infinity;
    dirtyMax = -1;
    for (let i = 0; i < COUNT; i++) {
      const w = Math.floor(i / DAYS);
      const d = i % DAYS;
      const rise = reducedMotion ? 1 : ease.back(span(p, w * 0.018 + d * 0.01, w * 0.018 + 0.55));
      const fall = leaving ? 1 - ease.inOut(span(lp, (WEEKS - w) * 0.008, (WEEKS - w) * 0.008 + 0.35)) : 1;
      const dist = Math.abs(hw - w) + Math.abs(hd - d);
      const goal = dist < 3 ? Math.max(0, 1 - Math.hypot(hw - w, hd - d) / 2.6) : 0;
      if (goal > 0 || hoverLift[i] > 0.001) {
        hoverLift[i] = damp(hoverLift[i], goal, 10, dt);
        if (Math.abs(hoverLift[i] - goal) > 0.002) hoverActive = true;
        else hoverLift[i] = goal;
      }
      const breathe = levels[i] > 0 ? Math.sin(time * 1.4 - w * 0.25) * 0.012 * breath : 0;
      if (!risingDone || leaving || breatheNow || hoverLift[i] > 0 || goal > 0 || shown[i] < 0) setCell(i, (heights[i] + breathe + hoverLift[i] * 0.35) * rise * fall);
    }
    if (dirtyMax >= 0) {
      cells.instanceMatrix.clearUpdateRanges();
      cells.instanceMatrix.addUpdateRange(dirtyMin * 16, (dirtyMax - dirtyMin + 1) * 16);
      cells.instanceMatrix.needsUpdate = true;
      stage.markShadows();
    }
    if (!risingDone || leaving || hoverActive) motion = Motion.Active;

    for (let s = 0; s < signs.length; s++) {
      const { sprite, index } = signs[s];
      const w = Math.floor(index / DAYS);
      const k = reducedMotion ? 1 : ease.out(span(p, 1.3 + w * 0.01, 1.8 + w * 0.01)) * (leaving ? 1 - span(lp, 0, 0.3) : 1);
      sprite.position.set(cellX(index), heights[index] + 0.34 + Math.sin(time * 1.6 + cellX(index)) * 0.02 * stage.ambient, cellZ(index));
      sprite.material.opacity = k;
      sprite.scale.set(0.9 * Math.max(0.001, k), 0.225 * Math.max(0.001, k), 1);
    }
    if (!reducedMotion && p < 2.2) motion = Motion.Active;

    // 终端逐字敲；敲完后光标每 0.5s 闪一次（定时唤醒，不让循环空转）
    const want = reducedMotion ? TOTAL : Math.min(TOTAL, Math.floor(Math.max(0, p - 0.6) * 38));
    const cursor = reducedMotion || stage.ambient < 0.5 ? true : Math.floor(time * 2) % 2 === 0;
    if (want !== typed || cursor !== cursorOn) {
      typed = want;
      cursorOn = cursor;
      screenTex.redraw({ typed, cursor });
    }
    if (want < TOTAL) motion = Motion.Active;

    if (leaving && lp > 1.05 && !leaving.done) {
      leaving.done = true;
      options.onLeft();
    }
    return motion;
  });

  stage.resize();
  await stage.warmUp();
  stage.invalidate();

  return {
    stage,
    leave() {
      if (leaving) return;
      if (reducedMotion) {
        options.onLeft();
        return;
      }
      breathing = false;
      leaving = { t0: clock, done: false };
      stage.invalidate();
    },
    dispose() {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      stage.dispose();
    },
  };
}
