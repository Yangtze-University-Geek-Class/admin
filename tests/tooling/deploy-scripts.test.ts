import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
      *" up "*) compose_images "$@" > "$state/in-use.txt"; echo "up $*" >> "$state/compose.log"; exit 0 ;;
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
printf '{"ok":true}' > "$out"
printf '200'
`;

const FAKE_FLOCK = '#!/bin/bash\nexit 0\n';

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

function run(h: ReturnType<typeof host>, script: string, args: string[]) {
  return spawnSync('bash', [join(repoRoot, 'deploy/remote', script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${h.bin}:${process.env.PATH}`, FAKE_DOCKER_STATE: h.state },
  });
}

const images = (h: ReturnType<typeof host>) =>
  existsSync(join(h.state, 'images.txt')) ? readFileSync(join(h.state, 'images.txt'), 'utf8').split('\n').filter(Boolean).sort() : [];
const seed = (h: ReturnType<typeof host>, list: string[]) => writeFileSync(join(h.state, 'images.txt'), `${[...new Set(list)].sort().join('\n')}\n`);

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
    // 上一次部署（另一个 SHA）的归档留在 incoming 里，没有任何步骤删它。
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
