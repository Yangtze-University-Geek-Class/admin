#!/usr/bin/env node
/**
 * 动态壁纸逐帧验收：换了 app/web/public/portal/wallpapers/ 下的视频就重跑一次。
 *
 * 对每段 <id>.mp4 / <id>.webm，用 ffmpeg 解出全部帧（480×270 灰度）：
 *   1. 不许变暗变亮：每一帧相对第一帧的平均亮度差、以及「所有 30×30 小块的亮度差」的中位数都在 ±1.5 以内
 *      （手和头发在动只影响少数小块，中位数不受影响；整体压暗或提亮会让中位数整体偏移）；
 *   2. 视频第一帧就是同名静态图 <id>.webp：两者平均逐像素差 ≤ 3（静态图与视频的色彩换算不同，留一点余量），
 *      视频淡入时画面不跳；
 *   3. 首尾无缝：最后一帧与第一帧的差不超过相邻两帧差的最大值（循环接回去不比正常一帧跳得多）；
 *   4. 帧率 48、分辨率 1920×1080。
 * 结果连同文件 sha256 写进 tests/web/fixtures/wallpaper-qa.json；tests/web/portal-wallpapers.test.ts
 * 只核对 sha256 与阈值（CI 没有 ffmpeg），所以视频换了却没重跑验收，单元测试就会失败。
 *
 * 用法：node scripts/wallpaper-qa.mjs           逐帧量并写报告，有不合格的退出码 1（报告照写，方便看哪一帧）
 * 需要本机 ffmpeg / ffprobe；只读视频，只写报告文件。
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = 'app/web/public/portal/wallpapers';
const REPORT = 'tests/web/fixtures/wallpaper-qa.json';
const W = 480;
const H = 270;
const BLOCK = 30;

export const LIMITS = Object.freeze({ fps: 48, width: 1920, height: 1080, lumaDrift: 1.5, posterDiff: 3 });

function run(command, args) {
  const result = spawnSync(command, args, { maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 失败：${result.stderr?.toString().trim()}`);
  return result.stdout;
}

function grayFrames(path) {
  const raw = run('ffmpeg', ['-v', 'error', '-i', path, '-vf', `scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-']);
  const size = W * H;
  const frames = [];
  for (let offset = 0; offset + size <= raw.length; offset += size) frames.push(raw.subarray(offset, offset + size));
  return frames;
}

function mean(frame) {
  let sum = 0;
  for (const value of frame) sum += value;
  return sum / frame.length;
}

function meanAbsDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

function blockMeans(frame) {
  const out = [];
  for (let by = 0; by < H / BLOCK; by += 1) {
    for (let bx = 0; bx < W / BLOCK; bx += 1) {
      let sum = 0;
      for (let y = by * BLOCK; y < (by + 1) * BLOCK; y += 1) for (let x = bx * BLOCK; x < (bx + 1) * BLOCK; x += 1) sum += frame[y * W + x];
      out.push(sum / (BLOCK * BLOCK));
    }
  }
  return out;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const round = (value) => Math.round(value * 100) / 100;

function measure(file, poster) {
  const path = join(root, DIR, file);
  const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', path]).toString()).streams[0];
  const [num, den] = probe.r_frame_rate.split('/').map(Number);
  const frames = grayFrames(path);
  const firstBlocks = blockMeans(frames[0]);
  const firstLuma = mean(frames[0]);
  let lumaDrift = 0;
  let worstFrame = 0;
  let blockDrift = 0;
  const steps = [];
  frames.forEach((frame, index) => {
    const luma = Math.abs(mean(frame) - firstLuma);
    const blocks = blockMeans(frame);
    const shift = Math.abs(median(blocks.map((value, i) => value - firstBlocks[i])));
    if (Math.max(luma, shift) > Math.max(lumaDrift, blockDrift)) worstFrame = index;
    lumaDrift = Math.max(lumaDrift, luma);
    blockDrift = Math.max(blockDrift, shift);
    if (index > 0) steps.push(meanAbsDiff(frame, frames[index - 1]));
  });
  return {
    file,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    width: probe.width,
    height: probe.height,
    fps: round(num / den),
    frames: frames.length,
    lumaDrift: round(lumaDrift),
    blockDrift: round(blockDrift),
    worstFrame,
    posterDiff: round(meanAbsDiff(frames[0], poster)),
    seam: round(meanAbsDiff(frames[frames.length - 1], frames[0])),
    maxStep: round(Math.max(...steps)),
  };
}

/** 报告里的一条是否合格；不合格返回原因列表（单元测试也用它） */
export function problems(entry) {
  const out = [];
  if (entry.width !== LIMITS.width || entry.height !== LIMITS.height) out.push(`分辨率 ${entry.width}×${entry.height}，要求 ${LIMITS.width}×${LIMITS.height}`);
  if (entry.fps !== LIMITS.fps) out.push(`帧率 ${entry.fps}，要求 ${LIMITS.fps}`);
  if (entry.lumaDrift > LIMITS.lumaDrift || entry.blockDrift > LIMITS.lumaDrift) out.push(`第 ${entry.worstFrame} 帧亮度偏离第一帧（平均 ${entry.lumaDrift}、小块中位 ${entry.blockDrift}，上限 ${LIMITS.lumaDrift}）`);
  if (entry.posterDiff > LIMITS.posterDiff) out.push(`第一帧与静态图差 ${entry.posterDiff}，上限 ${LIMITS.posterDiff}`);
  if (entry.seam > entry.maxStep) out.push(`首尾差 ${entry.seam} 大于相邻帧最大差 ${entry.maxStep}，循环会跳`);
  return out;
}

function main() {
  const dir = join(root, DIR);
  const videos = readdirSync(dir).filter((name) => /\.(mp4|webm)$/.test(name)).sort();
  const report = [];
  for (const file of videos) {
    const posterPath = join(dir, file.replace(/\.(mp4|webm)$/, '.webp'));
    if (!existsSync(posterPath)) throw new Error(`${file} 没有同名静态图 .webp`);
    const entry = measure(file, grayFrames(posterPath)[0]);
    report.push(entry);
    const bad = problems(entry);
    console.log(`${bad.length ? '不合格' : '合格'}  ${file}  ${entry.frames} 帧 @${entry.fps}  亮度偏离 ${entry.lumaDrift}/${entry.blockDrift}  首帧差 ${entry.posterDiff}  首尾差 ${entry.seam}（相邻帧最大 ${entry.maxStep}）`);
    for (const reason of bad) console.log(`        ${reason}`);
  }
  writeFileSync(join(root, REPORT), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`报告：${REPORT}`);
  if (report.some((entry) => problems(entry).length)) process.exit(1);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
