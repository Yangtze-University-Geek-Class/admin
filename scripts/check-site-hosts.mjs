#!/usr/bin/env node
// 站点域名一致性检查。
//
//   node scripts/check-site-hosts.mjs
//
// 为什么需要：三个端的域名存在两处 ——
//   · 前端：web/shared/config/app.config.json 的 sites.*.host（构建期常量，
//     用于拼跨站绝对 URL）
//   · 后端：.env 的 PUBLIC_ORIGIN / SITE_ORIGIN / *_HOST（运行时，用于把
//     SPA fallback 指到对应入口）
// 两边不一致时不会报错，只会让某个链接指向不存在的地址 —— 论坛那条死链
// 就是这么漏过去的。本脚本在构建前置比对，不一致直接失败。
//
// 没有 .env 时跳过（本地开发、CI 通常没有），所以不会挡住普通构建。

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_JSON = join(ROOT, "web/shared/config/app.config.json");
const ENV_FILE = join(ROOT, ".env");

if (!existsSync(ENV_FILE)) {
  console.log("· 无 .env，跳过站点域名一致性检查（本地开发/CI 属正常）");
  process.exit(0);
}

/** 极简 .env 读取：只取 KEY=VALUE，忽略注释与引号。 */
function readEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function hostOf(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return "";
  }
}

const env = readEnv(ENV_FILE);
const frontendHosts = JSON.parse(readFileSync(CONFIG_JSON, "utf8")).sites;

const portalOrigin = env.SITE_ORIGIN || env.PUBLIC_ORIGIN || "";
const adminOrigin = env.PUBLIC_ORIGIN || "";

const backendHosts = {
  admin: env.ADMIN_HOST || hostOf(adminOrigin),
  portal: env.PORTAL_HOST || hostOf(portalOrigin),
  forum: env.FORUM_HOST || `forum.${hostOf(portalOrigin)}`,
};

const mismatches = [];
for (const kind of ["portal", "forum", "admin"]) {
  const front = frontendHosts[kind]?.host ?? "";
  const back = backendHosts[kind] ?? "";
  if (front && back && front !== back) {
    mismatches.push({ kind, front, back });
  }
}

if (mismatches.length) {
  console.error("✗ 站点域名前后端不一致：\n");
  for (const { kind, front, back } of mismatches) {
    console.error(`  ${kind.padEnd(7)} 前端 ${front}  ≠  后端 ${back}`);
  }
  console.error(
    "\n改域名时两处都要改：\n" +
      "  · 前端 web/shared/config/app.config.json 的 sites.*.host\n" +
      "  · 后端 .env 的 PUBLIC_ORIGIN / SITE_ORIGIN（或显式 *_HOST）\n",
  );
  process.exit(1);
}

console.log(`✓ 站点域名一致（portal=${backendHosts.portal} forum=${backendHosts.forum} admin=${backendHosts.admin}）`);
