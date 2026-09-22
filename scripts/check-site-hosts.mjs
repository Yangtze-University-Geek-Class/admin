#!/usr/bin/env node
/**
 * 站点域名门禁：`app/web/shared/config/app.config.json` 的 sites.*.host 必须与环境契约完全一致。
 *
 * 规则（对新契约：论坛已从独立子域改为官网域名下的 /forum 路径）：
 *   1. admin 必须独占域名：host 不得与 portal / forum 相同（管理员端仍用独立域名）。
 *   2. portal 与 forum 允许同 host，但此时 forum.basePath 必须非空（如 /forum），
 *      且两者 basePath 不得相同、不得互为前缀；host 不同时 basePath 允许为空。
 *   3. portal / admin / forum 的 host 必须分别等于对应环境 env 文件的
 *      PORTAL_HOST / ADMIN_HOST / FORUM_HOST：提交态用 deploy/env/.env.production，
 *      预发布镜像构建期（render-web-config --environment preview 之后）用 .env.preview。
 *      本脚本只比对配置与 env 合同，不读构建产物。
 *   4. host 必须是纯主机名：无协议、无端口、无路径、小写。
 *
 * 只读：不联网、不读密钥、不改文件。
 */

import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readEnvironment, repositoryRoot } from './deployment-environment.mjs';

export const CONFIG_PATH = 'app/web/shared/config/app.config.json';
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const BASE_PATH_RE = /^(?:\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

function normalizeBasePath(value, site) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !BASE_PATH_RE.test(value)) {
    throw new Error(`${site}.basePath 必须是空串或以 / 开头的路径（不带结尾斜杠、不含大写与查询串）：${value}`);
  }
  return value;
}

export function readSiteConfig(text, label = CONFIG_PATH) {
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON：${error.message}`);
  }
  const sites = {};
  for (const site of ['portal', 'forum', 'admin']) {
    const entry = config.sites?.[site];
    if (!entry) throw new Error(`${label} 缺少 sites.${site}`);
    const host = entry.host;
    if (typeof host !== 'string' || !HOST_RE.test(host)) {
      throw new Error(`${label} 的 sites.${site}.host 必须是纯小写主机名（无协议、无端口、无路径）：${host}`);
    }
    sites[site] = { host, basePath: normalizeBasePath(entry.basePath, site) };
  }
  const production = config.environment?.production;
  if (!production || production.dataSource !== 'live' || production.allowDataSourceOverride) {
    throw new Error(`${label} 的 production 数据源必须固定为 live，且不允许运行时覆盖`);
  }
  return sites;
}

/** 域名/路径布局规则（与环境无关，必须自身自洽）。 */
export function assertSiteLayout(sites) {
  if (sites.admin.host === sites.portal.host || sites.admin.host === sites.forum.host) {
    throw new Error(`admin 必须独占域名：admin=${sites.admin.host} 与 portal/forum 冲突`);
  }
  if (sites.portal.host === sites.forum.host) {
    if (!sites.forum.basePath) throw new Error(`forum 与 portal 同 host（${sites.forum.host}）时 forum.basePath 必须非空（如 /forum）`);
    if (sites.portal.basePath && sites.forum.basePath === sites.portal.basePath) {
      throw new Error(`portal 与 forum 同 host 时 basePath 不得相同：${sites.forum.basePath}`);
    }
    const prefix = sites.portal.basePath ? `${sites.portal.basePath}/` : null;
    if (prefix && sites.forum.basePath.startsWith(prefix)) {
      throw new Error(`forum.basePath（${sites.forum.basePath}）落在 portal.basePath（${sites.portal.basePath}）之下`);
    }
    if (sites.portal.basePath && sites.portal.basePath.startsWith(`${sites.forum.basePath}/`)) {
      throw new Error(`portal.basePath（${sites.portal.basePath}）落在 forum.basePath（${sites.forum.basePath}）之下`);
    }
  }
}

/** 与 env 文件比对；返回匹配到的环境名，都不匹配则抛错。 */
export function matchEnvironment(sites, expectations) {
  const mismatches = [];
  for (const [name, expected] of expectations) {
    const differences = [];
    for (const site of ['portal', 'forum', 'admin']) {
      if (sites[site].host !== expected[site]) differences.push(`${site}: ${sites[site].host} ≠ ${expected[site]}`);
    }
    if (!differences.length) return name;
    mismatches.push(`  ${name}（来自 ${expected.source}）：${differences.join('；')}`);
  }
  throw new Error(
    `${CONFIG_PATH} 的站点域名与任何环境契约都不一致：\n${mismatches.join('\n')}\n`
      + '提交态必须等于 production 值；预发布镜像构建期请先运行 scripts/render-web-config.mjs --environment preview。',
  );
}

export function checkSiteHosts({ root = repositoryRoot() } = {}) {
  const config = readSiteConfig(readFileSync(resolve(root, CONFIG_PATH), 'utf8'));
  const expectations = [];
  for (const name of ['production', 'preview']) {
    const deployment = readEnvironment(root, name);
    expectations.push([name, { ...deployment.hosts, source: deployment.relativePath }]);
  }
  assertSiteLayout(config);
  const matched = matchEnvironment(config, expectations);
  return { sites: config, matched, expectations };
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
    if (process.argv.length > 2 && process.argv[2] !== '--check') throw new Error('用法：node scripts/check-site-hosts.mjs [--check]');
    const result = checkSiteHosts();
    const entry = result.expectations.find(([name]) => name === result.matched);
    console.log(
      `站点域名与 ${entry[1].source} 一致（环境 ${result.matched}）：portal=${result.sites.portal.host} `
        + `forum=${result.sites.forum.host}${result.sites.forum.basePath} admin=${result.sites.admin.host}；production 数据源固定为 live。`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
