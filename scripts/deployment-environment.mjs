#!/usr/bin/env node
/**
 * 环境契约：`deploy/env/.env.<environment>` 与 `deploy/environments.json` 的一致性校验 + 运行时环境文件渲染。
 *
 * 契约边界：
 *   * `deploy/environments.json` 是环境身份（域名、GitHub environment 名）的唯一机器配置。
 *   * 每个环境只有一个对外 origin：`PUBLIC_ORIGIN` 必须逐字等于契约里的 origin；
 *     管理端靠 URL 路径（/admin、/console）区分，不再有独立域名或按站点的 host 字段。
 *   * `deploy/env/.env.production|preview` 是**提交入库的模板**：地址/端口/域名写真实值，
 *     密钥项必须为空；目标机运行时文件由 CI 用环境级 secrets 渲染后落盘（本脚本 render 模式）。
 *   * 本脚本只读仓库、只写显式 `--out` 目标；不连接服务器、不发版、不改任何 Git 状态。
 *
 * 用法：
 *   node scripts/deployment-environment.mjs --check [--root <仓库根>]
 *   node scripts/deployment-environment.mjs render --environment <preview|production> \
 *     --out <运行时 env 文件路径> --image-tag <12 位 SHA>
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 环境名的唯一合法集合；没有默认环境，也不存在回落到 production 的路径。 */
export const ENVIRONMENTS = Object.freeze(['preview', 'production']);
/** 契约里必须存在、且提交模板里必须留空的密钥字段。 */
export const SECRET_FIELDS = Object.freeze([
  'OAUTH_CLIENT_ID',
  'OAUTH_CLIENT_SECRET',
  'SESSION_SECRET',
  'ENCRYPTION_KEY',
  'TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
]);
/**
 * Cloudflare Turnstile 是可选的一对：两项都为空 = 明确关闭（服务端 middleware/turnstile.ts 此时只靠工作量证明与限流），
 * 只填一项仍视为半配置。其余密钥一律必填。
 */
export const OPTIONAL_SECRET_PAIR = Object.freeze(['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']);
/** 允许为空但不属于密钥的字段（留空是明确的语义）。 */
const EMPTY_IS_MEANINGFUL = Object.freeze(new Set([...SECRET_FIELDS, 'COOKIE_DOMAIN', 'ALLOWED_ORGS']));
/** 模板里必须存在的非密钥字段。 */
const REQUIRED_FIELDS = Object.freeze([
  'GEEK_DEPLOYMENT_ENVIRONMENT',
  'GEEK_ENVIRONMENT_ORIGIN',
  'COMPOSE_PROJECT_NAME',
  'STACK_ROOT',
  'DEPLOY_HOST',
  'DEPLOY_PORT',
  'DEPLOY_USER',
  'IMAGE_TAG',
  'WEB_BIND',
  'SERVER_BIND',
  'SERVER_PORT',
  'FORUM_PORT',
  'PUBLIC_ORIGIN',
  'NODE_ENV',
  'PORT',
  'HOST',
  'TRUST_PROXY',
  'DB_PATH',
  'FORUM_DB_PATH',
  'FORUM_UPLOAD_DIR',
  'POW_DIFFICULTY',
  'CONSOLE_ORG',
  ...SECRET_FIELDS,
]);
/** 发布身份是构建期 build args：绝不写进部署 env 文件。 */
const BUILD_ONLY_FIELDS = Object.freeze(['GEEK_RELEASE_VERSION', 'GEEK_RELEASE_COMMIT', 'GEEK_RELEASE_DISPLAY_SUFFIX']);
/** 模板允许出现的全部字段：契约外的键（例如已退役的按站点 host 字段）一律拒绝，防止悄悄长出第二份配置。 */
const KNOWN_FIELDS = Object.freeze(new Set([...REQUIRED_FIELDS, ...EMPTY_IS_MEANINGFUL]));
/** 三个镜像对应的服务名（compose 服务名、Dockerfile 目录名一致）。 */
export const IMAGE_SERVICES = Object.freeze(['server', 'web', 'forum']);
/**
 * 每个环境独立的镜像仓库前缀，等于该环境的 COMPOSE_PROJECT_NAME。
 * 两套栈在同一个 Docker 守护进程上：同一提交的预发布与正式镜像构建参数不同（release.json、版本串、
 * 站点配置），如果共用 `<仓库>:<sha12>`，后 load 的一方会把另一方的镜像改名覆盖，回滚与重建容器会用错镜像。
 * 所以镜像仓库按环境分开，IMAGE_TAG 仍只是提交的 12 位 SHA。
 */
export function imageRepositoryPrefix(environment) {
  if (!ENVIRONMENTS.includes(environment)) fail(`未知部署环境：${environment}`);
  return `yzgc-${environment}`;
}
/** 某环境某服务某提交的完整镜像引用，例如 yzgc-preview/web:0123456789ab。 */
export function imageReference(environment, service, imageTag) {
  if (!IMAGE_SERVICES.includes(service)) fail(`未知镜像服务：${service}`);
  return `${imageRepositoryPrefix(environment)}/${service}:${imageTag}`;
}
/**
 * 从 compose 文本解析出全部 `image:` 引用，并把 ${IMAGE_TAG...} 代入给定的 tag。
 * 其它变量不代入：镜像仓库名必须是字面量，由 env 文件改不了。
 */
export function composeImageReferences(text, imageTag) {
  const references = [];
  for (const match of String(text).matchAll(/^[ \t]*image:[ \t]*(.+?)[ \t]*$/gm)) {
    const raw = match[1].replace(/^(['"])(.*)\1$/, '$2');
    references.push(raw.replace(/\$\{IMAGE_TAG(?::[?-][^}]*)?\}/g, imageTag));
  }
  return references;
}
/** 逐字固定的入口域名：论坛构建（app/forum/shared/deployment.ts）与 env 模板都要对得上。 */
export const EXPECTED_ORIGINS = Object.freeze({
  preview: 'https://prev.yangtzeu.work',
  production: 'https://yangtzeu.work',
});
/** 任何名字长得像密钥的键，一旦有非空值即拒绝（防止未来新增字段悄悄带上真值）。 */
const SECRET_KEY_RE = /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|ENCRYPTION_KEY|SSH_KEY|PRIVATE_KEY)(?:_|$)/i;
const HOST_RE = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const LOOPBACK_BIND_RE = /^127\.0\.0\.1:[0-9]{4,5}$/;
const IMAGE_TAG_RE = /^[a-f0-9]{12}$/;
const SECRET_VALUE_RE = /^[A-Za-z0-9._+/=:@~-]{4,4096}$/;
const ENV_FILE_DIR = 'deploy/env';

export function repositoryRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function fail(message) {
  throw new Error(message);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} 必须是非空字符串`);
  return value;
}

/** 只接受 https://<host> 形式：不接受协议降级、凭据、端口、路径、查询串与 fragment。 */
export function parseHttpsOrigin(value, label) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    fail(`${label} 不是合法 URL：${value}`);
  }
  if (url.protocol !== 'https:') fail(`${label} 必须是 https：${value}`);
  if (url.username || url.password) fail(`${label} 不得包含凭据：${value}`);
  if (url.port) fail(`${label} 必须是标准端口：${value}`);
  if (url.pathname !== '/' || url.search || url.hash) fail(`${label} 不得包含路径、查询串或 fragment：${value}`);
  if (!HOST_RE.test(url.hostname)) fail(`${label} 的域名非法：${value}`);
  return url.origin;
}

/** 解析 KEY=VALUE 环境文件；拒绝重复键与非法行，保留「键 → 值」顺序信息。 */
export function parseEnvFileText(text, label = 'env 文件') {
  const values = new Map();
  const lines = String(text).split('\n');
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) fail(`${label}:${index + 1} 不是 KEY=VALUE 形式：${trimmed}`);
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) fail(`${label}:${index + 1} 键名非法：${key}`);
    if (values.has(key)) fail(`${label}:${index + 1} 重复定义 ${key}`);
    let value = trimmed.slice(separator + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  });
  return values;
}

export function loadContract(root = repositoryRoot()) {
  const path = resolve(root, 'deploy/environments.json');
  if (!existsSync(path)) fail(`缺少环境身份契约：${relative(root, path) || path}`);
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`deploy/environments.json 不是合法 JSON：${error.message}`);
  }
  return value;
}

/**
 * 校验环境身份契约：只有环境身份（label / origin / githubEnvironment）。发布 tag 的规则
 * 唯一实现在 scripts/release-policy.mjs，这里**不**读取旧的 tagPrefix / allowCommitSuffix，存在也不参与判定。
 */
export function validateEnvironmentContract(value = loadContract()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('环境契约必须是 JSON 对象');
  if (value.schemaVersion !== 1) fail('环境契约 schemaVersion 必须为 1');
  const declared = Object.keys(value.environments ?? {}).sort().join(',');
  if (declared !== [...ENVIRONMENTS].sort().join(',')) fail('环境契约必须且只能声明 preview 与 production');
  for (const name of ENVIRONMENTS) {
    const entry = value.environments[name];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`环境契约缺少 ${name}`);
    assertNonEmptyString(entry.label, `${name}.label`);
    const origin = parseHttpsOrigin(entry.origin, `${name}.origin`);
    if (origin !== EXPECTED_ORIGINS[name]) {
      fail(`${name}.origin 必须逐字等于 ${EXPECTED_ORIGINS[name]}（论坛构建与 env 模板都依赖它），收到 ${origin}`);
    }
    if (entry.githubEnvironment !== name) {
      fail(`${name}.githubEnvironment 必须是 ${name}：禁止回落到仓库级配置，也禁止环境名指代别的环境`);
    }
  }
  return value;
}

/** 解析发布目标：环境 → 身份。requestedOrigin（可选）必须与契约完全一致。 */
export function deploymentTarget(environment, requestedOrigin, contractValue) {
  const contract = validateEnvironmentContract(contractValue);
  if (!ENVIRONMENTS.includes(environment)) fail('未知部署环境；没有默认目标。');
  const entry = contract.environments[environment];
  if (requestedOrigin !== undefined) {
    const origin = parseHttpsOrigin(requestedOrigin, 'requestedOrigin');
    if (origin !== entry.origin) fail(`环境与目标域名不匹配：${environment} 的入口是 ${entry.origin}`);
  }
  return Object.freeze({
    environment,
    label: entry.label,
    origin: entry.origin,
    githubEnvironment: entry.githubEnvironment,
  });
}

function readTemplate(root, name) {
  const path = resolve(root, `${ENV_FILE_DIR}/.env.${name}`);
  if (!existsSync(path)) fail(`缺少环境模板文件 ${ENV_FILE_DIR}/.env.${name}`);
  const text = readFileSync(path, 'utf8');
  const values = parseEnvFileText(text, `${ENV_FILE_DIR}/.env.${name}`);
  return { path, relativePath: `${ENV_FILE_DIR}/.env.${name}`, text, values };
}

/** 读取单个环境的模板与解析结果（供 release-policy 复用）。 */
export function readEnvironment(root, name) {
  const contract = validateEnvironmentContract(loadContract(root));
  if (!ENVIRONMENTS.includes(name)) fail(`环境必须是 ${ENVIRONMENTS.join(' / ')}，收到 ${name}`);
  const template = readTemplate(root, name);
  return {
    name,
    entry: contract.environments[name],
    path: template.path,
    relativePath: template.relativePath,
    text: template.text,
    values: template.values,
    stackRoot: template.values.get('STACK_ROOT'),
    composeProject: template.values.get('COMPOSE_PROJECT_NAME'),
    runtimeEnvFile: `${template.values.get('STACK_ROOT')}/.env.${name}`,
  };
}

/** 全量一致性校验：模板 ↔ 契约 ↔ 跨环境隔离 ↔ compose/远端脚本。 */
export function validateEnvironmentFiles({ root = repositoryRoot(), checkCompose = true } = {}) {
  const problems = [];
  const warnings = [];
  const environments = [];
  let contract;
  try {
    contract = validateEnvironmentContract(loadContract(root));
  } catch (error) {
    return { ok: false, problems: [error.message], warnings, environments: [] };
  }
  for (const name of ENVIRONMENTS) {
    const label = `${ENV_FILE_DIR}/.env.${name}`;
    let template;
    try {
      template = readTemplate(root, name);
    } catch (error) {
      problems.push(error.message);
      continue;
    }
    const { values, text, path, relativePath } = template;
    const problem = message => problems.push(`${label}: ${message}`);
    const warn = message => warnings.push(`${label}: ${message}`);

    for (const field of REQUIRED_FIELDS) if (!values.has(field)) problem(`缺少字段 ${field}`);
    for (const [key, value] of values) {
      if (!KNOWN_FIELDS.has(key) && !BUILD_ONLY_FIELDS.includes(key)) {
        problem(`${key} 不在环境契约里：每个环境只有 PUBLIC_ORIGIN 一个对外地址，不接受额外的域名或站点字段`);
        continue;
      }
      if (SECRET_FIELDS.includes(key)) {
        if (value) problem(`${key} 必须在入库模板里留空（由环境级 secrets 注入）`);
        continue;
      }
      if (SECRET_KEY_RE.test(key) && value && !EMPTY_IS_MEANINGFUL.has(key)) problem(`${key} 看起来是密钥却带非空值`);
      if (!value && !EMPTY_IS_MEANINGFUL.has(key)) warn(`${key} 为空`);
    }
    if (values.get('GEEK_DEPLOYMENT_ENVIRONMENT') !== name) problem(`GEEK_DEPLOYMENT_ENVIRONMENT 必须等于 ${name}`);
    const expectedOrigin = contract.environments[name].origin;
    if (values.get('GEEK_ENVIRONMENT_ORIGIN') !== expectedOrigin) {
      problem(`GEEK_ENVIRONMENT_ORIGIN 必须等于 deploy/environments.json 的 ${expectedOrigin}`);
    }
    if (values.get('COMPOSE_PROJECT_NAME') !== `yzgc-${name}`) problem(`COMPOSE_PROJECT_NAME 必须是 yzgc-${name}`);
    if (values.get('STACK_ROOT') !== `/opt/yzgc/${name}`) problem(`STACK_ROOT 必须是 /opt/yzgc/${name}`);
    for (const field of ['WEB_BIND', 'SERVER_BIND']) {
      const value = values.get(field) ?? '';
      if (!LOOPBACK_BIND_RE.test(value)) problem(`${field} 必须是 127.0.0.1:<端口>（禁止 0.0.0.0 暴露）：${value}`);
    }
    for (const field of ['SERVER_PORT', 'FORUM_PORT', 'PORT', 'DEPLOY_PORT']) {
      const value = Number(values.get(field));
      if (!Number.isInteger(value) || value < 1 || value > 65535) problem(`${field} 不是合法端口：${values.get(field)}`);
    }
    if (values.get('NODE_ENV') !== 'production') problem(`NODE_ENV 必须是 production`);
    if (values.get('PORT') !== values.get('SERVER_PORT')) warn(`PORT(${values.get('PORT')}) 与 SERVER_PORT(${values.get('SERVER_PORT')}) 不一致`);
    const imageTag = values.get('IMAGE_TAG') ?? '';
    if (imageTag === 'latest') problem('IMAGE_TAG 禁止 latest');
    else if (imageTag !== 'unset' && !IMAGE_TAG_RE.test(imageTag)) problem(`IMAGE_TAG 只能是 unset 或 12 位 SHA：${imageTag}`);
    // 单一 origin：OAuth 回调、邀请链接、登录回跳都由它拼出，必须与环境身份逐字一致。
    try {
      const publicOrigin = parseHttpsOrigin(values.get('PUBLIC_ORIGIN'), 'PUBLIC_ORIGIN');
      if (publicOrigin !== expectedOrigin || values.get('PUBLIC_ORIGIN') !== expectedOrigin) {
        problem(`PUBLIC_ORIGIN 必须逐字等于 deploy/environments.json 的 ${expectedOrigin}（每个环境只有这一个对外地址），收到 ${values.get('PUBLIC_ORIGIN')}`);
      }
    } catch (error) {
      problem(error.message);
    }
    if (values.get('COOKIE_DOMAIN')) problem('只允许 host-only cookie：COOKIE_DOMAIN 必须留空');
    for (const field of BUILD_ONLY_FIELDS) {
      if (values.has(field)) problem(`${field} 属于构建期 build args（CI 按分支生成），不得写进部署 env 文件`);
    }
    const host = values.get('HOST') ?? '';
    if (!['0.0.0.0', '127.0.0.1'].includes(host)) problem(`HOST 只能是容器内的 0.0.0.0 或 127.0.0.1：${host}`);
    if (values.get('TRUST_PROXY') !== 'true') warn('TRUST_PROXY 不是 true：容器里看不到真实客户端地址，反代链路的限流与日志会失真');
    const ignored = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', 'check-ignore', '--quiet', path], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 10000,
    });
    if (ignored.status === 0) problem('模板文件必须是提交入库的：当前被 .gitignore 忽略');
    else if (ignored.status !== 1) warn('无法通过 git check-ignore 判定该文件是否入库');
    if (text.includes('0.0.0.0') && !/^HOST=0\.0\.0\.0$/m.test(text)) {
      problem('模板里出现 0.0.0.0：只允许容器内 HOST=0.0.0.0，宿主侧端口必须绑回环');
    }
    environments.push({ name, label, relativePath, values, origin: expectedOrigin });
  }

  const byName = new Map(environments.map(item => [item.name, item]));
  if (byName.size === ENVIRONMENTS.length) {
    const production = byName.get('production');
    const preview = byName.get('preview');
    for (const field of ['STACK_ROOT', 'COMPOSE_PROJECT_NAME', 'WEB_BIND', 'SERVER_BIND', 'PUBLIC_ORIGIN']) {
      if (production.values.get(field) === preview.values.get(field)) {
        problems.push(`两套栈必须完全隔离：production 与 preview 的 ${field} 相同（${production.values.get(field)}）`);
      }
    }
    if (production.origin === preview.origin) problems.push('两套环境的入口域名必须不同');
    for (const field of ['DEPLOY_HOST', 'DEPLOY_PORT', 'DEPLOY_USER']) {
      if (production.values.get(field) !== preview.values.get(field)) {
        warnings.push(`production 与 preview 的 ${field} 不同（契约要求同机双栈）：${production.values.get(field)} vs ${preview.values.get(field)}`);
      }
    }
  }

  if (checkCompose) {
    // 用同一个示例 SHA 解析两套 compose：同一提交的两个环境绝不能落到同一个镜像引用上。
    const sampleTag = '0123456789ab';
    const referencesByEnvironment = new Map();
    for (const name of ENVIRONMENTS) {
      const composePath = resolve(root, `deploy/compose/${name}.yml`);
      if (!existsSync(composePath)) {
        problems.push(`缺少 deploy/compose/${name}.yml：每个环境必须有一套完整栈定义`);
        continue;
      }
      const compose = readFileSync(composePath, 'utf8');
      if (!compose.includes('COMPOSE_PROJECT_NAME')) problems.push(`deploy/compose/${name}.yml 必须使用 \${COMPOSE_PROJECT_NAME} 作为项目名`);
      const prefix = imageRepositoryPrefix(name);
      for (const service of IMAGE_SERVICES) {
        const imageRef = new RegExp(`^[ \\t]*image:[ \\t]*${prefix}/${service}:\\$\\{IMAGE_TAG(?::[^}]*)?\\}[ \\t]*$`, 'm');
        if (!imageRef.test(compose)) {
          problems.push(`deploy/compose/${name}.yml 必须使用 ${prefix}/${service}:\${IMAGE_TAG...}（镜像仓库按环境分开；禁止 latest 或写死 tag）`);
        }
      }
      const references = composeImageReferences(compose, sampleTag);
      const expected = IMAGE_SERVICES.map(service => imageReference(name, service, sampleTag));
      for (const reference of references) {
        if (!expected.includes(reference)) {
          problems.push(`deploy/compose/${name}.yml 的镜像 ${reference.replace(sampleTag, '${IMAGE_TAG}')} 不属于 ${prefix}/：每个环境只能用自己的镜像仓库`);
        }
      }
      referencesByEnvironment.set(name, references);
      if (/0\.0\.0\.0:\d/.test(compose)) problems.push(`deploy/compose/${name}.yml 把端口发布到 0.0.0.0：宿主侧只能绑 127.0.0.1`);
      if (compose.includes(':latest')) problems.push(`deploy/compose/${name}.yml 出现 latest 标签`);
    }
    const [first, second] = ENVIRONMENTS.map(name => referencesByEnvironment.get(name) ?? []);
    for (const shared of first.filter(reference => second.includes(reference))) {
      problems.push(
        `两套 compose 在同一提交上解析出同一个镜像引用 ${shared.replace(sampleTag, '<sha12>')}：`
          + '同一台 Docker 主机上预发布与正式镜像会互相覆盖，必须用各自环境的镜像仓库。',
      );
    }
    for (const script of ['deploy/remote/deploy-stack.sh', 'deploy/remote/rollback-stack.sh']) {
      if (!existsSync(resolve(root, script))) problems.push(`缺少 ${script}：目标机部署入口必须入库`);
    }
  }
  return { ok: problems.length === 0, problems, warnings, environments };
}

/** 渲染运行时环境文件：模板 + 环境级 secrets + IMAGE_TAG。只写显式 --out，值不回显。 */
export function renderRuntimeEnv({ root = repositoryRoot(), environment, out, imageTag, env = process.env }) {
  const deployment = readEnvironment(root, environment);
  if (typeof out !== 'string' || !out) fail('render 需要 --out <运行时 env 文件路径>');
  const tag = String(imageTag ?? '');
  if (!IMAGE_TAG_RE.test(tag)) fail(`IMAGE_TAG 必须是 12 位小写 SHA：${tag}`);
  const updated = new Map(deployment.values);
  const secretFields = [];
  const pairFilled = OPTIONAL_SECRET_PAIR.map(field => typeof env[field] === 'string' && env[field] !== '');
  if (pairFilled[0] !== pairFilled[1]) {
    fail(`${OPTIONAL_SECRET_PAIR.join(' 与 ')} 只配了一项：要么都填（开启 Turnstile），要么都留空（关闭）`);
  }
  const turnstileOff = !pairFilled[0];
  for (const field of SECRET_FIELDS) {
    const value = env[field];
    if (turnstileOff && OPTIONAL_SECRET_PAIR.includes(field)) {
      updated.set(field, '');
      continue;
    }
    if (typeof value !== 'string' || !value) fail(`缺少环境密钥 ${field}：拒绝生成半配置的运行时环境文件`);
    if (!SECRET_VALUE_RE.test(value)) fail(`环境密钥 ${field} 含非法字符（不接受空白、引号、$、#）：拒绝写入`);
    updated.set(field, value);
    secretFields.push(field);
  }
  updated.set('IMAGE_TAG', tag);
  const changed = new Set([...secretFields, 'IMAGE_TAG']);
  const lines = deployment.text.split('\n').map(line => {
    const match = /^([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (!match || !changed.has(match[1])) return line;
    const value = updated.get(match[1]) ?? '';
    return `${match[1]}=${/^[A-Za-z0-9._+/=:@~-]*$/.test(value) ? value : `"${value}"`}`;
  });
  const header = '# 本文件由 deployment-environment render 渲染（模板 deploy/env/.env.' + environment + '）：含环境密钥，禁止入库、禁止写入日志。';
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${header}\n${lines.join('\n')}`, { mode: 0o600 });
  return { out, environment, imageTag: tag, secretFields, turnstile: turnstileOff ? 'off' : 'on', bytes: Buffer.byteLength(lines.join('\n')) };
}

const USAGE = `环境契约校验与运行时环境文件渲染：
  node scripts/deployment-environment.mjs --check [--root <仓库根>]
  node scripts/deployment-environment.mjs render --environment <preview|production> --out <路径> --image-tag <12位SHA>

密钥值只从进程环境读取，永不接受命令行参数，也永不回显。`;

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h') || !argv.length) {
    console.log(USAGE);
    if (!argv.length) throw new Error('缺少子命令');
    return;
  }
  const [command, ...rest] = argv;
  if (command === '--check') {
    if (rest.length) throw new Error('--check 不接受额外参数');
    const report = validateEnvironmentFiles({ root: repositoryRoot() });
    for (const warning of report.warnings) console.warn(`[警告] ${warning}`);
    if (!report.ok) fail(report.problems.join('\n'));
    console.log(
      `环境契约通过：${report.environments.map(item => `${item.name} → ${item.origin}`).join('；')}；`
        + '模板为提交入库态、密钥留空、两套栈端口/目录/域名互不重叠。未执行任何部署。',
    );
    return;
  }
  if (command === 'render') {
    const options = { root: repositoryRoot() };
    for (let index = 0; index < rest.length; index += 2) {
      const key = rest[index];
      const value = rest[index + 1];
      if (!['--environment', '--out', '--image-tag', '--root'].includes(key) || !value || value.startsWith('--')) {
        throw new Error(`未知或缺失的选项：${key ?? ''}`);
      }
      options[key.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
    }
    const result = renderRuntimeEnv(options);
    console.log(
      `已渲染 ${result.environment} 运行时环境文件：${result.out}（注入 ${result.secretFields.length} 个密钥字段，IMAGE_TAG=${result.imageTag}，${result.bytes} 字节）。值不回显。`,
    );
    if (result.turnstile === 'off') console.warn(`[提示] ${OPTIONAL_SECRET_PAIR.join('、')} 都为空：Turnstile 关闭，公开表单只靠工作量证明与限流。`);
    return;
  }
  throw new Error(`未知子命令：${command}`);
}

// 入口判定必须走 realpath：脚本经符号链接路径启动时，直接比较 resolve(process.argv[1]) 会不相等，
// 导致 CLI 静默不执行却返回 0，被误当作契约校验通过。
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
