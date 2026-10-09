// 首页书桌上的笔记本电脑：MacBook 风格的圆润铝壳薄机身，纯程序化几何（issue #213）。
//
// 造型思路（对照旧模型的问题：整体 RoundedBox 的圆角被薄壳厚度封顶，XY 轮廓接近方形，
// 键盘是白色棋盘格）：
//   · 机身/上盖用「俯视/正面大圆角矩形轮廓 + 沿厚度方向薄挤出 + 小边缘倒角」：
//     平面转角半径（机身 0.062、上盖 0.052）与挤出厚度完全独立，薄壳也能有大圆角；
//     边缘倒角只有 4mm，负责把顶/底面收圆，不占用平面圆角预算（bevelSize 会撑大轮廓，
//     规划尺寸时已按 2×bevel 收缩）。
//   · 键盘是深色错列的真实布局（function 行 + 宽 delete/tab/caps/shift/enter/空格 + 半宽方向键），
//     键帽按「标准键 / 宽键」两组各一个 InstancedMesh（组内按绝对尺寸烘焙圆角与倒角，
//     逐实例只按 X/Z 缩放，顶面倒角高度不被拉伸），字符全部画进一张 512×512 逻辑
//     （×TEXT_SCALE=1024 物理）图集贴图，批处理成一个半透明贴面网格；按键下沉时
//     键帽实例矩阵与对应图例顶点一起下移，只上传变化区间，循环里零分配。
//   · 屏幕/玻璃/触控板/铰链/脚垫/接口/扬声器都来自同一套挤出与合并工具，
//     深色小件合并进 baseTrim / lidTrim 两个网格，整机 10 个网格，与旧场景（11）持平。
//
// 对外接口见 createLaptop()；display 几何不挂载，屏幕材质与位置由 desk.ts 决定。
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TEXT_SCALE, canvasTexture } from "./stage";

/** 屏幕在 lid 局部坐标系里的尺寸与位置（与旧 desk.ts 的 SCREEN_W/H 和屏幕 z 完全一致） */
export const LAPTOP_DISPLAY = { width: 1.1, height: 0.6875, y: 0.398, z: 0.0116 } as const;

export type LaptopKeyRect = { x: number; z: number; width: number; depth: number };

export type LaptopKeyboard = {
  /** 键帽矩形（laptop 局部 XZ 平面）：(x,z) 中心，width/depth 全宽/全深，命中区不越过键缝 */
  keys: readonly LaptopKeyRect[];
  /** 键帽顶面所在平面（laptop 局部 y），拾取射线与它求交 */
  y: number;
  /** 不参与投影的动态件（两组键帽实例 + 图例贴面），desk 侧据此排除 castShadow */
  visuals: readonly THREE.Object3D[];
  /** amount 归一化 0..1：键帽与图例一起下沉，最多 KEY_TRAVEL；0 也要调用（回弹帧） */
  setPressed(index: number, amount: number): void;
  /** 只上传本帧变化的实例矩阵/图例顶点区间 */
  flush(): void;
};

export type LaptopHandle = {
  laptop: THREE.Group;
  lid: THREE.Group;
  /** 上盖铝壳（拾取 + 投影体） */
  shell: THREE.Mesh;
  /** 屏面黑玻璃（拾取 + 投影体） */
  bezel: THREE.Mesh;
  /** 圆角屏幕几何：XY 轮廓居中于原点、UV 归一化到 [0,1]，未挂载 */
  display: THREE.BufferGeometry;
  keyboard: LaptopKeyboard;
};

// ── 尺寸常量（米）─────────────────────────────────────────────────────────
const BASE_W = 1.26;
const BASE_D = 0.86;
const BASE_R = 0.062; // 俯视大圆角：与厚度无关，是「圆润」的主要来源
const BASE_BEVEL = 0.004;
const BASE_BOTTOM = 0.004; // 底面离桌（脚垫补到桌面）
const DECK_Y = 0.0305; // 掌托/键盘台面
const WELL_TOP = 0.0335; // 键盘黑底板顶面
const KEY_H = 0.0075;
const KEY_TRAVEL = 0.006;
const KEY_Y = WELL_TOP + 0.001 + KEY_H / 2; // 键帽中心（底板 + 1mm 间隙 + 半高）
const CAP_TOP = WELL_TOP + 0.001 + KEY_H; // 键帽顶面 = 0.042，拾取平面（旧 KEY_Y 0.041 同带）
const PAD_W = 0.44;
const PAD_D = 0.265;
const LID_W = 1.26;
const LID_H = 0.79;
const LID_R = 0.052;
const LID_BEVEL = 0.004;
const LID_FRONT_Z = 0.01; // 上盖前面（含倒角仍低于黑玻璃）
const BEZEL_Z = 0.0108; // 黑玻璃前面 < LAPTOP_DISPLAY.z(0.0116)，屏幕/按钮/幕的层序不变
const BEZEL_W = 1.236;
const BEZEL_H = 0.777;
const BEZEL_R = 0.045;
const KEY_UNIT = 0.0707; // 1u 键距，整排 15u ≈ 1.06m
const KEY_GAP = 0.0065;
const KEYBOARD_REAR_Z = -0.345;
const KEYBOARD_W = 15 * KEY_UNIT;

// ── 键盘布局（MacBook US：function 行 + 5 个主行；宽度以 u 计）─────────────
// label "gap" 只推进光标不建键；"space" 建键但无图例。
type RowSpec = { depth: number; pitch: number; keys: [string, number][] };
const KEY_ROWS: RowSpec[] = [
  {
    depth: 0.036,
    pitch: 0.048,
    keys: [["esc", 1], ["F1", 1], ["F2", 1], ["F3", 1], ["F4", 1], ["F5", 1], ["F6", 1], ["F7", 1], ["F8", 1], ["F9", 1], ["F10", 1], ["F11", 1], ["F12", 1], ["power", 2]],
  },
  {
    depth: 0.0575,
    pitch: 0.064,
    keys: [["`", 1], ["1", 1], ["2", 1], ["3", 1], ["4", 1], ["5", 1], ["6", 1], ["7", 1], ["8", 1], ["9", 1], ["0", 1], ["-", 1], ["=", 1], ["delete", 2]],
  },
  {
    depth: 0.0575,
    pitch: 0.064,
    keys: [["tab", 1.5], ["Q", 1], ["W", 1], ["E", 1], ["R", 1], ["T", 1], ["Y", 1], ["U", 1], ["I", 1], ["O", 1], ["P", 1], ["[", 1], ["]", 1], ["\\", 1.5]],
  },
  {
    depth: 0.0575,
    pitch: 0.064,
    keys: [["caps", 1.75], ["A", 1], ["S", 1], ["D", 1], ["F", 1], ["G", 1], ["H", 1], ["J", 1], ["K", 1], ["L", 1], [";", 1], ["'", 1], ["enter", 2.25]],
  },
  {
    depth: 0.0575,
    pitch: 0.064,
    keys: [["shiftL", 2.25], ["Z", 1], ["X", 1], ["C", 1], ["V", 1], ["B", 1], ["N", 1], ["M", 1], [",", 1], [".", 1], ["/", 1], ["shiftR", 2.75]],
  },
  {
    depth: 0.0575,
    pitch: 0.064,
    keys: [["fn", 1], ["ctrl", 1], ["opt", 1], ["cmd", 1], ["space", 6.25], ["cmd", 1], ["opt", 1], ["gap", 0.17], ["left", 0.58], ["gap", 0.17], ["up", 0.58], ["gap", 0.17], ["right", 0.58]],
  },
];
const KEYBOARD_D = KEY_ROWS[0].pitch + (KEY_ROWS.length - 1) * KEY_ROWS[1].pitch;

type KeyPlacement = { x: number; z: number; w: number; d: number; label: string };

function layoutKeys(): KeyPlacement[] {
  const out: KeyPlacement[] = [];
  let z = KEYBOARD_REAR_Z;
  for (const row of KEY_ROWS) {
    z += row.pitch / 2;
    let cursor = -KEYBOARD_W / 2;
    for (const [label, units] of row.keys) {
      const span = units * KEY_UNIT;
      if (label !== "gap") out.push({ x: cursor + span / 2, z, w: span - KEY_GAP, d: row.depth - 0.006, label });
      cursor += span;
    }
    z += row.pitch / 2;
  }
  return out;
}

// ── 几何工具 ──────────────────────────────────────────────────────────────
/** 圆角矩形轮廓（居中于原点；挤出时 bevelSize 会撑大轮廓，规划尺寸按 2×bevel 扣除） */
function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = w / 2;
  const y = h / 2;
  s.moveTo(-x + r, -y);
  s.lineTo(x - r, -y);
  s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x, y - r);
  s.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
  s.lineTo(-x + r, y);
  s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-x, -y + r);
  s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 2, false);
  return s;
}

/**
 * 水平薄板：轮廓在 XZ 平面（俯视看是圆的），厚度沿 Y，上下边缘带绝对高度的小倒角。
 * 转角半径与板厚无关 —— 这是「薄壳 + 大圆角」的关键。底面落在 y=0。
 */
function slab(profile: THREE.Shape, thickness: number, bevel: number, segments: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(profile, {
    depth: Math.max(thickness - bevel * 2, 0.0005),
    steps: 1,
    curveSegments: segments,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: 1,
  });
  geo.rotateX(-Math.PI / 2); // 挤出方向 Z -> 高度 Y（对称轮廓，轮廓 y -> -Z 无影响）
  geo.computeBoundingBox();
  const bb = geo.boundingBox!; // 挤出几何必有包围盒
  geo.translate(0, -bb.min.y, 0);
  geo.clearGroups(); // 单一材质的薄板保持一次 draw call
  return geo;
}

/** 合并一组几何体并释放输入（全部转非索引，属性集一致：position/normal/uv） */
function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat, false)!; // 属性集一致，不会失败
  for (let i = 0; i < parts.length; i++) {
    if (flat[i] !== parts[i]) flat[i].dispose();
    parts[i].dispose();
  }
  return merged;
}

// ── 图例图集 ──────────────────────────────────────────────────────────────
const ATLAS_CELL = 32; // 逻辑像素
const ATLAS_COLS = 16;
const ATLAS_ROWS = 8;
const ATLAS_W = ATLAS_COLS * ATLAS_CELL;
const ATLAS_H = ATLAS_ROWS * ATLAS_CELL;

/** 第 i 个键的图集格子（左上角像素坐标）；布局与绘制共用，防止错位 */
function atlasCell(i: number): [number, number] {
  return [(i % ATLAS_COLS) * ATLAS_CELL, Math.floor(i / ATLAS_COLS) * ATLAS_CELL];
}

/** 特殊符号一律用线条画（源码守门：图例贴图里不放装饰性 Unicode 箭头） */
function drawLegendGlyphs(x: CanvasRenderingContext2D, label: string, cx: number, cy: number, size: number) {
  switch (label) {
    case "shiftL":
    case "shiftR": {
      x.beginPath();
      x.moveTo(cx, cy - size * 0.42);
      x.lineTo(cx + size * 0.4, cy + size * 0.18);
      x.lineTo(cx + size * 0.14, cy + size * 0.18);
      x.lineTo(cx + size * 0.14, cy + size * 0.42);
      x.lineTo(cx - size * 0.14, cy + size * 0.42);
      x.lineTo(cx - size * 0.14, cy + size * 0.18);
      x.lineTo(cx - size * 0.4, cy + size * 0.18);
      x.closePath();
      x.fill();
      return;
    }
    case "enter": {
      x.lineWidth = size * 0.11;
      x.beginPath();
      x.moveTo(cx + size * 0.4, cy - size * 0.4);
      x.lineTo(cx + size * 0.4, cy + size * 0.12);
      x.lineTo(cx - size * 0.14, cy + size * 0.12);
      x.moveTo(cx + size * 0.1, cy - size * 0.16);
      x.lineTo(cx - size * 0.42, cy + size * 0.12);
      x.lineTo(cx + size * 0.1, cy + size * 0.4);
      x.stroke();
      return;
    }
    case "delete": {
      x.beginPath();
      x.moveTo(cx - size * 0.42, cy);
      x.lineTo(cx - size * 0.06, cy - size * 0.24);
      x.lineTo(cx - size * 0.06, cy + size * 0.24);
      x.closePath();
      x.fill();
      x.lineWidth = size * 0.1;
      x.beginPath();
      x.moveTo(cx + size * 0.1, cy - size * 0.16);
      x.lineTo(cx + size * 0.38, cy + size * 0.16);
      x.moveTo(cx + size * 0.38, cy - size * 0.16);
      x.lineTo(cx + size * 0.1, cy + size * 0.16);
      x.stroke();
      return;
    }
    case "power": {
      x.lineWidth = size * 0.11;
      x.beginPath();
      x.arc(cx, cy + size * 0.04, size * 0.32, Math.PI * 0.75, Math.PI * 2.25);
      x.stroke();
      x.beginPath();
      x.moveTo(cx, cy - size * 0.44);
      x.lineTo(cx, cy - size * 0.02);
      x.stroke();
      return;
    }
    case "left":
    case "right":
    case "up": {
      const s = label === "left" ? -1 : label === "right" ? 1 : 0;
      x.lineWidth = size * 0.11;
      x.beginPath();
      if (s !== 0) {
        x.moveTo(cx - s * size * 0.34, cy);
        x.lineTo(cx + s * size * 0.34, cy);
        x.moveTo(cx + s * size * 0.06, cy - size * 0.24);
        x.lineTo(cx + s * size * 0.34, cy);
        x.lineTo(cx + s * size * 0.06, cy + size * 0.24);
      } else {
        x.moveTo(cx, cy + size * 0.34);
        x.lineTo(cx, cy - size * 0.34);
        x.moveTo(cx - size * 0.24, cy - size * 0.06);
        x.lineTo(cx, cy - size * 0.34);
        x.lineTo(cx + size * 0.24, cy - size * 0.06);
      }
      x.stroke();
      return;
    }
    case "caps": {
      x.beginPath();
      x.moveTo(cx, cy - size * 0.4);
      x.lineTo(cx + size * 0.34, cy + size * 0.06);
      x.lineTo(cx + size * 0.12, cy + size * 0.06);
      x.lineTo(cx + size * 0.12, cy + size * 0.34);
      x.lineTo(cx - size * 0.12, cy + size * 0.34);
      x.lineTo(cx - size * 0.12, cy + size * 0.06);
      x.lineTo(cx - size * 0.34, cy + size * 0.06);
      x.closePath();
      x.fill();
      x.lineWidth = size * 0.08;
      x.beginPath();
      x.arc(cx, cy + size * 0.44, size * 0.06, 0, Math.PI * 2);
      x.stroke();
      return;
    }
    default: {
      const compact = label.startsWith("F") || label === "esc";
      x.font = `500 ${Math.round(size * (compact ? 0.62 : 0.8))}px -apple-system, "PingFang SC", sans-serif`;
      x.fillText(label === "cmd" ? "\u2318" : label, cx, cy + size * 0.28);
    }
  }
}

/** 图例图集：每键一格，字符/符号用 2D canvas 画一次（键盘不特写，1024 物理宽足够清楚） */
function legendsAtlas(keys: KeyPlacement[]): THREE.CanvasTexture {
  return canvasTexture(ATLAS_W, ATLAS_H, (x) => {
    x.clearRect(0, 0, ATLAS_W, ATLAS_H);
    x.fillStyle = "#d6d9e2";
    x.strokeStyle = "#d6d9e2";
    x.textAlign = "center";
    for (let i = 0; i < keys.length; i++) {
      const label = keys[i].label;
      if (label === "" || label === "space") continue;
      const [ax, ay] = atlasCell(i);
      const size = label.startsWith("F") || label === "esc" || label === "power" ? ATLAS_CELL * 0.56 : ATLAS_CELL * 0.7;
      drawLegendGlyphs(x, label, ax + ATLAS_CELL / 2, ay + ATLAS_CELL / 2 + size * 0.06, size);
    }
  }, TEXT_SCALE).texture;
}

/** 键帽几何：绝对尺寸的俯视圆角 + 顶底 1.2mm 倒角，中心在原点、顶面 y=+KEY_H/2 */
function capGeometry(w: number, d: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(roundedRect(w, d, Math.min(0.0022, w / 3, d / 3)), {
    depth: KEY_H - 0.0024,
    steps: 1,
    curveSegments: 1, // 2.2mm 转角在 1.5m 视距下 1 段圆弧足够，键帽三角数减半
    bevelEnabled: true,
    bevelThickness: 0.0012,
    bevelSize: 0.0012,
    bevelOffset: 0,
    bevelSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!; // 挤出几何必有包围盒
  geo.translate(0, -(bb.min.y + bb.max.y) / 2, 0);
  geo.clearGroups(); // 一个 InstancedMesh 一次 draw call
  return geo;
}

// ── 主体 ──────────────────────────────────────────────────────────────────
export function createLaptop(): LaptopHandle {
  const laptop = new THREE.Group();
  laptop.name = "desk-laptop";
  laptop.position.set(0.05, 0, 0);
  laptop.rotation.y = 0.2;

  const alu = new THREE.MeshStandardMaterial({ color: "#d4d8e0", metalness: 0.82, roughness: 0.3 });
  const wellMat = new THREE.MeshStandardMaterial({ color: "#1c1e26", metalness: 0.25, roughness: 0.52 });
  const padMat = new THREE.MeshStandardMaterial({ color: "#ccd0d9", metalness: 0.55, roughness: 0.14 });
  const trimMat = new THREE.MeshLambertMaterial({ color: "#0e1016" });
  const bezelMat = new THREE.MeshStandardMaterial({ color: "#14172a", roughness: 0.18, metalness: 0.1 });
  const capMat = new THREE.MeshStandardMaterial({ color: "#2a2c35", metalness: 0.15, roughness: 0.42 });

  // 机身：俯视大圆角轮廓 + 薄挤出（轮廓按倒角收缩，最终占地恰为 BASE_W × BASE_D）
  const base = new THREE.Mesh(
    slab(roundedRect(BASE_W - BASE_BEVEL * 2, BASE_D - BASE_BEVEL * 2, BASE_R), DECK_Y - BASE_BOTTOM, BASE_BEVEL, 3),
    alu,
  );
  base.position.y = BASE_BOTTOM;
  laptop.add(base);

  // 键盘黑底板：略高于台面的一整块圆角深色板（MacBook 的「黑键盘区」观感）
  const well = new THREE.Mesh(
    slab(roundedRect(KEYBOARD_W + 0.038, KEYBOARD_D + 0.038, 0.013), WELL_TOP - DECK_Y, 0.0012, 2),
    wellMat,
  );
  well.position.set(0, DECK_Y, KEYBOARD_REAR_Z + KEYBOARD_D / 2);
  laptop.add(well);

  // 触控板：大圆角玻璃，顶面略低于键盘底板，靠低粗糙度与铝台面区分
  const padCenterZ = KEYBOARD_REAR_Z + KEYBOARD_D + 0.06 + PAD_D / 2;
  const trackpad = new THREE.Mesh(slab(roundedRect(PAD_W, PAD_D, 0.02), 0.0026, 0.001, 3), padMat);
  trackpad.position.set(0, DECK_Y, padCenterZ);
  laptop.add(trackpad);

  // 深色小件（脚垫/扬声器长条孔/侧面接口/耳机孔/铰链段）合并成一个网格
  const keys = layoutKeys();
  const baseTrimParts: THREE.BufferGeometry[] = [];
  for (const z of [-0.3, 0.3]) {
    const g = new THREE.BoxGeometry(0.3, 0.006, 0.014);
    g.translate(0, 0.003, z);
    baseTrimParts.push(g);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const g = new THREE.PlaneGeometry(0.0045, 0.05);
      g.rotateX(-Math.PI / 2);
      g.translate(side * 0.585, DECK_Y + 0.0004, -0.28 + i * 0.062);
      baseTrimParts.push(g);
    }
    for (const z of [-0.2, -0.05]) {
      const g = new THREE.PlaneGeometry(0.03, 0.0085);
      g.rotateY(-Math.PI / 2);
      g.translate(-(BASE_W / 2 + 0.0005), (BASE_BOTTOM + DECK_Y) / 2, z);
      baseTrimParts.push(g);
    }
  }
  {
    const g = new THREE.PlaneGeometry(0.03, 0.0085);
    g.rotateY(Math.PI / 2);
    g.translate(BASE_W / 2 + 0.0005, (BASE_BOTTOM + DECK_Y) / 2, -0.12);
    baseTrimParts.push(g);
    const jack = new THREE.CircleGeometry(0.0045, 10);
    jack.rotateY(Math.PI / 2);
    jack.translate(BASE_W / 2 + 0.0005, (BASE_BOTTOM + DECK_Y) / 2, 0.06);
    baseTrimParts.push(jack);
  }
  for (const side of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.008, 0.008, 0.13, 10, 1);
    g.rotateZ(Math.PI / 2);
    g.translate(side * 0.28, 0.028, -0.418);
    baseTrimParts.push(g);
  }
  const baseTrim = new THREE.Mesh(mergeAll(baseTrimParts), trimMat);
  laptop.add(baseTrim);

  // ── 上盖 ────────────────────────────────────────────────────────────────
  const lid = new THREE.Group();
  lid.position.set(0, 0.036, -0.395);
  lid.rotation.x = -0.27;
  laptop.add(lid);

  // 铝壳：正面大圆角轮廓沿 Z 挤出，前后面含倒角共 22mm，前面封顶在 LID_FRONT_Z
  const shellGeo = new THREE.ExtrudeGeometry(
    roundedRect(LID_W - LID_BEVEL * 2, LID_H - LID_BEVEL * 2, LID_R),
    {
      depth: 0.014,
      steps: 1,
      curveSegments: 3,
      bevelEnabled: true,
      bevelThickness: LID_BEVEL,
      bevelSize: LID_BEVEL,
      bevelOffset: 0,
      bevelSegments: 1,
    },
  );
  shellGeo.translate(0, 0, LID_FRONT_Z - (0.014 + LID_BEVEL)); // 前面 0.018->0.010，背面 -0.012
  shellGeo.clearGroups(); // 单一材质：正面/侧面/背面保持一次 draw call
  const shell = new THREE.Mesh(shellGeo, alu);
  shell.position.y = LID_H / 2;
  lid.add(shell);

  // 黑玻璃：圆角矩形（与 display 同一套收角语言），前面 z 低于屏幕 z
  const bezel = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(BEZEL_W, BEZEL_H, BEZEL_R), 4), bezelMat);
  bezel.position.set(0, LID_H / 2 - 0.003, BEZEL_Z);
  lid.add(bezel);

  // 摄像头（镜头圈 + 内孔）与上盖其它深色小件合并成一个网格
  const camRing = new THREE.CircleGeometry(0.005, 12);
  camRing.translate(0, 0.758, BEZEL_Z + 0.0004);
  const camLens = new THREE.CircleGeometry(0.0018, 8);
  camLens.translate(0, 0.758, BEZEL_Z + 0.0008);
  const lidTrim = new THREE.Mesh(mergeAll([camRing, camLens]), trimMat);
  lid.add(lidTrim);

  // ── 屏幕几何（不挂载，desk 侧负责材质与 LAPTOP_DISPLAY 位置）────────────
  const display = new THREE.ShapeGeometry(roundedRect(LAPTOP_DISPLAY.width, LAPTOP_DISPLAY.height, 0.025), 4);
  {
    // ShapeGeometry 的 uv 是原始 x/y，归一化到 [0,1] 让整张屏幕贴图角对角铺满
    const pos = display.getAttribute("position") as THREE.BufferAttribute;
    const uv = display.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, pos.getX(i) / LAPTOP_DISPLAY.width + 0.5, pos.getY(i) / LAPTOP_DISPLAY.height + 0.5);
    }
    uv.needsUpdate = true;
  }
  display.computeBoundingSphere();

  // ── 键盘：两组键帽 InstancedMesh + 一个批处理图例网格 ────────────────────
  // 键帽按「标准键 / 宽键」两组烘焙绝对圆角与倒角，组内逐实例只缩放 X/Z；
  // 倒角厚度（Y）不被拉伸，宽键只是被拉长的圆角矩形 —— 与真机一致。
  const STD_W = KEY_UNIT - KEY_GAP; // 1u 标准键宽 0.0642
  const STD_D = KEY_ROWS[1].depth - 0.006; // 主行键深 0.0515
  const WIDE_W = 6.25 * KEY_UNIT - KEY_GAP; // 空格宽 0.4356（宽键组的烘焙基准）
  // 键索引 -> [组, 组内槽位]，按压时零分配查表
  const keyGroup = new Int8Array(keys.length);
  const keySlot = new Int16Array(keys.length);
  const stdKeys: number[] = [];
  const wideKeys: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].w < (STD_W + WIDE_W) / 2) {
      keyGroup[i] = 0;
      keySlot[i] = stdKeys.length;
      stdKeys.push(i);
    } else {
      keyGroup[i] = 1;
      keySlot[i] = wideKeys.length;
      wideKeys.push(i);
    }
  }

  const capMeshes: THREE.InstancedMesh[] = [
    new THREE.InstancedMesh(capGeometry(STD_W, STD_D), capMat, stdKeys.length),
    new THREE.InstancedMesh(capGeometry(WIDE_W, STD_D), capMat, wideKeys.length),
  ];
  const capBases: Float32Array[] = [new Float32Array(stdKeys.length * 16), new Float32Array(wideKeys.length * 16)];
  const capBake: [number, number][] = [
    [STD_W, STD_D],
    [WIDE_W, STD_D],
  ];
  const keyRects: LaptopKeyRect[] = [];
  const legendPos = new Float32Array(keys.length * 4 * 3);
  const legendNormal = new Float32Array(keys.length * 4 * 3);
  const legendUv = new Float32Array(keys.length * 4 * 2);
  const legendIndex = new Uint16Array(keys.length * 6);
  const LEGEND_Y = CAP_TOP + 0.0006;
  const m4 = new THREE.Matrix4();
  for (let g = 0; g < 2; g++) {
    capMeshes[g].instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    capMeshes[g].receiveShadow = true;
    laptop.add(capMeshes[g]);
  }
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const g = keyGroup[i];
    const slot = keySlot[i];
    const [bw, bd] = capBake[g];
    m4.makeScale(k.w / bw, 1, k.d / bd);
    m4.setPosition(k.x, KEY_Y, k.z);
    m4.toArray(capBases[g], slot * 16);
    capMeshes[g].setMatrixAt(slot, m4);
    keyRects.push({ x: k.x, z: k.z, width: k.w, depth: k.d });

    // 图例贴面：正方形（图集格子是正方形），贴在键帽顶面上方 0.6mm
    const s = Math.max(Math.min(k.w, k.d) - 0.008, 0.014);
    const v = i * 4;
    const [ax, ay] = atlasCell(i);
    const u0 = ax / ATLAS_W;
    const u1 = (ax + ATLAS_CELL) / ATLAS_W;
    const v1 = 1 - ay / ATLAS_H;
    const v0 = 1 - (ay + ATLAS_CELL) / ATLAS_H;
    const corners: [number, number, number, number][] = [
      [-s / 2, -s / 2, u0, v1],
      [s / 2, -s / 2, u1, v1],
      [-s / 2, s / 2, u0, v0],
      [s / 2, s / 2, u1, v0],
    ];
    for (let c = 0; c < 4; c++) {
      legendPos[(v + c) * 3] = k.x + corners[c][0];
      legendPos[(v + c) * 3 + 1] = LEGEND_Y;
      legendPos[(v + c) * 3 + 2] = k.z + corners[c][1];
      legendNormal[(v + c) * 3 + 1] = 1;
      legendUv[(v + c) * 2] = corners[c][2];
      legendUv[(v + c) * 2 + 1] = corners[c][3];
    }
    legendIndex.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
  }
  for (const mesh of capMeshes) mesh.instanceMatrix.needsUpdate = true;

  const legendGeo = new THREE.BufferGeometry();
  legendGeo.setAttribute("position", new THREE.BufferAttribute(legendPos, 3).setUsage(THREE.DynamicDrawUsage));
  legendGeo.setAttribute("normal", new THREE.BufferAttribute(legendNormal, 3));
  legendGeo.setAttribute("uv", new THREE.BufferAttribute(legendUv, 2));
  legendGeo.setIndex(new THREE.BufferAttribute(legendIndex, 1));
  legendGeo.computeBoundingSphere();
  const legends = new THREE.Mesh(legendGeo, new THREE.MeshLambertMaterial({ map: legendsAtlas(keys), transparent: true, depthWrite: false }));
  laptop.add(legends);

  // ── 按压动画：零分配，只上传变化区间 ────────────────────────────────────
  const amounts = new Float32Array(keys.length);
  const pressMatrix = new THREE.Matrix4();
  const dirtyMin = [Infinity, Infinity];
  const dirtyMax = [-1, -1];
  let legendMin = Infinity;
  let legendMax = -1;

  return {
    laptop,
    lid,
    shell,
    bezel,
    display,
    keyboard: {
      keys: keyRects,
      y: CAP_TOP,
      visuals: [...capMeshes, legends],
      setPressed(index, amount) {
        if (index < 0 || index >= amounts.length) return;
        const a = amount < 0 ? 0 : amount > 1 ? 1 : amount;
        if (a === amounts[index]) return;
        amounts[index] = a;
        const drop = a * KEY_TRAVEL;
        const g = keyGroup[index];
        const slot = keySlot[index];
        pressMatrix.fromArray(capBases[g], slot * 16);
        pressMatrix.elements[13] = KEY_Y - drop; // 列主序平移的 y 分量
        capMeshes[g].setMatrixAt(slot, pressMatrix);
        const v = index * 4;
        for (let c = 0; c < 4; c++) legendPos[(v + c) * 3 + 1] = LEGEND_Y - drop;
        if (slot < dirtyMin[g]) dirtyMin[g] = slot;
        if (slot > dirtyMax[g]) dirtyMax[g] = slot;
        if (index < legendMin) legendMin = index;
        if (index > legendMax) legendMax = index;
      },
      flush() {
        for (let g = 0; g < 2; g++) {
          if (dirtyMax[g] < 0) continue;
          const im = capMeshes[g].instanceMatrix;
          im.clearUpdateRanges();
          im.addUpdateRange(dirtyMin[g] * 16, (dirtyMax[g] - dirtyMin[g] + 1) * 16);
          im.needsUpdate = true;
          dirtyMin[g] = Infinity;
          dirtyMax[g] = -1;
        }
        if (legendMax < 0) return;
        // position 已按 DynamicDrawUsage 建好，这里只是取回句柄
        const attr = legendGeo.getAttribute("position") as THREE.BufferAttribute;
        attr.clearUpdateRanges();
        attr.addUpdateRange(legendMin * 12, (legendMax - legendMin + 1) * 12);
        attr.needsUpdate = true;
        legendMin = Infinity;
        legendMax = -1;
      },
    },
  };
}
