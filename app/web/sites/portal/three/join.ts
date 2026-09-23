// 加入我们：信封飞进来停在画面正中 → 封舌打开 → 三折的信纸抽出 → 镜头推近、信纸边飞边展开，
// 平贴屏幕落在正中（与 DOM 表单严丝合缝后交给表单）→ 提交后信纸在原位两道折痕折好 → 飞回信封塞进去 →
// 封舌合上、火漆落下压扁一下 → 信封飞进一侧的信箱，小旗弹起。
// 由 pages/JoinUs.tsx 动态加载；提交本身在页面里完成（真实的 POST /api/portal/apply），这里只管画面。
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { pixelToCameraPlane } from "../lib/cameraMath";
import { ease, lerp, span } from "../lib/motion";
import { Motion, PALETTE, Stage, canvasTexture, loadImage, softShadow, type CanvasTexture } from "./stage";

export type JoinPhase = "arrive" | "open" | "land" | "writing" | "sealing" | "posting" | "done";

export type JoinOptions = {
  reducedMotion: boolean;
  logoUrl: string;
  /** DOM 信纸（表单）在视口里的位置；3D 信纸最后一帧落到这里 */
  letterRect: () => DOMRect | null;
  onPhase: (phase: JoinPhase) => void;
};

export type JoinHandle = {
  readonly stage: Stage;
  /** 表单已真实提交成功：把填好的内容画到信纸上，开始折信、封口、投递 */
  seal(lines: string[]): void;
  dispose(): void;
};

const W = 2.2;
const H = 1.4;
const ENV_SCALE = 0.82;
/** 信纸在信封里的宽度（信封局部单位） */
const LETTER_IN_W = W * 0.84;
/** 落位时信纸离相机的距离（比信封近得多，永远在最前面） */
const LAND_DIST = 1.6;
const PAPER = "#fbfaf6";
/** 信纸在信封里的 z（夹在底板 -0.004 与口袋 0.008 之间） */
const LETTER_Z = 0.002;
const PAPER_BACK = "#f7f4ec";
/** 写信时信封缩小平躺在信纸下方（露出带邮戳的下半截），不抢信纸的焦点 */
const REST_SCALE = 0.6;

type Layout = {
  fov: number;
  cam: THREE.Vector3;
  target: THREE.Vector3;
  camIn: THREE.Vector3;
  targetIn: THREE.Vector3;
  home: THREE.Vector3;
  rest: THREE.Vector3;
  box: THREE.Vector3;
  boxScale: number;
  boxRot: number;
};

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function layoutFor(aspect: number): Layout {
  if (aspect < 0.9) {
    return {
      fov: 44,
      cam: v(0, 1.6, 5.9),
      target: v(0, 1.4, 0),
      camIn: v(0, 1.4, 4.9),
      targetIn: v(0, 1.05, 0),
      home: v(0, 1.62, 0),
      rest: v(0, 0.06, 0.35),
      box: v(0.78, 0, -1.4),
      boxScale: 0.46,
      boxRot: -0.45,
    };
  }
  return {
    fov: 30,
    cam: v(0, 1.5, 5.4),
    target: v(0, 1.2, 0),
    camIn: v(0, 1.35, 4.5),
    targetIn: v(0, 0.95, 0),
    home: v(0, 1.2, 0),
    rest: v(0, 0.06, 0.3),
    box: v(1.8, 0, -1.0),
    boxScale: 0.78,
    boxRot: -0.55,
  };
}

export async function createJoinScene(canvas: HTMLCanvasElement, options: JoinOptions): Promise<JoinHandle> {
  const { reducedMotion } = options;
  const stage = new Stage(canvas, { fov: 30, reducedMotion });
  const { scene, camera } = stage;
  stage.parallax = 0.12;
  const logo = await loadImage(options.logoUrl);

  // ── 信封：底板、口袋（左右下三襟连成一片）、可翻的封舌、火漆 ─────────────
  const face = canvasTexture(1100, 700, (x, w, h) => {
    x.fillStyle = "#ffffff";
    x.fillRect(0, 0, w, h);
    const b = 26;
    x.save();
    x.beginPath();
    x.rect(0, 0, w, h);
    x.rect(b, b, w - 2 * b, h - 2 * b);
    x.clip("evenodd");
    for (let i = -h; i < w + h; i += 44) {
      x.fillStyle = (i / 44) % 2 === 0 ? PALETTE.cobalt : PALETTE.amber;
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i + 22, 0);
      x.lineTo(i + 22 - h, h);
      x.lineTo(i - h, h);
      x.closePath();
      x.fill();
    }
    x.restore();
    x.strokeStyle = "rgba(27,33,64,0.07)";
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(b, h - b);
    x.lineTo(w / 2, h * 0.48);
    x.lineTo(w - b, h - b);
    x.stroke();
    x.save();
    x.translate(w - 190, h - 150);
    x.rotate(-0.18);
    x.strokeStyle = "rgba(51,70,200,0.45)";
    x.lineWidth = 4;
    x.beginPath();
    x.arc(0, 0, 62, 0, Math.PI * 2);
    x.stroke();
    x.beginPath();
    x.arc(0, 0, 50, 0, Math.PI * 2);
    x.stroke();
    x.fillStyle = "rgba(51,70,200,0.55)";
    x.textAlign = "center";
    x.font = '700 22px "SF Mono", Menlo, monospace';
    x.fillText("YUGC", 0, -4);
    x.font = '14px "SF Mono", Menlo, monospace';
    x.fillText("POST", 0, 18);
    for (let k = 0; k < 4; k++) {
      x.beginPath();
      x.moveTo(80, -30 + k * 20);
      for (let X = 80; X < 230; X += 10) x.lineTo(X, -30 + k * 20 + Math.sin(X / 9) * 5);
      x.stroke();
    }
    x.restore();
  });
  const envMat = new THREE.MeshStandardMaterial({ map: face.texture, roughness: 0.75, side: THREE.DoubleSide });
  const envInner = new THREE.MeshStandardMaterial({ color: "#4a5ad2", roughness: 0.8, side: THREE.DoubleSide });
  const panel = (points: Array<[number, number]>, offsetY = 0) => {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (const [px, py] of points.slice(1)) shape.lineTo(px, py);
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const uv = geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + W / 2) / W, (pos.getY(i) + offsetY + H / 2) / H);
    return geometry;
  };

  const envelope = new THREE.Group();
  envelope.rotation.order = "YXZ";
  envelope.scale.setScalar(ENV_SCALE);
  scene.add(envelope);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), envInner);
  back.position.z = -0.004;
  envelope.add(back);
  const pocket = new THREE.Mesh(panel([[-W / 2, H / 2], [0, H * 0.02], [W / 2, H / 2], [W / 2, -H / 2], [-W / 2, -H / 2]]), envMat);
  pocket.position.z = 0.008;
  envelope.add(pocket);
  const flapPivot = new THREE.Group();
  flapPivot.position.set(0, H / 2, 0.01);
  envelope.add(flapPivot);
  const flap = new THREE.Mesh(panel([[-W / 2, 0], [W / 2, 0], [0, -H * 0.62]], H / 2), envMat);
  flapPivot.add(flap);
  // 封舌合上时的两条斜边：一道淡淡的描边，让信封一眼看得出是「封好的」
  const flapEdgeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-W / 2, 0, 0.002), new THREE.Vector3(0, -H * 0.62, 0.002), new THREE.Vector3(W / 2, 0, 0.002)]);
  const flapEdge = new THREE.Line(flapEdgeGeo, new THREE.LineBasicMaterial({ color: "#c9ccdb" }));
  flapPivot.add(flapEdge);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(W, H)), new THREE.LineBasicMaterial({ color: "#d9dbe6" }));
  edge.position.z = 0.009;
  envelope.add(edge);

  const sealTex = canvasTexture(256, 256, (x, w) => {
    x.clearRect(0, 0, w, w);
    x.fillStyle = PALETTE.cobalt;
    x.beginPath();
    x.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2);
    x.fill();
    if (logo) {
      x.save();
      x.beginPath();
      x.arc(w / 2, w / 2, w * 0.36, 0, Math.PI * 2);
      x.clip();
      x.drawImage(logo, w * 0.14, w * 0.14, w * 0.72, w * 0.72);
      x.restore();
    }
  });
  const sealSide = new THREE.MeshStandardMaterial({ color: PALETTE.cobaltDeep, roughness: 0.35 });
  const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.035, 36), [sealSide, new THREE.MeshStandardMaterial({ map: sealTex.texture, roughness: 0.35 }), sealSide]);
  seal.rotation.x = Math.PI / 2;
  seal.position.set(0, H / 2 - H * 0.6, 0.03);
  seal.visible = false;
  envelope.add(seal);
  envelope.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) m.castShadow = true;
  });
  const envShadow = softShadow(2.4, 0.16);
  scene.add(envShadow);

  // ── 信纸：上中下三片，两道折痕处各一个铰链；正面贴图、背面素纸 ────────────
  let letterAspect = 1.15;
  let letterTex: CanvasTexture<string[]> | null = null;
  let filledLines: string[] | undefined;
  const drawLetter = (x: CanvasRenderingContext2D, w: number, h: number, lines?: string[]) => {
    const s = w / 640;
    x.fillStyle = PAPER;
    x.fillRect(0, 0, w, h);
    x.strokeStyle = "rgba(51,70,200,0.09)";
    x.lineWidth = Math.max(1, s);
    for (let y = 104 * s; y < h - 30 * s; y += 34 * s) {
      x.beginPath();
      x.moveTo(40 * s, y);
      x.lineTo(w - 40 * s, y);
      x.stroke();
    }
    x.textAlign = "left";
    x.fillStyle = PALETTE.cobalt;
    x.font = `${Math.round(11 * s)}px "SF Mono", Menlo, monospace`;
    x.fillText("YUGC POST · 加入我们", 38 * s, 44 * s);
    x.fillStyle = PALETTE.ink;
    x.font = `600 ${Math.round(22 * s)}px "PingFang SC", "Hiragino Sans GB", sans-serif`;
    x.fillText("致 长江大学极客班：", 38 * s, 76 * s);
    if (logo) x.drawImage(logo, w - 80 * s, 36 * s, 40 * s, 40 * s);
    if (lines?.length) {
      x.fillStyle = PALETTE.cobalt;
      x.font = `${Math.round(19 * s)}px "PingFang SC", "Hiragino Sans GB", sans-serif`;
      const maxW = w - 88 * s;
      let y = 132 * s;
      for (const line of lines) {
        let text = line;
        while (text.length > 1 && x.measureText(text).width > maxW) text = text.slice(0, -1);
        if (text !== line) text = `${text.slice(0, -1)}…`;
        x.fillText(text, 44 * s, y);
        y += 34 * s;
        if (y > h - 60 * s) break;
      }
      x.fillStyle = PALETTE.inkSoft;
      x.font = `${Math.round(13 * s)}px "SF Mono", Menlo, monospace`;
      x.textAlign = "right";
      x.fillText("YUGC POST", w - 40 * s, h - 30 * s);
    }
  };
  const ensureLetterTexture = (aspect: number) => {
    const width = 1024;
    const height = Math.round(Math.min(2200, Math.max(560, width / aspect)));
    if (letterTex && letterTex.canvas.height === height) return;
    letterTex?.texture.dispose();
    letterTex = canvasTexture<string[]>(width, height, drawLetter);
    if (filledLines) letterTex.redraw(filledLines);
    for (const m of frontMats) {
      m.map = letterTex.texture;
      m.needsUpdate = true;
    }
  };

  const letter = new THREE.Group();
  const frontMats: THREE.MeshBasicMaterial[] = [];
  const backMat = new THREE.MeshBasicMaterial({ color: PAPER_BACK, side: THREE.BackSide });
  const makePanel = (k: 0 | 1 | 2) => {
    const geometry = new THREE.PlaneGeometry(1, 1 / 3);
    const uv = geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) === 1 ? 1 - k / 3 : 1 - (k + 1) / 3);
    const front = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
    frontMats.push(front);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, front), new THREE.Mesh(geometry, backMat));
    return group;
  };
  const topPanel = makePanel(0);
  const midPanel = makePanel(1);
  const botPanel = makePanel(2);
  const topPivot = new THREE.Group();
  topPivot.position.set(0, 1 / 6, 0.0016);
  topPanel.position.y = 1 / 6;
  topPivot.add(topPanel);
  const botPivot = new THREE.Group();
  botPivot.position.set(0, -1 / 6, 0.0008);
  botPanel.position.y = -1 / 6;
  botPivot.add(botPanel);
  letter.add(midPanel, topPivot, botPivot);
  ensureLetterTexture(letterAspect);
  const tintPaper = new THREE.Color();
  const WHITE = new THREE.Color("#ffffff");
  const CREASE = new THREE.Color("#d9d5ca");
  /** 0 = 平展，1 = 折好（先折下片，再折上片） */
  const setFold = (bottom: number, top: number) => {
    botPivot.rotation.x = -Math.PI * bottom;
    topPivot.rotation.x = Math.PI * top;
    frontMats[2].color.copy(tintPaper.copy(WHITE).lerp(CREASE, Math.sin(Math.PI * Math.min(1, bottom)) * 0.8));
    frontMats[0].color.copy(tintPaper.copy(WHITE).lerp(CREASE, Math.sin(Math.PI * Math.min(1, top)) * 0.8));
  };
  const inScale = new THREE.Vector3();
  const setInEnvelopeScale = () => {
    const sy = LETTER_IN_W / letterAspect;
    inScale.set(LETTER_IN_W, sy, 1);
  };
  setInEnvelopeScale();
  letter.scale.copy(inScale);
  letter.position.set(0, -0.06, LETTER_Z);
  setFold(1, 1);
  envelope.add(letter);

  // ── 信箱：圆顶邮筒 + 可以弹起的小旗 ─────────────────────────────────────
  const box = new THREE.Group();
  scene.add(box);
  const boxMat = new THREE.MeshStandardMaterial({ color: PALETTE.cobalt, roughness: 0.35, metalness: 0.05 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 16), new THREE.MeshStandardMaterial({ color: "#e7e4dc", roughness: 0.6 }));
  post.position.y = 0.55;
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.62, 1.2, 3, 0.08), boxMat);
  body.position.y = 1.4;
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.2, 32, 1, false, 0, Math.PI), boxMat);
  dome.rotation.set(0, Math.PI / 2, Math.PI / 2);
  dome.position.y = 1.71;
  const slot = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.06, 0.02, 2, 0.01), new THREE.MeshStandardMaterial({ color: "#141a44" }));
  slot.position.set(0, 1.55, 0.605);
  const plate = canvasTexture(256, 96, (x, w, h) => {
    x.fillStyle = PAPER;
    x.fillRect(0, 0, w, h);
    x.fillStyle = PALETTE.ink;
    x.textAlign = "center";
    x.font = '700 34px "SF Mono", Menlo, monospace';
    x.fillText("YUGC", w / 2, 44);
    x.font = '20px "PingFang SC", sans-serif';
    x.fillText("极客班信箱", w / 2, 78);
  });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.19), new THREE.MeshStandardMaterial({ map: plate.texture, roughness: 0.6 }));
  label.position.set(0, 1.3, 0.606);
  const flagPivot = new THREE.Group();
  flagPivot.position.set(0.47, 1.35, 0.1);
  const flagMat = new THREE.MeshStandardMaterial({ color: PALETTE.amber, roughness: 0.4 });
  const flagPole = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.03), flagMat);
  flagPole.position.y = 0.25;
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.22), flagMat);
  flag.position.set(0, 0.42, -0.11);
  flagPivot.add(flagPole, flag);
  flagPivot.rotation.x = Math.PI / 2 - 0.05;
  box.add(post, body, dome, slot, label, flagPivot);
  box.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  const boxShadow = softShadow(1.3, 0.25);
  scene.add(boxShadow);

  // ── 布局与镜头 ─────────────────────────────────────────────────────────
  let L = layoutFor(1.6);
  const START = { pos: new THREE.Vector3(), rot: new THREE.Euler(0.6, -1.1, 0.6, "YXZ") };
  const HOME_ROT = new THREE.Euler(-0.12, 0, 0, "YXZ");
  const REST_ROT = new THREE.Euler(-1.45, 0, 0, "YXZ");
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  let camIn = 0;
  const applyCam = (k: number) => {
    camIn = k;
    camPos.lerpVectors(L.cam, L.camIn, k);
    camTarget.lerpVectors(L.target, L.targetIn, k);
    stage.frame(camPos, camTarget);
  };
  stage.onLayout = (w, h) => {
    L = layoutFor(w / h);
    camera.fov = L.fov;
    camera.updateProjectionMatrix();
    START.pos.copy(L.home).add(tmp.set(3.6, 2.6, -2.6));
    box.position.copy(L.box);
    box.rotation.y = L.boxRot;
    box.scale.setScalar(L.boxScale);
    boxShadow.position.set(L.box.x, 0.002, L.box.z);
    boxShadow.scale.setScalar(L.boxScale / 0.78);
    applyCam(camIn);
    if (phase === "writing" || phase === "arrive" || phase === "open") placeEnvelopeForPhase();
    stage.markShadows();
  };

  const tmp = new THREE.Vector3();
  const setEnvelope = (pos: THREE.Vector3, rx: number, ry: number, rz: number, scale = ENV_SCALE) => {
    envelope.position.copy(pos);
    envelope.rotation.set(rx, ry, rz);
    envelope.scale.setScalar(scale);
    envShadow.position.set(pos.x, 0.002, pos.z);
    const lift = Math.max(0, pos.y);
    envShadow.scale.setScalar(0.55 + lift * 0.2);
    envShadow.material.opacity = Math.max(0, 0.85 - lift * 0.35);
    stage.markShadows();
  };

  // ── 信纸落位：DOM 表单在相机前方 LAND_DIST 处的位姿 ──────────────────────
  const domPos = new THREE.Vector3();
  const domQuat = new THREE.Quaternion();
  const domScale = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const computeDomPose = (): boolean => {
    const rect = options.letterRect();
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;
    if (!rect || !rect.width || !rect.height || !vw || !vh) return false;
    const p = pixelToCameraPlane(rect.left + rect.width / 2, rect.top + rect.height / 2, vw, vh, camera.fov, LAND_DIST);
    const perPx = (2 * LAND_DIST * Math.tan((camera.fov * Math.PI) / 360)) / vh;
    const q = camera.quaternion;
    right.set(1, 0, 0).applyQuaternion(q);
    up.set(0, 1, 0).applyQuaternion(q);
    fwd.set(0, 0, -1).applyQuaternion(q);
    domPos.copy(camera.position).addScaledVector(right, p.x).addScaledVector(up, p.y).addScaledVector(fwd, LAND_DIST);
    domQuat.copy(q);
    const sy = rect.height * perPx;
    domScale.set(rect.width * perPx, sy, 1);
    return true;
  };
  const syncAspect = () => {
    const rect = options.letterRect();
    if (rect && rect.width && rect.height) letterAspect = rect.width / rect.height;
    ensureLetterTexture(letterAspect);
    setInEnvelopeScale();
  };

  // ── 阶段 ───────────────────────────────────────────────────────────────
  let phase: JoinPhase = "arrive";
  // 动画时钟按「每帧夹紧后的 dt」累加，而不是读墙钟：浏览器偶尔卡一帧（或标签页刚恢复）时，
  // 过渡只会慢一点，不会直接跳过折信、封口这些步骤。
  let clock = 0;
  let t0 = 0;
  let flapOpen = 0;
  let flagUp = 0;
  const fromPos = new THREE.Vector3();
  const fromQuat = new THREE.Quaternion();
  const fromScale = new THREE.Vector3();
  const fromEnvPos = new THREE.Vector3();
  const fromEnvRot = new THREE.Euler(0, 0, 0, "YXZ");
  const mouthLocal = new THREE.Vector3();
  const IDENTITY = new THREE.Quaternion();
  let letterReturned = false;
  const setPhase = (next: JoinPhase) => {
    phase = next;
    t0 = clock;
    options.onPhase(next);
    stage.invalidate();
  };
  const placeEnvelopeForPhase = () => {
    if (phase === "writing") setEnvelope(L.rest, REST_ROT.x, REST_ROT.y, REST_ROT.z, REST_SCALE);
    else if (phase === "open") setEnvelope(L.home, HOME_ROT.x, HOME_ROT.y, HOME_ROT.z);
  };

  const beginLand = () => {
    syncAspect();
    scene.attach(letter);
    fromPos.copy(letter.position);
    fromQuat.copy(letter.quaternion);
    fromScale.copy(letter.scale);
    setPhase("land");
  };

  const slotWorld = new THREE.Vector3();
  const inward = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const arcA = new THREE.Vector3();
  const arcB = new THREE.Vector3();
  const postCam = new THREE.Vector3();
  const postTarget = new THREE.Vector3();
  const boxBump = { t: -1 };

  stage.add((dt) => {
    clock += dt;
    const p = clock - t0;
    let motion: Motion = Motion.Idle;
    switch (phase) {
      case "arrive": {
        const k = ease.out(span(p, 0, 1.5));
        const wobble = (1 - k) * 0.25;
        tmp.lerpVectors(START.pos, L.home, k);
        tmp.y += Math.sin(p * 5) * wobble * 0.3;
        setEnvelope(tmp, lerp(START.rot.x, HOME_ROT.x, k) + Math.sin(p * 4) * wobble, lerp(START.rot.y, HOME_ROT.y, k), lerp(START.rot.z, HOME_ROT.z, k) + Math.cos(p * 3) * wobble);
        if (p >= 1.55) setPhase("open");
        motion = Motion.Active;
        break;
      }
      case "open": {
        flapOpen = ease.inOut(span(p, 0, 0.55));
        const out = ease.out(span(p, 0.4, 1.15));
        letter.position.y = lerp(-0.06, H * 0.6, out);
        if (p >= 1.2) beginLand();
        motion = Motion.Active;
        break;
      }
      case "land": {
        const cam = ease.inOut(span(p, 0, 1.3));
        applyCam(cam);
        const rec = ease.inOut(span(p, 0.05, 1.15));
        tmp.lerpVectors(L.home, L.rest, rec);
        setEnvelope(tmp, lerp(HOME_ROT.x, REST_ROT.x, rec), lerp(HOME_ROT.y, REST_ROT.y, rec), lerp(HOME_ROT.z, REST_ROT.z, rec), lerp(ENV_SCALE, REST_SCALE, rec));
        if (computeDomPose()) {
          const fly = ease.inOut(span(p, 0, 1.3));
          const settle = ease.outQuint(span(p, 0, 1.3));
          letter.position.lerpVectors(fromPos, domPos, fly);
          letter.quaternion.slerpQuaternions(fromQuat, domQuat, settle);
          letter.scale.lerpVectors(fromScale, domScale, fly);
        }
        const unfold = ease.inOut(span(p, 0.3, 1.1));
        setFold(1 - unfold, 1 - unfold);
        if (p >= 1.3) {
          setFold(0, 0);
          letter.visible = false;
          setPhase("writing");
        }
        motion = Motion.Active;
        break;
      }
      case "writing":
        break;
      case "sealing": {
        const fb = ease.inOut(span(p, 0.1, 0.5));
        const ft = ease.inOut(span(p, 0.42, 0.82));
        setFold(fb, ft);
        const rise = ease.inOut(span(p, 0.05, 0.95));
        applyCam(1 - rise);
        tmp.lerpVectors(fromEnvPos, L.home, rise);
        setEnvelope(tmp, lerp(fromEnvRot.x, HOME_ROT.x, rise), lerp(fromEnvRot.y, HOME_ROT.y, rise), lerp(fromEnvRot.z, HOME_ROT.z, rise), lerp(REST_SCALE, ENV_SCALE, rise));
        if (p < 0.9) {
          // 还没飞：跟着相机留在表单原位
          if (computeDomPose()) {
            letter.position.copy(domPos);
            letter.quaternion.copy(domQuat);
            letter.scale.copy(domScale);
          }
        } else {
          if (!letterReturned) {
            letterReturned = true;
            envelope.updateMatrixWorld(true);
            envelope.attach(letter);
            fromPos.copy(letter.position);
            fromQuat.copy(letter.quaternion);
            fromScale.copy(letter.scale);
            mouthLocal.set(0, H * 0.62, LETTER_Z);
          }
          const fly = ease.inOut(span(p, 0.9, 1.6));
          letter.position.lerpVectors(fromPos, mouthLocal, fly);
          letter.quaternion.slerpQuaternions(fromQuat, IDENTITY, fly);
          letter.scale.lerpVectors(fromScale, inScale, fly);
          const slide = ease.inOut(span(p, 1.62, 2.1));
          if (slide > 0) letter.position.y = lerp(H * 0.62, -0.06, slide);
          letter.position.z = lerp(fromPos.z, LETTER_Z, fly);
        }
        flapOpen = 1 - ease.inOut(span(p, 2.15, 2.6));
        const drop = span(p, 2.62, 2.92);
        if (drop > 0) {
          seal.visible = true;
          const d = ease.inOut(drop);
          seal.position.z = lerp(0.5, 0.03, d);
          const squash = Math.sin(Math.PI * span(p, 2.88, 3.12));
          const grow = lerp(1.35, 1, d);
          seal.scale.set(grow * (1 + squash * 0.14), 1 - squash * 0.45, grow * (1 + squash * 0.14));
        }
        if (p >= 3.3) {
          fromEnvPos.copy(envelope.position);
          fromEnvRot.copy(envelope.rotation);
          setPhase("posting");
        }
        motion = Motion.Active;
        break;
      }
      case "posting": {
        const k = ease.inOut(span(p, 0, 1.5));
        scene.updateMatrixWorld();
        slot.getWorldPosition(slotWorld);
        inward.set(0, 0, -0.35 * L.boxScale).applyAxisAngle(tmp.set(0, 1, 0), box.rotation.y);
        slotWorld.addScaledVector(inward, k > 0.8 ? (k - 0.8) / 0.2 : 0);
        mid.lerpVectors(fromEnvPos, slotWorld, 0.5).add(tmp.set(0, 1.1, 0.6));
        arcA.lerpVectors(fromEnvPos, mid, k);
        arcB.lerpVectors(mid, slotWorld, k);
        envelope.position.lerpVectors(arcA, arcB, k);
        // 投信口是正面的一条横缝：信封放平、朝向信箱，沿信箱法线送进去
        envelope.rotation.set(lerp(fromEnvRot.x, -Math.PI / 2 + 0.08, ease.inOut(span(k, 0.35, 1))), lerp(fromEnvRot.y, box.rotation.y, k), Math.sin(k * Math.PI) * 0.35);
        envelope.scale.setScalar(lerp(ENV_SCALE, 0.2 * (L.boxScale / 0.78), k));
        envShadow.position.set(envelope.position.x, 0.002, envelope.position.z);
        envShadow.material.opacity = 0.4 * (1 - k);
        postCam.lerpVectors(L.cam, tmp.copy(L.cam).add(right.set(L.box.x * 0.45, 0.2, -0.4)), k);
        // 镜头只朝信箱偏一点：信箱停在画面右侧，左侧留给回执
        postTarget.lerpVectors(L.target, tmp.copy(L.box).setY(1.1 * L.boxScale), k * 0.3);
        stage.frame(postCam, postTarget);
        stage.markShadows();
        if (k > 0.995 && envelope.visible) {
          envelope.visible = false;
          envShadow.visible = false;
          boxBump.t = clock;
        }
        if (p >= 2.2) setPhase("done");
        motion = Motion.Active;
        break;
      }
      case "done":
        break;
    }
    if (!envelope.visible && flagUp < 1) {
      flagUp = Math.min(1, flagUp + dt * 2.4);
      motion = Motion.Active;
    }
    flagPivot.rotation.x = lerp(Math.PI / 2 - 0.05, 0, ease.back(flagUp));
    if (boxBump.t > 0) {
      const b = span(clock - boxBump.t, 0, 0.45);
      box.position.y = L.box.y + Math.sin(b * Math.PI) * 0.05;
      if (b < 1) motion = Motion.Active;
      stage.markShadows();
    }
    // 封舌绕上沿向前翻起、越过竖直后略向后靠（-1.06π），翻开时在信纸背后，不压住信纸；过了一半换成内侧颜色
    flapPivot.rotation.x = lerp(0, -Math.PI * 1.06, flapOpen);
    flapPivot.position.z = flapOpen > 0.5 ? -0.012 : 0.01;
    flap.material = flapOpen > 0.5 ? envInner : envMat;
    flapEdge.visible = flapOpen < 0.05;
    return motion;
  });

  applyCam(0);
  stage.resize();
  if (reducedMotion) {
    // 减少动态效果：不播动画，信封放在后面，直接写信
    syncAspect();
    letter.visible = false;
    flapOpen = 1;
    phase = "writing";
    setEnvelope(L.rest, REST_ROT.x, REST_ROT.y, REST_ROT.z, REST_SCALE);
    applyCam(1);
    options.onPhase("writing");
  } else {
    setEnvelope(START.pos, START.rot.x, START.rot.y, START.rot.z);
    options.onPhase("arrive");
  }
  await stage.warmUp();
  stage.invalidate();

  return {
    stage,
    seal(lines) {
      if (phase !== "writing") return;
      filledLines = lines;
      syncAspect();
      letterTex?.redraw(lines);
      if (reducedMotion) {
        envelope.visible = false;
        envShadow.visible = false;
        flagUp = 1;
        flagPivot.rotation.x = 0;
        setPhase("done");
        return;
      }
      if (letter.parent !== scene) scene.attach(letter);
      setFold(0, 0);
      letterReturned = false;
      if (computeDomPose()) {
        letter.position.copy(domPos);
        letter.quaternion.copy(domQuat);
        letter.scale.copy(domScale);
      }
      letter.visible = true;
      fromEnvPos.copy(envelope.position);
      fromEnvRot.copy(envelope.rotation);
      setPhase("sealing");
    },
    dispose() {
      letterTex?.texture.dispose();
      stage.dispose();
    },
  };
}
