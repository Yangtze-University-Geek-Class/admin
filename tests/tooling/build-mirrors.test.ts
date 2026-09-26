import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 构建下载源（#104）：家里的自托管 runner 经仓库变量换国内镜像，没设变量时必须回到官方源；
// 镜像参数只在 Dockerfile 的构建阶段出现，不进运行镜像。这里核对三个 Dockerfile、三条工作流与 runner
// 准备脚本的接线，并在临时目录里实跑其中负责拦下坏输入的 shell：三个 Dockerfile 构建阶段换源、核对的那条 RUN，
// ci forum job 装 pnpm 11 的那一步，container-setup.sh 下载并核对 Node 的函数（apt、corepack、npm、curl 等换成假命令）。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');
const readOr = (file: string) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * 临时目录里的 shell 沙箱：fakes 里的命令换成先记一行日志、再执行给定 shell 的假命令；
 * PATH 里另外只有系统目录（macOS 的 sha256sum 在 /sbin）与跑测试的这个 node（论坛的 sha512 核对要用真的 node）。
 */
function sandbox(fakes: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'build-mirrors-'));
  roots.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const log = join(root, 'calls.log');
  for (const [name, body] of Object.entries(fakes)) {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const PATH = [bin, '/usr/bin', '/bin', '/usr/sbin', '/sbin', dirname(process.execPath)].join(':');
  return {
    root,
    /** 在 root 里用 shell（默认 /bin/sh）跑 script，返回退出码、输出与假命令的调用日志。 */
    run(script: string, env: Record<string, string> = {}, shell = ['/bin/sh']) {
      const result = spawnSync(shell[0], [...shell.slice(1), '-c', script], { cwd: root, encoding: 'utf8', env: { PATH, ...env } });
      return { ...result, calls: readOr(log) };
    },
  };
}

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

/** 某个 Dockerfile 构建阶段里换源、核对的那条 RUN（`RUN set -eu; \` 起，到 `pnpm --version` 止）。 */
function builderRun(service: keyof typeof dockerfiles) {
  const match = /\nRUN (set -eu; \\\n[\s\S]*?pnpm --version)\n/.exec(stages(dockerfiles[service]).byName.builder);
  if (!match) throw new Error(`${service} Dockerfile 里找不到换源的 RUN`);
  return match[1];
}

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

  it.each(['web', 'forum'] as const)('%s rejects a plain-http or slash-terminated npm registry before downloading anything', service => {
    for (const registry of ['http://registry.npmjs.org', 'https://registry.npmjs.org/']) {
      const run = sandbox({ corepack: '', npm: '', pnpm: '' }).run(builderRun(service), { NPM_REGISTRY: registry });
      expect(run.status, registry).toBe(1);
      expect(run.stderr).toContain('NPM_REGISTRY 必须是不带结尾 / 的 https:// 地址');
      expect(run.calls).toBe('');
    }
    if (service === 'web') {
      const run = sandbox({ corepack: '', pnpm: '' }).run(builderRun('web'), { NPM_REGISTRY: OFFICIAL_NPM });
      expect(run.status, run.stderr).toBe(0);
      expect(run.calls).toBe('corepack enable\ncorepack prepare pnpm@9.15.9 --activate\npnpm --version\n');
    }
  });
});

describe('the forum pnpm 11 tarball is installed only after the pinned sha512 matches', () => {
  const pinned = /FORUM_PNPM_INTEGRITY: '([^']+)'/.exec(job(ci, 'forum'))![1];
  const version = /FORUM_PNPM_VERSION: '([^']+)'/.exec(job(ci, 'forum'))![1];

  /** 沙箱里放一个假的 pnpm 包（package/bin/pnpm.cjs 的 .tgz）；假 npm pack 把它复制成 <目标目录>/pnpm-<版本>.tgz。 */
  function withFakePackage() {
    const box = sandbox({ npm: 'if [ "$1" = pack ]; then cp "$FIXTURE" "$4/$(echo "$2" | tr @ -).tgz"; fi', pnpm: '' });
    const src = join(box.root, 'src');
    mkdirSync(join(src, 'package', 'bin'), { recursive: true });
    writeFileSync(join(src, 'package', 'bin', 'pnpm.cjs'), `console.log('${version}');\n`);
    const fixture = join(box.root, 'fixture.tgz');
    expect(spawnSync('tar', ['-czf', fixture, '-C', src, 'package']).status).toBe(0);
    const integrity = `sha512-${createHash('sha512').update(readFileSync(fixture)).digest('base64')}`;
    expect(integrity).not.toBe(pinned);
    return { box, fixture, integrity };
  }

  /** 实跑 forum Dockerfile 构建阶段那条 RUN，/tmp 换进沙箱；matching 时把写死的 sha512 换成假包的，模拟「对得上」。 */
  function dockerStage(matching: boolean) {
    const { box, fixture, integrity } = withFakePackage();
    const tmp = join(box.root, 'tmp');
    mkdirSync(tmp);
    let script = builderRun('forum').replaceAll(' /tmp', ` ${tmp}`);
    if (matching) script = script.replaceAll(pinned, integrity);
    return { ...box.run(script, { NPM_REGISTRY: OFFICIAL_NPM, FIXTURE: fixture }), tmp };
  }

  /** 实跑 ci forum job「安装 pnpm 11.24.0 到 .tools/pnpm11」那一步，按 `shell: bash` 的实际调用方式（-eo pipefail）。 */
  function ciStep(matching: boolean) {
    const { box, fixture, integrity } = withFakePackage();
    const step = /- name: 安装 pnpm 11\.24\.0 到 \.tools\/pnpm11\n\s+shell: bash\n\s+run: \|\n([\s\S]*?)\n\n/.exec(job(ci, 'forum'));
    if (!step) throw new Error('ci forum job 里找不到安装 pnpm 11 的那一步');
    const tmp = join(box.root, 'tmp');
    mkdirSync(tmp);
    const env = { FORUM_PNPM_VERSION: version, FORUM_PNPM_INTEGRITY: matching ? integrity : pinned, FIXTURE: fixture, TMPDIR: tmp };
    return { ...box.run(step[1].replace(/^ {10}/gm, ''), env, ['/bin/bash', '--noprofile', '--norc', '-eo', 'pipefail']), root: box.root };
  }

  it('Dockerfile: a tarball that does not match stops the build before npm install', () => {
    const run = dockerStage(false);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`pnpm-${version}.tgz 的 sha512 不符：期望 ${pinned}`);
    expect(run.calls).toBe(`npm pack pnpm@${version} --pack-destination ${run.tmp}\n`);
  });

  it('Dockerfile: a matching tarball is installed from the local file, then removed', () => {
    const run = dockerStage(true);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('sha512 核对通过');
    expect(run.calls).toBe([
      `npm pack pnpm@${version} --pack-destination ${run.tmp}`,
      `npm install --global ${run.tmp}/pnpm-${version}.tgz`,
      'pnpm --version',
      '',
    ].join('\n'));
    expect(readdirSync(run.tmp)).toEqual([]);
  });

  it('ci forum job: a tarball that does not match fails the step before anything is unpacked', () => {
    const run = ciStep(false);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(`pnpm-${version}.tgz 的 sha512 不符`);
    expect(existsSync(join(run.root, '.tools'))).toBe(false);
  });

  it('ci forum job: a matching tarball is unpacked to .tools/pnpm11', () => {
    const run = ciStep(true);
    expect(run.status, run.stderr).toBe(0);
    expect(readFileSync(join(run.root, '.tools', 'pnpm11', 'package', 'bin', 'pnpm.cjs'), 'utf8')).toBe(`console.log('${version}');\n`);
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
    // 与 /usr/local 同一个按 SHASUMS256 校验过的官方包（下面实跑核对）；setup-node 读的 .nvmrc 是 22。
    expect(setup).toMatch(/\nif ! node --version[^\n]*\n {2}fetch_node\n {2}tar -xJf "\$node_tarball" -C \/usr\/local /);
    expect(read('.nvmrc').trim()).toBe('22');
  });

  type Tarball = { name: string; sha256: string };
  const NODE_VERSION = 'v22.99.0';

  /**
   * 抽出 fetch_node（连同 mktemp 建的下载目录与 EXIT 清理）和 seed_node_tool_cache，curl 换成从夹具复制的假命令，
   * 给两个缓存目录播种。夹具是真的 .tar.xz，顶层目录与官方包相同；shasums 决定假 SHASUMS256.txt 的内容。
   * mktemp 也换成假的，把目录建在沙箱的 tmp 里：macOS 的 mktemp -d 不看 TMPDIR，测试就看不到目录有没有删掉。
   */
  function seed(shasums: (tarball: Tarball) => string) {
    const box = sandbox({
      mktemp: 'd="$TMPDIR/mktemp.$$"; mkdir -m 0700 "$d"; echo "$d"',
      curl: [
        'out=; url=',
        'while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2 ;; -*) shift ;; *) url=$1; shift ;; esac; done',
        'case "$url" in */SHASUMS256.txt) cp "$FIXTURES/SHASUMS256.txt" "$out" ;; *) cp "$FIXTURES/node.tar.xz" "$out" ;; esac',
      ].join('\n'),
    });
    const fixtures = join(box.root, 'fixtures');
    const top = `node-${NODE_VERSION}-linux-x64`;
    mkdirSync(join(fixtures, top, 'bin'), { recursive: true });
    writeFileSync(join(fixtures, top, 'bin', 'node'), 'fake node\n');
    expect(spawnSync('tar', ['-cJf', join(fixtures, 'node.tar.xz'), '-C', fixtures, top]).status).toBe(0);
    const sha256 = createHash('sha256').update(readFileSync(join(fixtures, 'node.tar.xz'))).digest('hex');
    writeFileSync(join(fixtures, 'SHASUMS256.txt'), shasums({ name: `${top}.tar.xz`, sha256 }));
    const block = (re: RegExp) => {
      const match = re.exec(setup);
      if (!match) throw new Error(`container-setup.sh 里找不到 ${re}`);
      return match[0];
    };
    const script = [
      'set -eu',
      `node_version=${NODE_VERSION}`,
      block(/^node_dir=\$\(mktemp -d\)\n[\s\S]*?\n}\n/m),
      block(/^seed_node_tool_cache\(\) \{\n[\s\S]*?\n}\n/m),
      'seed_node_tool_cache "$CACHE/r1" "$CACHE/r2"',
    ].join('\n');
    const tmp = join(box.root, 'tmp');
    mkdirSync(tmp);
    const cache = join(box.root, 'cache');
    return {
      ...box.run(script, { TMPDIR: tmp, CACHE: cache, FIXTURES: fixtures }),
      tmp,
      x64: (runner: string) => join(cache, runner, 'node', NODE_VERSION.slice(1), 'x64'),
    };
  }

  it('verifies the official tarball once per run and unpacks it into every cache', () => {
    const run = seed(({ name, sha256 }) => `${'1'.repeat(64)}  node-${NODE_VERSION}-darwin-arm64.tar.gz\n${sha256}  ${name}\n`);
    expect(run.status, run.stderr).toBe(0);
    for (const runner of ['r1', 'r2']) {
      expect(readFileSync(join(run.x64(runner), 'bin', 'node'), 'utf8')).toBe('fake node\n');
      expect(existsSync(`${run.x64(runner)}.complete`)).toBe(true);
    }
    // 两个缓存只下载、核对一次；下载目录是这次 mktemp 新建的，退出时连同包一起删掉。
    const [mktemp, tarball, shasumsFile, ...rest] = run.calls.trim().split('\n');
    expect(rest).toEqual([]);
    expect(mktemp).toBe('mktemp -d');
    expect(tarball).toMatch(/^curl -fsSL -o (\S+)\/mktemp\.\d+\/node-v22\.99\.0-linux-x64\.tar\.xz https:\/\/nodejs\.org\/dist\/v22\.99\.0\/node-v22\.99\.0-linux-x64\.tar\.xz$/);
    expect(tarball.startsWith(`curl -fsSL -o ${run.tmp}/`)).toBe(true);
    expect(shasumsFile.endsWith(` https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`)).toBe(true);
    expect(readdirSync(run.tmp)).toEqual([]);
  });

  it.each<[string, (tarball: Tarball) => string]>([
    ['the checksum does not match', ({ name }) => `${'0'.repeat(64)}  ${name}\n`],
    ['SHASUMS256.txt has no line for this tarball', ({ sha256 }) => `${sha256}  node-${NODE_VERSION}-linux-arm64.tar.xz\n`],
  ])('stops before unpacking anything when %s', (_label, shasums) => {
    const run = seed(shasums);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(`node-${NODE_VERSION}-linux-x64.tar.xz 与 nodejs.org 的 SHASUMS256 对不上`);
    for (const runner of ['r1', 'r2']) {
      expect(existsSync(run.x64(runner))).toBe(false);
      expect(existsSync(`${run.x64(runner)}.complete`)).toBe(false);
    }
    expect(readdirSync(run.tmp)).toEqual([]);
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

  /** 实跑 server 构建阶段那条 RUN：系统路径换进临时目录，apt-get / corepack / pnpm 换成只记日志的假命令。 */
  function runStage(env: Record<string, string>, initial = SOURCES) {
    const box = sandbox({ 'apt-get': '', corepack: '', pnpm: '' });
    const sources = join(box.root, 'debian.sources');
    writeFileSync(sources, initial);
    const script = builderRun('server')
      .replaceAll('/etc/apt/sources.list.d/debian.sources', sources)
      .replaceAll('/var/lib/apt/lists/*', `${join(box.root, 'lists')}/*`);
    expect(script).not.toMatch(/\/etc\/apt|\/var\/lib\/apt/);
    const run = box.run(script, { NPM_REGISTRY: OFFICIAL_NPM, DEBIAN_MIRROR: '', BETTER_SQLITE3_BINARY_HOST: '', ...env });
    return { ...run, sources: readOr(sources) };
  }

  it('accepts the values docs/ops/CICD.md tells the maintainer to set', () => {
    const documented = Object.fromEntries(
      [...read('docs/ops/CICD.md').matchAll(/^\| `(NPM_REGISTRY|DEBIAN_MIRROR|BETTER_SQLITE3_BINARY_HOST)` \| `([^`]+)` \|/gm)].map(match => [match[1], match[2]]),
    );
    expect(Object.keys(documented).sort()).toEqual([...MIRROR_ARGS].sort());
    const run = runStage(documented);
    expect(run.status, run.stderr).toBe(0);
    expect(run.sources).toBe(SOURCES.replaceAll('http://deb.debian.org/debian', documented.DEBIAN_MIRROR));
  });

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
    // prebuild-install 不核对预编译包的哈希，明文 http 等于让路上任何人换掉原生模块。
    ['a plain-http better-sqlite3 binary host', { BETTER_SQLITE3_BINARY_HOST: 'http://registry.npmmirror.com/-/binary/better-sqlite3' }, 'BETTER_SQLITE3_BINARY_HOST 必须是不带结尾 / 的 https:// 地址'],
    ['a better-sqlite3 binary host with a trailing slash', { BETTER_SQLITE3_BINARY_HOST: 'https://registry.npmmirror.com/-/binary/better-sqlite3/' }, 'BETTER_SQLITE3_BINARY_HOST 必须是不带结尾 / 的 https:// 地址'],
    ['a better-sqlite3 binary host with a user part', { BETTER_SQLITE3_BINARY_HOST: 'https://github.com@evil.example/better-sqlite3' }, 'BETTER_SQLITE3_BINARY_HOST 含有不允许的字符'],
    ['a better-sqlite3 binary host with a query', { BETTER_SQLITE3_BINARY_HOST: 'https://evil.example/x?y=1' }, 'BETTER_SQLITE3_BINARY_HOST 含有不允许的字符'],
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
