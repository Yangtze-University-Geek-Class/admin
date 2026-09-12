#!/usr/bin/env node
// 端边界检查 —— 阻止跨端 import 与 shared → sites 反向依赖。
//
//   node scripts/check-boundaries.mjs
//
// 为什么需要它：三端（portal / forum / admin）在目录上已隔离，但隔离本身
// 不阻止有人写一条跨端 import。本脚本在构建前置跑，命中即 exit 1 并打印
// 文件与行号。不引入 eslint 全家桶，零依赖。
//
// 规则（见 docs/plan/WEB-SPLIT.md §4）：
//   允许   sites/* → shared/*          sites/* 内部自由引用
//   禁止   sites/A → sites/B（A≠B）    shared/* → sites/*
//
// 后端同理：server/src/routes/{portal,forum,admin} 之间不得互相 import，
// 但都允许引用 lib/ 与 middleware/。

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 递归收集指定扩展名的源文件。 */
function walk(dir, ext = [".ts", ".tsx"]) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (ext.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

/** 从源文件里抽出所有相对/别名 import 的说明符。 */
function specifiers(src) {
  const out = [];
  const re = /(?:from\s+|import\s*)["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) out.push({ spec: m[1], index: m.index });
  return out;
}

/** 把 import 说明符解析为绝对路径（能解析到文件才算，解析不到返回 null）。 */
function resolveSpec(fromFile, spec) {
  let base;
  if (spec.startsWith("@shared/")) base = join(ROOT, "web/shared", spec.slice("@shared/".length));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // 裸包名，不管

  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

const violations = [];

/** 判定一个文件属于哪个「域」。 */
function domainOf(absPath) {
  const rel = relative(ROOT, absPath).split(sep).join("/");
  let m;
  if ((m = rel.match(/^web\/sites\/([a-z]+)\//))) return { kind: "site", name: m[1], layer: "web" };
  if (rel.startsWith("web/shared/")) return { kind: "shared", name: "shared", layer: "web" };
  if ((m = rel.match(/^server\/src\/routes\/([a-z]+)\//))) return { kind: "route", name: m[1], layer: "server" };
  if (rel.startsWith("server/src/")) return { kind: "serverShared", name: "server-shared", layer: "server" };
  return null;
}

const files = [...walk(join(ROOT, "web/sites")), ...walk(join(ROOT, "web/shared")), ...walk(join(ROOT, "server/src"))];

for (const file of files) {
  const from = domainOf(file);
  if (!from) continue;
  const src = readFileSync(file, "utf8");

  for (const { spec, index } of specifiers(src)) {
    const target = resolveSpec(file, spec);
    if (!target) continue;
    const to = domainOf(target);
    if (!to) continue;

    const rel = relative(ROOT, file);
    const line = src.slice(0, index).split("\n").length;
    const hit = `${rel}:${line}  ${spec}`;

    if (from.kind === "site" && to.kind === "site" && from.name !== to.name) {
      violations.push(`跨端 import：${from.name} → ${to.name}\n    ${hit}`);
    } else if (from.kind === "shared" && to.kind === "site") {
      violations.push(`shared 反向依赖站点：${to.name}\n    ${hit}`);
    } else if (from.kind === "route" && to.kind === "route" && from.name !== to.name) {
      violations.push(`后端跨端 import：${from.name} → ${to.name}\n    ${hit}`);
    }
  }
}

if (violations.length) {
  console.error(`✗ 发现 ${violations.length} 处边界违规：\n`);
  for (const v of violations) console.error(`  ${v}\n`);
  console.error("规则见 docs/plan/WEB-SPLIT.md §4。跨端跳转请用 externalUrl()，共享代码请放 shared/。");
  process.exit(1);
}

console.log(`✓ 边界检查通过（${files.length} 个文件）`);
