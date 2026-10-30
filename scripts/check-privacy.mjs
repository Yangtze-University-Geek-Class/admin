#!/usr/bin/env node
/**
 * 隐私门禁：规范、文档与代码里不能出现所有者的身份信息、本机路径和敏感凭据形态（#328）。
 *
 * 硬失败条件（只报位置与类别，不回显命中的内容）：
 *   1. 个人标识（名字、域名段与本机账号名）：文本切成字母数字段，每一段小写后算 sha256，与登记表 PERSONAL_IDENTIFIER_SHA256 比对。
 *      登记表只存摘要，不存名字：入库的脚本不能成为身份泄露点；CI 与别的机器都能用同一份摘要比对，不需要任何本机配置。
 *      所以连字符工具名、点分的域名段都会命中。执行记录的目录布局（notes/<日期>/<用户名>/）在任何文件里先去掉；链路 id（<用户名>/task_<号>_…）只在 notes/ 与提交说明里去掉，别处照报；noreply 地址在任何文件里都先去掉。新增一个个人标识：把它小写后的 sha256 加进登记表，不写明文。
 *   2. 本机家目录路径：`/Users/<名>/`、`/home/<名>/`、`C:/Users/<名>/`。占位写法 `/home/<login>` 与角色账号（guest、user、runner）不算。
 *      登记表可以按文件与精确值（`/Users/<名>`）放行这一条，理由必写；别的规则不能这样放行。
 *   3. 中国大陆手机号（11 位，1 开头、第二位 3–9）。
 *   4. 令牌形态：gk_、glpat-、gh[pousr]_、github_pat_、sk- 后跟长随机串。
 *   5. 个人邮箱。放行：本地部分是角色/系统发信词（notify、noreply、support、git 等，见 ROLE_LOCALS）；
 *      域名是占位（example.*、*.test、*.invalid、localhost）；域名是 systemd 单元后缀（`<实例>@<单元>.timer` 不是邮箱）。
 *   6. 证件号：18 位，第 7–14 位是合法出生日期的居民身份证形态。
 *   7. 用户原话形态（全仓，不限范围）：「原话」「所有者说」等标签后紧跟冒号或引号，或「所有者 / 用户 + 日期、时间、动词（在会话中、要求、说、确认……）+ 引号」。
 *      仓库里不写所有者的原文；批准写成摘要（角色、北京时间、渠道、范围）。占位 `[已脱敏]` 不算。
 *
 * 提交门禁（`--commits <base>..<head> [--published <ref>]...`，CI 的 branch-guard 对每个 PR 运行；`--published` 指向已经公开、改不掉的提交，如 GitHub main，从它可达的提交不查，所有者 2026-10-30 在会话中批准）：范围内每条提交的说明跑上面 1–4、5、7 的规则，
 * 作者与提交者邮箱与文件里的邮箱用同一条判定（见第 5 条）：users.noreply.<站点>、noreply.<站点>（GitLab）、角色地址与占位域名放行，其它都算个人地址。
 * 历史里已经有的提交不改写，命中就由所有者决定怎么处理（COMMITS）。
 *
 * 范围（见 inScope）：AGENTS.md、根目录 README 与 design-qa、docs/**，去掉生成物（docs/INDEX.md、docs/architecture/catalog/**）、
 * 第三方快照（docs/components/tuffex/snapshot/**）与交接记录（docs/handovers：记录的是当时的原文，不改写）；
 * .agents、scripts、.github、app 下的全部文本文件（去掉锁文件、二进制资源、构建产物与 node_modules，见 OUT_OF_SCOPE）、tests 目录，以及 deploy（含 deploy/env：环境值的键集由 check:env-isolation 核对，这里核对内容）。
 * notes/ 不在范围内：执行记录只允许按 NOTES §3 的脱敏修订规则改（替换成 [已脱敏]），由 note.mjs 核对。
 *
 * 目录结构例外：`notes/<日期>/<GitHub 用户名>/` 是执行记录的分目录（NOTES §2），扫描前先去掉这一段。
 *
 * 只读 `git ls-files`（含未跟踪、未忽略的文件）；不读 Git 历史、不联网、不改文件。
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 个人标识的登记表：名字、域名段与本机账号名小写后的 sha256。只存摘要，不存明文。
 * 第一项是所有者的 GitHub 账号名（它同时是本机账号名，也是个人域名的一段）。
 */
export const PERSONAL_IDENTIFIER_SHA256 = Object.freeze([
  'c320ed23d8d5e1f97f77948addd777637dc1b327b863ba4b12d8f10a41b5d14c',
]);

const IN_SCOPE = [
  /^AGENTS\.md$/,
  /^README(?:\.[A-Za-z]+)?\.md$/,
  /^design-qa\.md$/,
  /^docs\//,
  /^\.agents\//,
  /^scripts\//,
  /(?:^|\/)tests\//,
  /^\.github\//,
  /^app\//,
  /^deploy\//,
];
/** Tuffex 参考文档受完整性清单约束（scripts/tuffex-docs.mjs check 逐字核对），这两处是组件示例路径，要随上游同步一起改。 */
const UPSTREAM_LOCKED_FILES = new Set(['docs/components/tuffex/reference/icon-picker.md', 'docs/components/tuffex/reference/icons.md']);
const OUT_OF_SCOPE = [
  /^docs\/INDEX\.md$/,
  /^docs\/architecture\/catalog\//,
  /^docs\/components\/tuffex\/snapshot\//,
  /^docs\/handovers\//,
  // 锁文件、二进制资源与构建产物：不是人写的文本，只按文本扫描的规则在这里排除（用户原话形态仍全仓查）
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock|bun\.lockb?)$/,
  /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|icns|woff2?|ttf|otf|eot|mp3|mp4|m4a|ogg|wav|webm|mov|pdf|zip|gz|tgz|tar|wasm|sqlite3?|db|psd)$/i,
  /(?:^|\/)(?:node_modules|dist|build|target|\.nuxt|\.output|\.next|coverage)\//,
];
/** 执行记录的分目录：notes/<日期>/<用户名>/，用户名就是 GitHub 用户名（NOTES §2）。 */
const NOTES_LAYOUT_RE = /notes\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]+\//g;
const ROLE_LOCALS = new Set(['notify', 'noreply', 'no-reply', 'support', 'info', 'contact', 'admin', 'postmaster', 'hello', 'team', 'security', 'alerts', 'git', 'ci', 'bot', 'service', 'mailer', 'root']);
/** systemd 单元名与模板实例：`<模板>@.service`、`<实例>@<单元>.timer`，`@` 后面是单元类型而不是邮箱域名。 */
const UNIT_DOMAIN_RE = /(?:^|\.)(?:service|timer|socket|target|path|mount|slice)(?:\.|$)/;
/** GitHub 的 noreply 是 users.noreply.github.com；GitLab 的是 <用户名>@noreply.<站点>（docs/services/server/oidc.md）。 */
const NOREPLY_DOMAIN_RE = /^(?:users\.)?noreply\.[a-z0-9.-]+$/;
const PLACEHOLDER_DOMAIN_RE = /^example\.(?:com|org|net)$|(?:^|\.)(?:example|test|invalid|localhost)$/;
/** 个人标识按字母数字段比对；noreply 地址在任何文件里都是合法的，比对前先去掉。 */
const TOKEN_RE = /[A-Za-z0-9]+/g;
/** 执行记录的链路 id（`<用户名>/task_N`）只在 notes/ 与提交说明里合法（notesLayout），文档里出现的同样照报。 */
const CHAIN_ID_RE = /[A-Za-z0-9_-]+\/(?=task[_/]\d)/g;
const NOREPLY_ADDRESS_RE = /[A-Za-z0-9._+-]+@(?:users\.)?noreply\.[A-Za-z0-9.-]+/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** URL 的用户信息：`scheme://用户@主机`、`scheme://用户:口令@主机` 里 @ 前的部分；只认 :// 之后紧跟的用户段，别的冒号照常报。 */
const URL_USERINFO_RE = /[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^\s/@]*:)?$/;
/** 用户原话形态：标签后短距离内是冒号（不是网址的 ://）或引号，或「所有者 / 用户 + 日期、时间、动词 + 引号」；引号内以 [已脱敏] 开头的不算。 */
const USER_QUOTE_LABEL = '(?:原话|原文[：:]|用户说|用户写|用户的话|所有者说|所有者写|所有者回复|所有者要求|所有者指示|所有者的话|所有者原文|所有者提出|所有者问|所有者发来|所有者明确说|owner said)';
/** 标签前缀里允许出现的日期、时间与动词（在会话中、原话、要求、说、确认……）；只靠它们接引号才算原话。 */
const QUOTE_PREFIX = '\\d{4}-\\d{2}-\\d{2}|\\d{1,2}-\\d{1,2}|\\d{1,2}[:：]\\d{2}|北京时间|在会话中|原话|要求|说|确认|批准|指示|回复|提出|明确|写|问';
// 「所有者」后面可以是日期、时间与动词的任意组合再接引号；「用户」必须至少带一个日期、时间或动词，普通的「用户」引号写法不算
const OWNER_QUOTE_RE = new RegExp(`(?:所有者(?:[ 　0-9:：-]|${QUOTE_PREFIX})*|用户(?:[ 　]|${QUOTE_PREFIX})*(?:${QUOTE_PREFIX}))[ 　]*[：:]?[ 　]*[「“『](?!\\[已脱敏\\])`);
const USER_QUOTE_RES = [
  new RegExp(`${USER_QUOTE_LABEL}(?:[\\s（(]{0,3}[：:](?!//)[ ]?(?![「“『]?\\[已脱敏\\])|[\\s（(]{0,3}[「“『](?!\\[已脱敏\\]))`),
  OWNER_QUOTE_RE,
  // 时间戳开头的引语：「- 02:58：「…」」「02:58：「…」」
  /^\s*(?:[-*]\s*)?\d{1,2}[:：]\d{2}\s*[：:]\s*[「“『](?!\[已脱敏\])/,
  // 时间后面同一句里是要求、说（不含说明、说法）、定（不含决定、确定、一定）、指示之类的动词，紧跟冒号的原句才算；「定位」这类词不算
  /\d{1,2}:\d{2}[^。；;：:，,\n]{0,20}?(?:要求|说(?![明法])|(?<![决确肯一稳])定|指示)[：:](?!\s*[「“『]?\[已脱敏\])/,
  // 同一句（不跨冒号与逗号）里是上述动词，接括号里的原句才算
  /\d{1,2}:\d{2}[^。；;：:，,\n]{0,20}?(?:要求|说(?![明法])|(?<![决确肯一稳])定|指示)[^。；;：:，,\n「」“”『』\[]{0,40}?[（(](?!\s*[「“『]?\[已脱敏\])/,
  // 同一句里是上述动词，接引号里的原句（引号内以 [已脱敏] 开头的不算）
  /\d{1,2}:\d{2}[^。；;：:，,\n]{0,20}?(?:要求|说(?![明法])|(?<![决确肯一稳])定|指示)[^。；;：:，,\n]{0,8}?[「“『](?!\[已脱敏\])/,
];
/** 上游快照与 Tuffex 参考是第三方文本，不在用户原话范围内。 */
const UPSTREAM_TEXT_RE = /^docs\/components\/tuffex\//;
/** 家目录里的角色账号名（访客、通用占位、运行器）不是个人账号名，不算。 */
const HOME_ROLE_NAMES = ['guest', 'user', 'runner'];
const PATTERN_RULES = [
  // exceptable：登记表可以按文件与精确值放行这一条（上游种子数据里的示例路径）；令牌、手机号、证件号不开这个口子。
  { name: '本机家目录路径', exceptable: true, pattern: new RegExp(`(?:\\/Users\\/|\\/home\\/|[A-Za-z]:\\/Users\\/)(?!(?:${HOME_ROLE_NAMES.join('|')})(?![A-Za-z0-9._-]))[A-Za-z0-9._-]+`) },
  { name: '手机号', pattern: /(?<![0-9A-Za-z])1[3-9][0-9]{9}(?![0-9A-Za-z])/ },
  { name: '令牌形态', pattern: /\b(?:gk_[A-Za-z0-9_-]{16,}|glpat-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,}|sk-[A-Za-z0-9_-]{20,})/ },
  { name: '证件号', pattern: /(?<![0-9])[1-9][0-9]{5}(?:19|20)[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])[0-9]{3}[0-9Xx](?![0-9])/ },
];

const digestCache = new Map();
function digestOf(word) {
  if (!digestCache.has(word)) digestCache.set(word, createHash('sha256').update(word.toLowerCase()).digest('hex'));
  return digestCache.get(word);
}

/** 文件是否进入扫描范围。 */
export function inScope(file) {
  return IN_SCOPE.some(pattern => pattern.test(file)) && !OUT_OF_SCOPE.some(pattern => pattern.test(file)) && !UPSTREAM_LOCKED_FILES.has(file);
}

/** 个人地址：角色与系统发信词、noreply、systemd 单元名、占位域名之外都算。文件与提交（作者、提交者）共用这一条判定。 */
function isPersonalEmail(address) {
  const at = address.lastIndexOf('@');
  if (at < 0) return false;
  const local = address.slice(0, at).toLowerCase();
  const domain = address.slice(at + 1).toLowerCase();
  return !(ROLE_LOCALS.has(local) || NOREPLY_DOMAIN_RE.test(domain) || UNIT_DOMAIN_RE.test(domain) || PLACEHOLDER_DOMAIN_RE.test(domain));
}

/**
 * 扫描一个文件的内容，返回命中列表 [{ line, rule }]；个人邮箱另带 digest（地址的 sha256），不带地址本身。
 * notesLayout 为真时（notes/ 与提交说明）先去掉执行记录的目录布局与链路 id。
 */
export function scanText(text, { identityDigests = PERSONAL_IDENTIFIER_SHA256, notesLayout = false } = {}) {
  const findings = [];
  text.split('\n').forEach((raw, index) => {
    const layout = raw.replace(NOTES_LAYOUT_RE, '');
    const line = (notesLayout ? layout.replace(CHAIN_ID_RE, ' ') : layout).replace(NOREPLY_ADDRESS_RE, ' ');
    const line1 = index + 1;
    if ([...line.matchAll(TOKEN_RE)].some(token => identityDigests.includes(digestOf(token[0])))) findings.push({ line: line1, rule: '个人标识' });
    for (const rule of PATTERN_RULES) {
      const match = rule.pattern.exec(line);
      if (match) findings.push({ line: line1, rule: rule.name, ...(rule.exceptable ? { digest: sha256(match[0]) } : {}) });
    }
    for (const match of line.matchAll(EMAIL_RE)) {
      if (URL_USERINFO_RE.test(line.slice(0, match.index))) continue;
      if (isPersonalEmail(match[0])) findings.push({ line: line1, rule: '个人邮箱', digest: sha256(match[0]) });
    }
  });
  return findings;
}

/** 扫描一段文字里的用户原话形态，返回 [{ line, rule }]，不含命中的原文。 */
export function scanUserQuotes(text) {
  const findings = [];
  text.split('\n').forEach((line, index) => {
    if (USER_QUOTE_RES.some(pattern => pattern.test(line))) findings.push({ line: index + 1, rule: '用户原话形态' });
  });
  return findings;
}

/**
 * 核对 base..head 范围内的每条提交（只读 git log）：说明跑文件门禁的类别与用户原话形态，作者与提交者邮箱不能是个人地址。
 * 返回 { ok, findings, checked }，只写提交号与类别，命中的说明与地址都不输出。
 */
export function scanCommits({ repoRoot = root, range, published = [], identityDigests } = {}) {
  // published：已经公开、改不掉的提交所在的引用（如 GitHub main），从这些引用可达的提交不再检查
  const log = execFileSync('git', ['log', '--format=%H%x1f%ae%x1f%ce%x1f%B%x1e', range, ...published.map(ref => `^${ref}`)], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const findings = [];
  let checked = 0;
  for (const record of log.split('\x1e')) {
    const fields = record.replace(/^\n+/, '').split('\x1f');
    if (fields.length < 4) continue;
    const [sha, authorEmail, committerEmail, ...rest] = fields;
    const message = rest.join('\x1f');
    const id = sha.slice(0, 10);
    checked += 1;
    for (const { rule } of [...scanText(message, { identityDigests, notesLayout: true }), ...scanUserQuotes(message)]) {
      findings.push(`${id}: 提交说明含${rule}（命中内容未输出；提交说明不写用户原文、账号、本机路径与凭据）`);
    }
    if (isPersonalEmail(authorEmail)) findings.push(`${id}: 作者邮箱是个人地址（地址未输出；改用 users.noreply.<站点>、noreply.<站点>或角色地址）`);
    if (isPersonalEmail(committerEmail)) findings.push(`${id}: 提交者邮箱是个人地址（地址未输出；改用 users.noreply.<站点>、noreply.<站点>或角色地址）`);
  }
  return { ok: findings.length === 0, findings, checked };
}

/**
 * 登记放行：scripts/privacy-exceptions.json，逐条放行「文件 + 精确值」（个人邮箱）或「文件 + 整行内容的摘要」（用户原话形态）。
 * 只存摘要，不存明文：明文邮箱会被本门禁自己命中。不按目录整体豁免；登记过但已经不再命中的条目也报出来，让人删掉。
 */
export const EXCEPTIONS_FILE = 'scripts/privacy-exceptions.json';
const DIGEST_RE = /^[0-9a-f]{64}$/;

const sha256 = text => createHash('sha256').update(text).digest('hex');

/** 校验登记表并返回条目；格式不对直接抛错，不静默忽略。 */
export function parseExceptions(data) {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.exceptions)) throw new Error('隐私登记表的 schemaVersion 必须为 1，且 exceptions 是数组');
  return data.exceptions.map((entry, index) => {
    const where = `隐私登记表第 ${index + 1} 条`;
    if (typeof entry.file !== 'string' || !entry.file || entry.file.startsWith('/') || entry.file.split('/').includes('..')) throw new Error(`${where}：file 必须是仓库内的相对路径`);
    const kinds = ['valueSha256', 'lineSha256'].filter(key => entry[key] !== undefined);
    if (kinds.length !== 1) throw new Error(`${where}：valueSha256 与 lineSha256 只能二选一`);
    if (typeof entry[kinds[0]] !== 'string' || !DIGEST_RE.test(entry[kinds[0]])) throw new Error(`${where}：摘要必须是 64 位小写十六进制`);
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 6) throw new Error(`${where}：必须写理由（至少 6 个字）`);
    if (entry.maxCount !== undefined && !(Number.isInteger(entry.maxCount) && entry.maxCount >= 1)) throw new Error(`${where}：maxCount 必须是正整数`);
    return { file: entry.file, kind: kinds[0], digest: entry[kinds[0]], reason: entry.reason, maxCount: entry.maxCount };
  });
}

/** 读仓库里的登记表；没有这个文件就是没有任何放行。 */
export function readExceptions(repoRoot) {
  const path = resolve(repoRoot, EXCEPTIONS_FILE);
  if (!existsSync(path)) return [];
  return parseExceptions(JSON.parse(readFileSync(path, 'utf8')));
}

/** 扫描仓库（或给定的文件列表）。files 缺省时取 git ls-files，含未跟踪未忽略的文件。 */
export function auditRepository({ repoRoot = root, files, identityDigests, exceptions = readExceptions(repoRoot) } = {}) {
  const candidates = files ?? [
    ...new Set(
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repoRoot, encoding: 'utf8' })
        .split('\0')
        .filter(Boolean),
    ),
  ];
  const findings = [];
  const used = new Set();
  const uses = new Map();
  // 登记带 maxCount 的，超过次数的那几处不放行，照常报出来
  const allowed = (file, kind, digest) => {
    const hit = exceptions.find(item => item.file === file && item.kind === kind && item.digest === digest);
    if (!hit) return false;
    const count = uses.get(hit) ?? 0;
    if (hit.maxCount !== undefined && count >= hit.maxCount) return false;
    uses.set(hit, count + 1);
    used.add(hit);
    return true;
  };
  let checked = 0;
  for (const file of candidates) {
    const path = resolve(repoRoot, file);
    // 符号链接（指向目录或仓库外）不读内容
    if (!existsSync(path) || !lstatSync(path).isFile()) continue;
    const buffer = readFileSync(path);
    if (buffer.includes(0)) continue;
    const text = buffer.toString('utf8');
    if (!UPSTREAM_TEXT_RE.test(file)) {
      const lines = text.split('\n');
      for (const { line, rule } of scanUserQuotes(text)) {
        if (allowed(file, 'lineSha256', sha256(lines[line - 1]))) continue;
        findings.push(`${file}:${line}: ${rule}（命中内容未输出；仓库里不写用户原文，改成批准摘要或「[已脱敏]」）`);
      }
    }
    if (!inScope(file)) continue;
    checked += 1;
    for (const { line, rule, digest } of scanText(text, { identityDigests, notesLayout: file.startsWith('notes/') })) {
      if (digest !== undefined && allowed(file, 'valueSha256', digest)) continue;
      findings.push(`${file}:${line}: ${rule}（命中内容未输出；按规范改成角色描述、「[已脱敏]」或删除）`);
    }
  }
  const audited = new Set(candidates);
  for (const entry of exceptions) {
    if (!used.has(entry) && audited.has(entry.file)) findings.push(`${entry.file}: 登记表里的放行已经不再命中（命中内容未输出；从 ${EXCEPTIONS_FILE} 删掉这一条）`);
  }
  return { ok: findings.length === 0, findings, checked };
}

// 入口判定必须走 realpath：脚本经符号链接启动时，直接比较 resolve(process.argv[1]) 会不相等，
// 导致 CLI 静默不执行却返回 0，被误当作门禁通过（与 check-secrets.mjs 相同）。
function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url;
  } catch {
    return false;
  }
}
function report(result, passed) {
  if (!result.ok) {
    console.error(result.findings.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(passed);
  }
}

if (isDirectRun()) {
  try {
    const flag = process.argv.indexOf('--commits');
    if (flag >= 0) {
      const [base, head, extra] = (process.argv[flag + 1] ?? '').split('..');
      if (!base || !head || extra !== undefined || head.startsWith('.')) throw new Error('用法：node scripts/check-privacy.mjs --commits <base>..<head> [--published <ref>]...');
      const published = process.argv.flatMap((arg, index) => arg === '--published' ? [process.argv[index + 1] ?? ''] : []);
      for (const ref of published) {
        // 引用解析不到时失败，不当成「没有已公开的提交」放行
        try { execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: process.cwd(), stdio: 'ignore' }); } catch { throw new Error(`--published 的引用解析不到：${ref || '（空）'}`); }
      }
      const result = scanCommits({ repoRoot: process.cwd(), range: `${base}..${head}`, published });
      report(result, `提交门禁通过：扫描 ${result.checked} 条提交的说明，以及作者、提交者邮箱。`);
    } else {
      const result = auditRepository();
      report(result, `隐私门禁通过：扫描 ${result.checked} 个规范、文档与代码文件（所有者账号名、本机路径、手机号、令牌形态、个人邮箱、证件号），并核对全仓的用户原话形态。`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
