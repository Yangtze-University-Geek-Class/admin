#!/usr/bin/env node
// 维护者机器部署（GitHub 免费版的退路）。
//
// 免费版的私有仓库可以建环境、存环境级 secrets，但配不了审批，deploy-production 的部署 job 因此按设计失败关闭
// （见 docs/ops/CICD.md）。本脚本在维护者机器上执行与 CI deploy job 相同的步骤，而且一切部署物料都取自发布 tag
// 指向的提交，不取当前工作区：
//   git archive <提交> 取出 deploy/、scripts/、package.json → 用这份里的 release-policy 规划、环境契约 --check
//   → （正式）核对所有者批准记录、rc tag、预发布部署记录与 prev 的 release.json → 下载这个 tag 的 CI 运行构建的
//   镜像归档并核对 sha256 → 用这份里的 render 渲染运行时 env → 分发这份里的 compose 与 deploy-stack.sh
//   → deploy-stack.sh → 写 GitHub 部署记录。
// 只部署 CI 构建过的产物，不在本机或目标机构建；不创建或移动任何 tag。谁可以运行见 AGENTS.md §3。
//
// 密钥只从进程环境读取（与 CI 同名），只经子进程环境传给 render，永不进命令行参数、永不回显：
//   OAUTH_CLIENT_ID OAUTH_CLIENT_SECRET SESSION_SECRET ENCRYPTION_KEY [TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY]
//   DEPLOY_TARGET_ENVIRONMENT（必须等于 --environment，防止拿错环境的密钥）
//   DEPLOY_SSH_HOST DEPLOY_SSH_PORT DEPLOY_SSH_USER DEPLOY_SSH_KEY_FILE DEPLOY_SSH_KNOWN_HOSTS_FILE
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PREVIEW_ORIGIN = 'https://prev.yangtzeu.work';
const ENVIRONMENTS = ['preview', 'production'];
/** 与 scripts/release-policy.mjs 的 RELEASE_TAG_RE 逐字一致（tests/tooling/deploy-manual.test.ts 核对）。 */
export const RELEASE_TAG_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-rc\.([1-9]\d*))?$/;
/** 会拼进远端命令的值（目录、镜像 tag、归档名）只允许这些字符，远端再用单引号包起来。 */
const REMOTE_SAFE = /^[A-Za-z0-9._/-]+$/;
/** SSH 目标：不以 - 开头（否则 ssh 会当成选项），端口只能是数字。 */
const SSH_NAME = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;
/** 部署记录只要求 CI 的这项检查通过；默认的「全部检查」会把正在运行或失败的部署 job 也算进去而一直 409。 */
export const REQUIRED_CONTEXT = 'verify (required check)';

/**
 * 目标机上核对刚传过去的镜像归档。`.sha256` 里是相对文件名，`sha256sum -c` 按当前目录找，
 * 所以先进入 incoming 目录；不带 `--ignore-missing`，缺文件直接失败（v0.1.0-rc.2 在这里「一个都没校验」）。
 */
export const archiveCheckCommand = (incomingDir, environment, imagesArchive) =>
  `cd '${incomingDir}' && chmod 600 '.env.${environment}' && sha256sum -c '${imagesArchive}.sha256'`;

/**
 * 目标机上执行部署。`--images` 只指这次的归档：失败的部署会在 incoming 里留下归档（成功的部署会清掉），
 * 不指定时 deploy-stack.sh 会把整个目录当成本次输入，看到别的版本的镜像就拒绝部署。
 */
export const deployStackCommand = (plan, environment) =>
  `bash '${plan.incomingDir}/deploy-stack.sh' --environment ${environment} --stack-root '${plan.stackRoot}' `
  + `--image-tag '${plan.imageTag}' --incoming-dir '${plan.incomingDir}' --images '${plan.incomingDir}/${plan.imagesArchive}' `
  + `--env-file '${plan.incomingDir}/.env.${environment}'`;
const SSH_ENV = ['DEPLOY_SSH_HOST', 'DEPLOY_SSH_PORT', 'DEPLOY_SSH_USER', 'DEPLOY_SSH_KEY_FILE', 'DEPLOY_SSH_KNOWN_HOSTS_FILE'];
const SECRET_ENV = ['OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'SESSION_SECRET', 'ENCRYPTION_KEY', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'];
/** 取出哪些路径：规划器、环境契约、render 与远端物料都在这里面。 */
const MATERIAL_PATHS = ['deploy', 'scripts', 'package.json'];

export const USAGE = `维护者机器部署（只部署 CI 为该发布 tag 构建过的镜像归档，物料取自 tag 指向的提交）：
  node scripts/deploy-manual.mjs --environment preview --tag vX.Y.Z-rc.N [--dry-run]
  node scripts/deploy-manual.mjs --environment production --tag vX.Y.Z --acceptance <所有者批准评论的链接> [--dry-run]

--acceptance 必须是本仓库 issue 或 PR 里的一条评论（…#issuecomment-<id>）：作者是仓库管理员、没有被编辑过、发在预发布部署成功之后，
正文里有单独一行正好是「批准发布 vX.Y.Z」（格式细节见 docs/ops/CICD.md「维护者机器部署」）。
环境变量：DEPLOY_TARGET_ENVIRONMENT（必须等于 --environment）、${[...SECRET_ENV, ...SSH_ENV].join(' ')}。
--dry-run 做完全部核对、下载与渲染，不连目标机、不写部署记录。`;

export function parseArgs(argv) {
  const options = { dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--dry-run') { options.dryRun = true; continue; }
    if (key === '--help' || key === '-h') { options.help = true; continue; }
    const value = argv[index + 1];
    if (!['--environment', '--tag', '--acceptance'].includes(key) || !value || value.startsWith('--')) throw new Error(`未知或缺失的选项：${key}`);
    options[key.slice(2)] = value;
    index += 1;
  }
  if (options.help) return options;
  if (!ENVIRONMENTS.includes(options.environment)) throw new Error(`--environment 只能是 ${ENVIRONMENTS.join(' / ')}`);
  const match = RELEASE_TAG_RE.exec(options.tag ?? '');
  if (!match) throw new Error(`--tag 不是发布 tag：${options.tag ?? ''}`);
  const isRc = match[4] !== undefined;
  if ((options.environment === 'preview') !== isRc) throw new Error(`${options.tag} 不能部署到 ${options.environment}：rc tag 只进预发布，正式 tag 只进正式`);
  if (options.environment === 'production') {
    if (!acceptanceComment(options.acceptance ?? '')) throw new Error('正式部署必须带 --acceptance <https://github.com/<仓库>/(issues|pull)/<号>#issuecomment-<id>>');
  } else if (options.acceptance) {
    throw new Error('--acceptance 只用于正式部署');
  }
  return options;
}

/** 批准记录链接：`https://github.com/<owner>/<repo>/(issues|pull)/<n>#issuecomment-<id>`。 */
export function acceptanceComment(url) {
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)#issuecomment-(\d+)$/.exec(url);
  return match ? { repo: match[1], number: Number(match[2]), id: match[3] } : null;
}

/**
 * 批准评论本身：必须有单独一行（去掉首尾空白）正好是「批准发布 vX.Y.Z」，行尾可带一个句号或叹号。
 * 渲染后看不到或不是正文的内容都不算：HTML 注释、HTML 标签（如 blockquote、details）里的内容、围栏代码块、
 * 缩进代码、`>` 引用以及紧跟引用、中间没有空行的懒续行。「暂不批准发布 v0.1.0」「批准发布 v0.1.0-rc.1」也不算。
 * 作者权限、是否被编辑过、所在 issue 与时间另查。
 */
export function acceptanceSays(body, version) {
  const line = new RegExp(`^批准发布\\s*v?${version.replaceAll('.', '\\.')}\\s*[。.！!]?$`);
  let text = String(body ?? '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  for (let previous = ''; previous !== text;) {
    previous = text;
    text = text.replace(/<([A-Za-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1\s*>/g, '');
  }
  let fence = null;
  let quoted = false;
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    const marker = /^(```+|~~~+)/.exec(trimmed);
    if (fence) { if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null; continue; }
    if (marker) { fence = marker[1]; continue; }
    if (!trimmed) { quoted = false; continue; }
    if (trimmed.startsWith('>') || trimmed.startsWith('＞')) { quoted = true; continue; }
    if (quoted || /^( {4}|\t)/.test(raw)) continue;
    if (line.test(trimmed)) return true;
  }
  return false;
}

/** origin 远端的 `owner/repo`；tag、运行记录、部署记录都以它为准。 */
export function repoFromRemote(url) {
  const match = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(String(url).trim());
  if (!match) throw new Error(`origin 不是 GitHub 仓库：${url}`);
  return match[1];
}

export const artifactName = (environment, imageTag) => `yzgc-images-${environment}-${imageTag}`;
export const workflowFile = environment => `deploy-${environment}.yml`;

/** 这个 tag 触发的、已结束的部署工作流运行（最新的在前）；只认 push 事件、tag 名与提交都对得上的。 */
export function pickRun(runs, { tag, commit }) {
  return runs
    .filter(run => run.event === 'push' && run.head_branch === tag && run.head_sha === commit && run.status === 'completed')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null;
}

/** 构建镜像归档的 job 必须成功（部署 job 失败或被跳过不影响归档本身）。 */
export const buildJobSucceeded = jobs => jobs.some(job => /^build\b/.test(job.name) && job.conclusion === 'success');

/** 与 CI 部署记录同样的 payload 键（正式另有 preview_tags），外加来源与批准记录。 */
export function deploymentPayload(plan, acceptance) {
  return {
    tag: plan.tag,
    release_version: plan.releaseVersion,
    image_tag: plan.imageTag,
    image_repository: plan.imageRepository,
    ...(plan.environment === 'production' ? { preview_tags: plan.previewTags.join(' ') } : {}),
    deployed_from: 'maintainer',
    ...(acceptance ? { acceptance } : {}),
  };
}

/** 预发布站点的 release.json 必须是这个提交、这个版本的某个 rc（与 deploy-production 的证据 job 相同）。 */
export function previewReleaseMatches(body, commit, previewTags) {
  const expected = previewTags.map(tag => `${tag.slice(1)}@${commit.slice(0, 12)}`);
  return body?.environment === 'preview' && body?.commit === commit && expected.includes(body?.version);
}

/** `sha256sum` 格式（`<hex>  <文件名>`）里取出对应文件的摘要。 */
export function expectedDigest(sumsText, fileName) {
  for (const line of sumsText.split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match && match[2] === fileName) return match[1];
  }
  return null;
}

/** env 模板里的 KEY=VALUE（只取部署目标三项，用来核对 SSH 目标没拿错环境）。 */
export function templateTarget(text) {
  const values = new Map();
  for (const line of text.split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2].replace(/^"(.*)"$/, '$1'));
  }
  return { host: values.get('DEPLOY_HOST'), port: values.get('DEPLOY_PORT'), user: values.get('DEPLOY_USER') };
}

/** 进程环境里的 SSH 目标：格式合法，而且与这个提交里该环境模板的 DEPLOY_HOST/PORT/USER 一致。 */
export function sshTarget(env, template) {
  for (const name of SSH_ENV) if (!env[name]) throw new Error(`缺少环境变量 ${name}`);
  if (!SSH_NAME.test(env.DEPLOY_SSH_HOST) || !SSH_NAME.test(env.DEPLOY_SSH_USER) || !/^\d{1,5}$/.test(env.DEPLOY_SSH_PORT)) {
    throw new Error('DEPLOY_SSH_HOST / DEPLOY_SSH_USER / DEPLOY_SSH_PORT 格式不对');
  }
  if (env.DEPLOY_SSH_HOST !== template.host || env.DEPLOY_SSH_PORT !== template.port || env.DEPLOY_SSH_USER !== template.user) {
    throw new Error('DEPLOY_SSH_HOST/PORT/USER 与该提交里这个环境模板的 DEPLOY_HOST/PORT/USER 不一致：可能拿错了环境');
  }
  const common = ['-F', 'none', '-i', env.DEPLOY_SSH_KEY_FILE, '-o', 'IdentitiesOnly=yes', '-o', `UserKnownHostsFile=${env.DEPLOY_SSH_KNOWN_HOSTS_FILE}`,
    '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'StrictHostKeyChecking=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20'];
  const target = `${env.DEPLOY_SSH_USER}@${env.DEPLOY_SSH_HOST}`;
  return {
    ssh: command => ['ssh', [...common, '-p', env.DEPLOY_SSH_PORT, target, command]],
    scp: (files, destination) => ['scp', [...common, '-P', env.DEPLOY_SSH_PORT, ...files, `${target}:${destination}`]],
  };
}

export const withoutSecrets = env => Object.fromEntries(Object.entries(env).filter(([name]) => !SECRET_ENV.includes(name)));

/** 真实的外部动作；测试注入假的，核对编排顺序。 */
export function defaultDeps() {
  return {
    env: process.env,
    // 除了 render（显式传入密钥），子进程拿到的环境里没有任何密钥。
    run: (command, args, { env, quiet } = {}) => execFileSync(command, args, {
      cwd: ROOT, encoding: 'utf8', env: env ?? withoutSecrets(process.env), stdio: ['ignore', quiet === false ? 'inherit' : 'pipe', 'inherit'],
    }) ?? '',
    fetchJson: url => JSON.parse(execFileSync('curl', ['-fsS', '--max-time', '20', '--retry', '3', url], { encoding: 'utf8', env: withoutSecrets(process.env) })),
    readText: path => readFileSync(path, 'utf8'),
    hashFile: path => new Promise((done, failed) => {
      const hash = createHash('sha256');
      createReadStream(path).on('data', chunk => hash.update(chunk)).on('error', failed).on('end', () => done(hash.digest('hex')));
    }),
    tempDir: () => mkdtempSync(join(tmpdir(), 'yzgc-deploy-')),
    makeDir: path => mkdirSync(path, { recursive: true }),
    removeDir: path => rmSync(path, { recursive: true, force: true }),
    // Ctrl-C 或被杀时 finally 不会执行：先删掉含密钥的临时目录再退出。
    trap: cleanup => {
      const handler = signal => { cleanup(); process.exit(signal === 'SIGINT' ? 130 : 143); };
      process.once('SIGINT', handler);
      process.once('SIGTERM', handler);
      return () => { process.off('SIGINT', handler); process.off('SIGTERM', handler); };
    },
    log: message => console.error(`[deploy-manual] ${message}`),
  };
}

export async function deploy(options, deps = defaultDeps()) {
  const { environment, tag, acceptance, dryRun } = options;
  const { env, run, log } = deps;
  const ghJson = path => JSON.parse(run('gh', ['api', path]));
  if (env.DEPLOY_TARGET_ENVIRONMENT !== environment) {
    throw new Error(`DEPLOY_TARGET_ENVIRONMENT 必须等于 ${environment}（现在是「${env.DEPLOY_TARGET_ENVIRONMENT ?? ''}」）：确认导出的是这个环境的密钥`);
  }
  const repo = repoFromRemote(run('git', ['remote', 'get-url', 'origin']));
  if (acceptance && acceptanceComment(acceptance).repo !== repo) throw new Error(`批准记录不在本仓库 ${repo}`);

  run('git', ['fetch', '--quiet', '--tags', 'origin', '+refs/heads/stage:refs/remotes/origin/stage', '+refs/heads/main:refs/remotes/origin/main']);
  const commit = run('git', ['rev-parse', `refs/tags/${tag}^{commit}`]).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`解析不出 ${tag} 指向的提交`);

  const work = deps.tempDir();
  const untrap = deps.trap(() => deps.removeDir(work));
  let deploymentId = null;
  try {
    // 物料一律取自 tag 指向的提交：规划器、环境契约、render、compose、deploy-stack.sh 都用这一份。
    const src = join(work, 'src');
    deps.makeDir(src);
    run('git', ['archive', '--format=tar', '-o', join(work, 'src.tar'), commit, ...MATERIAL_PATHS]);
    run('tar', ['-xf', join(work, 'src.tar'), '-C', src]);
    const branch = environment === 'preview' ? 'stage' : 'main';
    const plan = JSON.parse(run(process.execPath, [join(src, 'scripts/release-policy.mjs'), 'plan', '--tag', tag, '--commit', commit,
      '--branch-ref', `refs/remotes/origin/${branch}`, '--require-tag', '--root', src, '--repo', ROOT]));
    if (plan.environment !== environment || plan.commit !== commit) throw new Error(`规划结果与参数不一致：${plan.environment} ${plan.commit}`);
    if (environment === 'production' && plan.releaseVersion !== tag.slice(1)) throw new Error(`正式版本必须是 ${tag.slice(1)}，规划得到 ${plan.releaseVersion}`);
    for (const value of [plan.stackRoot, plan.incomingDir, plan.imageTag, plan.imagesArchive]) {
      if (!REMOTE_SAFE.test(value)) throw new Error(`规划值含不安全字符：${value}`);
    }
    run(process.execPath, [join(src, 'scripts/deployment-environment.mjs'), '--check']);
    const remote = sshTarget(env, templateTarget(deps.readText(join(src, `deploy/env/.env.${environment}`))));
    log(`${tag} → ${environment}：提交 ${commit}，镜像 ${plan.imageRepository}/*:${plan.imageTag}，栈 ${plan.stackRoot}，物料取自该提交`);

    if (environment === 'production') {
      // 所有者批准：本仓库里的一条未被编辑的评论，作者是仓库管理员，正文单独一行「批准发布 vX.Y.Z」，晚于预发布成功。
      const { id, number } = acceptanceComment(acceptance);
      const comment = ghJson(`repos/${repo}/issues/comments/${id}`);
      if (!String(comment.issue_url ?? '').endsWith(`/issues/${number}`)) throw new Error(`批准评论不在链接写的 #${number} 里`);
      // 有写权限的人能编辑别人的评论而作者不变：被编辑过的评论一律不认，请所有者重新发一条。
      if (comment.updated_at !== comment.created_at) throw new Error('批准评论被编辑过：请所有者重新发一条新的批准评论');
      if (!acceptanceSays(comment.body, plan.version)) throw new Error(`批准评论里没有单独一行写「批准发布 v${plan.version}」`);
      const permission = ghJson(`repos/${repo}/collaborators/${encodeURIComponent(comment.user?.login ?? '')}/permission`).permission;
      if (permission !== 'admin') throw new Error(`批准评论的作者 @${comment.user?.login} 不是仓库管理员`);
      if (!plan.previewTags?.length) throw new Error(`提交 ${commit} 上没有 v${plan.version}-rc.N：正式版只能发在发过预发布的同一提交上`);
      const deployments = ghJson(`repos/${repo}/deployments?environment=preview&sha=${commit}&per_page=100`);
      let previewDone = null;
      const verified = deployments.find(item => {
        if (!plan.previewTags.includes(item.payload?.tag)) return false;
        const latest = ghJson(`repos/${repo}/deployments/${item.id}/statuses?per_page=1`)[0];
        if (latest?.state !== 'success') return false;
        previewDone = latest.created_at;
        return true;
      });
      if (!verified) throw new Error(`提交 ${commit} 没有来自 ${plan.previewTags.join('、')} 的成功预发布部署记录`);
      // 批准必须晚于预发布部署成功：先有可试用的预发布，所有者试过之后才批准。
      if (!(Date.parse(comment.created_at) > Date.parse(previewDone))) throw new Error('批准评论早于预发布部署成功的时间：请在试用预发布之后再批准');
      const body = deps.fetchJson(`${PREVIEW_ORIGIN}/release.json`);
      if (!previewReleaseMatches(body, commit, plan.previewTags)) throw new Error(`${PREVIEW_ORIGIN}/release.json 不是提交 ${commit} 的 rc 版本：${JSON.stringify(body)}`);
      log(`正式证据成立：@${comment.user.login} 批准，预发布部署 ${verified.id}（${verified.payload.tag}），预发布站点当前就是这个提交`);
    }

    const runs = ghJson(`repos/${repo}/actions/workflows/${workflowFile(environment)}/runs?event=push&branch=${encodeURIComponent(tag)}&per_page=20`).workflow_runs ?? [];
    const source = pickRun(runs, { tag, commit });
    if (!source) throw new Error(`找不到 ${tag} 在 ${workflowFile(environment)} 上已结束的运行`);
    const jobs = ghJson(`repos/${repo}/actions/runs/${source.id}/jobs?per_page=100`).jobs ?? [];
    if (!buildJobSucceeded(jobs)) throw new Error(`运行 ${source.id} 的镜像构建 job 没有成功`);

    const artifacts = join(work, 'artifacts');
    run('gh', ['run', 'download', String(source.id), '--repo', repo, '--name', artifactName(environment, plan.imageTag), '--dir', artifacts]);
    const archive = join(artifacts, plan.imagesArchive);
    const expected = expectedDigest(deps.readText(`${archive}.sha256`), plan.imagesArchive);
    const actual = await deps.hashFile(archive);
    if (!expected || expected !== actual) throw new Error(`镜像归档 sha256 不符：期望 ${expected ?? '无'}，实际 ${actual}`);
    log(`镜像归档来自运行 ${source.html_url}，sha256 ${actual}`);

    // 密钥只经子进程环境传给该提交里的 render，写成 0600 的临时文件，结束时随临时目录删除。
    const envFile = join(work, `.env.${environment}`);
    const secrets = Object.fromEntries(SECRET_ENV.filter(name => env[name] !== undefined).map(name => [name, env[name]]));
    run(process.execPath, [join(src, 'scripts/deployment-environment.mjs'), 'render', '--environment', environment, '--out', envFile, '--image-tag', plan.imageTag, '--root', src],
      { env: { PATH: env.PATH ?? '', HOME: env.HOME ?? '', ...secrets }, quiet: false });
    if (dryRun) { log('--dry-run：核对、下载与渲染都已完成，没有连接目标机，也没有写部署记录'); return { plan, dryRun: true }; }

    const payload = deploymentPayload(plan, acceptance);
    deploymentId = run('gh', ['api', '--method', 'POST', `repos/${repo}/deployments`, '-f', `ref=${commit}`, '-f', `environment=${environment}`,
      '-F', 'auto_inactive=false', '-f', `required_contexts[]=${REQUIRED_CONTEXT}`, '-f', `description=${tag} → ${environment}（${plan.releaseVersion}，镜像 tag ${plan.imageTag}，维护者机器部署）`,
      ...Object.entries(payload).flatMap(([key, value]) => ['-f', `payload[${key}]=${value}`]), '--jq', '.id']).trim();
    run('gh', ['api', '--method', 'POST', `repos/${repo}/deployments/${deploymentId}/statuses`, '-f', 'state=in_progress', '-f', `description=分发镜像与 env 文件到 ${plan.stackRoot}`]);
    log(`部署记录已创建：deployment ${deploymentId}`);

    const step = ([command, args]) => run(command, args, { quiet: false });
    step(remote.ssh(`mkdir -p '${plan.incomingDir}' '${plan.stackRoot}/deploy/compose' && chmod 700 '${plan.incomingDir}'`));
    step(remote.scp([archive, `${archive}.sha256`, envFile, join(src, 'deploy/remote/deploy-stack.sh')], `${plan.incomingDir}/`));
    step(remote.scp([join(src, 'deploy/compose/production.yml'), join(src, 'deploy/compose/preview.yml')], `${plan.stackRoot}/deploy/compose/`));
    step(remote.ssh(archiveCheckCommand(plan.incomingDir, environment, plan.imagesArchive)));
    step(remote.ssh(deployStackCommand(plan, environment)));
    run('gh', ['api', '--method', 'POST', `repos/${repo}/deployments/${deploymentId}/statuses`, '-f', 'state=success', '-f', `environment_url=${plan.origin}`,
      '-f', `description=${tag} 部署成功（镜像 tag ${plan.imageTag}，维护者机器部署）`]);
    log(`完成：${plan.origin}/release.json 应显示 ${plan.releaseVersion}`);
    return { plan, deploymentId };
  } catch (error) {
    if (deploymentId) {
      try {
        run('gh', ['api', '--method', 'POST', `repos/${repo}/deployments/${deploymentId}/statuses`, '-f', 'state=failure', '-f', `description=${tag} 部署失败（维护者机器部署）`]);
      } catch { log('部署记录状态没能更新为 failure，请手工核对'); }
    }
    throw error;
  } finally {
    deps.removeDir(work);
    untrap();
  }
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url;
  } catch {
    return false;
  }
}
if (isDirectRun()) {
  (async () => {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { console.log(USAGE); return; }
    await deploy(options);
  })().catch(error => {
    console.error(`[deploy-manual] 失败：${error.message}`);
    process.exit(1);
  });
}
