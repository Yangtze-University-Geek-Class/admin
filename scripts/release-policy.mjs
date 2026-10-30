#!/usr/bin/env node
/**
 * 发布身份规划器（**tag 模型**，只读）：发布 tag + commit → 环境 → 镜像/产物/目录身份。
 *
 * 发布 tag 有四种（SemVer 写法）：
 *   vX.Y.Z-rc.N      预发布（N ≥ 1）：提交必须在 stage 上 → preview，展示 `X.Y.Z-rc.N@<sha12>`
 *   vX.Y.Z-hf.N      预发布（N ≥ 1）：把 main 的热修复合进 stage 的那个合并提交 → preview，展示 `X.Y.Z-hf.N@<sha12>`
 *   vX.Y.Z-stable.N  预发布（N ≥ 1）：把 hotfix 窗口收尾登记合进 stage 的那个合并提交 → preview，展示 `X.Y.Z-stable@<sha12>`（不带 N）
 *   vX.Y.Z           正式：提交必须在 main 上，且同一提交上有 vX.Y.Z-rc.N（hf / stable 不算）→ production，展示 `X.Y.Z`
 * 预发布三种都必须在 stage 的提交上（origin/stage 的祖先或等于它）；X.Y.Z 必须等于该提交里根 package.json 的 version。
 * hf / stable 的 N 按 (X.Y.Z, 种类) 分别从 1 计数，不跳号、不复用；提交形态也由 hotfixTagProblems 核对。
 * 本脚本不创建 tag、不写文件、不连接服务器、不授予任何批准；「同一提交先成功预发布」由部署工作流的证据 job 核对。
 *
 * 用法：
 *   node scripts/release-policy.mjs plan --tag <发布 tag> --commit <40位SHA> \
 *     [--origin <https://...>] [--root <仓库根>] [--repo <Git 仓库>] [--branch-ref <ref>] [--require-tag]
 *
 * stdout 只输出 JSON（供流水线 jq 消费），人类可读的结论走 stderr。
 */

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  IMAGE_SERVICES,
  deploymentTarget,
  imageReference,
  imageRepositoryPrefix,
  readEnvironment,
  repositoryRoot,
} from './deployment-environment.mjs';
import { WINDOWS_FILE, readRegistryAt, validateWindows, windowOf } from './hotfix-windows.mjs';
import { commitsBetween } from './promotion-windows.mjs';

/**
 * 发布 tag 的唯一正则：RELEASES.md 的 tag 表逐字引用它（测试核对两处一致）。
 * 第 4 组是预发布种类（rc / hf / stable，缺省为正式），第 5 组是 N。
 */
export const RELEASE_TAG_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(rc|hf|stable)\.([1-9]\d*))?$/;
/** tag 种类 → 环境与提交必须所在的长期分支。 */
export const TAG_KINDS = Object.freeze({
  rc: Object.freeze({ environment: 'preview', branch: 'stage' }),
  hf: Object.freeze({ environment: 'preview', branch: 'stage' }),
  stable: Object.freeze({ environment: 'preview', branch: 'stage' }),
  final: Object.freeze({ environment: 'production', branch: 'main' }),
});
const SHA_RE = /^[a-f0-9]{40}$/;
const VERSION_RE = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const RETIRED_SWITCHES = new Map([
  ['--branch', '分支参数：push stage / main 不再部署，发版改由发布 tag 触发，请用 --tag'],
  ['--base-tag', '基准 tag 参数'],
  ['--version', '版本参数：版本号只取自 tag，并且必须等于提交里 package.json 的 version'],
  ['--display-version', '展示版本参数：展示值由 tag 与 commit 推导'],
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

function isAncestor(repo, earlier, later) {
  const result = git(repo, ['merge-base', '--is-ancestor', earlier, later]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`无法判定祖先关系（${earlier} → ${later}）：${(result.stderr ?? '').trim()}`);
}

/** 解析发布 tag；不合规返回 null（调用方决定报错措辞）。number 是预发布的 N（正式为 null），rc 只在 rc 种类上有值。 */
export function parseReleaseTag(tag) {
  if (typeof tag !== 'string') return null;
  const match = RELEASE_TAG_RE.exec(tag);
  if (!match) return null;
  const kind = match[4] ?? 'final';
  const number = match[5] ? Number(match[5]) : null;
  return {
    tag,
    kind,
    version: `${match[1]}.${match[2]}.${match[3]}`,
    number,
    rc: kind === 'rc' ? number : null,
    ...TAG_KINDS[kind],
  };
}

/** 展示版本的主体（不含 `@<sha12>`）：rc / hf 带 N；stable 不带 N（所有者定的写法）；正式就是 X.Y.Z。 */
export function displayBodyOf({ kind, version, number }) {
  if (kind === 'final') return version;
  if (kind === 'stable') return `${version}-stable`;
  return `${version}-${kind}.${number}`;
}

/** 同一 X.Y.Z、同一种类下，下一个没用过的 N（从 1 开始）。tagNames 里的同名 tag 与别的版本不计。选号与核对共用这一个判定。 */
export function nextPreviewNumber(tagNames, { version, kind }) {
  const used = tagNames
    .map(name => parseReleaseTag(name))
    .filter(item => item?.kind === kind && item.version === version)
    .map(item => item.number);
  return Math.max(0, ...used) + 1;
}

function parentsOf(repo, commit) {
  const result = git(repo, ['rev-list', '--parents', '-n', '1', commit]);
  return result.status === 0 ? (result.stdout ?? '').trim().split(/\s+/).slice(1) : [];
}

const registryAt = (repo, rev) => { try { return readRegistryAt(repo, rev); } catch { return null; } };

/**
 * commit 是不是「把 main 合进 stage」的合并提交：返回第一父提交和合进来的那个 main 提交，不是返回 null。
 * 合进来的父提交要带来第一父没有的提交，并且在 main（mainSha）的历史里。
 */
export function mainMergeOf(repo, commit, mainSha) {
  const [first, ...others] = parentsOf(repo, commit);
  if (!first || !mainSha) return null;
  const merged = others.find(parent => !isAncestor(repo, parent, first) && isAncestor(repo, parent, mainSha));
  return merged ? { first, merged } : null;
}

/**
 * hf / stable 的专属规则（rc 与正式 tag 的检查仍在各自原处）：
 *   · 只用于已经正式发布过的版本：tagNames 里必须有 v<X.Y.Z>；
 *   · N 从 1 开始、不跳号、不复用：isNew（这个 tag 还没打过）时，N 必须是同组已用最大值加一；已存在的 tag 不再核对 N；
 *   · 只打在把 main 合进 stage 的合并提交上（mainSha 是 main 的位置，拿不到就拒绝）；
 *   · hf：合进来的 main 提交里至少有一个归属 v<X.Y.Z> 的 hotfix 窗口（按合进来那一版 main 的登记，晋升窗口挑过去的不算）；
 *   · stable：这个提交上的登记合规，并且比第一父提交多关闭了一个 tag 为 v<X.Y.Z> 的窗口（窗口只在生产验收之后才关）。
 * 这些判定只看提交本身，不看当前时间：同一个 tag 以后重跑部署，结论不变。
 * tagNames 是已知的全部 tag 名（本地与远端合并）。返回问题列表，空 = 通过。
 */
export function hotfixTagProblems({ repo, release, commit, tagNames, isNew, mainSha }) {
  const problems = [];
  const short = commit.slice(0, 12);
  if (!tagNames.includes(`v${release.version}`)) {
    problems.push(`${release.tag} 所属的版本 ${release.version} 还没有正式 tag v${release.version}：hf / stable 只用于已经正式发布过的版本`);
  }
  const others = tagNames.filter(name => name !== release.tag);
  const next = nextPreviewNumber(others, release);
  if (isNew && release.number !== next) {
    problems.push(`${release.tag} 的 N 必须是 ${next}：${release.version} 的 ${release.kind} 已用到 ${next - 1}，N 从 1 开始、不跳号、不复用`);
  }
  if (!mainSha) {
    problems.push(`本地没有 main 的引用，确认不了 ${short} 合进来的是 main（先 git fetch origin main）`);
    return problems;
  }
  const merge = mainMergeOf(repo, commit, mainSha);
  if (!merge) {
    problems.push(`${release.tag} 只打在把 main 合进 stage 的合并提交上：${short} 不是合并提交，或者它合进来的提交不在 main（${mainSha.slice(0, 12)}）的历史里`);
    return problems;
  }
  if (release.kind === 'hf') {
    const windows = (registryAt(repo, merge.merged)?.windows ?? []).filter(item => item.tag === `v${release.version}`);
    let entries = [];
    try {
      entries = commitsBetween(repo, merge.first, merge.merged);
    } catch (error) {
      problems.push(error.message);
    }
    if (!entries.some(entry => windowOf(entry.sha, entry.message, windows, entry.committedAt))) {
      problems.push(`${release.tag} 所在提交 ${short} 合进来的 main 提交都不归属 v${release.version} 的 hotfix 窗口（${WINDOWS_FILE}）：不是热修复的合回不打 hf`);
    }
  }
  if (release.kind === 'stable') {
    let registry = null;
    try {
      registry = readRegistryAt(repo, commit);
    } catch (error) {
      problems.push(`${WINDOWS_FILE} 在提交 ${short} 上读不出来：${error.message}`);
    }
    const invalid = registry ? validateWindows(registry, { legacy: true }) : [];
    if (invalid.length) problems.push(`${WINDOWS_FILE} 在提交 ${short} 上不合规：${invalid.join('；')}`);
    const closedBefore = new Set((registryAt(repo, merge.first)?.windows ?? []).filter(item => item.status === 'closed').map(item => item.issue));
    const closing = (registry?.windows ?? []).filter(item => item.status === 'closed' && item.tag === `v${release.version}` && !closedBefore.has(item.issue));
    if (!closing.length) {
      problems.push(`${release.tag} 所在提交 ${short} 没有新关闭的 v${release.version} hotfix 窗口（${WINDOWS_FILE}；第一父提交 ${merge.first.slice(0, 12)} 上已经关过的不算）：stable 只打在收尾登记合回 stage 的那个提交上`);
    }
  }
  return problems;
}

/** 读取某个提交里根 package.json 的 version（不看工作区，避免未提交改动冒充发布版本）。 */
export function packageVersionAt(repo, commit) {
  const result = git(repo, ['show', `${commit}:package.json`]);
  if (result.status !== 0) throw new Error(`提交 ${commit.slice(0, 12)} 里读不到根 package.json`);
  let manifest;
  try {
    manifest = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`提交 ${commit.slice(0, 12)} 的 package.json 不是合法 JSON：${error.message}`);
  }
  const version = manifest?.version;
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    throw new Error(`提交 ${commit.slice(0, 12)} 的 package.json version 必须是 X.Y.Z：${version}`);
  }
  return version;
}

/** 列出本地所有 tag 与它们最终指向的提交（附注 tag 取剥开后的对象）。 */
export function listTagCommits(repo) {
  const result = git(repo, ['for-each-ref', '--format=%(refname:strip=2)%09%(objectname)%09%(*objectname)', 'refs/tags']);
  if (result.status !== 0) throw new Error(`无法枚举 tag：${(result.stderr ?? '').trim()}`);
  return (result.stdout ?? '')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [name, object, peeled] = line.split('\t');
      return { name, commit: peeled || object };
    });
}

/** 同一提交上、同一 X.Y.Z 的预发布 tag（按 N 升序）：正式发布前必须至少有一个。 */
export function previewTagsFor(repo, version, commit) {
  return listTagCommits(repo)
    .map(entry => ({ ...entry, release: parseReleaseTag(entry.name) }))
    .filter(entry => entry.release?.kind === 'rc' && entry.release.version === version && entry.commit === commit)
    .sort((left, right) => left.release.rc - right.release.rc)
    .map(entry => entry.name);
}

/**
 * 规划一次部署身份。所有取值都来自显式参数 + 仓库内的环境契约 + 本地 Git 证据；没有默认环境。
 */
export function planDeployment({ repo = process.cwd(), root = repo, tag, commit, origin, branchRef, mainRef, requireTag = false } = {}) {
  const release = parseReleaseTag(tag);
  if (!release) {
    throw new Error(
      `发布 tag 只接受 vX.Y.Z-rc.N / vX.Y.Z-hf.N / vX.Y.Z-stable.N（预发布，N 从 1 开始）或 vX.Y.Z（正式），正则 ${RELEASE_TAG_RE}；`
        + `收到 ${JSON.stringify(tag ?? null)}。分支名、latest、短 SHA 都不是发布 tag。`,
    );
  }
  if (typeof commit !== 'string' || !SHA_RE.test(commit)) {
    throw new Error('必须提供准确的 40 位小写 commit SHA；不接受 tag、分支名或短 SHA。');
  }
  const { environment, branch, version } = release;
  const notes = [];
  if (resolveRef(repo, commit) !== commit) throw new Error(`本地对象库里找不到该提交：${commit}（不会自动 fetch，也不会猜测）`);
  const shortCommit = commit.slice(0, 12);

  const tagRef = `refs/tags/${tag}`;
  const tagged = resolveRef(repo, tagRef);
  if (tagged && tagged !== commit) {
    throw new Error(`${tag} 指向 ${tagged.slice(0, 12)}，传入的是 ${shortCommit}：发布 tag 与提交必须一致，tag 不可移动。`);
  }
  if (!tagged) {
    if (requireTag) throw new Error(`本地找不到 ${tagRef}：部署必须从已推送的发布 tag 出发（checkout 请使用 fetch-depth: 0）。`);
    notes.push(`本地还没有 ${tagRef}：只按传入的提交规划。`);
  } else notes.push(`${tagRef} 指向 ${shortCommit}。`);

  const packageVersion = packageVersionAt(repo, commit);
  if (packageVersion !== version) {
    throw new Error(
      `${tag} 的版本 ${version} 与提交 ${shortCommit} 里 package.json 的 version ${packageVersion} 不一致：`
        + `先用 task PR 把 version 改成 ${version} 并合进 stage，再在那个提交上打 tag。`,
    );
  }

  const candidates = branchRef ? [branchRef] : [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`];
  const base = candidates.map(ref => ({ ref, sha: resolveRef(repo, ref) })).find(entry => entry.sha) ?? null;
  if (!base) throw new Error(`无法解析 ${candidates.join(' 或 ')}：确认不了 ${tag} 打在 ${branch} 的提交上，拒绝规划（不会自动 fetch）。`);
  if (!isAncestor(repo, commit, base.sha)) {
    throw new Error(
      `${release.kind === 'final' ? '正式' : '预发布'} tag ${tag} 必须打在 ${branch} 的提交上：`
        + `${shortCommit} 不在 ${base.ref}@${base.sha.slice(0, 12)} 的历史里。`,
    );
  }
  notes.push(`${shortCommit} 在 ${base.ref}@${base.sha.slice(0, 12)} 的历史里。`);

  let previewTags = [];
  if (release.kind === 'rc') {
    // 同一版本已经正式发布过，再发它的预发布就会把旧版本号重新推回预发布：必须先升版本。
    if (listTagCommits(repo).some(entry => entry.name === `v${version}`)) {
      throw new Error(`v${version} 已有正式 tag：同一版本不能再发预发布，先用 task PR 升 package.json 的 version。`);
    }
  } else if (release.kind === 'hf' || release.kind === 'stable') {
    // 热修复之后的预发布：版本必须已经有正式 tag（vX.Y.Z），N 与 stable 的窗口登记由 hotfixTagProblems 核对。
    const mainSha = (mainRef ? [mainRef] : ['refs/remotes/origin/main', 'refs/heads/main']).map(ref => resolveRef(repo, ref)).find(Boolean) ?? null;
    const problems = hotfixTagProblems({ repo, release, commit, tagNames: listTagCommits(repo).map(entry => entry.name), isNew: !tagged, mainSha });
    if (problems.length) throw new Error(`${tag} 不能在提交 ${shortCommit} 上发布：${problems.join('；')}。`);
    notes.push(`${tag} 是热修复之后的预发布（${release.kind}），不计入正式发布的 rc 证据。`);
  } else {
    // 正式 tag 必须和某个 vX.Y.Z-rc.N 落在同一提交上：先预发布、后正式。预发布部署是否成功、
    // 预发布站点是否就是这个提交，由 deploy-production 的证据 job 读 GitHub 与 release.json 再核对。
    // hf / stable 不算：它们不是 rc，previewTagsFor 只认 rc。
    previewTags = previewTagsFor(repo, version, commit);
    if (!previewTags.length) {
      throw new Error(
        `正式 tag ${tag} 所在提交 ${shortCommit} 上没有 v${version}-rc.N：正式版只能发在已经发过预发布的同一提交上`
          + '（本地缺 tag 时先 git fetch --tags）。',
      );
    }
    notes.push(`同一提交上的预发布 tag：${previewTags.join('、')}。`);
  }

  const deployment = readEnvironment(root, environment);
  const target = deploymentTarget(environment, origin);
  // 展示版本：preview `X.Y.Z-rc.N@<sha12>` / `X.Y.Z-hf.N@<sha12>` / `X.Y.Z-stable@<sha12>`，production `X.Y.Z`（禁止任何后缀）。
  // 这两个值以 build args 形式传进镜像构建（env 文件里不写死，见 deployment-environment 的契约校验）。
  const releaseVersion = release.kind === 'final' ? version : `${displayBodyOf(release)}@${shortCommit}`;
  const stackRoot = deployment.values.get('STACK_ROOT');
  const composeProject = deployment.values.get('COMPOSE_PROJECT_NAME');
  if (!stackRoot || !composeProject) throw new Error(`${deployment.relativePath} 缺少 STACK_ROOT 或 COMPOSE_PROJECT_NAME`);
  return {
    model: 'tag',
    tag,
    tagKind: release.kind,
    rc: release.rc,
    branch,
    containedIn: base.ref,
    environment,
    githubEnvironment: target.githubEnvironment,
    origin: target.origin,
    commit,
    shortCommit,
    imageTag: shortCommit,
    // 镜像仓库按环境分开（yzgc-preview/… 与 yzgc-production/…）：两套栈共用一个 Docker 守护进程，
    // 同一提交的两次构建参数不同，共用镜像名会互相覆盖。IMAGE_TAG 仍是提交的 12 位 SHA。
    imageRepository: imageRepositoryPrefix(environment),
    images: Object.fromEntries(IMAGE_SERVICES.map(service => [service, imageReference(environment, service, shortCommit)])),
    imagesArchive: `yzgc-images-${environment}-${shortCommit}.tar.gz`,
    version,
    releaseVersion,
    previewTags,
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
    evidence: 'local-git-only',
    deploymentAuthorized: false,
    notes,
    warning: 'tag 与本地 Git 证据通过不等于人工试用或部署成功；部署开关、环境审批、预发布证据与健康检查仍必须真实成立。',
  };
}

const USAGE = `发布身份规划（只读，tag 模型）：
  node scripts/release-policy.mjs plan --tag <vX.Y.Z-rc.N|vX.Y.Z-hf.N|vX.Y.Z-stable.N|vX.Y.Z> --commit <40位SHA> \\
    [--origin <https://...>] [--root <仓库根>] [--repo <Git 仓库>] [--branch-ref <ref>] [--require-tag]

vX.Y.Z-rc.N / -hf.N / -stable.N → preview（https://prev.yangtzeu.work），提交必须在 stage 上；
vX.Y.Z → production（https://yangtzeu.work），提交必须在 main 上，且同一提交上有 vX.Y.Z-rc.N。
X.Y.Z 必须等于该提交里 package.json 的 version；不接受分支参数、版本参数或批准开关。`;

function parseOptions(argv) {
  const options = { root: repositoryRoot(), requireTag: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (RETIRED_SWITCHES.has(arg)) throw new Error(`不接受${RETIRED_SWITCHES.get(arg)}。`);
    if (arg === '--require-tag') {
      options.requireTag = true;
      continue;
    }
    const value = argv[index + 1];
    if (!['--tag', '--commit', '--origin', '--root', '--repo', '--branch-ref'].includes(arg)) throw new Error(`未知参数：${arg}`);
    if (!value || value.startsWith('--')) throw new Error(`${arg} 需要取值`);
    index += 1;
    options[arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
  }
  if (options.repo) options.repo = resolve(options.repo);
  if (options.root) options.root = resolve(options.root);
  if (!options.tag) throw new Error('必须显式指定 --tag（vX.Y.Z-rc.N 或 vX.Y.Z）');
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
  if (command !== 'plan') throw new Error(`未知子命令：${command}（只有 plan；旧的 preview/tag 子命令已退役）`);
  const identity = planDeployment(parseOptions(rest));
  for (const note of identity.notes) console.error(`[证据] ${note}`);
  console.error(
    `${identity.tag} → ${identity.environment}（${identity.origin}）：镜像 ${identity.imageRepository}/<服务>:${identity.imageTag}，`
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
