import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// CI 与部署只用 GitHub 托管 runner（#139）：每个工作流的每个 job 都写字面量 runs-on: ubuntu-latest，
// 不读仓库变量，也不带自托管标签。要改回自托管先开 issue 重新论证，见 docs/ops/CICD.md「运行位置」。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const dir = join(repoRoot, '.github', 'workflows');
const workflows = readdirSync(dir)
  .filter(name => /\.ya?ml$/.test(name))
  .sort()
  .map(name => [name, readFileSync(join(dir, name), 'utf8')] as const);

/** `jobs:` 下两格缩进的 job id，与它到下一个 job 之前的原文。 */
function jobs(text: string) {
  const start = text.indexOf('\njobs:\n');
  if (start < 0) throw new Error('工作流里没有 jobs:');
  const body = text.slice(start + '\njobs:\n'.length);
  const heads = [...body.matchAll(/^ {2}([a-z][\w-]*):\n/gm)];
  return heads.map((head, i) => [head[1], body.slice(head.index, heads[i + 1]?.index ?? body.length)] as const);
}

describe('workflows run only on GitHub-hosted runners', () => {
  it('covers the six workflows described in docs/ops/CICD.md', () => {
    expect(workflows.map(([name]) => name)).toEqual([
      'branch-hygiene.yml',
      'cert-watch.yml',
      'ci.yml',
      'deploy-preview.yml',
      'deploy-production.yml',
      'issue-lifecycle.yml',
    ]);
  });

  it.each(workflows)('%s: every job has the literal runs-on: ubuntu-latest', (_name, text) => {
    const list = jobs(text);
    expect(list.length).toBeGreaterThan(0);
    for (const [id, block] of list) {
      expect([...block.matchAll(/^\s*runs-on:.*$/gm)].map(match => match[0]), id).toEqual(['    runs-on: ubuntu-latest']);
    }
    // runs-on 只出现在 job 这一层，没有藏在别处（matrix、容器、条件表达式）的第二种写法。
    expect(text.split(/^\s*runs-on:/m).length - 1).toBe(list.length);
  });

  it.each(workflows)('%s: no runner variable or self-hosted label is left', (_name, text) => {
    expect(text).not.toMatch(/vars\.(?:CI|DEPLOY)_RUNNER|self-hosted|yzgc-arch|yzgc-deploy/);
  });
});
