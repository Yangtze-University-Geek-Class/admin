import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLE_ALLOWLIST, buildBundle, collectBundleFiles, resolveReleaseIdentity, verifyBundle } from '../../scripts/release-bundle.mjs';

// 全部夹具都是临时目录里合成出来的假产物；本测试从不读取真实构建结果、.env 或任何数据库。
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4';
const SHORT = COMMIT.slice(0, 12);
const TOOLCHAIN = { coreNode: 'v22.23.2', corePnpm: '9.15.9', forumNode: 'v26.7.0', forumPnpm: '11.24.0' };

function write(root: string, relative: string, content: string) {
  const absolute = join(root, relative);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

/** 按允许列表合成一个最小仓库；顺序可反转，用于证明摘要与写入顺序无关。 */
function fixtureRepo(options: { reversed?: boolean; mtime?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'geek-bundle-fixture-'));
  roots.push(root);
  const rules = options.reversed ? [...BUNDLE_ALLOWLIST].reverse() : [...BUNDLE_ALLOWLIST];
  const written: string[] = [];
  for (const rule of rules) {
    if (rule.kind === 'tree') {
      const names = options.reversed ? ['nested/beta.txt', 'alpha.txt'] : ['alpha.txt', 'nested/beta.txt'];
      for (const name of names) written.push(write(root, `${rule.source}/${name}`, `合成内容 ${rule.target}/${name}\n`));
    } else {
      written.push(write(root, rule.source, `合成内容 ${rule.target}\n`));
    }
  }
  // 这些是必须被排除的真实世界污染物，放在仓库里但不在允许列表内。
  write(root, '.env', 'SESSION_SECRET=fixture-value-never-real\n');
  write(root, '.env.production', 'OAUTH_CLIENT_SECRET=fixture-value-never-real\n');
  write(root, 'data/geek.db', 'fixture sqlite placeholder');
  write(root, 'data/geek.db-wal', 'fixture wal placeholder');
  write(root, 'node_modules/left-pad/index.js', 'module.exports = 1;\n');
  write(root, '.tools/node/bin/node', 'fixture binary placeholder');
  write(root, '.git/config', '[core]\n');
  if (options.mtime !== undefined) {
    for (const path of written) utimesSync(path, options.mtime, options.mtime);
  }
  return root;
}

function outDir() {
  const dir = mkdtempSync(join(tmpdir(), 'geek-bundle-out-'));
  roots.push(dir);
  return dir;
}

function buildOptions(root: string, overrides: Record<string, unknown> = {}) {
  return {
    root, out: outDir(), environment: 'preview', baseVersion: '0.1.0', displayVersion: `0.1.0@${SHORT}`,
    commit: COMMIT, builtAt: '2026-09-13T10:00:00Z', runId: 'fixture-run', runNumber: '1', toolchain: TOOLCHAIN,
    ...overrides,
  } as Parameters<typeof buildBundle>[0];
}

function listFiles(dir: string, prefix = '', out: string[] = []) {
  for (const entry of readdirSync(prefix ? join(dir, prefix) : dir, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) listFiles(dir, path, out); else out.push(path);
  }
  return out;
}

describe('发布包构建身份', () => {
  it('生成完整的 release.json、MANIFEST 与归档，并声明未获部署批准', () => {
    const result = buildBundle(buildOptions(fixtureRepo()));
    expect(result.artifactName).toBe(`geek-preview-0.1.0-${SHORT}`);
    expect(result.releaseId).toBe(`0.1.0-${SHORT}`);
    expect(existsSync(result.tarPath)).toBe(true);
    expect(readFileSync(`${result.tarPath}.sha256`, 'utf8')).toBe(`${result.tarSha256}  ${result.artifactName}.tar.gz\n`);

    const release = JSON.parse(readFileSync(result.releaseJsonPath, 'utf8'));
    expect(release).toMatchObject({
      schemaVersion: 1, environment: 'preview', publicOrigin: 'https://prev.yangtzeu.work',
      baseVersion: '0.1.0', displayVersion: `0.1.0@${SHORT}`, commit: COMMIT, shortCommit: SHORT,
      tag: null, releaseId: `0.1.0-${SHORT}`, artifactName: `geek-preview-0.1.0-${SHORT}`,
      builtAt: '2026-09-13T10:00:00Z', run: { id: 'fixture-run', number: '1' }, toolchain: TOOLCHAIN,
      manifestSha256: result.manifestSha256, deploymentAuthorized: false,
    });
    for (const name of ['server', 'web', 'forum']) {
      expect(release.components[name].files).toBeGreaterThan(0);
      expect(release.components[name].sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    // MANIFEST 不登记自身与 release.json，其余文件逐行覆盖。
    const manifest = readFileSync(join(result.bundleDir, 'MANIFEST.sha256'), 'utf8').split('\n').filter(Boolean);
    const bundled = listFiles(result.bundleDir).filter(path => path !== 'MANIFEST.sha256' && path !== 'release.json').sort();
    expect(manifest.map(line => line.slice(66)).sort()).toEqual(bundled);
    expect(manifest.every(line => /^[a-f0-9]{64} {2}\S/.test(line))).toBe(true);
  });

  it('论坛静态产物落到 forum/public，服务端产物保持 server/dist 以便 REPO_ROOT 找到 web/dist', () => {
    const result = buildBundle(buildOptions(fixtureRepo()));
    const bundled = listFiles(result.bundleDir);
    expect(bundled).toContain('forum/public/alpha.txt');
    expect(bundled).toContain('server/dist/alpha.txt');
    expect(bundled).toContain('web/dist/alpha.txt');
    expect(bundled).toContain('scripts/release-bundle.mjs');
    expect(bundled).toContain('deploy/environments.json');
    expect(bundled.some(path => path.startsWith('modules/'))).toBe(false);
  });

  it('组件摘要只取决于路径与内容，与 mtime、写入顺序无关', () => {
    const first = buildBundle(buildOptions(fixtureRepo({ mtime: 1_600_000_000 })));
    const second = buildBundle(buildOptions(fixtureRepo({ reversed: true, mtime: 1_700_000_000 })));
    expect(second.components).toEqual(first.components);
    expect(second.manifestSha256).toBe(first.manifestSha256);
  });
});

describe('版本与环境规则', () => {
  it('正式环境拒绝带 @ 的展示版本', () => {
    expect(() => buildBundle(buildOptions(fixtureRepo(), { environment: 'production', displayVersion: `0.1.0@${SHORT}` })))
      .toThrow(/正式环境禁止 @/);
  });
  it('正式环境接受与基础版本一致的纯版本号', () => {
    const result = buildBundle(buildOptions(fixtureRepo(), { environment: 'production', displayVersion: '0.1.0' }));
    expect(result.publicOrigin).toBe('https://yangtzeu.work');
    expect(result.artifactName).toBe(`geek-production-0.1.0-${SHORT}`);
  });
  it('预发布拒绝与所选 commit 不符的 @ 后缀', () => {
    expect(() => buildBundle(buildOptions(fixtureRepo(), { displayVersion: '0.1.0@ffffffffffff' })))
      .toThrow(/预发布展示版本/);
  });
  it('拒绝与目标环境交叉的 tag', () => {
    expect(() => buildBundle(buildOptions(fixtureRepo(), { tag: 'release-0.1.0' }))).toThrow(/production/);
    expect(() => buildBundle(buildOptions(fixtureRepo(), { environment: 'production', displayVersion: '0.1.0', tag: 'prev-0.1.0' }))).toThrow(/preview/);
  });
  it('拒绝与基础版本不一致的 tag，接受一致的 tag', () => {
    expect(() => buildBundle(buildOptions(fixtureRepo(), { tag: 'prev-0.2.0' }))).toThrow(/基础版本/);
    expect(buildBundle(buildOptions(fixtureRepo(), { displayVersion: '0.1.0', tag: 'prev-0.1.0' })).tag).toBe('prev-0.1.0');
  });
  it('拒绝非法的环境、commit、版本与构建时间', () => {
    expect(() => resolveReleaseIdentity({ environment: 'staging', baseVersion: '0.1.0', displayVersion: '0.1.0', commit: COMMIT, builtAt: '2026-09-13T10:00:00Z', runId: 'r', runNumber: '1', toolchain: TOOLCHAIN })).toThrow();
    expect(() => resolveReleaseIdentity({ environment: 'preview', baseVersion: '0.1.0', displayVersion: '0.1.0', commit: SHORT, builtAt: '2026-09-13T10:00:00Z', runId: 'r', runNumber: '1', toolchain: TOOLCHAIN })).toThrow(/40 位/);
    expect(() => resolveReleaseIdentity({ environment: 'preview', baseVersion: 'v0.1.0', displayVersion: 'v0.1.0', commit: COMMIT, builtAt: '2026-09-13T10:00:00Z', runId: 'r', runNumber: '1', toolchain: TOOLCHAIN })).toThrow();
    expect(() => resolveReleaseIdentity({ environment: 'preview', baseVersion: '0.1.0', displayVersion: '0.1.0', commit: COMMIT, builtAt: '2026-09-13 10:00', runId: 'r', runNumber: '1', toolchain: TOOLCHAIN })).toThrow(/ISO 8601/);
  });
});

describe('允许列表与禁止列表', () => {
  it('缺少任一构建产物时直接失败并指出缺什么', () => {
    const root = fixtureRepo();
    rmSync(join(root, 'modules/forum/.output/public'), { recursive: true, force: true });
    expect(() => collectBundleFiles(root)).toThrow(/modules\/forum\/\.output\/public/);
    const other = fixtureRepo();
    rmSync(join(other, 'server/dist'), { recursive: true, force: true });
    expect(() => buildBundle(buildOptions(other))).toThrow(/server\/dist/);
  });
  it('构建产物目录为空时不静默跳过', () => {
    const root = fixtureRepo();
    rmSync(join(root, 'web/dist'), { recursive: true, force: true });
    mkdirSync(join(root, 'web/dist'), { recursive: true });
    expect(() => collectBundleFiles(root)).toThrow(/为空/);
  });
  it('仓库里的 .env、数据库、node_modules、.tools 与 .git 绝不进入发布包', () => {
    const result = buildBundle(buildOptions(fixtureRepo()));
    const bundled = listFiles(result.bundleDir);
    expect(bundled.length).toBeGreaterThan(0);
    for (const path of bundled) {
      expect(path.split('/').some(segment => ['node_modules', '.git', '.tools', 'data'].includes(segment))).toBe(false);
      expect(path.split('/').pop()!.startsWith('.env')).toBe(false);
      expect(/\.db(-wal|-shm)?$/.test(path)).toBe(false);
    }
    expect(readFileSync(join(result.bundleDir, 'MANIFEST.sha256'), 'utf8')).not.toMatch(/\.env|\.db|node_modules|\.tools/);
  });
  it('禁止列表是第二道防线：构建产物内混入 .env 或数据库时构建失败', () => {
    const root = fixtureRepo();
    write(root, 'server/dist/.env.local', 'SESSION_SECRET=fixture\n');
    expect(() => collectBundleFiles(root)).toThrow(/环境文件/);
    const other = fixtureRepo();
    write(other, 'web/dist/assets/cache.db', 'fixture');
    expect(() => collectBundleFiles(other)).toThrow(/数据库文件/);
  });
});

describe('发布包校验', () => {
  it('对未改动的发布包通过，并回报环境、文件数与摘要', () => {
    const result = buildBundle(buildOptions(fixtureRepo()));
    const checked = verifyBundle({ dir: result.bundleDir, expectEnvironment: 'preview', expectCommit: COMMIT });
    expect(checked).toMatchObject({ environment: 'preview', commit: COMMIT, manifestSha256: result.manifestSha256, deploymentAuthorized: false });
    expect(checked.files).toBeGreaterThan(0);
  });
  it('文件被篡改、被删除或多出未登记文件时失败', () => {
    const tampered = buildBundle(buildOptions(fixtureRepo()));
    writeFileSync(join(tampered.bundleDir, 'server/dist/alpha.txt'), '被篡改的内容\n');
    expect(() => verifyBundle({ dir: tampered.bundleDir })).toThrow(/内容被篡改/);

    const removed = buildBundle(buildOptions(fixtureRepo()));
    rmSync(join(removed.bundleDir, 'forum/public/alpha.txt'));
    expect(() => verifyBundle({ dir: removed.bundleDir })).toThrow(/缺少文件/);

    const extra = buildBundle(buildOptions(fixtureRepo()));
    writeFileSync(join(extra.bundleDir, 'web/dist/injected.js'), 'console.log(1);\n');
    expect(() => verifyBundle({ dir: extra.bundleDir })).toThrow(/多出未登记文件/);
  });
  it('只改 release.json 的字段无法骗过校验', () => {
    const result = buildBundle(buildOptions(fixtureRepo()));
    const release = JSON.parse(readFileSync(result.releaseJsonPath, 'utf8'));
    release.manifestSha256 = 'f'.repeat(64);
    writeFileSync(result.releaseJsonPath, JSON.stringify(release, null, 2));
    expect(() => verifyBundle({ dir: result.bundleDir })).toThrow(/manifestSha256/);

    const second = buildBundle(buildOptions(fixtureRepo()));
    const forged = JSON.parse(readFileSync(second.releaseJsonPath, 'utf8'));
    forged.deploymentAuthorized = true;
    writeFileSync(second.releaseJsonPath, JSON.stringify(forged, null, 2));
    expect(() => verifyBundle({ dir: second.bundleDir })).toThrow(/部署批准/);

    const third = buildBundle(buildOptions(fixtureRepo()));
    const components = JSON.parse(readFileSync(third.releaseJsonPath, 'utf8'));
    components.components.forum.files += 1;
    writeFileSync(third.releaseJsonPath, JSON.stringify(components, null, 2));
    expect(() => verifyBundle({ dir: third.bundleDir })).toThrow(/组件摘要/);
  });
  it('已部署目录里的 node_modules 整棵跳过，但同目录的 .env 仍然失败', () => {
    const result = buildBundle(buildOptions(fixtureRepo()));
    // 复刻目标机形态：deploy-release.sh 在解包目录跑过 pnpm install --prod，顶层与 server/ 下都有 node_modules，
    // 其中含 .pnpm 与指向包外的符号链接。这些既不在 MANIFEST 里，也不该让 verify 失败。
    const outside = mkdtempSync(join(tmpdir(), 'geek-bundle-store-'));
    roots.push(outside);
    writeFileSync(join(outside, 'real-package.js'), 'module.exports = 1;\n');
    for (const prefix of ['node_modules', 'server/node_modules']) {
      mkdirSync(join(result.bundleDir, prefix, '.pnpm/fastify@5.0.0/node_modules'), { recursive: true });
      writeFileSync(join(result.bundleDir, prefix, '.pnpm/fastify@5.0.0/node_modules/index.js'), 'module.exports = 2;\n');
      writeFileSync(join(result.bundleDir, prefix, '.modules.yaml'), 'hoistPattern:\n  - \'*\'\n');
      symlinkSync(join(outside, 'real-package.js'), join(result.bundleDir, prefix, 'linked-out.js'));
    }
    const checked = verifyBundle({ dir: result.bundleDir, expectEnvironment: 'preview', expectCommit: COMMIT });
    expect(checked).toMatchObject({ environment: 'preview', commit: COMMIT, manifestSha256: result.manifestSha256 });

    // 跳过只针对 node_modules：同一目录下多出的 .env 依然是未登记文件，必须失败。
    writeFileSync(join(result.bundleDir, '.env'), 'SESSION_SECRET=fixture-value-never-real\n');
    expect(() => verifyBundle({ dir: result.bundleDir, expectEnvironment: 'preview', expectCommit: COMMIT })).toThrow(/环境文件|未登记文件/);
  });
  it('期望环境或期望提交不符时失败', () => {
    const result = buildBundle(buildOptions(fixtureRepo()));
    expect(() => verifyBundle({ dir: result.bundleDir, expectCommit: 'b'.repeat(40) })).toThrow(/提交不符/);
    expect(() => verifyBundle({ dir: result.bundleDir, expectEnvironment: 'production' })).toThrow(/环境不符/);
    expect(() => verifyBundle({ dir: join(result.bundleDir, 'does-not-exist') })).toThrow(/不存在/);
  });
});

describe('随发布包分发的命令行校验器', () => {
  it('在发布包自身的目录布局下真的执行并输出结论（入口判定必须走 realpath）', () => {
    const result = buildBundle(buildOptions(fixtureRepo()));
    // 复刻目标机形态：只有发布包，没有仓库；且临时目录路径本身可能经过符号链接（如 macOS 的 /tmp）。
    const repoScripts = dirname(fileURLToPath(new URL('../../scripts/release-bundle.mjs', import.meta.url)));
    for (const name of ['release-bundle.mjs', 'release-policy.mjs', 'deployment-environment.mjs']) {
      copyFileSync(join(repoScripts, name), join(result.bundleDir, 'scripts', name));
    }
    copyFileSync(join(repoScripts, '../deploy/environments.json'), join(result.bundleDir, 'deploy/environments.json'));
    const cli = spawnSync(process.execPath, [
      join(result.bundleDir, 'scripts/release-bundle.mjs'), 'verify', '--dir', result.bundleDir,
      '--expect-environment', 'preview', '--expect-commit', COMMIT,
    ], { encoding: 'utf8' });
    // 覆盖过真实脚本后 MANIFEST 已对不上，重点是 CLI 必须真的跑起来并给出结论，而不是静默返回 0。
    expect(`${cli.stdout}${cli.stderr}`.trim()).not.toBe('');
    expect(cli.status).toBe(1);
    expect(`${cli.stdout}${cli.stderr}`).toMatch(/内容被篡改|校验通过/);
  });
  it('拒绝批准开关并对未知子命令非零退出', () => {
    const script = fileURLToPath(new URL('../../scripts/release-bundle.mjs', import.meta.url));
    const approved = spawnSync(process.execPath, [script, 'build', '--approved', 'true'], { encoding: 'utf8' });
    expect(approved.status).toBe(1);
    expect(approved.stderr).toContain('批准开关');
    const unknown = spawnSync(process.execPath, [script, 'deploy'], { encoding: 'utf8' });
    expect(unknown.status).toBe(1);
  });
});
