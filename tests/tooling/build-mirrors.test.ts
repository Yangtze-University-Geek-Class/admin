import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 构建下载源（#104）：家里的自托管 runner 经仓库变量换国内镜像，没设变量时必须回到官方源；
// 镜像参数只在 Dockerfile 的构建阶段出现，不进运行镜像。这里核对三个 Dockerfile、三条工作流与 runner
// 准备脚本的接线，并在临时目录里实跑 server 构建阶段改写 Debian 源的那段 shell（apt、corepack、pnpm 换成假命令）。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const OFFICIAL_NPM = 'https://registry.npmjs.org';
const VAR_EXPR = {
  NPM_REGISTRY: `\${{ vars.NPM_REGISTRY || '${OFFICIAL_NPM}' }}`,
  DEBIAN_MIRROR: "${{ vars.DEBIAN_MIRROR || '' }}",
  BETTER_SQLITE3_BINARY_HOST: "${{ vars.BETTER_SQLITE3_BINARY_HOST || '' }}",
} as const;
const MIRROR_ARGS = ['NPM_REGISTRY', 'DEBIAN_MIRROR', 'BETTER_SQLITE3_BINARY_HOST'] as const;
// 运行阶段里不许出现的名字：镜像参数本身，以及它们在构建阶段映射成的环境变量。
const BUILD_ONLY = /NPM_REGISTRY|DEBIAN_MIRROR|BETTER_SQLITE3_BINARY_HOST|npm_config_|pnpm_config_|COREPACK_/;
// 默认值只能是官方源：镜像地址只从仓库变量来，不写进 Dockerfile 或工作流。
const MIRROR_HOSTS = /https?:\/\/[^\s'"$]*(?:mirror|ustc|tsinghua|tuna|aliyun|huaweicloud|tencent|daocloud|1ms\.run)/i;

/** 按 FROM 把 Dockerfile 切成阶段；preamble 是第一个 FROM 之前的部分（全局 ARG 会在这里）。 */
function stages(dockerfile: string) {
  const [preamble, ...parts] = dockerfile.split(/^(?=FROM )/m);
  return {
    preamble,
    byName: Object.fromEntries(parts.map(text => [/^FROM \S+ AS (\S+)/.exec(text)?.[1] ?? '', text])) as Record<string, string>,
  };
}

/** 截出工作流里某个 job（两格缩进的 `<id>:` 到下一个同级 key）。 */
function job(workflow: string, id: string) {
  const start = workflow.indexOf(`\n  ${id}:\n`);
  if (start < 0) throw new Error(`工作流里找不到 job ${id}`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 2);
}

const dockerfiles = {
  server: read('app/server/Dockerfile'),
  web: read('app/web/Dockerfile'),
  forum: read('app/forum/Dockerfile'),
};
const ci = read('.github/workflows/ci.yml');
const deploys = { preview: read('.github/workflows/deploy-preview.yml'), production: read('.github/workflows/deploy-production.yml') };

describe('Dockerfile mirror arguments', () => {
  it('declare the mirror arguments in the build stage only, with official defaults', () => {
    for (const [service, text] of Object.entries(dockerfiles)) {
      const { preamble, byName } = stages(text);
      expect(Object.keys(byName), service).toEqual(['builder', 'runtime']);
      expect(preamble, `${service} 不能有全局 ARG`).not.toMatch(/^ARG /m);
      expect(byName.builder, service).toContain(`\nARG NPM_REGISTRY=${OFFICIAL_NPM}\n`);
      expect(byName.runtime, `${service} 的运行阶段不能带镜像参数`).not.toMatch(BUILD_ONLY);
      expect(text, `${service} 的默认值只能是官方源`).not.toMatch(MIRROR_HOSTS);
      // 地址格式的校验三处逐字相同：https://、不带结尾的 /。
      expect(byName.builder, service).toContain(`case "$NPM_REGISTRY" in https://*[!/]) ;; *) echo "NPM_REGISTRY 必须是不带结尾 / 的 https:// 地址：\${NPM_REGISTRY}" >&2; exit 1 ;; esac;`);
    }
    // 只有 server 用 apt 与 better-sqlite3 的预编译包；空默认值 = deb.debian.org 与 GitHub releases。
    const server = stages(dockerfiles.server).byName.builder;
    expect(server).toContain('\nARG DEBIAN_MIRROR=\n');
    expect(server).toContain('\nARG BETTER_SQLITE3_BINARY_HOST=\n');
    for (const service of ['web', 'forum'] as const) {
      expect(dockerfiles[service]).not.toMatch(/DEBIAN_MIRROR|BETTER_SQLITE3_BINARY_HOST/);
    }
  });

  it('map the arguments onto the variables each tool actually reads', () => {
    const server = stages(dockerfiles.server).byName.builder;
    // pnpm 9 与 npm 读 npm_config_registry，corepack 读 COREPACK_NPM_REGISTRY，
    // prebuild-install 读 npm_config_<包名>_binary_host（包名里的 - 换成 _）。
    for (const line of ['npm_config_registry=${NPM_REGISTRY}', 'COREPACK_NPM_REGISTRY=${NPM_REGISTRY}', 'npm_config_better_sqlite3_binary_host=${BETTER_SQLITE3_BINARY_HOST}']) {
      expect(server).toContain(line);
    }
    const web = stages(dockerfiles.web).byName.builder;
    expect(web).toContain('npm_config_registry=${NPM_REGISTRY}');
    expect(web).toContain('COREPACK_NPM_REGISTRY=${NPM_REGISTRY}');
    // pnpm 11 不读 npm_config_*，只认 pnpm_config_registry。
    const forum = stages(dockerfiles.forum).byName.builder;
    expect(forum).toContain('npm_config_registry=${NPM_REGISTRY}');
    expect(forum).toContain('pnpm_config_registry=${NPM_REGISTRY}');
    // 换源不关 corepack 的签名核对。
    for (const text of Object.values(dockerfiles)) expect(text).not.toContain('COREPACK_INTEGRITY_KEYS');
  });

  it('pin the forum pnpm tarball to the same official sha512 in the Dockerfile and in CI', () => {
    const version = /"packageManager": "pnpm@([^"]+)"/.exec(read('app/forum/package.json'))?.[1];
    expect(version).toBe('11.24.0');
    const integrity = /FORUM_PNPM_INTEGRITY: '(sha512-[A-Za-z0-9+/]+={0,2})'/.exec(job(ci, 'forum'))?.[1];
    expect(integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
    const forum = stages(dockerfiles.forum).byName.builder;
    expect(forum).toContain(`npm pack pnpm@${version} --pack-destination /tmp;`);
    expect(forum).toContain(`/tmp/pnpm-${version}.tgz '${integrity}';`);
    expect(forum).toContain(`npm install --global /tmp/pnpm-${version}.tgz;`);
    expect(forum).not.toMatch(/npm install --global pnpm@/);
    // 核对在安装之前，CI 那边在解包之前。
    expect(forum.indexOf(integrity!)).toBeLessThan(forum.indexOf('npm install --global'));
    const forumJob = job(ci, 'forum');
    expect(forumJob.indexOf('"$FORUM_PNPM_INTEGRITY"')).toBeGreaterThan(forumJob.indexOf('npm pack "pnpm@'));
    expect(forumJob.indexOf('"$FORUM_PNPM_INTEGRITY"')).toBeLessThan(forumJob.indexOf('tar -xzf'));
  });
});

describe('workflows pass the mirrors from repository variables', () => {
  it('fall back to the official sources whenever a variable is unset', () => {
    for (const text of [ci, ...Object.values(deploys)]) {
      expect(text).not.toMatch(MIRROR_HOSTS);
      for (const name of MIRROR_ARGS) {
        for (const match of text.matchAll(new RegExp(`\\$\\{\\{ vars\\.${name}[^}]*\\}\\}`, 'g'))) {
          expect(match[0]).toBe(VAR_EXPR[name]);
        }
      }
    }
  });

  it('give every image build the mirror build args', () => {
    const docker = job(ci, 'docker');
    for (const name of MIRROR_ARGS) expect(docker).toContain(`      ${name}: ${VAR_EXPR[name]}\n`);
    const builds = docker.split('docker build \\').slice(1);
    expect(builds).toHaveLength(3);
    for (const build of builds) expect(build).toContain('--build-arg NPM_REGISTRY="$NPM_REGISTRY"');
    const server = builds.find(build => build.includes('app/server/Dockerfile'))!;
    expect(server).toContain('--build-arg DEBIAN_MIRROR="$DEBIAN_MIRROR"');
    expect(server).toContain('--build-arg BETTER_SQLITE3_BINARY_HOST="$BETTER_SQLITE3_BINARY_HOST"');
    for (const [environment, text] of Object.entries(deploys)) {
      const build = job(text, 'build');
      for (const name of MIRROR_ARGS) expect(build, environment).toContain(`      ${name}: ${VAR_EXPR[name]}\n`);
      expect(build, environment).toContain('server) mirror_args=(--build-arg NPM_REGISTRY="$NPM_REGISTRY" --build-arg DEBIAN_MIRROR="$DEBIAN_MIRROR" --build-arg BETTER_SQLITE3_BINARY_HOST="$BETTER_SQLITE3_BINARY_HOST") ;;');
      expect(build, environment).toContain('*) mirror_args=(--build-arg NPM_REGISTRY="$NPM_REGISTRY") ;;');
      expect(build, environment).toMatch(/--build-arg GEEK_RELEASE_COMMIT="\$GEEK_RELEASE_COMMIT" \\\n\s+"\$\{mirror_args\[@\]\}" \\\n/);
    }
  });

  it('point the runner-side installs at the mirror, but leave pnpm self-update on the official registry', () => {
    const npm = `      npm_config_registry: ${VAR_EXPR.NPM_REGISTRY}\n`;
    const sqlite = `      npm_config_better_sqlite3_binary_host: ${VAR_EXPR.BETTER_SQLITE3_BINARY_HOST}\n`;
    const withActionSetup = [job(ci, 'core'), job(ci, 'env-contract'), job(deploys.preview, 'build'), job(deploys.production, 'build')];
    for (const block of withActionSetup) {
      expect(block).toContain('uses: pnpm/action-setup@');
      expect(block).toContain(npm);
      // pnpm/action-setup 的引导版 pnpm 11 会 self-update 到 9.15.9，这一步没有锁文件，只信源给的 integrity。
      expect(block).not.toMatch(/^\s+pnpm_config_registry:/m);
    }
    for (const block of [job(ci, 'core'), job(deploys.preview, 'build'), job(deploys.production, 'build')]) expect(block).toContain(sqlite);
    const forum = job(ci, 'forum');
    expect(forum).toContain(npm);
    expect(forum).toContain(`      pnpm_config_registry: ${VAR_EXPR.NPM_REGISTRY}\n`);
    // scripts/forum.mjs 只把白名单里的变量交给 pnpm，pnpm_config_registry 必须在里面。
    expect(read('scripts/forum.mjs')).toMatch(/for \(const key of \[[^\]]*'pnpm_config_registry'[^\]]*\]\)/);
  });
});

describe('runner containers pre-seed Node 22 into the actions tool cache', () => {
  const setup = read('deploy/runner/container-setup.sh');

  it('uses the @actions/tool-cache layout for both the CI runners and the one-shot deploy runner', () => {
    expect(setup).toContain('dir=$cache/node/${node_version#v}/x64');
    expect(setup).toContain(': > "$dir.complete"');
    expect(setup).toContain('seed_node_tool_cache /home/runner/r1/_work/_tool /home/runner/r2/_work/_tool');
    expect(setup).toMatch(/d=\/home\/runner\/actions-runner\n[\s\S]*seed_node_tool_cache "\$d\/_work\/_tool"/);
    // 缓存要在 chown 之前写好，runner 用户才能读写。
    for (const call of ['seed_node_tool_cache "$d/_work/_tool"', 'seed_node_tool_cache /home/runner/r1']) {
      const at = setup.indexOf(call);
      expect(setup.indexOf('chown -R runner:runner /home/runner', at)).toBeGreaterThan(at);
    }
    // 与 /usr/local 同一个按 SHASUMS256 校验过的官方包；setup-node 读的 .nvmrc 是 22。
    expect(setup).toContain('sha256sum -c -');
    expect(read('.nvmrc').trim()).toBe('22');
  });
});

describe('server build stage rewrites the Debian sources only when asked', () => {
  // debian:bookworm 系镜像（node:22-bookworm-slim）自带的 deb822 源文件，注释行省略。
  const SOURCES = [
    'Types: deb', 'URIs: http://deb.debian.org/debian', 'Suites: bookworm bookworm-updates', 'Components: main',
    'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg', '',
    'Types: deb', 'URIs: http://deb.debian.org/debian-security', 'Suites: bookworm-security', 'Components: main',
    'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg', '',
  ].join('\n');

  /** 抽出 server 构建阶段那条 RUN，把系统路径换进临时目录，apt-get / corepack / pnpm 换成只记日志的假命令。 */
  function runStage(env: Record<string, string>, initial = SOURCES) {
    const root = mkdtempSync(join(tmpdir(), 'build-mirrors-'));
    roots.push(root);
    const builder = stages(dockerfiles.server).byName.builder;
    const match = /\nRUN (set -eu; \\\n[\s\S]*?pnpm --version)\n/.exec(builder);
    if (!match) throw new Error('server Dockerfile 里找不到换源的 RUN');
    const sources = join(root, 'debian.sources');
    writeFileSync(sources, initial);
    const script = match[1]
      .replaceAll('/etc/apt/sources.list.d/debian.sources', sources)
      .replaceAll('/var/lib/apt/lists/*', `${join(root, 'lists')}/*`);
    expect(script).not.toMatch(/\/etc\/apt|\/var\/lib\/apt/);
    const bin = join(root, 'bin');
    mkdirSync(bin);
    for (const name of ['apt-get', 'corepack', 'pnpm']) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${join(root, 'calls.log')}"\n`);
      chmodSync(join(bin, name), 0o755);
    }
    const result = spawnSync('/bin/sh', ['-c', script], {
      encoding: 'utf8',
      env: { PATH: `${bin}:/usr/bin:/bin`, NPM_REGISTRY: OFFICIAL_NPM, DEBIAN_MIRROR: '', ...env },
    });
    const read = (file: string) => { try { return readFileSync(join(root, file), 'utf8'); } catch { return ''; } };
    return { ...result, sources: read('debian.sources'), calls: read('calls.log') };
  }

  it('keeps deb.debian.org when DEBIAN_MIRROR is empty', () => {
    const run = runStage({});
    expect(run.status, run.stderr).toBe(0);
    expect(run.sources).toBe(SOURCES);
    expect(run.calls).toContain('apt-get update');
    expect(run.calls).toContain('corepack prepare pnpm@9.15.9 --activate');
  });

  it('rewrites both the main and the security archive to the mirror before apt-get update', () => {
    const run = runStage({ DEBIAN_MIRROR: 'http://mirrors.ustc.edu.cn/debian' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.sources).toBe(SOURCES.replaceAll('http://deb.debian.org/debian', 'http://mirrors.ustc.edu.cn/debian'));
    expect(run.stdout).toBe('URIs: http://mirrors.ustc.edu.cn/debian\nURIs: http://mirrors.ustc.edu.cn/debian-security\n');
    // 签名来源不变：Signed-By 仍是 debian-archive-keyring。
    expect(run.sources.match(/Signed-By: \/usr\/share\/keyrings\/debian-archive-keyring\.gpg/g)).toHaveLength(2);
    expect(run.calls.split('\n')[0]).toBe('apt-get update');
  });

  it.each([
    ['https, which apt cannot use before ca-certificates is installed', { DEBIAN_MIRROR: 'https://mirrors.ustc.edu.cn/debian' }, 'DEBIAN_MIRROR 必须是不带结尾 / 的 http:// 地址'],
    ['a trailing slash', { DEBIAN_MIRROR: 'http://mirrors.ustc.edu.cn/debian/' }, 'DEBIAN_MIRROR 必须是不带结尾 / 的 http:// 地址'],
    ['characters that would break the sed expression', { DEBIAN_MIRROR: 'http://evil#x' }, 'DEBIAN_MIRROR 含有不允许的字符'],
    ['a plain-http npm registry', { NPM_REGISTRY: 'http://registry.npmjs.org' }, 'NPM_REGISTRY 必须是不带结尾 / 的 https:// 地址'],
    ['an npm registry with a trailing slash', { NPM_REGISTRY: 'https://registry.npmjs.org/' }, 'NPM_REGISTRY 必须是不带结尾 / 的 https:// 地址'],
  ])('rejects %s before touching apt', (_label, env, message) => {
    const run = runStage(env);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(message);
    expect(run.sources).toBe(SOURCES);
    expect(run.calls).toBe('');
  });

  it('fails instead of silently keeping another archive when the sources file has a different shape', () => {
    // 基础镜像哪天换了源的写法（这里是 ftp.debian.org），改写后找不到镜像那一行，直接失败，不去 apt-get。
    const other = 'Types: deb\nURIs: http://ftp.debian.org/debian\nSuites: bookworm\n';
    const run = runStage({ DEBIAN_MIRROR: 'http://mirrors.ustc.edu.cn/debian' }, other);
    expect(run.status).not.toBe(0);
    expect(run.calls).toBe('');
  });
});
