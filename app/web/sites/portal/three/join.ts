// 加入我们：信封飞进来停在画面正中 → 封舌打开 → 三折的信纸抽出 → 镜头推近、信纸边飞边展开，
// 平贴屏幕落在正中（与 DOM 表单严丝合缝后交给表单）→ 提交后信纸在原位两道折痕折好 → 飞回信封塞进去 →
// 封舌合上、火漆落下压扁一下 → 信封飞进一侧的信箱，小旗弹起。
// 由 pages/JoinUs.tsx 动态加载；提交本身在页面里完成（真实的 POST /api/portal/apply），这里只管画面。
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { pixelToCameraPlane } from "../lib/cameraMath";
import { ease, lerp, span } from "../lib/motion";
import { Motion, PALETTE, Stage, TEXT_SCALE, canvasTexture, drawEmblem, loadImage, softShadow, type CanvasTexture } from "./stage";

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
/** 信纸在信封里的 z（夹在底板内衬 -0.001 与口袋 0.008 之间；折好后最厚到 0.0052） */
const LETTER_Z = 0.002;
const PAPER_BACK = "#f7f4ec";
/** 写信时信封缩小平躺在信纸下方（露出带邮戳的下半截），不抢信纸的焦点 */
const REST_SCALE = 0.6;
/** 信纸落位后，3D 信纸在 DOM 表单下面再留这么久（秒），等表单淡入完再藏，交接时不闪 */
const HANDOFF_S = 0.3;
/** 信纸贴图宽度的上下限（像素）：按 DOM 信纸宽 × 设备像素比（封顶 2）取值，落位那一帧与表单一样清楚 */
const LETTER_TEX_MIN = 512;
const LETTER_TEX_MAX = 1536;

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
      // 竖屏：信箱立在地上、放在信封右下方靠前的位置，信封停在正中时不压住信箱顶，信箱连同立柱整个在画面里
      box: v(0.66, 0, -0.2),
      boxScale: 0.4,
      boxRot: -0.4,
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

  // ── 纸的质感：所有纸面共用一张凹凸贴图（细颗粒 + 短纤维），光照下看得出是纸 ─────────
  let seed = 20260924;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  /** 印在纸上的细小杂点：暖灰与亮白各一半，让大面积纸色不是一块死平的颜色 */
  const speckle = (x: CanvasRenderingContext2D, w: number, h: number, count: number, alpha: number) => {
    for (let i = 0; i < count; i++) {
      x.fillStyle = rand() < 0.5 ? `rgba(90,70,40,${alpha * rand()})` : `rgba(255,255,255,${alpha * 1.6 * rand()})`;
      x.fillRect(rand() * w, rand() * h, 1 + rand() * 1.6, 1 + rand() * 1.6);
    }
  };
  const grain = canvasTexture(256, 256, (x, w, h) => {
    const image = x.createImageData(w, h);
    for (let i = 0; i < image.data.length; i += 4) {
      const n = 128 + (rand() - 0.5) * 46;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = n;
      image.data[i + 3] = 255;
    }
    x.putImageData(image, 0, 0);
    x.lineCap = "round";
    for (let i = 0; i < 140; i++) {
      x.strokeStyle = rand() < 0.5 ? `rgba(255,255,255,${0.18 + rand() * 0.2})` : `rgba(0,0,0,${0.12 + rand() * 0.14})`;
      x.lineWidth = 0.6 + rand() * 0.8;
      const sx = rand() * w;
      const sy = rand() * h;
      const angle = rand() * Math.PI * 2;
      const len = 4 + rand() * 14;
      x.beginPath();
      x.moveTo(sx, sy);
      x.quadraticCurveTo(sx + Math.cos(angle + 0.6) * len * 0.5, sy + Math.sin(angle + 0.6) * len * 0.5, sx + Math.cos(angle) * len, sy + Math.sin(angle) * len);
      x.stroke();
    }
  });
  grain.texture.colorSpace = THREE.NoColorSpace;
  grain.texture.wrapS = grain.texture.wrapT = THREE.RepeatWrapping;
  grain.texture.repeat.set(5, 3.2);

  /** 航空信封的斜条纹边：钴蓝与琥珀交替，中间留纸色的缝 */
  const airmail = (x: CanvasRenderingContext2D, w: number, h: number) => {
    const inset = 8;
    const band = 20;
    x.save();
    x.beginPath();
    x.rect(inset, inset, w - 2 * inset, h - 2 * inset);
    x.rect(inset + band, inset + band, w - 2 * (inset + band), h - 2 * (inset + band));
    x.clip("evenodd");
    for (let i = -h, k = 0; i < w + h; i += 34, k++) {
      x.fillStyle = k % 2 === 0 ? "rgba(51,70,200,0.86)" : "rgba(236,152,32,0.9)";
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i + 22, 0);
      x.lineTo(i + 22 - h, h);
      x.lineTo(i - h, h);
      x.closePath();
      x.fill();
    }
    x.restore();
  };
  /** 折口：纸在边上翻过去的地方略暗（四边各一道渐变，top 单独给强度，封舌的翻折线用得上） */
  const foldShade = (x: CanvasRenderingContext2D, w: number, h: number, top: number) => {
    const shade = (x0: number, y0: number, x1: number, y1: number, alpha: number) => {
      const g = x.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, `rgba(90,70,40,${alpha})`);
      g.addColorStop(1, "rgba(90,70,40,0)");
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    };
    shade(0, 0, w * 0.05, 0, 0.08);
    shade(w, 0, w * 0.95, 0, 0.08);
    shade(0, h, 0, h * 0.93, 0.07);
    shade(0, 0, 0, h * 0.07, top);
  };
  const IVORY = "#fbf8f1";

  // 封舌这一面（镜头看到的一面）：下襟压在左右两襟上，下襟略亮，两条斜边上一道软阴影和一道细折痕
  const face = canvasTexture(
    1100,
    700,
    (x, w, h) => {
      x.fillStyle = IVORY;
      x.fillRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.5;
      x.fillStyle = "rgba(255,255,255,0.55)";
      x.beginPath();
      x.moveTo(0, h);
      x.lineTo(cx, cy);
      x.lineTo(w, h);
      x.closePath();
      x.fill();
      x.save();
      x.shadowColor = "rgba(70,55,30,0.24)";
      x.shadowBlur = 16;
      x.shadowOffsetY = -4;
      x.strokeStyle = "rgba(70,55,30,0.16)";
      x.lineWidth = 1.6;
      x.beginPath();
      x.moveTo(0, h);
      x.lineTo(cx, cy);
      x.lineTo(w, h);
      x.stroke();
      x.restore();
      foldShade(x, w, h, 0.09);
      speckle(x, w, h, 2600, 0.12);
      airmail(x, w, h);
    },
    TEXT_SCALE,
  );
  // 封舌外侧：只有纸、条纹边和靠近翻折线的一道暗
  const flapFace = canvasTexture(
    1100,
    700,
    (x, w, h) => {
      x.fillStyle = IVORY;
      x.fillRect(0, 0, w, h);
      foldShade(x, w, h, 0.12);
      speckle(x, w, h, 2600, 0.12);
      airmail(x, w, h);
    },
    TEXT_SCALE,
  );
  // 地址面（信封翻过来时看到）：左上六个邮编框、右上一枚带齿孔的邮票和邮戳、手写的收件人
  const address = canvasTexture(
    1100,
    700,
    (x, w, h) => {
      x.fillStyle = IVORY;
      x.fillRect(0, 0, w, h);
      foldShade(x, w, h, 0.07);
      speckle(x, w, h, 2600, 0.12);
      airmail(x, w, h);
      x.strokeStyle = "rgba(213,72,64,0.75)";
      x.lineWidth = 3;
      for (let i = 0; i < 6; i++) x.strokeRect(70 + i * 56, 66, 44, 44);
      // 邮票：先画纸色的齿孔底，再铺票面
      const sx = w - 236;
      const sy = 56;
      const sw = 156;
      const sh = 188;
      x.fillStyle = "#ffffff";
      x.fillRect(sx, sy, sw, sh);
      x.fillStyle = IVORY;
      for (let t = 0; t <= sw; t += 13) {
        for (const yy of [sy, sy + sh]) {
          x.beginPath();
          x.arc(sx + t, yy, 4.5, 0, Math.PI * 2);
          x.fill();
        }
      }
      for (let t = 0; t <= sh; t += 13) {
        for (const xx of [sx, sx + sw]) {
          x.beginPath();
          x.arc(xx, sy + t, 4.5, 0, Math.PI * 2);
          x.fill();
        }
      }
      x.fillStyle = PALETTE.cobaltSoft;
      x.fillRect(sx + 12, sy + 12, sw - 24, sh - 24);
      if (logo) drawEmblem(x, logo, sx + sw / 2, sy + 82, 88);
      x.fillStyle = PALETTE.cobalt;
      x.textAlign = "center";
      x.font = '700 22px "PingFang SC", "Hiragino Sans GB", sans-serif';
      x.fillText("极客班", sx + sw / 2, sy + sh - 30);
      // 邮戳压在邮票左边缘
      x.save();
      x.translate(sx - 6, sy + 120);
      x.rotate(-0.2);
      x.strokeStyle = "rgba(51,70,200,0.42)";
      x.lineWidth = 3.5;
      x.beginPath();
      x.arc(0, 0, 58, 0, Math.PI * 2);
      x.stroke();
      x.beginPath();
      x.arc(0, 0, 46, 0, Math.PI * 2);
      x.stroke();
      x.fillStyle = "rgba(51,70,200,0.5)";
      x.font = '700 20px "PingFang SC", "Hiragino Sans GB", sans-serif';
      x.fillText("YUGC", 0, 7);
      for (let k = 0; k < 4; k++) {
        x.beginPath();
        x.moveTo(-230, -30 + k * 20);
        for (let X = -230; X < -70; X += 10) x.lineTo(X, -30 + k * 20 + Math.sin(X / 9) * 5);
        x.stroke();
      }
      x.restore();
      // 收件人：手写体 + 淡淡的地址横线
      x.strokeStyle = "rgba(90,70,40,0.18)";
      x.lineWidth = 1.5;
      for (const yy of [388, 488]) {
        x.beginPath();
        x.moveTo(150, yy);
        x.lineTo(w - 150, yy);
        x.stroke();
      }
      x.fillStyle = "rgba(27,33,64,0.86)";
      x.textAlign = "left";
      x.font = '52px "Kaiti SC", "STKaiti", "KaiTi", "BiauKai", serif';
      x.fillText("长江大学", 190, 372);
      x.font = '64px "Kaiti SC", "STKaiti", "KaiTi", "BiauKai", serif';
      x.fillText("极客班 收", 430, 474);
    },
    TEXT_SCALE,
  );
  // 内衬：深钴蓝底上一层细线六边形，像保密信封的内衬
  const liner = canvasTexture(
    640,
    400,
    (x, w, h) => {
      x.fillStyle = "#2c3cb2";
      x.fillRect(0, 0, w, h);
      x.strokeStyle = "rgba(170,184,255,0.22)";
      x.lineWidth = 1.2;
      const r = 11;
      const dx = r * Math.sqrt(3);
      const dy = r * 1.5;
      for (let row = 0, y = -r; y < h + r * 2; row++, y += dy) {
        for (let X = (row % 2 ? dx / 2 : 0) - dx; X < w + dx; X += dx) {
          x.beginPath();
          for (let k = 0; k <= 6; k++) {
            const angle = Math.PI / 6 + (k * Math.PI) / 3;
            if (k === 0) x.moveTo(X + Math.cos(angle) * r, y + Math.sin(angle) * r);
            else x.lineTo(X + Math.cos(angle) * r, y + Math.sin(angle) * r);
          }
          x.stroke();
        }
      }
      const vignette = x.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.7);
      vignette.addColorStop(0, "rgba(10,14,60,0)");
      vignette.addColorStop(1, "rgba(10,14,60,0.35)");
      x.fillStyle = vignette;
      x.fillRect(0, 0, w, h);
    },
    TEXT_SCALE,
  );
  const paperBump = { bumpMap: grain.texture, bumpScale: 0.6 };
  const faceMat = new THREE.MeshStandardMaterial({ map: face.texture, roughness: 0.86, ...paperBump });
  const flapMat = new THREE.MeshStandardMaterial({ map: flapFace.texture, roughness: 0.86, ...paperBump });
  const addressMat = new THREE.MeshStandardMaterial({ map: address.texture, roughness: 0.86, ...paperBump });
  const linerMat = new THREE.MeshStandardMaterial({ map: liner.texture, roughness: 0.78, ...paperBump });
  const linerBack = new THREE.MeshStandardMaterial({ map: liner.texture, roughness: 0.78, side: THREE.BackSide, ...paperBump });
  const edgeMat = new THREE.MeshStandardMaterial({ color: "#ece5d6", roughness: 0.9 });

  const shapeOf = (points: Array<[number, number]>) => {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (const [px, py] of points.slice(1)) shape.lineTo(px, py);
    shape.closePath();
    return shape;
  };
  /** 按信封局部坐标给顶点铺 UV：口袋、封舌、底板共用一套贴图坐标 */
  const mapUv = <G extends THREE.BufferGeometry>(geometry: G, offsetY = 0): G => {
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const uv = geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + W / 2) / W, (pos.getY(i) + offsetY + H / 2) / H);
    return geometry;
  };

  // 信封的层次（信封局部 z）：底板 -0.011..-0.001 │ 信纸 0.002..0.0052 │ 口袋 0.008..0.012 │ 封舌 0.013 │ 火漆
  // 左右与下边各一条窄边墙把底板和口袋连起来，侧面看是一个有厚度的纸袋，不是两张分开的面片
  const envelope = new THREE.Group();
  envelope.rotation.order = "YXZ";
  envelope.scale.setScalar(ENV_SCALE);
  scene.add(envelope);
  const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.01), [edgeMat, edgeMat, edgeMat, edgeMat, linerMat, addressMat]);
  back.position.z = -0.006;
  envelope.add(back);
  const pocket = new THREE.Mesh(
    mapUv(new THREE.ExtrudeGeometry(shapeOf([[-W / 2, H / 2], [0, H * 0.02], [W / 2, H / 2], [W / 2, -H / 2], [-W / 2, -H / 2]]), { depth: 0.004, bevelEnabled: false })),
    [faceMat, edgeMat],
  );
  pocket.position.z = 0.008;
  envelope.add(pocket);
  const wallGeo = new THREE.BoxGeometry(1, 1, 0.009);
  for (const [px, py, sw, sh] of [
    [-W / 2 + 0.002, 0, 0.004, H],
    [W / 2 - 0.002, 0, 0.004, H],
    [0, -H / 2 + 0.002, W, 0.004],
  ] as const) {
    const wall = new THREE.Mesh(wallGeo, edgeMat);
    wall.scale.set(sw, sh, 1);
    wall.position.set(px, py, 0.0035);
    envelope.add(wall);
  }
  const flapPivot = new THREE.Group();
  flapPivot.position.set(0, H / 2, 0.013);
  envelope.add(flapPivot);
  const flapGeo = mapUv(new THREE.ShapeGeometry(shapeOf([[-W / 2, 0], [W / 2, 0], [0, -H * 0.62]])), H / 2);
  // 封舌外侧是纸、翻过来是内衬：两张共用几何体的单面网格，翻到哪面就看到哪面，不用中途换材质
  flapPivot.add(new THREE.Mesh(flapGeo, flapMat), new THREE.Mesh(flapGeo, linerBack));
  // 封舌合上时投在口袋上的一道软影（贴图只画封舌三角形外缘的模糊），翻开就淡掉
  const flapShadowTex = canvasTexture(512, 336, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.shadowColor = "rgba(40,30,10,0.4)";
    x.shadowBlur = 14;
    x.shadowOffsetY = 6;
    x.fillStyle = "rgba(40,30,10,0.2)";
    x.beginPath();
    x.moveTo(0, 0);
    x.lineTo(w, 0);
    x.lineTo(w / 2, h * (0.62 / 0.7));
    x.closePath();
    x.fill();
  });
  const flapShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H * 0.7),
    new THREE.MeshBasicMaterial({ map: flapShadowTex.texture, transparent: true, depthWrite: false }),
  );
  flapShadow.position.set(0, H / 2 - H * 0.35, 0.0125);
  envelope.add(flapShadow);

  // 火漆：不规则的一团蜡（挤出 + 倒角出体积），顶面压着校徽，校徽同时做凹凸贴图，看得出是压进去的
  const sealShape = new THREE.Shape();
  for (let i = 0; i <= 72; i++) {
    const angle = (i / 72) * Math.PI * 2;
    const radius = 0.15 * (1 + 0.05 * Math.sin(angle * 5 + 1.3) + 0.025 * Math.sin(angle * 13 + 0.4));
    if (i === 0) sealShape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    else sealShape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  const sealGeo = new THREE.ExtrudeGeometry(sealShape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.016, bevelSize: 0.022, bevelSegments: 5, curveSegments: 4 });
  sealGeo.center();
  {
    const pos = sealGeo.attributes.position as THREE.BufferAttribute;
    const uv = sealGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / 0.4, 0.5 + pos.getY(i) / 0.4);
  }
  const sealFace = canvasTexture(
    256,
    256,
    (x, w) => {
      const g = x.createRadialGradient(w * 0.42, w * 0.38, w * 0.05, w / 2, w / 2, w * 0.55);
      g.addColorStop(0, "#4b5de0");
      g.addColorStop(1, "#23309a");
      x.fillStyle = g;
      x.fillRect(0, 0, w, w);
      x.lineWidth = 5;
      x.strokeStyle = "rgba(10,16,70,0.45)";
      x.beginPath();
      x.arc(w / 2, w / 2, w * 0.34, 0, Math.PI * 2);
      x.stroke();
      if (logo) {
        x.globalAlpha = 0.55;
        x.globalCompositeOperation = "multiply";
        drawEmblem(x, logo, w / 2, w / 2, w * 0.56);
      }
    },
    TEXT_SCALE,
  );
  const sealBump = canvasTexture(
    256,
    256,
    (x, w) => {
      x.fillStyle = "#b4b4b4";
      x.fillRect(0, 0, w, w);
      x.lineWidth = 7;
      x.strokeStyle = "#5a5a5a";
      x.beginPath();
      x.arc(w / 2, w / 2, w * 0.34, 0, Math.PI * 2);
      x.stroke();
      if (logo) {
        x.globalCompositeOperation = "multiply";
        drawEmblem(x, logo, w / 2, w / 2, w * 0.56);
      }
    },
    TEXT_SCALE,
  );
  sealBump.texture.colorSpace = THREE.NoColorSpace;
  const seal = new THREE.Mesh(sealGeo, [
    new THREE.MeshStandardMaterial({ map: sealFace.texture, bumpMap: sealBump.texture, bumpScale: 2.2, roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ color: "#2a37a8", roughness: 0.28 }),
  ]);
  /** 火漆落定时中心的 z：贴在合上的封舌表面（0.013）上，厚度一半 0.022 */
  const SEAL_Z = 0.036;
  seal.position.set(0, H / 2 - H * 0.6, SEAL_Z);
  seal.visible = false;
  envelope.add(seal);
  envelope.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) m.castShadow = true;
  });
  flapShadow.castShadow = false;
  const envShadow = softShadow(2.4, 0.16);
  scene.add(envShadow);

  // ── 信纸：上中下三片，两道折痕处各一个铰链；正面贴图、背面素纸 ────────────
  let letterAspect = 1.15;
  let letterTex: CanvasTexture<string[]> | null = null;
  let filledLines: string[] | undefined;
  /** DOM 信纸的 CSS 宽度：贴图按它换算，窄屏上横格线与标题也和表单对得上 */
  let letterCssW = 640;
  const drawLetter = (x: CanvasRenderingContext2D, w: number, h: number, lines?: string[]) => {
    const s = w / letterCssW;
    x.fillStyle = PAPER;
    x.fillRect(0, 0, w, h);
    // 左上角一团淡白高光，同 DOM 信纸的 radial-gradient(120% 80% at 0% 0%, …)
    x.save();
    x.scale(1.2 * w, 0.8 * h);
    const glow = x.createRadialGradient(0, 0, 0, 0, 0, 1);
    glow.addColorStop(0, "rgba(255,255,255,0.7)");
    glow.addColorStop(0.6, "rgba(255,255,255,0)");
    x.fillStyle = glow;
    x.fillRect(0, 0, 1 / 1.2, 1 / 0.8);
    x.restore();
    // 横格线与内框和 DOM 信纸（styles/scenes.css 的 .pt-letter 背景与 ::before）一致：第一条在 129px，之后每 34px 一条
    x.fillStyle = "rgba(51,70,200,0.08)";
    for (let y = 129 * s; y < h; y += 34 * s) x.fillRect(0, y, w, s);
    x.strokeStyle = "rgba(51,70,200,0.07)";
    x.lineWidth = s;
    x.strokeRect(10.5 * s, 10.5 * s, w - 21 * s, h - 21 * s);
    x.textAlign = "left";
    x.fillStyle = PALETTE.ink;
    x.font = `700 ${Math.round(22 * s)}px "PingFang SC", "Hiragino Sans GB", sans-serif`;
    x.fillText("致 长江大学极客班：", 38 * s, 56 * s);
    if (logo) drawEmblem(x, logo, w - 60 * s, 52 * s, 44 * s);
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
    }
  };
  let drawnCssW = 0;
  const ensureLetterTexture = (aspect: number) => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(Math.min(LETTER_TEX_MAX, Math.max(LETTER_TEX_MIN, letterCssW * ratio)));
    const height = Math.round(Math.min(width * 2.4, Math.max(width * 0.55, width / aspect)));
    // 尺寸与排版都没变就不重画：重画会重新上传整张贴图，动画中途会卡一帧
    if (letterTex && letterTex.canvas.width === width && letterTex.canvas.height === height && drawnCssW === letterCssW) return;
    drawnCssW = letterCssW;
    if (letterTex && letterTex.canvas.width === width && letterTex.canvas.height === height) {
      letterTex.redraw(filledLines);
      return;
    }
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
  // 信纸背面：受光的纸（颗粒凹凸），透出一点正面的横格线；折起来时看到的就是这一面
  const letterBack = canvasTexture(512, 512, (x, w, h) => {
    x.fillStyle = PAPER_BACK;
    x.fillRect(0, 0, w, h);
    speckle(x, w, h, 900, 0.1);
    x.fillStyle = "rgba(51,70,200,0.05)";
    for (let y = 0.232 * h; y < h; y += 0.061 * h) x.fillRect(0, y, w, 1.2);
  });
  // 正面是不受光的贴图（要和 DOM 表单一模一样），背面受光但带一点自发光：翻过来背光时仍是纸色，不会变成一块灰板
  const backMat = new THREE.MeshStandardMaterial({
    map: letterBack.texture,
    bumpMap: grain.texture,
    bumpScale: 0.4,
    roughness: 0.92,
    emissive: "#efe9dc",
    emissiveIntensity: 0.55,
    side: THREE.BackSide,
  });
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
  // 贴图一开始就按 DOM 信纸的尺寸建好（表单此时已在页面里，只是隐藏），抽出信纸时不用再换贴图
  let texAspect = letterAspect;
  const initialRect = options.letterRect();
  if (initialRect && initialRect.width && initialRect.height) {
    letterCssW = initialRect.width;
    texAspect = initialRect.width / initialRect.height;
  }
  ensureLetterTexture(texAspect);
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
  const plate = canvasTexture(
    256,
    96,
    (x, w) => {
      x.fillStyle = PAPER;
      x.fillRect(0, 0, w, 96);
      x.fillStyle = PALETTE.ink;
      x.textAlign = "center";
      x.font = '700 34px "SF Mono", Menlo, monospace';
      x.fillText("YUGC", w / 2, 44);
      x.font = '20px "PingFang SC", sans-serif';
      x.fillText("极客班信箱", w / 2, 78);
    },
    TEXT_SCALE,
  );
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
  // 从正上方偏后落下来：信箱在右边（从右上方进场会穿过信箱），左边是说明文字（从左上方进场会压在字后面）
  const START = { pos: new THREE.Vector3(), rot: new THREE.Euler(1.0, 0.5, -0.5, "YXZ") };
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
    START.pos.copy(L.home).add(tmp.set(0, 3.4, -2.4));
    box.position.copy(L.box);
    box.rotation.y = L.boxRot;
    box.scale.setScalar(L.boxScale);
    boxShadow.position.set(L.box.x, 0.002, L.box.z);
    boxShadow.scale.setScalar(L.boxScale / 0.78);
    applyCam(camIn);
    readDomRect();
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
  const plane = { x: 0, y: 0 };
  /** DOM 信纸的位置：固定定位，只在阶段开始和窗口尺寸变化时读一次（逐帧读会触发布局并分配 DOMRect） */
  let domRect: DOMRect | null = null;
  const readDomRect = () => {
    domRect = options.letterRect();
  };
  const computeDomPose = (): boolean => {
    const rect = domRect;
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;
    if (!rect || !rect.width || !rect.height || !vw || !vh) return false;
    const p = pixelToCameraPlane(rect.left + rect.width / 2, rect.top + rect.height / 2, vw, vh, camera.fov, LAND_DIST, plane);
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
    readDomRect();
    const rect = domRect;
    if (rect && rect.width && rect.height) {
      letterAspect = rect.width / rect.height;
      letterCssW = rect.width;
    }
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
  /** 投递开始时贴地柔影的不透明度：从这里淡到 0，不从固定值起跳 */
  let fromShadow = 0;
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
          setPhase("writing");
        }
        motion = Motion.Active;
        break;
      }
      case "writing":
        // DOM 信纸在 3D 信纸上面淡入；淡入完成后再把 3D 信纸藏起来
        if (letter.visible) {
          if (p >= HANDOFF_S) letter.visible = false;
          motion = Motion.Active;
        }
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
          seal.position.z = lerp(0.5, SEAL_Z, d);
          const squash = Math.sin(Math.PI * span(p, 2.88, 3.12));
          const grow = lerp(1.35, 1, d);
          seal.scale.set(grow * (1 + squash * 0.14), grow * (1 + squash * 0.14), 1 - squash * 0.45);
        }
        if (p >= 3.3) {
          fromEnvPos.copy(envelope.position);
          fromEnvRot.copy(envelope.rotation);
          fromShadow = envShadow.material.opacity;
          setPhase("posting");
        }
        motion = Motion.Active;
        break;
      }
      case "posting": {
        const k = ease.inOut(span(p, 0, 1.5));
        scene.updateMatrixWorld();
        slot.getWorldPosition(slotWorld);
        // 投信口是信箱正面的一条横缝。分两段走：
        //   1) 前 70%：沿一条向上拱的弧线飞到投信口正前方（法线方向离开信箱一段距离），路上转正、放平、缩到比缝窄；
        //   2) 后 30%：沿信箱法线直直推进缝里。信封在信箱前方时已经比缝小，不会从侧面或圆顶上穿过信箱。
        inward.set(0, 0, 1).applyAxisAngle(tmp.set(0, 1, 0), box.rotation.y);
        mid.copy(slotWorld).addScaledVector(inward, 0.9 * L.boxScale);
        const fly = ease.inOut(span(k, 0, 0.7));
        arcA.lerpVectors(fromEnvPos, mid, fly);
        arcA.y += Math.sin(fly * Math.PI) * 0.5;
        const push = ease.inOut(span(k, 0.7, 1));
        arcB.copy(mid).addScaledVector(inward, -(0.9 + 0.35) * L.boxScale * push);
        envelope.position.copy(push > 0 ? arcB : arcA);
        const turn = ease.inOut(span(k, 0.05, 0.62));
        envelope.rotation.set(lerp(fromEnvRot.x, -Math.PI / 2, turn), lerp(fromEnvRot.y, box.rotation.y, turn), Math.sin(turn * Math.PI) * 0.25);
        envelope.scale.setScalar(lerp(ENV_SCALE, 0.17 * (L.boxScale / 0.78), ease.inOut(span(k, 0, 0.62))));
        envShadow.position.set(envelope.position.x, 0.002, envelope.position.z);
        envShadow.material.opacity = fromShadow * (1 - k);
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
    // 翻过一半后铰链挪到底板后面：翻开的封舌根部在信纸后方，信纸抽出、塞回时都不会穿过它
    flapPivot.position.z = flapOpen > 0.5 ? -0.013 : 0.013;
    flapShadow.material.opacity = 1 - span(flapOpen, 0, 0.12);
    flapShadow.visible = flapOpen < 0.12;
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
  await stage.warmUp([seal, flapShadow]);
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
