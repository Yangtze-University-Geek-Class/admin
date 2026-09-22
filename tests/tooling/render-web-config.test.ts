import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 夹具是临时目录：真实 deploy/env 模板 + 一份 app.config.json 副本，绝不改写仓库里的前端配置。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const script = join(repoRoot, 'scripts/render-web-config.mjs');
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'geek-web-config-'));
  roots.push(root);
  cpSync(join(repoRoot, 'deploy/env'), join(root, 'deploy/env'), { recursive: true });
  cpSync(join(repoRoot, 'deploy/environments.json'), join(root, 'deploy/environments.json'));
  cpSync(join(repoRoot, 'app/web/shared/config'), join(root, 'app/web/shared/config'), { recursive: true });
  const configPath = join(root, 'app/web/shared/config/app.config.json');
  return { root, configPath, before: readFileSync(configPath, 'utf8') };
}

const run = (root: string, ...args: string[]) => spawnSync(process.execPath, [script, ...args, '--root', root], { encoding: 'utf8' });

describe('front-end site host rendering', () => {
  it('rewrites only the three host values and keeps the rest of the file byte-identical', () => {
    const f = fixture();
    const result = run(f.root, '--environment', 'preview');
    expect(result.status).toBe(0);
    const after = readFileSync(f.configPath, 'utf8');
    const changedLines = after
      .split('\n')
      .filter((line, index) => line !== f.before.split('\n')[index]);
    expect(changedLines).toHaveLength(3);
    expect(changedLines.join('\n')).toContain('prev.yangtzeu.work');
    expect(after).toContain('"basePath": "/forum"');
    // 渲染结果仍然是合法 JSON，且 portal/forum/admin 三个域名都换成了预发布值。
    expect(JSON.parse(after).sites).toMatchObject({
      portal: { host: 'prev.yangtzeu.work' },
      forum: { host: 'prev.yangtzeu.work' },
      admin: { host: 'prev-admin.yangtzeu.work' },
    });
  });

  it('reports a mismatch without writing in --check mode, and passes once rendered', () => {
    const f = fixture();
    writeFileSync(f.configPath, f.before.replace('"host": "yangtzeu.work",\n      "title": "长江大学极客班', '"host": "stale.example.com",\n      "title": "长江大学极客班'));
    const failing = run(f.root, '--environment', 'production', '--check');
    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain('stale.example.com');
    expect(failing.stderr).toContain('yangtzeu.work');
    expect(readFileSync(f.configPath, 'utf8')).toContain('stale.example.com');
    expect(run(f.root, '--environment', 'production').status).toBe(0);
    expect(run(f.root, '--environment', 'production', '--check').status).toBe(0);
  });

  it('refuses an environment without a template, and requires an explicit environment', () => {
    const f = fixture();
    const missing = run(f.root, '--environment', 'development', '--check');
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('development');
    expect(run(f.root).status).toBe(1);
  });
});
