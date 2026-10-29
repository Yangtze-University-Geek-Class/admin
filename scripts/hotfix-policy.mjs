#!/usr/bin/env node
// 同版本 hotfix：既有正式 tag 是版本锚点，修复身份是 main 上的明确 SHA；不移动 tag、不伪造 rc。
import { execFileSync } from 'node:child_process';
import { realpathSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseReleaseTag, packageVersionAt } from './release-policy.mjs';
import { readEnvironment, deploymentTarget, imageRepositoryPrefix } from './deployment-environment.mjs';
import { WINDOWS_FILE, activeWindows, readRegistryAt, validateWindows } from './hotfix-windows.mjs';

const SHA = /^[a-f0-9]{40}$/;
const git = (repo, ...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 20000 }).trim();

export function planHotfix({ repo = process.cwd(), root = repo, tag, commit, event, ref, workflowSha, issue, now = new Date() }) {
  if (event !== 'workflow_dispatch' || ref !== 'refs/heads/main') throw new Error('hotfix 只允许从 main 手工触发');
  if (!SHA.test(commit ?? '') || workflowSha !== commit) throw new Error('修复 SHA 必须为完整 SHA，且等于本次工作流 SHA');
  if (!/^[1-9]\d*$/.test(String(issue ?? ''))) throw new Error('必须提供已授权的 P0 issue 编号');
  const release = parseReleaseTag(tag);
  if (release?.kind !== 'final') throw new Error('hotfix 只接受既有正式版本 tag');
  if (git(repo, 'rev-parse', 'HEAD') !== commit || git(repo, 'rev-parse', 'refs/remotes/origin/main') !== commit) throw new Error('修复必须精确等于检出的 HEAD 与最新 origin/main');
  // issue 必须是 main 上登记、仍开着、没过期的 P0 hotfix 窗口，并且窗口绑定的正式版本就是这次的 tag
  const registry = readRegistryAt(repo, commit);
  const invalid = registry ? validateWindows(registry) : [`${WINDOWS_FILE} 不存在`];
  if (invalid.length) throw new Error(`hotfix 窗口登记不可用：${invalid.join('；')}`);
  const window = activeWindows(registry, now).find(item => item.issue === Number(issue));
  if (!window) throw new Error(`issue #${issue} 没有开着的 hotfix 窗口（${WINDOWS_FILE} 里没登记、已 closed 或已过期）：先由所有者批准并登记`);
  if (window.tag !== tag) throw new Error(`hotfix 窗口 #${issue} 绑定的是 ${window.tag}，不是 ${tag}`);
  const baseCommit = git(repo, 'rev-parse', `refs/tags/${tag}^{commit}`);
  if (!SHA.test(baseCommit) || baseCommit === commit) throw new Error('hotfix 必须是既有 tag 之后的新修复提交');
  git(repo, 'merge-base', '--is-ancestor', baseCommit, commit);
  if (packageVersionAt(repo, commit) !== release.version || packageVersionAt(repo, baseCommit) !== release.version) throw new Error('hotfix 不允许改变版本号');
  const environment = readEnvironment(root, 'production');
  const target = deploymentTarget('production');
  const stackRoot = environment.values.get('STACK_ROOT');
  return {
    model: 'hotfix', tag, baseCommit, issue: Number(issue), commit,
    version: release.version, releaseVersion: release.version,
    imageTag: commit.slice(0, 12), imageRepository: imageRepositoryPrefix('production'),
    imagesArchive: `yzgc-images-production-${commit.slice(0, 12)}.tar.gz`,
    origin: target.origin, stackRoot, incomingDir: `${stackRoot}/incoming`,
    runtimeEnvFile: environment.runtimeEnvFile, composeProject: environment.values.get('COMPOSE_PROJECT_NAME'),
    environment: 'production', previewTags: [], deploymentAuthorized: false,
  };
}

export async function verifyLive(plan, { fetcher = fetch, repo, token, gitRepo = process.cwd() }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !token) throw new Error('缺少部署证据读取身份');
  const get = async (url, authenticated = false) => {
    const response = await fetcher(url, { headers: authenticated ? { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } : {}, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`部署证据请求失败：HTTP ${response.status}`);
    return response.json();
  };
  const live = await get(`${plan.origin}/release.json`);
  if (live.environment !== 'production' || live.version !== plan.version || !SHA.test(live.commit ?? '')) throw new Error('线上正式版本不是本次 hotfix 对应的版本');
  git(gitRepo, 'merge-base', '--is-ancestor', plan.baseCommit, live.commit);
  git(gitRepo, 'merge-base', '--is-ancestor', live.commit, plan.commit);
  const rows = await get(`https://api.github.com/repos/${repo}/deployments?environment=production&sha=${live.commit}&per_page=100`, true);
  if (!Array.isArray(rows)) throw new Error('生产部署记录格式错误');
  for (const row of rows) {
    if (row.sha !== live.commit || row.environment !== 'production' || row.payload?.tag !== plan.tag) continue;
    const statuses = await get(`https://api.github.com/repos/${repo}/deployments/${row.id}/statuses?per_page=1`, true);
    if (statuses[0]?.state === 'success') return { rollbackCommit: live.commit, deploymentId: row.id, tag: plan.tag };
  }
  throw new Error('当前生产提交没有同版本成功部署记录');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'plan') {
    if (args.length) throw new Error('plan 只从工作流进程环境接收参数');
    const plan = planHotfix({ tag: process.env.RELEASE_TAG, commit: process.env.HOTFIX_COMMIT, event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, workflowSha: process.env.GITHUB_SHA, issue: process.env.HOTFIX_ISSUE });
    console.log(JSON.stringify(plan, null, 2));
  } else if (command === 'verify-live' && args.length === 1) {
    const plan = JSON.parse(readFileSync(args[0], 'utf8'));
    // 重新检查 refs 与版本，等待审批期间 main 或 tag 漂移时停止，不能部署旧计划。
    const current = planHotfix({ tag: plan.tag, commit: plan.commit, event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, workflowSha: process.env.GITHUB_SHA, issue: plan.issue });
    if (current.baseCommit !== plan.baseCommit || current.origin !== plan.origin) throw new Error('hotfix 计划的版本锚点或环境已漂移');
    console.log(JSON.stringify(await verifyLive(current, { repo: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN })));
  } else throw new Error('usage: hotfix-policy.mjs plan | verify-live <plan.json>');
}
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
