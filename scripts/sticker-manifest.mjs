#!/usr/bin/env node
// 内置表情包的清单（#286）。app/server/assets/stickers/<包名>/ 下每个包有一份手写的 pack.json 和若干 .webp，
// 本脚本从它们生成 app/server/assets/stickers/manifest.json：每张图的内容哈希、字节数和 CDN 对象键。
// 服务启动时读清单播种表情包（app/server/src/lib/migrations/2026-10-sticker-packs.ts）并决定哪些图片地址可以走 CDN，
// scripts/static-cdn.mjs 的 plan / upload 读清单上传图片；两边都不再猜目录。清单与目录不一致由
// tests/tooling/sticker-manifest.test.ts 拦下。pack.json 的格式见 docs/services/forum/README.md「表情包」。
//
//   node scripts/sticker-manifest.mjs write  [--dir <目录>]   从目录重新生成 manifest.json
//   node scripts/sticker-manifest.mjs check  [--dir <目录>]   只读：manifest.json 与目录不一致就失败
//   node scripts/sticker-manifest.mjs report [--dir <目录>]   只读：每个内置表情的字节数（超过 60 KB 的标出）和 CDN 地址
//   node scripts/sticker-manifest.mjs urls   [--dir <目录>]   只读：每张图的 CDN 地址，一行一个，上传后核对用
//
// 对象键就是 forum/stickers/<图片内容 sha256>.webp：同样的内容同一个键，内容变了就是新键，上传只增不改不会撞。
// 这个哈希也是服务端 forum_sticker_files 里的 hash，同源地址 /api/forum/stickers/<hash>.webp 与 CDN 地址只差前缀。
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { staticCdnPrefixURL } from './static-cdn-base.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const STICKER_ASSETS_DIR = join(REPO_ROOT, 'app/server/assets/stickers');
export const MANIFEST_FILE = 'manifest.json';
export const PACK_FILE = 'pack.json';
/** 对象键在 STATIC_CDN_PREFIX 之后的前缀，与 scripts/static-cdn.mjs 的 STICKERS.mount 一致。 */
export const STICKER_KEY_PREFIX = 'forum/stickers/';
/** report 里超过这个字节数的表情单独标出（所有者要清晰又压缩过的图，面板里最大只画 64px）。 */
export const LARGE_STICKER_BYTES = 60 * 1024;
/** 单张图的硬上限：防止把没压缩的原图提交进来，图片会进 data.db 的 BLOB。 */
export const MAX_STICKER_BYTES = 1024 * 1024;

/** 包名，也是这个包里表情短码的前缀：`<包名>-<表情 id>`，整体不超过 40 位，与服务端 STICKER_ID_PATTERN 一致。 */
export const PACK_ID = /^[a-z0-9][a-z0-9-]{0,19}$/;
export const STICKER_ID = /^[a-z0-9][a-z0-9-]{0,18}$/;
export const SHORTCODE = /^[a-z0-9][a-z0-9-]{1,39}$/;
/** 包的显示名（公开列表的 name 上限）、表情名（lib/forum-rules.ts 的 stickerLabelMax）。 */
export const PACK_NAME_MAX = 40;
export const STICKER_LABEL_MAX = 20;
const CAPTION_MAX = 12;
const DESCRIPTION_MAX = 100;
const ORDER_DEFAULT = 100;
const ORDER_MAX = 1000;
/** 图片文件名：同一个包目录里的平铺 .webp。 */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.webp$/;

const PACK_FIELDS = new Set(['id', 'name', 'description', 'order', 'stickers']);
const STICKER_FIELDS = new Set(['id', 'label', 'caption', 'file']);

/** 对象键：forum/stickers/<sha256>.webp。 */
export function stickerObjectKey(sha256) {
  return `${STICKER_KEY_PREFIX}${sha256}.webp`;
}

/** 服务端存图用的哈希：文件内容的 sha256，十六进制小写。 */
export function sha256Of(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function isWebp(buffer) {
  return buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP';
}

/** 显示用的文字：去掉首尾空白后不能为空，不含方括号（会破坏 [包名_名字] 的写法）、换行与控制字符。 */
function plainText(value, max) {
  return typeof value === 'string' && value.length >= 1 && value.length <= max && value === value.trim() && !/[[\]\p{Cc}\p{Cf}]/u.test(value);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** 把一个包目录读成 { order, pack }；有问题往 problems 里记，返回 null。 */
function readPack(root, dirName, problems, seen) {
  const where = `${dirName}/`;
  const before = problems.length;
  const dir = join(root, dirName);
  let raw;
  try {
    raw = readJson(join(dir, PACK_FILE));
  } catch (error) {
    problems.push(`${where}${PACK_FILE}：${error.code === 'ENOENT' ? '缺这个文件' : `读不出来（${error.message}）`}`);
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { problems.push(`${where}${PACK_FILE}：要是一个对象`); return null; }
  for (const field of Object.keys(raw)) if (!PACK_FIELDS.has(field)) problems.push(`${where}${PACK_FILE}：不认识的字段 ${field}`);
  if (raw.id !== dirName) problems.push(`${where}${PACK_FILE}：id ${JSON.stringify(raw.id)} 要和目录名 ${dirName} 一致`);
  if (typeof raw.id !== 'string' || !PACK_ID.test(raw.id)) problems.push(`${where}${PACK_FILE}：id 要是 1–20 位小写字母、数字和连字符，字母或数字开头`);
  if (!plainText(raw.name, PACK_NAME_MAX)) problems.push(`${where}${PACK_FILE}：name 要是 1–${PACK_NAME_MAX} 字、不含方括号和首尾空白的显示名`);
  else if (seen.names.has(raw.name)) problems.push(`${where}${PACK_FILE}：name ${raw.name} 和 ${seen.names.get(raw.name)} 重名（[包名_名字] 会分不清）`);
  else seen.names.set(raw.name, dirName);
  if (raw.description !== undefined && !plainText(raw.description, DESCRIPTION_MAX)) problems.push(`${where}${PACK_FILE}：description 要是 1–${DESCRIPTION_MAX} 字、不含方括号和首尾空白的一句话`);
  const order = raw.order ?? ORDER_DEFAULT;
  if (!Number.isInteger(order) || order < 0 || order > ORDER_MAX) problems.push(`${where}${PACK_FILE}：order 要是 0–${ORDER_MAX} 的整数（越小越靠前，默认 ${ORDER_DEFAULT}）`);
  if (!Array.isArray(raw.stickers) || raw.stickers.length === 0) {
    problems.push(`${where}${PACK_FILE}：stickers 要是至少一个表情的数组`);
    return null;
  }

  const onDisk = new Map();
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || name === PACK_FILE) continue;
    const stat = lstatSync(join(dir, name));
    if (!stat.isFile() || !FILE_NAME.test(name)) problems.push(`${where}${name}：包目录里只放 ${PACK_FILE} 和 .webp 普通文件（文件名用字母、数字、点、下划线、连字符）`);
    else onDisk.set(name, stat.size);
  }

  const ids = new Set();
  const labels = new Set();
  const files = new Set();
  const stickers = [];
  raw.stickers.forEach((item, index) => {
    const at = `${where}${PACK_FILE} 第 ${index + 1} 个表情`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) { problems.push(`${at}：要是一个对象`); return; }
    for (const field of Object.keys(item)) if (!STICKER_FIELDS.has(field)) problems.push(`${at}：不认识的字段 ${field}`);
    if (typeof item.id !== 'string' || !STICKER_ID.test(item.id)) { problems.push(`${at}：id 要是 1–19 位小写字母、数字和连字符，字母或数字开头`); return; }
    const label = `${where}${item.id}`;
    if (ids.has(item.id)) problems.push(`${label}：id 在这个包里重复`);
    ids.add(item.id);
    const shortcode = `${raw.id}-${item.id}`;
    if (!SHORTCODE.test(shortcode)) problems.push(`${label}：短码 ${shortcode} 超过 40 位`);
    else if (seen.shortcodes.has(shortcode)) problems.push(`${label}：短码 ${shortcode} 和 ${seen.shortcodes.get(shortcode)} 重复`);
    else seen.shortcodes.set(shortcode, label);
    if (!plainText(item.label, STICKER_LABEL_MAX)) problems.push(`${label}：label 要是 1–${STICKER_LABEL_MAX} 字、不含方括号和首尾空白的名字`);
    else if (labels.has(item.label)) problems.push(`${label}：label ${item.label} 在这个包里重名（[包名_名字] 会分不清）`);
    else labels.add(item.label);
    if (item.caption !== undefined && !plainText(item.caption, CAPTION_MAX)) problems.push(`${label}：caption 要是 1–${CAPTION_MAX} 字、不含方括号和首尾空白的图上小字`);
    const file = item.file ?? `${item.id}.webp`;
    if (typeof file !== 'string' || !FILE_NAME.test(file)) { problems.push(`${label}：file 要是包目录里的 .webp 文件名`); return; }
    if (files.has(file)) problems.push(`${label}：${file} 已经是别的表情的图片`);
    files.add(file);
    if (!onDisk.has(file)) { problems.push(`${label}：包目录里没有 ${file}`); return; }
    const bytes = readFileSync(join(dir, file));
    if (!isWebp(bytes)) { problems.push(`${label}：${file} 不是 WebP 图片`); return; }
    if (bytes.length > MAX_STICKER_BYTES) { problems.push(`${label}：${file} 有 ${bytes.length} 字节，超过 ${MAX_STICKER_BYTES}，先压缩`); return; }
    const sha256 = sha256Of(bytes);
    stickers.push({ id: item.id, label: item.label, file, sha256, size: bytes.length, key: stickerObjectKey(sha256) });
  });
  for (const name of onDisk.keys()) if (!files.has(name)) problems.push(`${where}${name}：没有写进 ${PACK_FILE} 的 stickers`);
  if (problems.length > before) return null;
  return { order, pack: { id: raw.id, name: raw.name, stickers } };
}

/**
 * 从目录生成清单：包按 pack.json 的 order、再按 id 排；每个表情带内容哈希、字节数和对象键。
 * description 与 caption 只留在 pack.json（写给审稿和检索的人看），不进清单，服务端也不读。
 * 有任何问题都一起报出来，不生成半份。
 * @param {string} [dir] 默认是仓库里的 app/server/assets/stickers
 * @returns {{ version: 1, packs: { id: string, name: string, stickers: { id: string, label: string, file: string, sha256: string, size: number, key: string }[] }[] }}
 */
export function buildManifest(dir = STICKER_ASSETS_DIR) {
  let names;
  try { names = readdirSync(dir).sort(); } catch { throw new Error(`没有表情目录：${dir}`); }
  const problems = [];
  const seen = { names: new Map(), shortcodes: new Map() };
  const packs = [];
  for (const name of names) {
    if (name.startsWith('.') || name === MANIFEST_FILE) continue;
    if (!lstatSync(join(dir, name)).isDirectory()) { problems.push(`${name}：表情目录里只放包目录和 ${MANIFEST_FILE}`); continue; }
    const found = readPack(dir, name, problems, seen);
    if (found) packs.push(found);
  }
  if (!problems.length && packs.length === 0) problems.push('一个表情包都没有');
  if (problems.length) throw new Error(`${dir} 里这些地方不对：\n  ${problems.join('\n  ')}`);
  packs.sort((a, b) => a.order - b.order || (a.pack.id < b.pack.id ? -1 : 1));
  return { version: 1, packs: packs.map(({ pack }) => pack) };
}

/** 清单文件的写法：两格缩进，末尾一个换行，重新生成时逐字节相同。 */
export function manifestText(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * 清单和目录是否一致。
 * @returns {string} 一致返回空串，否则说明哪里不同
 */
export function manifestProblem(dir = STICKER_ASSETS_DIR) {
  const expected = manifestText(buildManifest(dir));
  let actual;
  try { actual = readFileSync(join(dir, MANIFEST_FILE), 'utf8'); } catch { return `${MANIFEST_FILE} 不存在，先运行 node scripts/sticker-manifest.mjs write`; }
  return actual === expected ? '' : `${MANIFEST_FILE} 和目录对不上（新增、改动或删除了表情图片或 ${PACK_FILE} 之后要重新生成），运行 node scripts/sticker-manifest.mjs write`;
}

/** 一张表情的 CDN 地址。 */
export function stickerCdnUrl(sticker, base = staticCdnPrefixURL()) {
  return `${base}${sticker.key}`;
}

const USAGE = 'node scripts/sticker-manifest.mjs write|check|report|urls [--dir <目录>]';

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['write', 'check', 'report', 'urls'].includes(command)) throw new Error(`用法：${USAGE}`);
  const options = { command, dir: STICKER_ASSETS_DIR };
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i] !== '--dir') throw new Error(`${command} 不认识参数 ${rest[i]}；用法：${USAGE}`);
    if (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) throw new Error('--dir 缺值');
    options.dir = resolve(rest[i + 1]);
  }
  return options;
}

const kib = bytes => `${(bytes / 1024).toFixed(1)} KB`;

export function main(argv, { stdout = process.stdout, log = console.error } = {}) {
  const options = parseArgs(argv);
  if (options.command === 'write') {
    const manifest = buildManifest(options.dir);
    writeFileSync(join(options.dir, MANIFEST_FILE), manifestText(manifest));
    const count = manifest.packs.reduce((sum, pack) => sum + pack.stickers.length, 0);
    log(`已写 ${join(options.dir, MANIFEST_FILE)}：${manifest.packs.length} 个包，${count} 张表情`);
    return { manifest };
  }
  if (options.command === 'check') {
    const problem = manifestProblem(options.dir);
    if (problem) throw new Error(problem);
    log(`${MANIFEST_FILE} 与目录一致`);
    return {};
  }
  const manifest = buildManifest(options.dir);
  if (options.command === 'urls') {
    for (const url of new Set(manifest.packs.flatMap(pack => pack.stickers.map(sticker => stickerCdnUrl(sticker))))) stdout.write(`${url}\n`);
    return { manifest };
  }
  // report
  const large = [];
  let total = 0;
  for (const pack of manifest.packs) {
    stdout.write(`${pack.name}（${pack.id}）${pack.stickers.length} 张\n`);
    for (const sticker of pack.stickers) {
      total += sticker.size;
      const flag = sticker.size > LARGE_STICKER_BYTES ? '  超过 60 KB' : '';
      if (flag) large.push(`${pack.id}-${sticker.id}`);
      stdout.write(`  ${`${pack.id}-${sticker.id}`.padEnd(24)} ${sticker.file.padEnd(24)} ${String(sticker.size).padStart(7)} 字节  ${kib(sticker.size).padStart(8)}${flag}\n`);
    }
  }
  const count = manifest.packs.reduce((sum, pack) => sum + pack.stickers.length, 0);
  log(`共 ${manifest.packs.length} 个包、${count} 张，${kib(total)}；超过 60 KB 的 ${large.length} 张${large.length ? `：${large.join('、')}` : ''}`);
  return { manifest, large };
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url;
  } catch {
    return false;
  }
}
if (isDirectRun()) {
  // `urls | head` 这样提前关掉管道不算失败。
  process.stdout.on('error', error => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  });
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[sticker-manifest] 失败：${error.message}`);
    process.exit(1);
  }
}
