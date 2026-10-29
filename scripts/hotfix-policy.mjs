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

/** 部署 API 读取 commit status，不读取 Actions check；只投影本次运行已经成功的真实检查。 */
export async function publishVerifiedCheck(plan, { repo, token, runId, runAttempt, fetcher = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !token || !SHA.test(plan?.commit ?? '')
    || !/^[1-9]\d*$/.test(String(runId ?? '')) || !/^[1-9]\d*$/.test(String(runAttempt ?? ''))) {
    throw new Error('缺少明确的 hotfix 检查来源');
  }
  const base = `https://api.github.com/repos/${repo}`;
  const request = async (path, body) => {
    const response = await fetcher(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`检查来源请求失败：HTTP ${response.status}`);
    return response.json();
  };
  const run = await request(`/actions/runs/${runId}`);
  if (run.id !== Number(runId) || run.run_attempt !== Number(runAttempt) || run.head_sha !== plan.commit
    || run.event !== 'workflow_dispatch' || run.head_branch !== 'main' || run.status !== 'in_progress'
    || run.path !== '.github/workflows/deploy-hotfix.yml' || run.repository?.full_name?.toLowerCase() !== repo.toLowerCase()
    || !Number.isSafeInteger(run.check_suite_id)) throw new Error('hotfix 运行来源与当前计划不一致');
  const page = await request(`/actions/runs/${runId}/jobs?filter=latest&per_page=100`);
  if (!Array.isArray(page.jobs) || page.total_count !== page.jobs.length) throw new Error('hotfix job 列表不完整');
  const jobs = page.jobs.filter(job => job.name === 'hotfix-verify');
  if (jobs.length !== 1) throw new Error('本次 hotfix-verify 检查不唯一或缺失');
  const job = jobs[0];
  if (!Number.isSafeInteger(job.id) || job.run_id !== run.id || job.head_sha !== plan.commit
    || !Number.isSafeInteger(job.run_attempt) || job.run_attempt < 1 || job.run_attempt > run.run_attempt
    || job.status !== 'completed' || job.conclusion !== 'success'
    || job.check_run_url !== `${base}/check-runs/${job.id}`) throw new Error('本次 hotfix-verify 尚未成功');
  const check = await request(`/check-runs/${job.id}`);
  const evidenceUrl = `https://github.com/${repo}/actions/runs/${runId}/job/${job.id}`;
  if (check.id !== job.id || check.name !== 'hotfix-verify' || check.head_sha !== plan.commit
    || check.status !== 'completed' || check.conclusion !== 'success' || check.app?.id !== 15368
    || check.app?.slug !== 'github-actions' || check.check_suite?.id !== run.check_suite_id
    || check.details_url !== evidenceUrl) throw new Error('hotfix 检查不是本次可信的成功证据');
  const status = await request(`/statuses/${plan.commit}`, {
    state: 'success', context: 'hotfix-verify', target_url: evidenceUrl,
    description: `Verified Actions check ${check.id}; deployment status API projection`,
  });
  if (status.state !== 'success' || status.context !== 'hotfix-verify' || status.target_url !== evidenceUrl) {
    throw new Error('部署状态接口没有返回对应的检查证据');
  }
  return { context: status.context, checkRunId: check.id, statusId: status.id, evidenceUrl };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'plan') {
    if (args.length) throw new Error('plan 只从工作流进程环境接收参数');
    const plan = planHotfix({ tag: process.env.RELEASE_TAG, commit: process.env.HOTFIX_COMMIT, event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, workflowSha: process.env.GITHUB_SHA, issue: process.env.HOTFIX_ISSUE });
    console.log(JSON.stringify(plan, null, 2));
  } else if ((command === 'verify-live' || command === 'publish-check') && args.length === 1) {
    const plan = JSON.parse(readFileSync(args[0], 'utf8'));
    // 重新检查 refs 与版本，等待审批期间 main 或 tag 漂移时停止，不能部署旧计划。
    const current = planHotfix({ tag: plan.tag, commit: plan.commit, event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, workflowSha: process.env.GITHUB_SHA, issue: plan.issue });
    if (current.baseCommit !== plan.baseCommit || current.origin !== plan.origin) throw new Error('hotfix 计划的版本锚点或环境已漂移');
    const identity = { repo: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN };
    const result = command === 'verify-live' ? await verifyLive(current, identity)
      : await publishVerifiedCheck(current, { ...identity, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT });
    console.log(JSON.stringify(result));
  } else throw new Error('usage: hotfix-policy.mjs plan | verify-live|publish-check <plan.json>');
}
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
