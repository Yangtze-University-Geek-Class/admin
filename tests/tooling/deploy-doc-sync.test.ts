import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// 发版前的文档同步（#192）：两条部署工作流的 plan job 在发布 tag 指向的提交上跑 check-doc-sync，
// 不通过 plan 就失败；后面的 job 都 needs plan，不会构建、上传或部署（docs/ops/CICD.md「触发与职责」）。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');
const STEP = '文档同步（发布 tag 指向的提交）';
const workflows = [
  ['deploy-preview.yml', read('.github/workflows/deploy-preview.yml')],
  ['deploy-production.yml', read('.github/workflows/deploy-production.yml')],
] as const;

/** `jobs:` 下两格缩进的 job id 与它到下一个 job 之前的原文（与 hosted-runners.test.ts 相同）。 */
function jobs(text: string) {
  const start = text.indexOf('\njobs:\n');
  if (start < 0) throw new Error('工作流里没有 jobs:');
  const body = text.slice(start + '\njobs:\n'.length);
  const heads = [...body.matchAll(/^ {2}([a-z][\w-]*):\n/gm)];
  return heads.map((head, i) => [head[1], body.slice(head.index, heads[i + 1]?.index ?? body.length)] as const);
}

function job(text: string, id: string) {
  const found = jobs(text).find(([name]) => name === id);
  if (!found) throw new Error(`工作流里找不到 job ${id}`);
  return found[1];
}

/** job 里的每一步：{ name, text }，按出现顺序；最后一步不带下一个 job 前面的空行和注释。 */
function steps(block: string) {
  const heads = [...block.matchAll(/^ {6}- name: (.+)\n/gm)];
  return heads.map((head, i) => ({
    name: head[1],
    text: block.slice(head.index, heads[i + 1]?.index ?? block.length).replace(/(?:\n(?: {0,4}#.*)?)+$/, '\n'),
  }));
}

function step(block: string, name: string) {
  const found = steps(block).find((item) => item.name === name);
  if (!found) throw new Error(`找不到这一步：${name}`);
  return found.text;
}

/** 一步里 `run: |` 的脚本，去掉缩进。 */
function runScript(text: string) {
  const run = /\n {8}run: \|\n((?: {10}.*\n|\n)+)/.exec(text);
  if (!run) throw new Error('这一步没有 run 脚本');
  return run[1].replace(/^ {10}/gm, '');
}

/** 去掉注释行之后的原文，只看真正执行的内容。 */
const code = (text: string) => text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

describe('deploy workflows check doc sync on the release tag commit before building', () => {
  it.each(workflows)('%s: the plan job has the step, after the full-history tag checkout and Node setup', (_name, text) => {
    const plan = job(text, 'plan');
    const names = steps(plan).map((item) => item.name);
    const at = names.indexOf(STEP);
    expect(at, names.join(' / ')).toBeGreaterThan(-1);

    const checkout = names.findIndex((name) => name.startsWith('检出发布 tag'));
    expect(checkout).toBeGreaterThan(-1);
    expect(checkout).toBeLessThan(at);
    const checkoutStep = steps(plan)[checkout].text;
    expect(checkoutStep).toContain('          ref: refs/tags/${{ steps.source.outputs.tag }}\n');
    expect(checkoutStep).toContain('          fetch-depth: 0\n');

    const node = names.indexOf('安装 Node（读取 .nvmrc）');
    expect(node).toBeGreaterThan(-1);
    expect(node).toBeLessThan(at);
    expect(steps(plan)[node].text).toContain('          node-version-file: .nvmrc\n');
    expect(read('.nvmrc').trim()).toBe('22');

    // 在核对 HEAD 是 tag 指向的提交的那一步之后：这一步用它输出的 commit 再核对一次
    expect(names.indexOf('规划发布身份（tag 模型）')).toBeLessThan(at);
  });

  it.each(workflows)('%s: the step runs the check plainly — no install, no condition, no way to swallow a failure', (_name, text) => {
    const plan = job(text, 'plan');
    const body = step(plan, STEP);
    expect(body).toContain('        env:\n          COMMIT: ${{ steps.identity.outputs.commit }}\n');
    expect(body).not.toMatch(/^ {8}(?:if|continue-on-error):/m);
    const script = runScript(body);
    expect(script.split('\n')[0]).toBe('set -eu');
    expect(script.split('\n').filter(Boolean).at(-1)).toBe('node scripts/check-doc-sync.mjs');
    expect(script).not.toMatch(/\|\||set \+e|--base|--head|\btrue\b/);
    // plan job 不装依赖：check-doc-sync 与它导入的 note.mjs 只用 Node 内置模块
    expect(code(plan)).not.toMatch(/pnpm|npm (?:ci|install)|corepack/);
    for (const file of ['scripts/check-doc-sync.mjs', 'scripts/note.mjs']) {
      const imports = [...read(file).matchAll(/^import .* from ["'](.+)["'];$/gm)].map((match) => match[1]);
      expect(imports.length, file).toBeGreaterThan(0);
      for (const spec of imports) expect(spec, file).toMatch(/^(?:node:|\.\/note\.mjs$)/);
      expect(read(file), file).not.toMatch(/\bimport\(|\brequire\(/);
    }
    expect(text).not.toMatch(/continue-on-error/);
  });

  it.each(workflows)('%s: every other job needs plan, and none runs after plan has failed', (_name, text) => {
    const list = jobs(text);
    expect(list[0][0]).toBe('plan');
    expect(list.map(([id]) => id)).toContain('build');
    for (const [id, block] of list.slice(1)) {
      const needs = /^ {4}needs: (.+)$/m.exec(block)?.[1] ?? '';
      expect(needs.replace(/[[\]\s]/g, '').split(','), id).toContain('plan');
      // job 级的 if 不带 always()、failure()、cancelled()：上游失败时 job 就跳过
      const condition = /^ {4}if: (.+)$/m.exec(block)?.[1] ?? '';
      expect(condition, id).not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
    }
  });

  it('both workflows carry the same step', () => {
    const [preview, production] = workflows.map(([, text]) => step(job(text, 'plan'), STEP));
    expect(preview).toBe(production);
  });
});

// 照工作流的写法在临时仓库里跑这一步：检出的 tag 是 detached HEAD，按第一父链的时间核对。
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const MAP = [
  '# 文档与规范总入口',
  '',
  '## 文档跟着模块改',
  '',
  '| 模块路径 | 文档路径 | 头部「更新：」 |',
  '|---|---|---|',
  '| `app/svc/` | `docs/services/svc/` | `docs/services/svc/README.md` |',
  '',
].join('\n');
const doc = (date: string, body: string) => `# svc\n\n> 摘要\n\n状态：\`current\` · 更新：${date}\n\n${body}\n`;

function git(cwd: string, args: string[], env: Record<string, string> = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
}

function commit(root: string, at: string, message: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message], { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
  return git(root, ['rev-parse', 'HEAD']).trim();
}

/** stage 上：rc.1 模块与文档一起改（同步），rc.2 直接在 stage 上只改模块（不同步，像 hot-fix 合回那样）。 */
function release() {
  const root = mkdtempSync(join(tmpdir(), 'geek-deploy-doc-sync-'));
  dirs.push(root);
  git(root, ['init', '-q', '-b', 'stage']);
  git(root, ['config', 'user.email', 'ci@example.test']);
  git(root, ['config', 'user.name', 'CI']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['config', 'tag.gpgsign', 'false']);
  mkdirSync(join(root, 'scripts'));
  for (const file of ['check-doc-sync.mjs', 'note.mjs']) copyFileSync(join(repoRoot, 'scripts', file), join(root, 'scripts', file));
  commit(root, '2026-09-25T10:00:00+08:00', 'base', {
    'docs/README.md': MAP,
    'app/svc/index.ts': 'export const a = 1;\n',
    'docs/services/svc/README.md': doc('2026-09-25', 'a 是 1'),
  });
  const synced = commit(root, '2026-09-26T09:00:00+08:00', 'fix(svc): 模块和文档一起改', {
    'app/svc/index.ts': 'export const a = 2;\n',
    'docs/services/svc/README.md': doc('2026-09-26', 'a 改成 2'),
  });
  git(root, ['tag', '-a', 'v0.0.1-rc.1', '-m', 'v0.0.1-rc.1']);
  const broken = commit(root, '2026-09-26T10:00:00+08:00', 'fix(svc): stage 上直接改模块', { 'app/svc/index.ts': 'export const a = 3;\n' });
  git(root, ['tag', '-a', 'v0.0.1-rc.2', '-m', 'v0.0.1-rc.2']);
  return { root, synced, broken };
}

function runStep(root: string, script: string, commitSha: string) {
  const PATH = [dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin', process.env.PATH ?? ''].join(':');
  return spawnSync('bash', ['-c', script], { cwd: root, encoding: 'utf8', env: { PATH, HOME: process.env.HOME ?? root, COMMIT: commitSha } });
}

describe.each(workflows)('%s: the step script on a detached tag checkout', (_name, text) => {
  const script = () => runScript(step(job(text, 'plan'), STEP));

  it('fails on a commit whose module changed after its docs, and passes on a synced one', () => {
    const { root, synced, broken } = release();

    git(root, ['checkout', '-q', '--detach', 'v0.0.1-rc.2']);
    expect(git(root, ['branch', '--show-current']).trim()).toBe('');
    const failed = runStep(root, script(), broken);
    expect(failed.status, failed.stdout + failed.stderr).toBe(1);
    expect(failed.stderr).toContain('文档没跟上模块：app/svc/ ↔ docs/services/svc/');
    expect(failed.stderr).toContain('fix(svc): stage 上直接改模块');

    git(root, ['checkout', '-q', '--detach', 'v0.0.1-rc.1']);
    const passed = runStep(root, script(), synced);
    expect(passed.status, passed.stdout + passed.stderr).toBe(0);
    expect(passed.stdout).toContain('文档同步通过：1 组模块与文档，按第一父链的时间核对。');
  });

  it('refuses when HEAD is not the commit the tag points to', () => {
    const { root, synced, broken } = release();
    git(root, ['checkout', '-q', '--detach', 'v0.0.1-rc.1']);
    const result = runStep(root, script(), broken);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`检出的 HEAD 不是发布 tag 指向的提交 ${broken}`);
    expect(synced).not.toBe(broken);
  });

  it('fails closed on a shallow clone', () => {
    const { root } = release();
    const shallow = join(root, 'shallow');
    git(root, ['clone', '-q', '--depth', '1', '--branch', 'v0.0.1-rc.1', `file://${root}`, shallow]);
    const head = git(shallow, ['rev-parse', 'HEAD']).trim();
    const result = runStep(shallow, script(), head);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('仓库是浅克隆');
  });
});
