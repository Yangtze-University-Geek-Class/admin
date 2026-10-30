#!/usr/bin/env node
/**
 * 环境隔离检查：正式（production）、预发布（preview）、本机（dev）三份 env 模板互相隔离，
 * 仓库里的代码和部署片段不写另一个环境的地址（#309）。
 *
 *   1. 键集：三份 `deploy/env/.env.*` 的键完全一致。
 *   2. 身份：各自的 origin 只能是自己的（正式、预发布取 deploy/environments.json，本机是回环）。
 *   3. 隔离：每份文件不得出现另外两个环境才有的域名、镜像仓库、端口、路径。
 *   4. 同构：正式与预发布除登记的差异键（域名、端口、项目名、栈目录、独立 GitLab 实例）外，值必须相同。
 *   5. 密钥：名字像密钥的键三份都必须留空；本机另外不外发邮件、不同步 GitLab。
 *   6. 硬编码：代码和部署片段里的正式域名和预发布域名只能出现在 deploy/env/origin-exceptions.json
 *      登记过的文件里，登记要写次数上限和理由；`only` 限定一个环境的文件里出现另一个环境的域名也失败。
 *   7. 子域名（#335）：app/、deploy/（含 env 模板）、scripts/、tests/ 里，环境入口之外的 *.yangtzeu.work 一律失败；
 *      确需保留的登记在同一个文件的 subdomains 里：主机、理由，加上文件与次数上限，或 anywhere（整个主机不归任何环境）。
 *
 * 只读仓库，不连网络。用法：node scripts/check-env-isolation.mjs [--root <仓库根>] [--json]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENV_FILES = Object.freeze({
  production: 'deploy/env/.env.production',
  preview: 'deploy/env/.env.preview',
  dev: 'deploy/env/.env.dev',
});
export const EXCEPTIONS_FILE = 'deploy/env/origin-exceptions.json';
export const DEV_ORIGIN = 'http://127.0.0.1:5173';

/** 正式与预发布允许取不同值的键：环境身份与各自独立的 GitLab 实例；其余键的值必须相同。 */
export const PER_ENVIRONMENT_KEYS = Object.freeze([
  'GEEK_DEPLOYMENT_ENVIRONMENT',
  'GEEK_ENVIRONMENT_ORIGIN',
  'COMPOSE_PROJECT_NAME',
  'STACK_ROOT',
  'WEB_BIND',
  'SERVER_BIND',
  'PUBLIC_ORIGIN',
  'GITLAB_SYNC',
  'GITLAB_URL',
  'GITLAB_OIDC_CLIENT',
  'GITLAB_OIDC_SECTOR',
  'GITLAB_STACK_ROOT',
  'GITLAB_HTTP_BIND',
  'GITLAB_DOCKER_SUBNET',
  'GITLAB_DOCKER_GATEWAY',
  'BACKUP_S3_PREFIX',
  // 用户文件对象存储（#352）：前缀按环境分开（yzgc/production/ 与 yzgc/preview/），端点与公开地址两边相同
  'OBJECT_STORAGE_PREFIX',
]);

/** 名字像密钥的键：三份模板都必须留空。 */
const SECRET_KEY_RE = /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|ENCRYPTION_KEY|SSH_KEY|PRIVATE_KEY|JWKS|CLIENT_ID|ACCESS_KEY_ID|API_KEY|SITE_KEY|ALLOWLIST)(?:_|$)/i;

const APEX = String.raw`(?<![\w.-])yangtzeu\.work(?![\w-])`;
const PREV = String.raw`(?<![\w.-])prev\.yangtzeu\.work(?![\w-])`;
const APEX_RE = new RegExp(APEX, 'g');
const PREV_RE = new RegExp(PREV, 'g');
const LOOPBACK_RE = /(?:127\.0\.0\.1|localhost|\[::1\])/;

/** 每个环境的文件里不得出现的别家标志。 */
const FOREIGN = Object.freeze({
  production: [
    { re: PREV_RE, what: '预发布域名' },
    { re: /yzgc-preview|\/opt\/yzgc\/preview/, what: '预发布的镜像仓库或栈目录' },
    { re: /:1820[01]\b/, what: '预发布端口 18200/18201' },
    { re: /127\.0\.0\.1:5173|localhost/, what: '本机开发地址' },
  ],
  preview: [
    { re: APEX_RE, what: '正式域名' },
    { re: /yzgc-production|\/opt\/yzgc\/production/, what: '正式的镜像仓库或栈目录' },
    { re: /:1810[01]\b/, what: '正式端口 18100/18101' },
    { re: /127\.0\.0\.1:5173|localhost/, what: '本机开发地址' },
  ],
  dev: [
    { re: APEX_RE, what: '正式域名' },
    { re: PREV_RE, what: '预发布域名' },
    { re: /yzgc-production|yzgc-preview|\/opt\/yzgc\//, what: '部署栈的镜像仓库或目录' },
    { re: /:18[12]0[01]\b/, what: '部署栈端口 18100/18101/18200/18201' },
  ],
});

export function parseEnv(text) {
  const values = new Map();
  const duplicates = [];
  for (const [index, raw] of String(text).split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      duplicates.push(`第 ${index + 1} 行不是 KEY=value：${line.slice(0, 40)}`);
      continue;
    }
    if (values.has(match[1])) duplicates.push(`${match[1]} 重复定义（第 ${index + 1} 行）`);
    values.set(match[1], match[2].trim());
  }
  return { values, problems: duplicates };
}

/** 去掉注释行：隔离只看会被消费的内容，说明文字里提到别的环境不算。 */
function withoutComments(text) {
  return String(text).split(/\r?\n/).filter(line => !line.trim().startsWith('#')).join('\n');
}

/**
 * 检查三份 env 模板。
 * @param {{production: string, preview: string, dev: string}} files 文件全文
 * @param {{preview: string, production: string}} origins deploy/environments.json 里的 origin
 */
export function checkEnvFiles(files, origins) {
  const findings = [];
  const add = (rule, file, message) => findings.push({ rule, file, message });
  const parsed = {};
  for (const name of Object.keys(ENV_FILES)) {
    if (typeof files[name] !== 'string') {
      add('missing', ENV_FILES[name], '文件不存在');
      continue;
    }
    parsed[name] = parseEnv(files[name]);
    for (const problem of parsed[name].problems) add('syntax', ENV_FILES[name], problem);
  }
  if (Object.keys(parsed).length !== 3) return findings;

  // 1. 键集一致
  const union = new Set([...Object.values(parsed).flatMap(p => [...p.values.keys()])]);
  for (const name of Object.keys(parsed)) {
    const missing = [...union].filter(key => !parsed[name].values.has(key)).sort();
    if (missing.length) add('keys', ENV_FILES[name], `缺少与另外两份对齐的键：${missing.join('、')}`);
  }

  // 2. 身份
  const identity = {
    production: { origin: origins.production, deployment: 'production' },
    preview: { origin: origins.preview, deployment: 'preview' },
    dev: { origin: DEV_ORIGIN, deployment: 'local' },
  };
  for (const [name, expected] of Object.entries(identity)) {
    const values = parsed[name].values;
    for (const key of ['PUBLIC_ORIGIN', 'GEEK_ENVIRONMENT_ORIGIN']) {
      if (values.get(key) !== expected.origin) add('identity', ENV_FILES[name], `${key} 应为 ${expected.origin}，实际 ${values.get(key) ?? '缺失'}`);
    }
    if (values.get('GEEK_DEPLOYMENT_ENVIRONMENT') !== expected.deployment) {
      add('identity', ENV_FILES[name], `GEEK_DEPLOYMENT_ENVIRONMENT 应为 ${expected.deployment}，实际 ${values.get('GEEK_DEPLOYMENT_ENVIRONMENT') ?? '缺失'}`);
    }
  }

  // 3. 隔离：别家的标志不得出现在自己的文件里
  for (const [name, rules] of Object.entries(FOREIGN)) {
    const body = withoutComments(files[name]);
    for (const { re, what } of rules) {
      re.lastIndex = 0;
      if (re.test(body)) add('foreign', ENV_FILES[name], `出现了${what}`);
    }
  }
  if (!LOOPBACK_RE.test(parsed.dev.values.get('PUBLIC_ORIGIN') ?? '')) add('foreign', ENV_FILES.dev, 'PUBLIC_ORIGIN 必须是回环地址');

  // 4. 同构：正式与预发布除登记的键以外值相同
  for (const key of union) {
    if (PER_ENVIRONMENT_KEYS.includes(key)) continue;
    const a = parsed.production.values.get(key);
    const b = parsed.preview.values.get(key);
    if (a !== undefined && b !== undefined && a !== b) {
      add('parity', ENV_FILES.preview, `${key} 在正式与预发布取值不同（正式 ${JSON.stringify(a)}，预发布 ${JSON.stringify(b)}）；确属环境差异就加进 PER_ENVIRONMENT_KEYS 并写进 docs/ops/ENVIRONMENTS.md，否则对齐`);
    }
  }
  for (const key of ['GITLAB_URL', 'GITLAB_OIDC_SECTOR', 'GITLAB_STACK_ROOT', 'GITLAB_HTTP_BIND', 'GITLAB_DOCKER_SUBNET', 'GITLAB_DOCKER_GATEWAY']) {
    if (parsed.production.values.get(key) === parsed.preview.values.get(key)) add('gitlab_isolation', ENV_FILES.preview, `${key} 必须属于独立 GitLab 实例，不能与正式共用`);
  }

  // 5. 密钥留空；本机不外发、不同步
  for (const name of Object.keys(parsed)) {
    for (const [key, value] of parsed[name].values) {
      if (SECRET_KEY_RE.test(key) && value !== '') add('secret', ENV_FILES[name], `${key} 是密钥，模板里必须留空`);
    }
  }
  const dev = parsed.dev.values;
  if (dev.get('GITLAB_SYNC') !== 'off') add('dev_safety', ENV_FILES.dev, 'GITLAB_SYNC 必须是 off：本机不碰真实 GitLab');
  if (dev.get('MAIL_RECIPIENTS') !== 'allowlist') add('dev_safety', ENV_FILES.dev, 'MAIL_RECIPIENTS 必须是 allowlist：本机不群发');
  if (dev.get('NODE_ENV') !== 'development') add('dev_safety', ENV_FILES.dev, 'NODE_ENV 必须是 development');
  return findings;
}

const BINARY_FILE = /\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp4|webm|mp3|wav|zip|gz|tar|wasm|pdf|bin)$/i;
/** 扫描范围外：文档、执行记录、测试、依赖、锁文件、说明性 Markdown。 */
const SCAN_SKIP = [
  /^docs\//, /^notes\//, /^tests\//, /^\.tools\//, /^\.claude\//, /^node_modules\//, /(^|\/)node_modules\//,
  /^deploy\/env\//, /^\.github\/ISSUE_TEMPLATE\//, /^\.github\/pull_request_template\.md$/,
  /\.md$/, /\.lock$/, /(^|\/)pnpm-lock\.yaml$/, /(^|\/)Cargo\.lock$/,
  /\.test\.[cm]?[jt]sx?$/, /(^|\/)tests?\//, /(^|\/)test_[^/]+\.py$/,
  BINARY_FILE,
];
export function isScanned(path) {
  return !SCAN_SKIP.some(re => re.test(path));
}

/** 统计一个文件里两种域名各出现几次。 */
export function countOrigins(text) {
  APEX_RE.lastIndex = 0;
  PREV_RE.lastIndex = 0;
  return { production: (String(text).match(APEX_RE) ?? []).length, preview: (String(text).match(PREV_RE) ?? []).length };
}

/**
 * 核对硬编码的域名。
 * @param {{path: string, text: string}[]} files 已选出的待扫描文件
 * @param {{file: string, max: number, reason: string, only?: 'production'|'preview'}[]} exceptions 登记
 */
export function checkHardcodedOrigins(files, exceptions) {
  const findings = [];
  const add = (rule, file, message) => findings.push({ rule, file, message });
  const registry = new Map();
  for (const entry of exceptions) {
    if (!entry || typeof entry.file !== 'string' || !Number.isInteger(entry.max) || entry.max < 1) {
      add('exception', EXCEPTIONS_FILE, `登记项必须有 file 和不小于 1 的整数 max：${JSON.stringify(entry)}`);
      continue;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 8) add('exception', entry.file, '登记项要写清理由（至少 8 个字）');
    if (entry.only !== undefined && !['production', 'preview'].includes(entry.only)) add('exception', entry.file, 'only 只能是 production 或 preview');
    if (registry.has(entry.file)) add('exception', entry.file, '重复登记');
    registry.set(entry.file, entry);
  }
  const seen = new Set();
  for (const { path, text } of files) {
    const hits = countOrigins(text);
    const total = hits.production + hits.preview;
    if (total === 0) continue;
    seen.add(path);
    const entry = registry.get(path);
    if (!entry) {
      add('hardcoded', path, `写死了环境域名（正式 ${hits.production} 处，预发布 ${hits.preview} 处）：改成读 env 文件或 deploy/environments.json；确需写死就登记到 ${EXCEPTIONS_FILE} 并写理由`);
      continue;
    }
    if (total > entry.max) add('hardcoded', path, `域名出现 ${total} 处，超过登记的上限 ${entry.max}：新增的写死位置要先审，再改登记`);
    if (entry.only === 'production' && hits.preview > 0) add('cross_environment', path, `只属于正式的文件里出现了预发布域名（${hits.preview} 处）`);
    if (entry.only === 'preview' && hits.production > 0) add('cross_environment', path, `只属于预发布的文件里出现了正式域名（${hits.production} 处）`);
  }
  for (const [file] of registry) {
    if (!seen.has(file)) add('stale_exception', file, '登记过，但这个文件已经没有环境域名（或不存在）：从登记里删掉');
  }
  return findings;
}

/** 子域名扫描的范围：代码、部署物料（含 env 模板）、脚本与测试；文档和执行记录写的是历史，不扫。 */
const SUBDOMAIN_SCOPE = /^(?:app|deploy|scripts|tests)\//;
const SUBDOMAIN_SKIP = [/(^|\/)node_modules\//, /\.lock$/, /(^|\/)pnpm-lock\.yaml$/, BINARY_FILE];
export function isSubdomainScanned(path) {
  // 登记表本身就是这些子域名的清单
  return SUBDOMAIN_SCOPE.test(path) && path !== EXCEPTIONS_FILE && !SUBDOMAIN_SKIP.some(re => re.test(path));
}

const SUBDOMAIN_RE = /(?<![\w.-])((?:[a-z0-9-]+\.)+yangtzeu\.work)(?![\w-])/gi;

/**
 * 核对环境入口之外的子域名。
 * @param {{path: string, text: string}[]} files 已选出的待扫描文件
 * @param {{host: string, reason: string, file?: string, max?: number, anywhere?: boolean}[]} entries origin-exceptions.json 的 subdomains
 * @param {string[]} allowed 环境入口的主机（deploy/environments.json），由第 6 条管
 */
export function checkSubdomains(files, entries, allowed) {
  const findings = [];
  const add = (rule, file, message) => findings.push({ rule, file, message });
  const anywhere = new Set();
  const registry = new Map();
  for (const entry of entries) {
    const host = typeof entry?.host === 'string' ? entry.host.toLowerCase() : '';
    const label = JSON.stringify(entry);
    if (!/^(?:[a-z0-9-]+\.)+yangtzeu\.work$/.test(host) || allowed.includes(host)) {
      add('exception', EXCEPTIONS_FILE, `subdomains 的 host 必须是环境入口之外的 *.yangtzeu.work：${label}`);
      continue;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 6) add('exception', EXCEPTIONS_FILE, `subdomains 登记要写清理由（至少 6 个字）：${label}`);
    if (entry.anywhere === true) {
      if (entry.file !== undefined || entry.max !== undefined) add('exception', EXCEPTIONS_FILE, `anywhere 与 file/max 只能二选一：${label}`);
      else anywhere.add(host);
      continue;
    }
    if (typeof entry.file !== 'string' || !Number.isInteger(entry.max) || entry.max < 1) {
      add('exception', EXCEPTIONS_FILE, `subdomains 登记要有 file 和不小于 1 的整数 max，或者 anywhere：${label}`);
      continue;
    }
    const key = `${host} ${entry.file}`;
    if (registry.has(key)) add('exception', entry.file, `${host} 重复登记`);
    registry.set(key, { host, file: entry.file, max: entry.max });
  }
  const seen = new Set();
  for (const { path, text } of files) {
    const counts = new Map();
    SUBDOMAIN_RE.lastIndex = 0;
    for (const match of String(text).matchAll(SUBDOMAIN_RE)) {
      const host = match[1].toLowerCase();
      if (allowed.includes(host) || anywhere.has(host)) continue;
      counts.set(host, (counts.get(host) ?? 0) + 1);
    }
    for (const [host, count] of counts) {
      const entry = registry.get(`${host} ${path}`);
      if (!entry) {
        add('subdomain', path, `写了环境入口之外的子域名 ${host}（${count} 处）：在用的地址改成读 env 文件或 deploy/environments.json，样例用中性值；确需保留就登记到 ${EXCEPTIONS_FILE} 的 subdomains 并写理由`);
        continue;
      }
      seen.add(`${host} ${path}`);
      if (count > entry.max) add('subdomain', path, `${host} 出现 ${count} 处，超过登记的上限 ${entry.max}：新增的位置要先审，再改登记`);
    }
  }
  for (const [key, entry] of registry) {
    if (!seen.has(key)) add('stale_exception', entry.file, `登记过 ${entry.host}，但这个文件里已经没有它（或文件不存在）：从 subdomains 里删掉`);
  }
  return findings;
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function collectScanFiles(root, scanned = isScanned) {
  const paths = git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean);
  const files = [];
  for (const path of paths) {
    if (!scanned(path)) continue;
    const absolute = resolve(root, path);
    if (!existsSync(absolute) || !lstatSync(absolute).isFile()) continue;
    const buffer = readFileSync(absolute);
    if (buffer.length > 4 * 1024 * 1024 || buffer.includes(0)) continue;
    files.push({ path, text: buffer.toString('utf8') });
  }
  return files;
}

export function checkRepository(root) {
  const read = relative => (existsSync(resolve(root, relative)) ? readFileSync(resolve(root, relative), 'utf8') : undefined);
  const contract = JSON.parse(read('deploy/environments.json') ?? '{}');
  const origins = {
    production: contract.environments?.production?.origin,
    preview: contract.environments?.preview?.origin,
  };
  const findings = [];
  if (!origins.production || !origins.preview) {
    findings.push({ rule: 'identity', file: 'deploy/environments.json', message: '缺少 production 或 preview 的 origin' });
    return findings;
  }
  findings.push(...checkEnvFiles({ production: read(ENV_FILES.production), preview: read(ENV_FILES.preview), dev: read(ENV_FILES.dev) }, origins));
  const exceptionsText = read(EXCEPTIONS_FILE);
  let exceptions = [];
  let subdomains = [];
  if (exceptionsText === undefined) findings.push({ rule: 'exception', file: EXCEPTIONS_FILE, message: '文件不存在' });
  else {
    try {
      const parsed = JSON.parse(exceptionsText);
      exceptions = parsed.exceptions ?? [];
      subdomains = parsed.subdomains ?? [];
    } catch (error) {
      findings.push({ rule: 'exception', file: EXCEPTIONS_FILE, message: `不是合法 JSON：${error.message}` });
    }
  }
  findings.push(...checkHardcodedOrigins(collectScanFiles(root), exceptions));
  const hosts = [origins.production, origins.preview].map(origin => new URL(origin).host);
  findings.push(...checkSubdomains(collectScanFiles(root, isSubdomainScanned), subdomains, hosts));
  // 本机预览入口的 origin 要和 .env.dev 一致，不能各写各的。
  const preview = read('scripts/local-preview.mjs');
  if (preview && !preview.includes(`"${DEV_ORIGIN}"`)) {
    findings.push({ rule: 'identity', file: 'scripts/local-preview.mjs', message: `webOrigin 应与 ${ENV_FILES.dev} 的 PUBLIC_ORIGIN 一致（${DEV_ORIGIN}）` });
  }
  return findings;
}

function main(argv) {
  const rootIndex = argv.indexOf('--root');
  const root = rootIndex >= 0 ? resolve(argv[rootIndex + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const findings = checkRepository(root);
  if (argv.includes('--json')) console.log(JSON.stringify({ ok: findings.length === 0, findings }, null, 2));
  else if (findings.length === 0) console.log('环境隔离通过：三份 env 键集一致、值互相隔离，代码里的环境域名和环境入口之外的子域名都已登记。');
  else {
    console.error(`环境隔离检查未通过（${findings.length} 项）：`);
    for (const f of findings) console.error(`  [${f.rule}] ${f.file}：${f.message}`);
  }
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
