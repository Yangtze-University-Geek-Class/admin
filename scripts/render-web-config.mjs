#!/usr/bin/env node
/**
 * 把 `deploy/env/.env.<environment>` 的站点域名写进前端构建期配置。
 *
 * 为什么需要它：域名在前端是**构建期常量**（`app/web/shared/config/app.config.json`），
 * 环境事实却只写在 env 文件里。镜像构建前用它把两者对齐；提交态必须保持 production 值，
 * 所以 preivew 渲染只是构建期的一次性改写，不进入仓库历史。
 *
 * 只改 `sites.{portal,forum,admin}.host` 三个值，其余字节（含单行紧凑写法与注释外的排版）保持不变。
 * 不读密钥、不联网、不提交。
 *
 * 用法：
 *   node scripts/render-web-config.mjs --environment <production|preview> [--check] [--root <仓库根>]
 */

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readEnvironment, repositoryRoot } from './deployment-environment.mjs';

export const CONFIG_RELATIVE_PATH = 'app/web/shared/config/app.config.json';

/** 定位 `"<site>": { ... }` 的块边界（按花括号计数，跳过字符串内的括号）。 */
function siteBlockRange(text, site) {
  const match = new RegExp(`"${site}"\\s*:\\s*\\{`).exec(text);
  if (!match) throw new Error(`app.config.json 里找不到站点块：${site}`);
  const open = match.index + match[0].length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = open; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return { start: open, end: index };
    }
  }
  throw new Error(`app.config.json 的站点块未闭合：${site}`);
}

export function readSiteHosts(text, label = CONFIG_RELATIVE_PATH) {
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON：${error.message}`);
  }
  const hosts = {};
  for (const site of ['portal', 'forum', 'admin']) {
    const host = config.sites?.[site]?.host;
    if (typeof host !== 'string' || !host) throw new Error(`${label} 缺少 sites.${site}.host`);
    hosts[site] = host;
  }
  return hosts;
}

/** 只替换站点块里的 host 值；未变化的站点保持原样。 */
export function replaceSiteHosts(text, hosts) {
  const edits = [];
  for (const site of ['portal', 'forum', 'admin']) {
    const { start, end } = siteBlockRange(text, site);
    const block = text.slice(start, end + 1);
    const matches = [...block.matchAll(/"host"\s*:\s*"([^"]*)"/g)];
    if (matches.length !== 1) throw new Error(`站点 ${site} 的 host 字段必须恰好出现一次（实际 ${matches.length} 次）`);
    const current = matches[0][1];
    const next = hosts[site];
    if (typeof next !== 'string' || !next) throw new Error(`目标 host 缺失：${site}`);
    if (current === next) continue;
    edits.push({ site, current, next, start: start + matches[0].index, end: start + matches[0].index + matches[0][0].length });
  }
  let output = text;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, edit.start)}"host": ${JSON.stringify(edit.next)}${output.slice(edit.end)}`;
  }
  return { text: output, changes: edits.map(({ site, current, next }) => ({ site, from: current, to: next })) };
}

/** 计算一次渲染要做的改动；不写文件。 */
export function planWebConfig({ root = repositoryRoot(), environment }) {
  const deployment = readEnvironment(root, environment);
  const configPath = resolve(root, CONFIG_RELATIVE_PATH);
  const text = readFileSync(configPath, 'utf8');
  const current = readSiteHosts(text);
  const expected = deployment.hosts;
  const { text: next, changes } = replaceSiteHosts(text, expected);
  return { environment, configPath, envFile: deployment.relativePath, current, expected, next, changes };
}

/** 写入渲染结果（镜像构建用）。写后重新解析校验，避免产出坏 JSON。 */
export function writeWebConfig(plan) {
  writeFileSync(plan.configPath, plan.next);
  const hosts = readSiteHosts(readFileSync(plan.configPath, 'utf8'));
  for (const site of ['portal', 'forum', 'admin']) {
    if (hosts[site] !== plan.expected[site]) throw new Error(`写入后校验失败：${site} 期望 ${plan.expected[site]}，实际 ${hosts[site]}`);
  }
  return hosts;
}

const USAGE = `前端站点域名渲染：
  node scripts/render-web-config.mjs --environment <production|preview> [--check] [--root <仓库根>]

--check 只比对不写入，不一致时 exit 1。默认（无 --check）写入 app/web/shared/config/app.config.json，
供镜像构建使用；提交态必须保持 production 值。`;

function parseArguments(argv) {
  const options = { root: repositoryRoot(), check: false, environment: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--check') {
      options.check = true;
      continue;
    }
    if (!['--environment', '--root'].includes(arg)) throw new Error(`未知参数：${arg}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${arg} 需要取值`);
    options[arg === '--environment' ? 'environment' : 'root'] = value;
  }
  if (!options.environment) throw new Error('必须显式指定 --environment（没有默认环境）');
  return options;
}

function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const plan = planWebConfig(options);
  if (options.check) {
    if (plan.changes.length) {
      for (const change of plan.changes) {
        console.error(`[不一致] ${change.site}: ${CONFIG_RELATIVE_PATH} 里是 "${change.from}"，${plan.envFile} 要求 "${change.to}"（应改为后者）`);
      }
      throw new Error(
        `${CONFIG_RELATIVE_PATH} 与 ${plan.envFile} 的站点域名不一致（${plan.changes.length} 处）。提交态必须是 production 值。`,
      );
    }
    console.log(`站点域名一致：${CONFIG_RELATIVE_PATH} 的 portal/forum/admin 与 ${plan.envFile} 完全匹配（环境 ${plan.environment}）。`);
    return;
  }
  if (!plan.changes.length) {
    console.log(`无需改写：${CONFIG_RELATIVE_PATH} 已经是 ${plan.environment} 的站点域名。`);
    return;
  }
  const hosts = writeWebConfig(plan);
  for (const change of plan.changes) console.log(`[已改写] ${change.site}: ${change.from} → ${change.to}`);
  console.log(`已按 ${plan.envFile} 渲染 ${CONFIG_RELATIVE_PATH}（portal=${hosts.portal} forum=${hosts.forum} admin=${hosts.admin}）。`);
  if (plan.environment !== 'production') {
    console.log('提醒：这是镜像构建期的临时改写，提交前请用 --environment production 还原（提交态 = production 值）。');
  }
}

// 入口判定必须走 realpath：脚本经符号链接路径启动时，直接比较 resolve(process.argv[1]) 会不相等，
// 导致 CLI 静默不执行却返回 0，被误当作校验通过。
function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url;
  } catch {
    return false;
  }
}
if (isDirectRun()) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
