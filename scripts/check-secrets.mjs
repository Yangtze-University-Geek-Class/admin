#!/usr/bin/env node
/**
 * 密钥门禁：仓库里**永远不能出现真实密钥**。
 *
 * 允许入库的模板型 env 文件只有一个家族：`deploy/env/.env.<environment>`（以及 `.env.example`）。
 * 它们只写地址/端口/域名/开关，密钥字段必须留空，由 CI 用环境级 secrets 渲染到目标机。
 *
 * 硬失败条件：
 *   1. 根 `.env`、`.env.local`、`.env.<environment>.local` 等本地/私有 env 文件被纳入版本控制。
 *   2. 任何被扫描文本文件里出现「密钥名 = 非空值」（SECRET / TOKEN / PASSWORD / ENCRYPTION_KEY / SSH_KEY…）。
 *   3. sshpass 内联口令、私钥材料、GitHub token 形态的字符串。
 *   4. `.db` / SQLite 旁路文件进入版本控制。
 *
 * 只读 `git ls-files` 的结果；不读 Git 历史、不联网、不改文件。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 允许入库的模板 env：deploy/env/.env.<environment> 与根 .env.example。 */
const TEMPLATE_ENV_RE = /^(?:deploy\/env\/\.env\.[a-z]+|\.env\.example)$/;
/** 明确禁止入库的私有 env 形态。 */
const FORBIDDEN_ENV_RES = [
  /(?:^|\/)\.env$/,
  /(?:^|\/)\.env\.local$/,
  /(?:^|\/)\.env\.[a-z0-9-]+\.local$/,
];
/** 键名长得像密钥：一旦有非空值即失败（SITE_KEY 之类的公开键不在列表里）。 */
const SECRET_KEY_RE = /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|ENCRYPTION_KEY|SSH_KEY|PRIVATE_KEY)(?:_|$)/i;
const TEXT_EXTENSIONS = new Set(['.md', '.mdc', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.sh', '.bash', '.conf', '.toml', '.env', '.example']);
const PATTERN_RULES = [
  { name: 'inline SSH password', pattern: /sshpass\s+-p\s+(?:'[^']+'|"[^"]+")/ },
  { name: 'private key material', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/ },
];

/** 逐行解析 KEY=VALUE，返回 [行号, 键, 值]；注释与空行跳过。 */
export function parseAssignments(text) {
  const assignments = [];
  text.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) return;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) return;
    let value = trimmed.slice(separator + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    assignments.push({ line: index + 1, key, value });
  });
  return assignments;
}

/** 扫描一个文件的内容，返回问题描述列表。 */
export function scanText(file, text) {
  const findings = [];
  const isTemplateEnv = TEMPLATE_ENV_RE.test(file);
  if (isTemplateEnv) {
    for (const { line, key, value } of parseAssignments(text)) {
      if (SECRET_KEY_RE.test(key) && value) {
        findings.push(`${file}:${line}: ${key} 在模板 env 里必须留空（真实值只经环境级 secrets 注入）[REDACTED]`);
      }
    }
  }
  text.split('\n').forEach((line, index) => {
    for (const rule of PATTERN_RULES) {
      if (rule.pattern.test(line)) findings.push(`${file}:${index + 1}: ${rule.name} [REDACTED]`);
    }
  });
  return findings;
}

export function auditRepository({ repoRoot = root } = {}) {
  const files = [
    ...new Set(
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repoRoot, encoding: 'utf8' })
        .split('\0')
        .filter(Boolean),
    ),
  ];
  const findings = [];
  let checked = 0;
  for (const file of files) {
    if (FORBIDDEN_ENV_RES.some(pattern => pattern.test(file))) {
      findings.push(`${file}: 私有 env 文件禁止入库（模板只能是 deploy/env/.env.<environment>）`);
      continue;
    }
    if (/(?:^|\/)\.env(?:\.|$)/.test(file) && !TEMPLATE_ENV_RE.test(file)) {
      findings.push(`${file}: 只允许 deploy/env/.env.<environment> 这类模板 env 入库`);
      continue;
    }
    if (/\.(?:db|db-wal|db-shm|sqlite3?)$/.test(file)) {
      findings.push(`${file}: 数据库文件禁止入库`);
      continue;
    }
    const isEnvFile = /(?:^|\/)\.env/.test(file) || file.endsWith('.example');
    if (!isEnvFile && !TEXT_EXTENSIONS.has(extname(file))) continue;
    const path = resolve(repoRoot, file);
    if (!existsSync(path)) continue;
    checked += 1;
    findings.push(...scanText(file, readFileSync(path, 'utf8')));
  }
  return { ok: findings.length === 0, findings, checked, files: files.length };
}

// 入口判定必须走 realpath：脚本经符号链接路径启动时，直接比较 resolve(process.argv[1]) 会不相等，
// 导致 CLI 静默不执行却返回 0，被误当作门禁通过。
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
    const result = auditRepository();
    if (!result.ok) {
      console.error(result.findings.join('\n'));
      process.exitCode = 1;
    } else {
      console.log(
        `密钥门禁通过：扫描 ${result.checked} 个项目文本文件（共 ${result.files} 个入库/未忽略文件）；`
          + '模板 env 只允许 deploy/env/.env.<environment> 且密钥字段必须留空；未读取 Git 历史。',
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
