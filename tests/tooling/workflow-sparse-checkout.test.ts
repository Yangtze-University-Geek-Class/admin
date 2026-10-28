import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 工作流里的 sparse-checkout 漏检出依赖（#282）：`issue-lifecycle.yml` 的 sweep job 只取了三份脚本，
// 而 pr-contract.mjs 新增了 `import "./pr-markdown.mjs"`，整个 job 一启动就 ERR_MODULE_NOT_FOUND，
// 每天的 issue 巡检直接停摆（运行 40668563862）。
//
// 这类回归的共同形状是「脚本新增了本地 import，工作流的检出清单没跟上」。这里不针对某个文件写死，
// 而是把每个 job 实际运行的脚本展开成完整的本地 import 闭包，再和它的 sparse-checkout 清单比对：
// 少一份就报出来。新增本地 import 忘了改清单时，这个测试会失败，不用等定时任务第二天跑红。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

/** `jobs:` 下两格缩进的 job id 与它到下一个 job 之前的原文（与 deploy-doc-sync.test.ts 相同）。 */
function jobs(text: string) {
  const start = text.indexOf('\njobs:\n');
  if (start < 0) throw new Error('工作流里没有 jobs:');
  const body = text.slice(start + '\njobs:\n'.length);
  const heads = [...body.matchAll(/^ {2}([a-z][\w-]*):\n/gm)];
  return heads.map((head, i) => [head[1], body.slice(head.index, heads[i + 1]?.index ?? body.length)] as const);
}

/**
 * 一个 job 的 sparse-checkout 清单。没有这一步时返回 null：整个仓库都在，不会漏文件。
 * 清单是 `sparse-checkout: |` 之后那些缩进更深的非空行。
 */
function sparseCheckoutPaths(block: string) {
  const at = block.search(/^ +sparse-checkout: \|\n/m);
  if (at < 0) return null;
  const rest = block.slice(at).split('\n').slice(1);
  const paths: string[] = [];
  for (const line of rest) {
    if (!line.trim()) continue;
    if (!/^\s{12,}\S/.test(line)) break;
    paths.push(line.trim());
  }
  return paths;
}

/** job 里所有 `run:` 脚本与执行过的脚本路径（`node scripts/foo.mjs`，含 `pkexec node …` 之类的前缀）。 */
function executedScripts(block: string) {
  return [...new Set([...block.matchAll(/\bnode (?:--[\w-]+=\S+ )*(scripts\/[\w./-]+\.m?js)/g)].map((match) => match[1]))];
}

/**
 * 一个脚本的本地 import 闭包：自己 + `from "./x.mjs"` / `from "../y.mjs"` 递归下去。
 * 只跟相对路径；`node:` 内置模块和裸包名不需要检出额外的仓库文件。
 */
function importClosure(entry: string) {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const path = queue.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const full = join(repoRoot, path);
    if (!existsSync(full)) throw new Error(`${path} 不存在，但被别的脚本 import 了`);
    const source = read(path);
    for (const match of source.matchAll(/^import .* from ["'](\.[^"']+)["'];$/gm)) {
      const target = relative(repoRoot, resolve(dirname(full), match[1]));
      if (target.startsWith('..')) throw new Error(`${path} 导出了仓库外：${match[1]}`);
      queue.push(normalize(target));
    }
  }
  return [...seen].sort();
}

// 直接读目录，不写死清单：新增工作流自动纳入，不需要改这个测试。
// （deploy-hotfix.yml 只存在于 main，本分支的 base 上可能还没有；写死清单会在那种情况下误报。）
const workflows = readdirSync(join(repoRoot, '.github/workflows'))
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

describe('每个 job 的 sparse-checkout 覆盖它真正运行的脚本的全部本地 import', () => {
  it.each(workflows)('%s', (name) => {
    const text = read(`.github/workflows/${name}`);
    for (const [id, block] of jobs(text)) {
      const paths = sparseCheckoutPaths(block);
      if (!paths) continue;
      const checkedOut = new Set(paths);
      const needed = new Set<string>();
      for (const script of executedScripts(block)) {
        for (const file of importClosure(script)) needed.add(file);
      }
      // 清单里的每一项都应该是仓库里真实存在的文件，写错路径同样要拦下
      for (const path of checkedOut) {
        expect(existsSync(join(repoRoot, path)), `${name} ${id} 的 sparse-checkout 写了不存在的 ${path}`).toBe(true);
      }
      const missing = [...needed].filter((file) => !checkedOut.has(file)).sort();
      expect(
        missing,
        `${name} 的 ${id} job 会跑 ${[...executedScripts(block)].join('、')}，但 sparse-checkout 漏了：\n` +
          missing.map((file) => `  - ${file}`).join('\n') +
          '\n漏了本地 import 目标时，检出后第一步就是 ERR_MODULE_NOT_FOUND（#282）。把这几行补进这个 job 的 sparse-checkout。',
      ).toEqual([]);
    }
  });
});

describe('sweep job 带着它的完整依赖链（#282 的定点回归）', () => {
  const text = read('.github/workflows/issue-lifecycle.yml');
  const sweep = jobs(text).find(([id]) => id === 'sweep')?.[1] ?? '';

  it('检出了 issue-sweep.mjs 与它 import 的 pr-contract.mjs → pr-markdown.mjs', () => {
    const paths = sparseCheckoutPaths(sweep);
    expect(paths).not.toBeNull();
    for (const file of ['scripts/issue-sweep.mjs', 'scripts/pr-contract.mjs', 'scripts/pr-markdown.mjs', 'scripts/issue-labels.mjs']) {
      expect(paths, `${file} 要在 sweep 的 sparse-checkout 里`).toContain(file);
    }
  });

  it('pr-contract.mjs 确实 import 了 pr-markdown.mjs，所以 sweep 必须带上它', () => {
    const imports = [...read('scripts/pr-contract.mjs').matchAll(/^import .* from ["'](\.[^"']+)["'];$/gm)].map((m) => m[1]);
    expect(imports).toContain('./pr-markdown.mjs');
    // issue-sweep 直接 import pr-contract，链路成立
    expect(read('scripts/issue-sweep.mjs')).toMatch(/^import .* from ["']\.\/pr-contract\.mjs["'];$/m);
  });

  it('pr-contract job 也覆盖它的依赖，两个 job 不再一个改了一个没改', () => {
    // 不要求两个 job 的清单逐字相同：它们跑的脚本不同（sweep 多一个 issue-sweep.mjs）。
    // 要的是各自都覆盖自己那条 import 链，上面那条通用断言已经逐 job 核过；
    // 这里只盯住「pr-contract.mjs 的依赖，两个 job 都得有」这一点，避免只补一边。
    const contract = jobs(text).find(([id]) => id === 'pr-contract')?.[1] ?? '';
    const contractPaths = sparseCheckoutPaths(contract) ?? [];
    const sweepPaths = sparseCheckoutPaths(sweep) ?? [];
    for (const file of importClosure('scripts/pr-contract.mjs')) {
      expect(contractPaths, `pr-contract job 要检出 ${file}`).toContain(file);
      expect(sweepPaths, `sweep job 要检出 ${file}`).toContain(file);
    }
  });
});
