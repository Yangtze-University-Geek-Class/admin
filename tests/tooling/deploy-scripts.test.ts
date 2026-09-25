import { afterEach, describe, expect, it } from 'vitest';
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// 在临时目录里用假的 docker / curl / flock 跑目标机脚本：从不连接真实 Docker 守护进程、服务器或网络。
// 假 docker 用一个文本文件模拟「本机镜像列表」，两套环境共用它，正好对应同机双栈共用一个守护进程。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const FAKE_DOCKER = `#!/bin/bash
set -eu
state="$FAKE_DOCKER_STATE"
images="$state/images.txt"
touch "$images" "$state/in-use.txt"
repo_tags() {
  tar -xOf "$1" manifest.json | tr -d '\\n' | grep -o '"RepoTags":[[:space:]]*\\[[^]]*\\]' \\
    | sed -e 's/^"RepoTags":[[:space:]]*\\[//' -e 's/\\]$//' | tr ',' '\\n' \\
    | sed -e 's/^[[:space:]]*"//' -e 's/"[[:space:]]*$//' | grep -v '^$'
}
compose_images() {
  file=""; envfile=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -f) file="$2"; shift 2 ;;
      --env-file) envfile="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  tag=$(grep '^IMAGE_TAG=' "$envfile" | tail -n 1 | cut -d= -f2)
  grep -E '^[[:space:]]*image:' "$file" | sed -E 's/^[[:space:]]*image:[[:space:]]*//' \\
    | sed -E "s/\\\\$\\\\{IMAGE_TAG[^}]*\\\\}/$tag/"
}
case "$1" in
  compose)
    shift
    case " $* " in
      *" version "*) echo "Docker Compose version fake"; exit 0 ;;
      *" config "*) compose_images "$@"; exit 0 ;;
      *" up "*)
        # 容器按 compose 解析出的镜像重建；FAKE_DOCKER_UP_FAIL_TAG 对上时 up 非零退出（例如 web 等不到 server 健康）。
        refs=$(compose_images "$@")
        printf '%s\\n' "$refs" > "$state/in-use.txt"
        case "$refs" in *":\${FAKE_DOCKER_UP_FAIL_TAG:-none}"*) echo "up failed $*" >> "$state/compose.log"; exit 1 ;; esac
        echo "up $*" >> "$state/compose.log"; exit 0 ;;
    esac
    exit 1 ;;
  load)
    repo_tags "$3" >> "$images"; sort -u -o "$images" "$images"; exit 0 ;;
  images)
    ref=""
    while [ "$#" -gt 0 ]; do case "$1" in --filter) ref="\${2#reference=}"; shift 2 ;; *) shift ;; esac; done
    prefix="\${ref%\\*}"
    grep -F "$prefix" "$images" | while IFS= read -r line; do
      case "$line" in "$prefix"*) echo "\${line#"$prefix"}" ;; esac
    done
    exit 0 ;;
  image)
    grep -qxF "$3" "$images" ;;
  rmi)
    grep -qxF "$2" "$state/in-use.txt" && exit 1
    grep -qxF "$2" "$images" || exit 1
    grep -vxF "$2" "$images" > "$images.tmp" || true
    mv "$images.tmp" "$images"; exit 0 ;;
  tag)
    echo "$3" >> "$images"; exit 0 ;;
  *) echo "fake docker: unsupported $*" >&2; exit 2 ;;
esac
`;

const FAKE_CURL = `#!/bin/bash
out=""
while [ "$#" -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac; done
# 正在跑的容器是 FAKE_UNHEALTHY_TAG 时健康检查失败。
if [ -n "\${FAKE_UNHEALTHY_TAG:-}" ] && grep -q ":\${FAKE_UNHEALTHY_TAG}$" "$FAKE_DOCKER_STATE/in-use.txt" 2>/dev/null; then
  printf '{"ok":false}' > "$out"; printf '503'; exit 0
fi
printf '{"ok":true}' > "$out"
printf '200'
`;

const FAKE_FLOCK = '#!/bin/bash\nexit 0\n';

// health_check 算完 deadline 紧接着调用不带参数的 mktemp：在这里睡过一个整秒边界，SECONDS 一定已经走到 deadline，
// 把「整秒跳变正好落在算 deadline 之后」这个偶发时机变成每次都发生。带参数的调用（原子替换 env 文件）不受影响。
const REAL_MKTEMP = execFileSync('sh', ['-c', 'command -v mktemp'], { encoding: 'utf8' }).trim();
const SLOW_MKTEMP = `#!/bin/bash
[ "$#" -eq 0 ] && sleep 1.1
exec '${REAL_MKTEMP}' "$@"
`;

const SHA = 'aaaaaaaaaaaa';
const OLD = 'bbbbbbbbbbbb';
const services = ['server', 'web', 'forum'];
const refs = (repository: string, tag: string) => services.map(service => `${repository}/${service}:${tag}`);

function host() {
  const root = mkdtempSync(join(tmpdir(), 'geek-deploy-scripts-'));
  roots.push(root);
  const bin = join(root, 'bin');
  const state = join(root, 'docker-state');
  mkdirSync(bin);
  mkdirSync(state);
  for (const [name, text] of [['docker', FAKE_DOCKER], ['curl', FAKE_CURL], ['flock', FAKE_FLOCK]]) {
    writeFileSync(join(bin, name), text);
    chmodSync(join(bin, name), 0o755);
  }
  return { root, bin, state };
}

/** 一个环境的栈根：真实 compose 文件 + 由入库模板改写出的 env 文件（STACK_ROOT 指向临时目录）。 */
function stack(root: string, environment: 'preview' | 'production', imageTag: string) {
  const stackRoot = join(root, environment);
  mkdirSync(join(stackRoot, 'deploy/compose'), { recursive: true });
  mkdirSync(join(stackRoot, 'incoming'), { recursive: true });
  cpSync(join(repoRoot, `deploy/compose/${environment}.yml`), join(stackRoot, `deploy/compose/${environment}.yml`));
  const template = readFileSync(join(repoRoot, `deploy/env/.env.${environment}`), 'utf8')
    .replace(/^STACK_ROOT=.*$/m, `STACK_ROOT=${stackRoot}`)
    .replace(/^IMAGE_TAG=.*$/m, `IMAGE_TAG=${imageTag}`);
  const envFile = join(stackRoot, 'incoming', `.env.${environment}`);
  writeFileSync(envFile, template);
  return { stackRoot, envFile };
}

/** 用 docker save 的清单格式造一个只含 manifest.json 的归档，并写好 .sha256。 */
function archive(dir: string, name: string, repoTags: string[]) {
  const work = mkdtempSync(join(dir, 'archive-'));
  writeFileSync(join(work, 'manifest.json'), JSON.stringify(repoTags.map(tag => ({ Config: 'config.json', RepoTags: [tag], Layers: [] }))));
  const path = join(dir, name);
  execFileSync('tar', ['-czf', path, '-C', work, 'manifest.json']);
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  writeFileSync(`${path}.sha256`, `${digest}  ${name}\n`);
  rmSync(work, { recursive: true, force: true });
  return path;
}

function run(h: ReturnType<typeof host>, script: string, args: string[], fakes: Record<string, string> = {}) {
  return spawnSync('bash', [join(repoRoot, 'deploy/remote', script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${h.bin}:${process.env.PATH}`, FAKE_DOCKER_STATE: h.state, ...fakes },
  });
}

const images = (h: ReturnType<typeof host>) =>
  existsSync(join(h.state, 'images.txt')) ? readFileSync(join(h.state, 'images.txt'), 'utf8').split('\n').filter(Boolean).sort() : [];
const seed = (h: ReturnType<typeof host>, list: string[]) => writeFileSync(join(h.state, 'images.txt'), `${[...new Set(list)].sort().join('\n')}\n`);
const inUse = (h: ReturnType<typeof host>) => readFileSync(join(h.state, 'in-use.txt'), 'utf8').split('\n').filter(Boolean).sort();
/** deploy-history.log 的每一行拆成 [时间, 环境, 生效版本, 结果, 说明]。 */
const history = (stackRoot: string) =>
  readFileSync(join(stackRoot, 'deploy-history.log'), 'utf8').split('\n').filter(Boolean).map(line => line.split('\t'));

describe('deploy-stack.sh keeps each environment inside its own image repository', () => {
  it('loads only yzgc-<env>/* for this SHA, prunes only its own repository and never touches the other stack', () => {
    const h = host();
    const preview = stack(h.root, 'preview', SHA);
    // 本机已有另一环境同一 SHA 的镜像，以及本环境 7 个更早的版本。
    const olderPreview = ['111111111111', '222222222222', '333333333333', '444444444444', '555555555555', '666666666666', '777777777777'];
    seed(h, [...refs('yzgc-production', SHA), ...refs('yzgc-production', OLD), ...olderPreview.flatMap(tag => refs('yzgc-preview', tag))]);
    writeFileSync(join(preview.stackRoot, 'deploy-history.log'), olderPreview.map(tag => `2026-09-01T00:00:00Z\tpreview\t${tag}\tOK\tfixture\n`).join(''));
    archive(join(preview.stackRoot, 'incoming'), `yzgc-images-preview-${SHA}.tar.gz`, refs('yzgc-preview', SHA));

    const result = run(h, 'deploy-stack.sh', ['--environment', 'preview', '--incoming-dir', join(preview.stackRoot, 'incoming'), '--health-timeout', '5']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const after = images(h);
    for (const ref of [...refs('yzgc-preview', SHA), ...refs('yzgc-production', SHA), ...refs('yzgc-production', OLD)]) expect(after).toContain(ref);
    // 保留当前 + 最近 5 个历史版本；最早的两个被清理，但只清理 yzgc-preview/*。
    for (const tag of ['111111111111', '222222222222']) for (const ref of refs('yzgc-preview', tag)) expect(after).not.toContain(ref);
    for (const tag of olderPreview.slice(2)) for (const ref of refs('yzgc-preview', tag)) expect(after).toContain(ref);
    expect(readFileSync(join(h.state, 'in-use.txt'), 'utf8').split('\n').filter(Boolean).sort()).toEqual(refs('yzgc-preview', SHA).sort());
    expect(readFileSync(join(preview.stackRoot, 'deploy-history.log'), 'utf8')).toMatch(new RegExp(`\\tpreview\\t${SHA}\\tOK\\t`));
  });

  it('deploys only the archive named by --images when an earlier archive is still in incoming', () => {
    const h = host();
    const preview = stack(h.root, 'preview', SHA);
    const incoming = join(preview.stackRoot, 'incoming');
    // 上一次失败的部署（另一个 SHA）把归档留在了 incoming 里：只有成功的部署才清理 incoming。
    archive(incoming, `yzgc-images-preview-${OLD}.tar.gz`, refs('yzgc-preview', OLD));
    const current = archive(incoming, `yzgc-images-preview-${SHA}.tar.gz`, refs('yzgc-preview', SHA));
    const whole = run(h, 'deploy-stack.sh', ['--environment', 'preview', '--incoming-dir', incoming, '--health-timeout', '5']);
    expect(whole.status).toBe(1);
    expect(whole.stderr).toMatch(/不属于本环境本版本/);
    const named = run(h, 'deploy-stack.sh', ['--environment', 'preview', '--incoming-dir', incoming, '--images', current, '--health-timeout', '5']);
    expect(named.stderr).toBe('');
    expect(named.status).toBe(0);
    expect(readFileSync(join(h.state, 'in-use.txt'), 'utf8').split('\n').filter(Boolean).sort()).toEqual(refs('yzgc-preview', SHA).sort());
  });

  it.each([
    ['the old shared name', ['yzgc/server', 'yzgc/web', 'yzgc/forum'].map(repository => `${repository}:${SHA}`)],
    ['the other environment', refs('yzgc-production', SHA)],
    ['one foreign image mixed in', [...refs('yzgc-preview', SHA), `yzgc-production/web:${SHA}`]],
    ['another SHA', refs('yzgc-preview', OLD)],
  ])('refuses an archive carrying %s before docker load', (_label, repoTags) => {
    const h = host();
    const preview = stack(h.root, 'preview', SHA);
    const before = [...refs('yzgc-production', SHA)];
    seed(h, before);
    archive(join(preview.stackRoot, 'incoming'), `yzgc-images-preview-${SHA}.tar.gz`, repoTags);
    const result = run(h, 'deploy-stack.sh', ['--environment', 'preview', '--incoming-dir', join(preview.stackRoot, 'incoming'), '--health-timeout', '5']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/不属于本环境本版本|缺少 yzgc-preview/);
    expect(images(h)).toEqual(before.sort());
    expect(readFileSync(join(preview.stackRoot, 'deploy-history.log'), 'utf8')).toContain('\tFAILED\t');
  });

  it('refuses to start when the compose file on the host still uses the shared yzgc/* names', () => {
    const h = host();
    const production = stack(h.root, 'production', SHA);
    const composePath = join(production.stackRoot, 'deploy/compose/production.yml');
    writeFileSync(composePath, readFileSync(composePath, 'utf8').replaceAll('image: yzgc-production/', 'image: yzgc/'));
    archive(join(production.stackRoot, 'incoming'), `yzgc-images-production-${SHA}.tar.gz`, refs('yzgc-production', SHA));
    const result = run(h, 'deploy-stack.sh', ['--environment', 'production', '--incoming-dir', join(production.stackRoot, 'incoming'), '--health-timeout', '5']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('compose 文件解析出的镜像不是 yzgc-production/');
    expect(images(h)).toEqual([]);
  });
});

describe('deploy-stack.sh rolls back the same way whether compose up or the health check fails', () => {
  it.each([
    ['docker compose up -d exits non-zero', { FAKE_DOCKER_UP_FAIL_TAG: SHA }, 'docker compose up -d 失败'],
    ['the health check times out', { FAKE_UNHEALTHY_TAG: SHA }, '健康检查超时'],
  ])('goes back to the previous tag when %s on the new tag', (_label, failure, reason) => {
    const h = host();
    const preview = stack(h.root, 'preview', SHA);
    const incoming = join(preview.stackRoot, 'incoming');
    // 线上正在跑 OLD：栈根的 env、本机镜像和历史都对得上。
    writeFileSync(join(preview.stackRoot, '.env.preview'), readFileSync(preview.envFile, 'utf8').replace(`IMAGE_TAG=${SHA}`, `IMAGE_TAG=${OLD}`));
    seed(h, refs('yzgc-preview', OLD));
    writeFileSync(join(preview.stackRoot, 'deploy-history.log'), `2026-09-01T00:00:00Z\tpreview\t${OLD}\tOK\tfixture\n`);
    const current = archive(incoming, `yzgc-images-preview-${SHA}.tar.gz`, refs('yzgc-preview', SHA));

    const result = run(h, 'deploy-stack.sh', [
      '--environment', 'preview', '--incoming-dir', incoming, '--images', current, '--env-file', preview.envFile, '--health-timeout', '1',
    ], failure);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`已回滚：preview 现在是 ${OLD}`);
    const rows = history(preview.stackRoot).slice(1);
    expect(rows.map(row => [row[2], row[3]])).toEqual([[SHA, 'FAILED'], [OLD, 'ROLLED_BACK']]);
    expect(rows[0][4]).toContain(reason);
    expect(readFileSync(join(preview.stackRoot, '.env.preview'), 'utf8')).toContain(`IMAGE_TAG=${OLD}`);
    expect(inUse(h)).toEqual(refs('yzgc-preview', OLD).sort());
    // 失败的部署不清理 incoming：归档和 env 文件留给维护者排查或重跑。
    for (const file of [current, `${current}.sha256`, preview.envFile]) expect(existsSync(file)).toBe(true);
  });

  it('records FAILED then ROLLBACK_SKIPPED when compose up fails on the first deploy', () => {
    const h = host();
    const preview = stack(h.root, 'preview', SHA);
    const incoming = join(preview.stackRoot, 'incoming');
    archive(incoming, `yzgc-images-preview-${SHA}.tar.gz`, refs('yzgc-preview', SHA));
    const result = run(h, 'deploy-stack.sh', ['--environment', 'preview', '--incoming-dir', incoming, '--health-timeout', '1'], { FAKE_DOCKER_UP_FAIL_TAG: SHA });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('没有上一个版本可回滚');
    expect(history(preview.stackRoot).map(row => [row[2], row[3]])).toEqual([[SHA, 'FAILED'], [SHA, 'ROLLBACK_SKIPPED']]);
  });
});

describe('health_check probes before it looks at the deadline', () => {
  const slowMktemp = (h: ReturnType<typeof host>) => {
    writeFileSync(join(h.bin, 'mktemp'), SLOW_MKTEMP);
    chmodSync(join(h.bin, 'mktemp'), 0o755);
  };

  it('deploy-stack.sh passes when the first probe is healthy even if SECONDS already reached the deadline', () => {
    const h = host();
    slowMktemp(h);
    const preview = stack(h.root, 'preview', SHA);
    const incoming = join(preview.stackRoot, 'incoming');
    archive(incoming, `yzgc-images-preview-${SHA}.tar.gz`, refs('yzgc-preview', SHA));
    const result = run(h, 'deploy-stack.sh', ['--environment', 'preview', '--incoming-dir', incoming, '--health-timeout', '1']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(history(preview.stackRoot).map(row => [row[2], row[3]])).toEqual([[SHA, 'OK']]);
  });

  it('rollback-stack.sh passes when the first probe is healthy even if SECONDS already reached the deadline', () => {
    const h = host();
    slowMktemp(h);
    const preview = stack(h.root, 'preview', SHA);
    const stackEnv = join(preview.stackRoot, '.env.preview');
    cpSync(preview.envFile, stackEnv);
    seed(h, [...refs('yzgc-preview', SHA), ...refs('yzgc-preview', OLD)]);
    const result = run(h, 'rollback-stack.sh', ['--environment', 'preview', '--to', OLD, '--env-file', stackEnv, '--health-timeout', '1']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(history(preview.stackRoot).map(row => [row[2], row[3]])).toEqual([[OLD, 'MANUAL_ROLLBACK']]);
  });
});

describe('deploy-stack.sh clears incoming only after a successful deploy', () => {
  it('removes this environment\'s archives and env file from incoming, this run\'s and older, and nothing else', () => {
    const h = host();
    const preview = stack(h.root, 'preview', SHA);
    const production = stack(h.root, 'production', OLD);
    const incoming = join(preview.stackRoot, 'incoming');
    archive(incoming, `yzgc-images-preview-${OLD}.tar.gz`, refs('yzgc-preview', OLD));
    const current = archive(incoming, `yzgc-images-preview-${SHA}.tar.gz`, refs('yzgc-preview', SHA));
    // 另一环境的文件即使落在同一个目录里也不动；部署脚本本身这类别的文件也不动。
    archive(incoming, `yzgc-images-production-${SHA}.tar.gz`, refs('yzgc-production', SHA));
    writeFileSync(join(incoming, '.env.production'), 'GEEK_DEPLOYMENT_ENVIRONMENT=production\n');
    writeFileSync(join(incoming, 'deploy-stack.sh'), '# 分发来的部署脚本\n');
    archive(join(production.stackRoot, 'incoming'), `yzgc-images-production-${OLD}.tar.gz`, refs('yzgc-production', OLD));

    const result = run(h, 'deploy-stack.sh', [
      '--environment', 'preview', '--incoming-dir', incoming, '--images', current, '--env-file', preview.envFile, '--health-timeout', '5',
    ]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readdirSync(incoming).sort()).toEqual(
      ['.env.production', 'deploy-stack.sh', `yzgc-images-production-${SHA}.tar.gz`, `yzgc-images-production-${SHA}.tar.gz.sha256`].sort(),
    );
    expect(readdirSync(join(production.stackRoot, 'incoming')).sort()).toEqual(
      ['.env.production', `yzgc-images-production-${OLD}.tar.gz`, `yzgc-images-production-${OLD}.tar.gz.sha256`].sort(),
    );
    // compose 读的是栈根里安装好的那份 env，它不在清理范围内。
    expect(readFileSync(join(preview.stackRoot, '.env.preview'), 'utf8')).toContain(`IMAGE_TAG=${SHA}`);
  });

  it('never deletes the installed env file even when --incoming-dir is the stack root', () => {
    const h = host();
    const preview = stack(h.root, 'preview', SHA);
    const stackEnv = join(preview.stackRoot, '.env.preview');
    cpSync(preview.envFile, stackEnv);
    const current = archive(preview.stackRoot, `yzgc-images-preview-${SHA}.tar.gz`, refs('yzgc-preview', SHA));
    const result = run(h, 'deploy-stack.sh', ['--environment', 'preview', '--incoming-dir', preview.stackRoot, '--health-timeout', '5']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(existsSync(current)).toBe(false);
    expect(existsSync(`${current}.sha256`)).toBe(false);
    expect(readFileSync(stackEnv, 'utf8')).toContain(`IMAGE_TAG=${SHA}`);
  });

  it('leaves files alone when no --incoming-dir is given', () => {
    const h = host();
    const preview = stack(h.root, 'preview', SHA);
    const upload = join(h.root, 'upload');
    mkdirSync(upload);
    const current = archive(upload, `yzgc-images-preview-${SHA}.tar.gz`, refs('yzgc-preview', SHA));
    const envFile = join(upload, '.env.preview');
    cpSync(preview.envFile, envFile);
    const result = run(h, 'deploy-stack.sh', ['--environment', 'preview', '--images', current, '--env-file', envFile, '--health-timeout', '5']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    for (const file of [current, `${current}.sha256`, envFile, preview.envFile]) expect(existsSync(file)).toBe(true);
  });

  it('keeps a file whose name only matches the archive pattern once its trailing newline is stripped', () => {
    const h = host();
    const preview = stack(h.root, 'preview', SHA);
    const incoming = join(preview.stackRoot, 'incoming');
    const current = archive(incoming, `yzgc-images-preview-${SHA}.tar.gz`, refs('yzgc-preview', SHA));
    const trailing = join(incoming, `yzgc-images-preview-${OLD}.tar.gz\n`);
    writeFileSync(trailing, 'not an archive of ours\n');
    const result = run(h, 'deploy-stack.sh', [
      '--environment', 'preview', '--incoming-dir', incoming, '--images', current, '--env-file', preview.envFile, '--health-timeout', '5',
    ]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(existsSync(current)).toBe(false);
    expect(existsSync(trailing)).toBe(true);
  });

  it('keeps the incoming env file when the installed env is a symlink to it', () => {
    const h = host();
    const preview = stack(h.root, 'preview', SHA);
    const incoming = join(preview.stackRoot, 'incoming');
    const current = archive(incoming, `yzgc-images-preview-${SHA}.tar.gz`, refs('yzgc-preview', SHA));
    // 工作流不会这样装，但手工做成的链接不能在清理后变成悬空链接。
    const stackEnv = join(preview.stackRoot, '.env.preview');
    symlinkSync(preview.envFile, stackEnv);
    const result = run(h, 'deploy-stack.sh', [
      '--environment', 'preview', '--incoming-dir', incoming, '--images', current, '--env-file', stackEnv, '--health-timeout', '5',
    ]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(existsSync(current)).toBe(false);
    expect(lstatSync(stackEnv).isSymbolicLink()).toBe(true);
    expect(readFileSync(stackEnv, 'utf8')).toContain(`IMAGE_TAG=${SHA}`);
  });

  // root 不受目录权限限制，删不失败，这条路径造不出来。
  it.skipIf(process.getuid?.() === 0)('reports a failed cleanup as a warning without failing the deploy', () => {
    const h = host();
    const preview = stack(h.root, 'preview', SHA);
    const incoming = join(preview.stackRoot, 'incoming');
    const current = archive(incoming, `yzgc-images-preview-${SHA}.tar.gz`, refs('yzgc-preview', SHA));
    chmodSync(incoming, 0o500);
    try {
      const result = run(h, 'deploy-stack.sh', [
        '--environment', 'preview', '--incoming-dir', incoming, '--images', current, '--env-file', preview.envFile, '--health-timeout', '5',
      ]);
      expect(result.status).toBe(0);
      expect(history(preview.stackRoot).at(-1)?.slice(2, 4)).toEqual([SHA, 'OK']);
      expect(result.stdout).toMatch(/^::warning::清理 incoming 失败/m);
      expect(result.stderr).toContain('清理 incoming 失败');
      for (const file of [current, `${current}.sha256`, preview.envFile]) expect(existsSync(file)).toBe(true);
    } finally {
      chmodSync(incoming, 0o700);
    }
  });
});

describe('rollback-stack.sh only rolls back to images of its own environment', () => {
  it('refuses a target that exists only in the other environment, and succeeds once its own images are present', () => {
    const h = host();
    const preview = stack(h.root, 'preview', SHA);
    const stackEnv = join(preview.stackRoot, '.env.preview');
    cpSync(preview.envFile, stackEnv);
    // OLD 只有正式环境的镜像：同一 SHA，但构建参数属于正式环境，不能拿来回滚预发布。
    seed(h, [...refs('yzgc-preview', SHA), ...refs('yzgc-production', OLD)]);
    const refused = run(h, 'rollback-stack.sh', ['--environment', 'preview', '--to', OLD, '--env-file', stackEnv, '--health-timeout', '5']);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(`本机没有 yzgc-preview/server:${OLD}`);
    expect(readFileSync(stackEnv, 'utf8')).toContain(`IMAGE_TAG=${SHA}`);

    seed(h, [...refs('yzgc-preview', SHA), ...refs('yzgc-production', OLD), ...refs('yzgc-preview', OLD)]);
    const accepted = run(h, 'rollback-stack.sh', ['--environment', 'preview', '--to', OLD, '--env-file', stackEnv, '--health-timeout', '5']);
    expect(accepted.stderr).toBe('');
    expect(accepted.status).toBe(0);
    expect(readFileSync(stackEnv, 'utf8')).toContain(`IMAGE_TAG=${OLD}`);
    expect(readFileSync(join(h.state, 'in-use.txt'), 'utf8').split('\n').filter(Boolean).sort()).toEqual(refs('yzgc-preview', OLD).sort());
    // 回滚不清理镜像，也不碰另一环境。
    expect(images(h)).toEqual([...refs('yzgc-preview', SHA), ...refs('yzgc-production', OLD), ...refs('yzgc-preview', OLD)].sort());
  });
});
