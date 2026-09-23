#!/usr/bin/env node
/**
 * 发布身份规划器（**分支模型**，只读）：分支 → 环境 → 镜像/产物/目录身份。
 *
 * 与旧 tag 模型的关系：tag、版本里程碑、prev/release 前缀、@sha 增量全部退役。
 * 发布身份只有两个输入——分支（main → production，stage → preview）与 commit SHA（tag = SHA 前 12 位）。
 * 本脚本不创建 tag、不写文件、不连接服务器、不授予任何批准。
 *
 * 用法：
 *   node scripts/release-policy.mjs plan --branch <main|stage> --commit <40位SHA> \
 *     [--origin <https://...>] [--root <仓库根>] [--tip-ref <ref>] [--no-tip-check]
 *
 * stdout 只输出 JSON（供流水线 jq 消费），人类可读的结论走 stderr。
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deploymentTarget, readEnvironment, repositoryRoot } from './deployment-environment.mjs';

/** 分支 → 环境的唯一映射（长期分支只有这两条）。 */
export const BRANCH_ENVIRONMENTS = Object.freeze({ main: 'production', stage: 'preview' });
const SHA_RE = /^[a-f0-9]{40}$/;
const TAG_SWITCHES = new Map([
  ['--tag', 'tag'],
  ['--base-tag', '基准 tag'],
  ['--version', '版本'],
  ['--display-version', '展示版本'],
  ['--approved', '批准开关'],
  ['--approve', '批准开关'],
]);

function git(repo, args) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 20000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw new Error(`无法执行 git ${args.join(' ')}：${result.error.message}`);
  return result;
}

function resolveRef(repo, ref) {
  const result = git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  const value = (result.stdout ?? '').trim();
  return result.status === 0 && SHA_RE.test(value) ? value : null;
}

function packageVersion(root) {
  const path = resolve(root, 'package.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取 ${path}：${error.message}`);
  }
  const version = manifest.version;
  if (typeof version !== 'string' || !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(version)) {
    throw new Error(`package.json 的 version 必须是 X.Y.Z：${version}`);
  }
  return version;
}

/**
 * 规划一次部署身份。所有取值都来自显式参数 + 仓库内的环境契约；没有默认环境，也没有 tag 语义。
 */
export function planDeployment({ repo = process.cwd(), root = repo, branch, commit, origin, tipRef, checkTip = true } = {}) {
  if (typeof branch !== 'string' || !Object.hasOwn(BRANCH_ENVIRONMENTS, branch)) {
    throw new Error('只有 main（正式）与 stage（预发布）参与部署；task/<issue>/<slug> 与 dev/<username> 分支只做验证，永不部署。');
  }
  if (typeof commit !== 'string' || !SHA_RE.test(commit)) {
    throw new Error('必须提供准确的 40 位小写 commit SHA；不接受 tag、分支名或短 SHA。');
  }
  const environment = BRANCH_ENVIRONMENTS[branch];
  const notes = [];
  const resolved = resolveRef(repo, commit);
  if (resolved !== commit) throw new Error(`本地对象库里找不到该提交：${commit}（不会自动 fetch，也不会猜测）`);
  const version = packageVersion(root);
  const deployment = readEnvironment(root, environment);
  const target = deploymentTarget(environment, origin);
  const shortCommit = commit.slice(0, 12);
  // 发布身份只由分支决定：preview 展示 `X.Y.Z@<sha12>`，production 禁止 @ 后缀。
  // 这两个值以 build args 形式传进镜像构建（env 文件里不写死，见 deployment-environment 的契约校验）。
  const releaseVersion = environment === 'preview' ? `${version}@${shortCommit}` : version;
  if (checkTip) {
    const candidates = tipRef ? [tipRef] : [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`];
    const tip = candidates.map(ref => ({ ref, sha: resolveRef(repo, ref) })).find(entry => entry.sha) ?? null;
    if (!tip) notes.push(`无法解析 ${candidates.join(' 或 ')}：跳过「必须是分支 tip」校验。`);
    else if (tip.sha !== commit) {
      throw new Error(`部署只接受分支 tip：${tip.ref} 是 ${tip.sha.slice(0, 12)}，传入的是 ${shortCommit}。`);
    } else notes.push(`${shortCommit} 是 ${tip.ref} 的当前 tip。`);
  }
  const stackRoot = deployment.values.get('STACK_ROOT');
  const composeProject = deployment.values.get('COMPOSE_PROJECT_NAME');
  if (!stackRoot || !composeProject) throw new Error(`${deployment.relativePath} 缺少 STACK_ROOT 或 COMPOSE_PROJECT_NAME`);
  const identity = {
    model: 'branch',
    branch,
    environment,
    githubEnvironment: target.githubEnvironment,
    origin: target.origin,
    commit,
    shortCommit,
    imageTag: shortCommit,
    imagePrefix: 'yzgc',
    images: {
      server: `yzgc/server:${shortCommit}`,
      web: `yzgc/web:${shortCommit}`,
      forum: `yzgc/forum:${shortCommit}`,
    },
    imagesArchive: `yzgc-images-${environment}-${shortCommit}.tar.gz`,
    version,
    releaseVersion,
    envTemplate: deployment.relativePath,
    runtimeEnvFile: deployment.runtimeEnvFile,
    stackRoot,
    incomingDir: `${stackRoot}/incoming`,
    composeProject,
    composeFile: `deploy/compose/${environment}.yml`,
    remoteComposeFile: `${stackRoot}/deploy/compose/${environment}.yml`,
    enableVar: `DEPLOY_${environment.toUpperCase()}_ENABLED`,
    sentinelVar: 'DEPLOY_TARGET_ENVIRONMENT',
    requiresPriorPreviewEvidence: environment === 'production',
    buildEnv: {
      GEEK_DEPLOYMENT_ENVIRONMENT: environment,
      GEEK_RELEASE_VERSION: releaseVersion,
      GEEK_RELEASE_COMMIT: commit,
    },
    webConfigEnvironment: environment,
    tagSemantics: false,
    evidence: 'local-git-only',
    deploymentAuthorized: false,
    notes,
    warning: '分支身份与本地 Git 证据通过不等于人工试用或部署成功；部署开关、环境审批与健康检查仍必须真实配置。',
  };
  return identity;
}

const USAGE = `发布身份规划（只读，分支模型）：
  node scripts/release-policy.mjs plan --branch <main|stage> --commit <40位SHA> \\
    [--origin <https://...>] [--root <仓库根>] [--repo <Git 仓库>] [--tip-ref <ref>] [--no-tip-check]

main → production（https://yangtzeu.work）；stage → preview（https://prev.yangtzeu.work）。
不接受 tag / 版本里程碑 / 批准开关：部署身份只由分支 + commit SHA 决定。`;

function parseOptions(argv) {
  const options = { root: repositoryRoot(), checkTip: true };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (TAG_SWITCHES.has(arg)) {
      throw new Error(`不接受 ${TAG_SWITCHES.get(arg)} 参数：分支模型没有 tag/版本发布语义，部署身份只由分支 + commit SHA 决定。`);
    }
    const value = argv[index + 1];
    if (arg === '--no-tip-check') {
      options.checkTip = false;
      continue;
    }
    if (!['--branch', '--commit', '--origin', '--root', '--repo', '--tip-ref'].includes(arg)) throw new Error(`未知参数：${arg}`);
    if (!value || value.startsWith('--')) throw new Error(`${arg} 需要取值`);
    index += 1;
    options[arg.slice(2)] = value;
  }
  if (options.repo) options.repo = resolve(options.repo);
  if (options.root) options.root = resolve(options.root);
  if (!options.branch) throw new Error('必须显式指定 --branch（没有默认分支映射）');
  if (!options.commit) throw new Error('必须显式指定 --commit（40 位小写 SHA）');
  return options;
}

function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    if (!command) throw new Error('缺少子命令：plan');
    return;
  }
  if (command !== 'plan') throw new Error(`未知子命令：${command}（只有 plan；tag/preview 等旧模式已退役）`);
  const identity = planDeployment(parseOptions(rest));
  for (const note of identity.notes) console.error(`[证据] ${note}`);
  console.error(
    `${identity.branch} → ${identity.environment}（${identity.origin}）：镜像 tag ${identity.imageTag}，`
      + `产物 ${identity.imagesArchive}，发布版本 ${identity.releaseVersion}，开关 ${identity.enableVar}。`,
  );
  console.log(JSON.stringify(identity, null, 2));
}

// 入口判定必须走 realpath：脚本经符号链接路径启动时，直接比较 resolve(process.argv[1]) 会不相等，
// 导致 CLI 静默不执行却返回 0，被误当作规划通过。
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
