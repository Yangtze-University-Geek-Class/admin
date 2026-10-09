// 首页书桌上的小物件：马克杯与杯垫、盆栽、硬壳笔记本与铅笔、墙上的挂画（issue #213 的延伸，所有者要求「周围建模精细一点」）。
// 全部程序化几何，不引入外部模型或依赖。位置、朝向与交互（点杯子冒热气、点植物晃动）仍由 desk.ts 决定，
// 这里只负责「长什么样」：
//   · 车削（LatheGeometry）做杯子与花盆：壁厚、圆润杯口、底部圆角、盆沿与托盘，而不是一段空心圆柱；
//   · 叶片放样：沿长度渐尖、横向 V 形弯折、整体向外弯曲，顶点色做根深尖浅，比压扁的球像叶子；
//   · 笔记本有前后封面、纸页厚度与松紧带，铅笔是六棱柱 + 削尖的木头 + 石墨 + 铁箍 + 橡皮；
//   · 挂画是薄画板 + 画面 + 两枚小图钉，不带相框；杯子下垫软木杯垫。
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const v2 = (x: number, y: number) => new THREE.Vector2(x, y);

/** 圆弧采样：圆心 (cx,cy)、半径 r，从角 a0 到 a1（弧度），端点都包含 */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(v2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return out;
}

function lathe(points: THREE.Vector2[], segments = 64): THREE.LatheGeometry {
  const g = new THREE.LatheGeometry(points, segments);
  g.computeVertexNormals();
  return g;
}

// ── 马克杯 ──────────────────────────────────────────────────────────────────
/** 杯壁外半径随高度的线性插值（底部圆角之上到杯口之下），用来贴蓝色腰带 */
const MUG_WALL = (y: number) => 0.105 + ((y - 0.02) / 0.225) * 0.0105;

export function createMug(): THREE.Group {
  const mug = new THREE.Group();
  const ceramic = new THREE.MeshStandardMaterial({ color: "#fbfbfd", roughness: 0.2 });

  // 一条闭合轮廓：外底 → 底圆角 → 外壁 → 圆润杯口 → 内壁 → 内底圆角 → 内底
  const profile: THREE.Vector2[] = [v2(0, 0), v2(0.082, 0)];
  profile.push(...arc(0.082, 0.021, 0.021, -Math.PI / 2, 0, 8).slice(1));
  profile.push(v2(0.1155, 0.245));
  profile.push(...arc(0.107, 0.245, 0.0085, 0, Math.PI, 10).slice(1));
  profile.push(v2(0.0885, 0.05));
  profile.push(...arc(0.0685, 0.05, 0.02, 0, -Math.PI / 2, 8).slice(1));
  profile.push(v2(0, 0.03));
  mug.add(new THREE.Mesh(lathe(profile, 56), ceramic));

  // 咖啡液面：深色主体 + 靠杯壁一圈偏浅的油脂，稍高于主体避免共面
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.0955, 40), new THREE.MeshStandardMaterial({ color: "#5b3a26", roughness: 0.1 }));
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = 0.205;
  const crema = new THREE.Mesh(new THREE.RingGeometry(0.083, 0.0955, 40), new THREE.MeshStandardMaterial({ color: "#8b5d3d", roughness: 0.3 }));
  crema.rotation.x = -Math.PI / 2;
  crema.position.y = 0.2055;
  mug.add(coffee, crema);

  // 蓝色腰带：两端带小圆角，微微凸出杯壁
  const bandProfile = [v2(MUG_WALL(0.14) - 0.0003, 0.14), v2(MUG_WALL(0.14) + 0.0016, 0.1424), v2(MUG_WALL(0.19) + 0.0016, 0.1876), v2(MUG_WALL(0.19) - 0.0003, 0.19)];
  mug.add(new THREE.Mesh(lathe(bandProfile, 56), new THREE.MeshStandardMaterial({ color: "#3346c8", roughness: 0.35 })));

  // 杯把：沿平滑曲线扫出的管，两端埋进杯壁
  const curve = new THREE.CatmullRomCurve3(
    [v2(0.104, 0.205), v2(0.15, 0.208), v2(0.19, 0.162), v2(0.19, 0.106), v2(0.153, 0.064), v2(0.104, 0.062)].map((p) => new THREE.Vector3(p.x, p.y, 0)),
    false,
    "centripetal",
  );
  const handle = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.0155, 10, false), ceramic);
  handle.scale.z = 0.88;
  mug.add(handle);
  return mug;
}

/** 软木杯垫：边缘圆润，面上一圈浅槽；原点在桌面中心 */
export function createCoaster(): THREE.Mesh {
  const r = 0.15;
  const h = 0.008;
  const profile = [v2(0, 0), v2(r - 0.006, 0), ...arc(r - 0.006, 0.004, 0.004, -Math.PI / 2, 0, 4).slice(1), v2(r, h - 0.003), ...arc(r - 0.003, h - 0.003, 0.003, 0, Math.PI / 2, 4).slice(1), v2(r - 0.02, h), v2(r - 0.024, h - 0.0007), v2(r - 0.028, h), v2(0, h)];
  const mesh = new THREE.Mesh(lathe(profile, 56), new THREE.MeshStandardMaterial({ color: "#c9a77c", roughness: 0.95 }));
  mesh.receiveShadow = true;
  return mesh;
}

// ── 盆栽 ────────────────────────────────────────────────────────────────────
/**
 * 一片放样叶片：沿 +Y 生长，宽度在 Z，向 -X 弯曲（pivot 绕 Z 正向转动时也是向 -X 倾倒，两者同向）。
 * 正面略凹成 V 槽，背面中脊凸起；顶点色根深尖浅。
 */
function bladeGeometry(length: number, halfWidth: number, bend: number, thickness: number): THREE.BufferGeometry {
  const L = 16;
  const W = 6;
  const positions: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const base = new THREE.Color("#3b8460");
  const mid = new THREE.Color("#63b184");
  const tip = new THREE.Color("#94d3a8");
  const tmp = new THREE.Color();

  const surface = (back: boolean) => {
    const start = positions.length / 3;
    for (let i = 0; i <= L; i++) {
      const t = i / L;
      // 宽度：根部收窄、中段最宽、末端渐尖
      const w = halfWidth * (0.5 + 0.5 * Math.min(1, t * 5)) * Math.pow(Math.max(0, 1 - Math.pow(t, 1.7)), 0.75);
      const x0 = -bend * length * t * t;
      const y0 = length * (t - 0.12 * t * t);
      const thk = thickness * (1 - 0.7 * t);
      for (let j = 0; j <= W; j++) {
        const s = (j / W) * 2 - 1;
        const x = back ? x0 - thk * (1 - s * s) : x0 + thk * 0.35 * (s * s - 1);
        positions.push(x, y0, s * w);
        tmp.copy(base).lerp(mid, Math.min(1, t * 2)).lerp(tip, Math.max(0, t * 2 - 1));
        tmp.multiplyScalar((back ? 0.88 : 1) * (0.94 + 0.06 * s * s));
        colors.push(tmp.r, tmp.g, tmp.b);
      }
    }
    for (let i = 0; i < L; i++) {
      for (let j = 0; j < W; j++) {
        const a = start + i * (W + 1) + j;
        const b = a + 1;
        const c = a + W + 1;
        const d = c + 1;
        if (back) index.push(a, b, c, b, d, c);
        else index.push(a, c, b, b, c, d);
      }
    }
  };
  surface(true);
  surface(false);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

export type Plant = { group: THREE.Group; /** 叶片枢轴：userData.tilt 是静止倾角，desk 在每帧上叠加摇摆 */ leaves: THREE.Group[] };

export function createPlant(): Plant {
  const group = new THREE.Group();
  const potMat = new THREE.MeshStandardMaterial({ color: "#f6f3ee", roughness: 0.42 });

  // 托盘：浅碟，边缘卷起
  const saucer: THREE.Vector2[] = [v2(0, 0), v2(0.13, 0), ...arc(0.13, 0.008, 0.008, -Math.PI / 2, 0, 5).slice(1), v2(0.176, 0.02), ...arc(0.172, 0.02, 0.004, 0, Math.PI, 6).slice(1), v2(0.164, 0.014), v2(0.12, 0.011), v2(0, 0.011)];
  group.add(new THREE.Mesh(lathe(saucer, 56), potMat));

  // 花盆：外壁上敞，盆沿一圈圆润卷边，内壁下到土面
  const potBase = 0.012;
  const pot: THREE.Vector2[] = [v2(0, potBase), v2(0.092, potBase), ...arc(0.092, potBase + 0.016, 0.016, -Math.PI / 2, 0, 6).slice(1), v2(0.151, potBase + 0.236)];
  pot.push(...arc(0.1445, potBase + 0.236, 0.0065, 0, Math.PI, 8).slice(1));
  pot.push(v2(0.1315, potBase + 0.22), v2(0.1, potBase + 0.2), v2(0, potBase + 0.2));
  group.add(new THREE.Mesh(lathe(pot, 56), potMat));

  // 土面：中间略高的小土堆 + 一圈碎石
  const soilTop = potBase + 0.232;
  const soil = new THREE.Mesh(lathe([v2(0, soilTop + 0.006), v2(0.05, soilTop + 0.004), v2(0.1, soilTop - 0.002), v2(0.128, soilTop - 0.01), v2(0.128, soilTop - 0.03), v2(0, soilTop - 0.03)], 32), new THREE.MeshStandardMaterial({ color: "#5a4636", roughness: 1 }));
  group.add(soil);
  const pebbles: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) {
    const a = i * 2.399 + 0.4;
    const r = 0.045 + ((i * 37) % 11) * 0.0068;
    const s = 0.007 + ((i * 17) % 5) * 0.0021;
    const g = new THREE.IcosahedronGeometry(s, 1);
    g.scale(1.2, 0.65, 1);
    g.rotateY(a * 3);
    g.translate(Math.cos(a) * r, soilTop - 0.0015 - Math.min(0.012, r * 0.05) + 0.004, Math.sin(a) * r);
    pebbles.push(g);
  }
  const pebbleMesh = new THREE.Mesh(mergeGeometries(pebbles)!, new THREE.MeshStandardMaterial({ color: "#d9d0c3", roughness: 0.8, flatShading: true }));
  group.add(pebbleMesh);

  // 叶片：三圈，内圈直立、外圈张开；方位角按黄金角错开
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide });
  const rings: { n: number; len: number; width: number; tilt: number; bend: number }[] = [
    { n: 5, len: 0.4, width: 0.034, tilt: 0.16, bend: 0.22 },
    { n: 6, len: 0.34, width: 0.04, tilt: 0.5, bend: 0.3 },
    { n: 5, len: 0.27, width: 0.04, tilt: 0.92, bend: 0.34 },
  ];
  const leaves: THREE.Group[] = [];
  let k = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.n; i++, k++) {
      const pivot = new THREE.Group();
      pivot.position.y = soilTop;
      pivot.rotation.y = k * 2.399963;
      const len = ring.len * (0.9 + ((k * 7) % 5) * 0.045);
      const leaf = new THREE.Mesh(bladeGeometry(len, ring.width, ring.bend, 0.012), leafMat);
      pivot.add(leaf);
      pivot.userData.tilt = ring.tilt + ((k * 3) % 4) * 0.035;
      pivot.rotation.z = pivot.userData.tilt as number;
      group.add(pivot);
      leaves.push(pivot);
    }
  }
  return { group, leaves };
}

// ── 笔记本与铅笔 ─────────────────────────────────────────────────────────────
/** 原点在桌面（y=0），封面朝上；脊在 -X 侧 */
export function createNotebook(): THREE.Group {
  const g = new THREE.Group();
  const W = 0.44;
  const D = 0.31;
  const cover = new THREE.MeshStandardMaterial({ color: "#3346c8", roughness: 0.5 });

  const back = new THREE.Mesh(new RoundedBoxGeometry(W, 0.004, D, 3, 0.002), cover);
  back.position.y = 0.002;
  const front = new THREE.Mesh(new RoundedBoxGeometry(W, 0.004, D, 3, 0.002), cover);
  front.position.y = 0.0205;
  g.add(back, front);

  // 纸页：比封面小一圈，侧面画细密页线
  const lines = document.createElement("canvas");
  lines.width = 16;
  lines.height = 128;
  const c = lines.getContext("2d");
  if (c) {
    c.fillStyle = "#f4efe3";
    c.fillRect(0, 0, 16, 128);
    c.fillStyle = "rgba(120,105,80,0.28)";
    for (let y = 0; y < 128; y += 4) c.fillRect(0, y, 16, 1);
  }
  const pageTex = new THREE.CanvasTexture(lines);
  pageTex.colorSpace = THREE.SRGBColorSpace;
  const pages = new THREE.Mesh(new THREE.BoxGeometry(W - 0.024, 0.0135, D - 0.016), new THREE.MeshStandardMaterial({ map: pageTex, roughness: 0.9 }));
  pages.position.set(0.004, 0.0115, 0);
  g.add(pages);

  // 书脊：深一点的蓝，圆润包住左缘
  const spine = new THREE.Mesh(new RoundedBoxGeometry(0.018, 0.0245, D, 3, 0.0085), new THREE.MeshStandardMaterial({ color: "#2a3aa8", roughness: 0.45 }));
  spine.position.set(-W / 2 + 0.009, 0.01225, 0);
  g.add(spine);

  // 松紧带：压在封面上，两端绕到侧边
  const band = new THREE.Mesh(new RoundedBoxGeometry(0.01, 0.0016, D + 0.004, 2, 0.0006), new THREE.MeshStandardMaterial({ color: "#1b2140", roughness: 0.7 }));
  band.position.set(W / 2 - 0.05, 0.0236, 0);
  g.add(band);

  // 封面上的米色标签（印「极客班」与几条横线）
  const label = document.createElement("canvas");
  label.width = 256;
  label.height = 144;
  const lc = label.getContext("2d");
  if (lc) {
    lc.fillStyle = "#f4efe3";
    lc.fillRect(0, 0, 256, 144);
    lc.strokeStyle = "rgba(51,70,200,0.55)";
    lc.lineWidth = 4;
    lc.strokeRect(6, 6, 244, 132);
    lc.fillStyle = "#1b2140";
    lc.font = '700 38px "PingFang SC", "Hiragino Sans GB", sans-serif';
    lc.textAlign = "center";
    lc.fillText("极客班", 128, 62);
    lc.fillStyle = "rgba(27,33,64,0.35)";
    for (const y of [86, 104, 122]) lc.fillRect(40, y, 176, 3);
  }
  const labelTex = new THREE.CanvasTexture(label);
  labelTex.colorSpace = THREE.SRGBColorSpace;
  labelTex.anisotropy = 4;
  const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.056), new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.85 }));
  labelMesh.rotation.x = -Math.PI / 2;
  labelMesh.position.set(-0.1, 0.0227, 0.085);
  g.add(labelMesh);

  // 书签带：从纸页里垂出来，搭在桌面上
  const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.011, 0.07), new THREE.MeshStandardMaterial({ color: "#d9503f", roughness: 0.6, side: THREE.DoubleSide }));
  ribbon.rotation.x = -Math.PI / 2;
  ribbon.position.set(0.12, 0.0012, D / 2 + 0.028);
  g.add(ribbon);
  return g;
}

/** 六棱柱铅笔，沿 +X 方向：橡皮端在 -X，笔尖在 +X；原点在笔身中心 */
export function createPencil(): THREE.Group {
  const g = new THREE.Group();
  const R = 0.0085;
  const alongX = <T extends THREE.BufferGeometry>(geo: T, x: number): T => {
    geo.rotateZ(-Math.PI / 2);
    geo.translate(x, 0, 0);
    return geo;
  };
  const body = new THREE.Mesh(alongX(new THREE.CylinderGeometry(R, R, 0.24, 6), 0), new THREE.MeshStandardMaterial({ color: "#f5a524", roughness: 0.4, flatShading: true }));
  const ferrule = new THREE.Mesh(alongX(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.02, 24), -0.13), new THREE.MeshStandardMaterial({ color: "#b8bcc6", roughness: 0.3, metalness: 0.85 }));
  const eraser = new THREE.Mesh(alongX(new THREE.CylinderGeometry(R * 0.95, R * 0.95, 0.014, 24), -0.147), new THREE.MeshStandardMaterial({ color: "#f08aa0", roughness: 0.8 }));
  const wood = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.0024, R, 0.03, 6), 0.135), new THREE.MeshStandardMaterial({ color: "#e8c590", roughness: 0.7, flatShading: true }));
  const lead = new THREE.Mesh(alongX(new THREE.CylinderGeometry(0.0002, 0.0026, 0.01, 12), 0.1545), new THREE.MeshStandardMaterial({ color: "#2c2f3a", roughness: 0.4 }));
  g.add(body, ferrule, eraser, wood, lead);
  return g;
}

// ── 相框 ────────────────────────────────────────────────────────────────────
/**
 * 挂画：薄画板（白边，侧面可见厚度）+ 画面 + 顶角两枚小图钉，不带相框。原点在画板中心，前面朝 +Z。
 * art 是 3:4 左右（0.6×0.81）的画面贴图。
 */
export function createPortrait(art: THREE.Texture): { group: THREE.Group; poster: THREE.Mesh } {
  const group = new THREE.Group();
  const W = 0.6;
  const H = 0.81;
  const D = 0.016;
  const board = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 3, 0.004), new THREE.MeshStandardMaterial({ color: "#f3f1ec", roughness: 0.6 }));
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.004, H - 0.004), new THREE.MeshStandardMaterial({ map: art, roughness: 0.75 }));
  poster.position.z = D / 2 + 0.0003;
  group.add(board, poster);
  const pinMat = new THREE.MeshStandardMaterial({ color: "#8d93a3", roughness: 0.3, metalness: 0.8 });
  for (const sx of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), pinMat);
    head.rotation.x = Math.PI / 2;
    head.position.set(sx * (W / 2 - 0.03), H / 2 - 0.03, D / 2 + 0.0005);
    group.add(head);
  }
  return { group, poster };
}
