#!/usr/bin/env node
/**
 * 前端站点配置门禁：`app/web/shared/config/app.config.json` 必须符合「每个环境一个域名」的契约。
 *
 * 规则：
 *   1. sites.portal / sites.forum / sites.admin 都必须存在，且都**不得**带 host 字段：
 *      域名只来自各环境的 PUBLIC_ORIGIN，管理端按路径（/admin、/console）区分，
 *      前端产物因此与环境无关，同一个镜像在两个环境通用。
 *   2. basePath 只能是空串或以 / 开头的小写路径；forum.basePath 必须非空（论坛挂在 /forum），
 *      且不得与 portal / admin 的 basePath 相同或互为前缀。
 *   3. production 数据源固定为 live，且不允许运行时覆盖。
 *
 * 只读：不联网、不读密钥、不改文件、不读 env 文件。
 */

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CONFIG_PATH = 'app/web/shared/config/app.config.json';
export const SITES = Object.freeze(['portal', 'forum', 'admin']);
const BASE_PATH_RE = /^(?:\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

function repositoryRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function normalizeBasePath(value, site, label) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !BASE_PATH_RE.test(value)) {
    throw new Error(`${label} 的 sites.${site}.basePath 必须是空串或以 / 开头的路径（不带结尾斜杠、不含大写与查询串）：${value}`);
  }
  return value;
}

/** 解析并校验配置文本；返回各站点的 basePath。任何违规都直接抛错。 */
export function checkSiteConfigText(text, label = CONFIG_PATH) {
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON：${error.message}`);
  }
  const sites = {};
  for (const site of SITES) {
    const entry = config.sites?.[site];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${label} 缺少 sites.${site}`);
    if (Object.hasOwn(entry, 'host')) {
      throw new Error(`${label} 的 sites.${site} 不得带 host：每个环境只有一个域名（PUBLIC_ORIGIN），管理端按路径区分`);
    }
    sites[site] = { basePath: normalizeBasePath(entry.basePath, site, label) };
  }
  const forum = sites.forum.basePath;
  if (!forum) throw new Error(`${label} 的 sites.forum.basePath 必须非空（论坛挂在同域名的 /forum 路径下）`);
  for (const other of ['portal', 'admin']) {
    const base = sites[other].basePath;
    if (!base) continue;
    if (base === forum || base.startsWith(`${forum}/`) || forum.startsWith(`${base}/`)) {
      throw new Error(`${label} 的 sites.forum.basePath（${forum}）与 sites.${other}.basePath（${base}）重叠`);
    }
  }
  const production = config.environment?.production;
  if (!production || production.dataSource !== 'live' || production.allowDataSourceOverride) {
    throw new Error(`${label} 的 production 数据源必须固定为 live，且不允许运行时覆盖`);
  }
  return sites;
}

export function checkSiteConfig({ root = repositoryRoot() } = {}) {
  return checkSiteConfigText(readFileSync(resolve(root, CONFIG_PATH), 'utf8'));
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
    if (process.argv.length > 2) throw new Error('用法：node scripts/check-site-config.mjs');
    const sites = checkSiteConfig();
    console.log(
      `站点配置通过：portal/forum/admin 均不带 host（域名只来自 PUBLIC_ORIGIN），`
        + `forum.basePath=${sites.forum.basePath}；production 数据源固定为 live。`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
