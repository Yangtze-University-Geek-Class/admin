import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ENVIRONMENTS,
  IMAGE_SERVICES,
  OPTIONAL_SECRET_PAIR,
  SECRET_FIELDS,
  composeImageReferences,
  deploymentTarget,
  imageReference,
  imageRepositoryPrefix,
  parseEnvFileText,
  readEnvironment,
  renderRuntimeEnv,
  validateEnvironmentContract,
  validateEnvironmentFiles,
} from '../../scripts/deployment-environment.mjs';
import { auditRepository, scanText } from '../../scripts/check-secrets.mjs';

// 全部夹具都放在临时目录：只有「提交态模板」这一条测试读仓库里的真实 env 文件（它们不含任何密钥）。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot({ withStack = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'geek-env-fixture-'));
  roots.push(root);
  cpSync(join(repoRoot, 'deploy/env'), join(root, 'deploy/env'), { recursive: true });
  cpSync(join(repoRoot, 'deploy/environments.json'), join(root, 'deploy/environments.json'));
  if (withStack) {
    cpSync(join(repoRoot, 'deploy/compose'), join(root, 'deploy/compose'), { recursive: true });
    cpSync(join(repoRoot, 'deploy/remote'), join(root, 'deploy/remote'), { recursive: true });
  }
  return root;
}

const secrets = Object.fromEntries(SECRET_FIELDS.map(field => [field, `${field.toLowerCase()}-fixture-value`]));

describe('environment identity contract', () => {
  it('binds each environment to its own https entry and refuses unknown or swapped targets', () => {
    expect(deploymentTarget('preview')).toMatchObject({ origin: 'https://prev.yangtzeu.work', githubEnvironment: 'preview' });
    expect(deploymentTarget('production')).toMatchObject({ origin: 'https://yangtzeu.work', githubEnvironment: 'production' });
    expect(deploymentTarget('preview', 'https://prev.yangtzeu.work/').origin).toBe('https://prev.yangtzeu.work');
    for (const label of ['prev', 'development', '__proto__', 'preview ']) {
      expect(() => deploymentTarget(label)).toThrow();
    }
  });

  it.each([
    ['preview', 'https://yangtzeu.work'],
    ['production', 'https://prev.yangtzeu.work'],
    ['preview', 'http://prev.yangtzeu.work'],
    ['preview', 'https://prev.yangtzeu.work.attacker.example'],
    ['preview', 'https://prev.yangtzeu.work@attacker.example'],
    ['production', 'https://user:password@yangtzeu.work'],
    ['production', 'https://yangtzeu.work:8443'],
    ['production', 'https://yangtzeu.work/path'],
    ['preview', 'https://prev.yangtzeu.work?environment=production'],
  ])('rejects crossed or malformed target %s %s', (environment, origin) => {
    expect(() => deploymentTarget(environment, origin)).toThrow();
  });

  it('rejects a contract whose environments are swapped, renamed or schema-drifted', () => {
    const valid = validateEnvironmentContract();
    const swapped = structuredClone(valid);
    swapped.environments.preview.origin = 'https://yangtzeu.work';
    expect(() => validateEnvironmentContract(swapped)).toThrow(/prev\.yangtzeu\.work|域名|origin/);

    const crossWired = structuredClone(valid);
    crossWired.environments.production.githubEnvironment = 'preview';
    expect(() => validateEnvironmentContract(crossWired)).toThrow();

    const drifted = structuredClone(valid);
    drifted.schemaVersion = 2;
    expect(() => validateEnvironmentContract(drifted)).toThrow(/schemaVersion/);
  });
});

describe('committed env templates are the single source of deploy facts', () => {
  it('keeps both stacks fully isolated with loopback-only ports and empty secret fields', () => {
    const report = validateEnvironmentFiles({ checkCompose: false });
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.environments.map(item => item.name)).toEqual([...ENVIRONMENTS]);

    const production = report.environments.find(item => item.name === 'production').values;
    const preview = report.environments.find(item => item.name === 'preview').values;
    for (const field of ['WEB_BIND', 'SERVER_BIND']) {
      expect(production.get(field)).toMatch(/^127\.0\.0\.1:\d{4,5}$/);
      expect(preview.get(field)).toMatch(/^127\.0\.0\.1:\d{4,5}$/);
      expect(production.get(field)).not.toBe(preview.get(field));
    }
    expect(production.get('STACK_ROOT')).not.toBe(preview.get('STACK_ROOT'));
    expect(production.get('COMPOSE_PROJECT_NAME')).not.toBe(preview.get('COMPOSE_PROJECT_NAME'));
    for (const field of SECRET_FIELDS) {
      expect(production.get(field)).toBe('');
      expect(preview.get(field)).toBe('');
    }
    // 每个环境只有一个对外 origin，逐字等于 deploy/environments.json；按站点的 host 字段已退役。
    expect(production.get('PUBLIC_ORIGIN')).toBe('https://yangtzeu.work');
    expect(preview.get('PUBLIC_ORIGIN')).toBe('https://prev.yangtzeu.work');
    for (const retired of ['SITE_ORIGIN', 'ADMIN_HOST', 'PORTAL_HOST', 'FORUM_HOST']) {
      expect(production.has(retired)).toBe(false);
      expect(preview.has(retired)).toBe(false);
    }
    expect(readEnvironment(repoRoot, 'production')).not.toHaveProperty('hosts');
  });

  it('fails closed when a template carries a real secret or loses isolation', () => {
    const leaked = fixtureRoot();
    const leakedPath = join(leaked, 'deploy/env/.env.preview');
    writeFileSync(leakedPath, readFileSync(leakedPath, 'utf8').replace('\nSESSION_SECRET=\n', '\nSESSION_SECRET=committed-value\n'));
    const leakedReport = validateEnvironmentFiles({ root: leaked, checkCompose: false });
    expect(leakedReport.ok).toBe(false);
    expect(leakedReport.problems.join('\n')).toContain('SESSION_SECRET');

    const collided = fixtureRoot();
    const collidedPath = join(collided, 'deploy/env/.env.preview');
    writeFileSync(collidedPath, readFileSync(collidedPath, 'utf8').replace('WEB_BIND=127.0.0.1:18200', 'WEB_BIND=127.0.0.1:18100'));
    const collidedReport = validateEnvironmentFiles({ root: collided, checkCompose: false });
    expect(collidedReport.ok).toBe(false);
    expect(collidedReport.problems.join('\n')).toContain('WEB_BIND');
  });

  it('pins PUBLIC_ORIGIN to the environment origin and rejects the retired host split', () => {
    const edit = (name: string, from: string, to: string) => {
      const root = fixtureRoot();
      const path = join(root, `deploy/env/.env.${name}`);
      const before = readFileSync(path, 'utf8');
      expect(before).toContain(from);
      writeFileSync(path, before.replace(from, to));
      return validateEnvironmentFiles({ root, checkCompose: false });
    };
    const cases: Array<[string, string, string, RegExp]> = [
      // 管理端子域不再是合法 origin，两环境也不能互换或共用同一个 origin。
      ['production', 'PUBLIC_ORIGIN=https://yangtzeu.work', 'PUBLIC_ORIGIN=https://github.yangtzeu.work', /PUBLIC_ORIGIN 必须逐字等于.*https:\/\/yangtzeu\.work/],
      ['preview', 'PUBLIC_ORIGIN=https://prev.yangtzeu.work', 'PUBLIC_ORIGIN=https://prev-admin.yangtzeu.work', /PUBLIC_ORIGIN 必须逐字等于/],
      ['preview', 'PUBLIC_ORIGIN=https://prev.yangtzeu.work', 'PUBLIC_ORIGIN=https://yangtzeu.work', /PUBLIC_ORIGIN/],
      ['production', 'PUBLIC_ORIGIN=https://yangtzeu.work', 'PUBLIC_ORIGIN=https://yangtzeu.work/', /PUBLIC_ORIGIN 必须逐字等于/],
      ['production', 'PUBLIC_ORIGIN=https://yangtzeu.work', 'PUBLIC_ORIGIN=http://yangtzeu.work', /https/],
      ['production', 'PUBLIC_ORIGIN=https://yangtzeu.work\n', '', /缺少字段 PUBLIC_ORIGIN/],
      // 退役字段重新出现即失败：它们会悄悄长出第二份域名配置。
      ['production', 'PUBLIC_ORIGIN=https://yangtzeu.work', 'PUBLIC_ORIGIN=https://yangtzeu.work\nADMIN_HOST=github.yangtzeu.work', /ADMIN_HOST 不在环境契约里/],
      ['preview', 'PUBLIC_ORIGIN=https://prev.yangtzeu.work', 'PUBLIC_ORIGIN=https://prev.yangtzeu.work\nSITE_ORIGIN=https://prev.yangtzeu.work', /SITE_ORIGIN 不在环境契约里/],
      // host-only cookie 对两个环境都成立。
      ['preview', 'COOKIE_DOMAIN=', 'COOKIE_DOMAIN=.yangtzeu.work', /COOKIE_DOMAIN 必须留空/],
    ];
    for (const [name, from, to, message] of cases) {
      const report = edit(name, from, to);
      expect(report.ok, `${name}: ${to}`).toBe(false);
      expect(report.problems.join('\n')).toMatch(message);
    }
  });
});

describe('per-environment image repositories on the shared Docker host', () => {
  const sha = '0123456789ab';
  const composeText = (root: string, environment: string) => readFileSync(join(root, `deploy/compose/${environment}.yml`), 'utf8');

  it('resolves the two committed compose files to disjoint image references for the same SHA', () => {
    const preview = composeImageReferences(composeText(repoRoot, 'preview'), sha).sort();
    const production = composeImageReferences(composeText(repoRoot, 'production'), sha).sort();
    expect(preview).toEqual(IMAGE_SERVICES.map(service => `yzgc-preview/${service}:${sha}`).sort());
    expect(production).toEqual(IMAGE_SERVICES.map(service => `yzgc-production/${service}:${sha}`).sort());
    // 两套栈共用一个 Docker 守护进程：同一提交绝不能落到同一个镜像引用上。
    expect(preview.filter(reference => production.includes(reference))).toEqual([]);
    expect(imageRepositoryPrefix('preview')).toBe('yzgc-preview');
    expect(imageReference('production', 'web', sha)).toBe(`yzgc-production/web:${sha}`);
    expect(() => imageRepositoryPrefix('staging')).toThrow();
    expect(() => imageReference('preview', 'db', sha)).toThrow();
  });

  it('passes the full compose check on the committed stack', () => {
    const report = validateEnvironmentFiles();
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('fails when both compose files resolve to the same image reference for the same SHA', () => {
    // 回到修复前的写法：两套栈都用 yzgc/<服务>:${IMAGE_TAG}。
    const shared = fixtureRoot({ withStack: true });
    for (const environment of ENVIRONMENTS) {
      const path = join(shared, `deploy/compose/${environment}.yml`);
      writeFileSync(path, readFileSync(path, 'utf8').replaceAll(`image: yzgc-${environment}/`, 'image: yzgc/'));
    }
    const report = validateEnvironmentFiles({ root: shared });
    expect(report.ok).toBe(false);
    const problems = report.problems.join('\n');
    expect(problems).toContain('两套 compose 在同一提交上解析出同一个镜像引用 yzgc/web:<sha12>');
    expect(problems).toContain('必须使用 yzgc-preview/server');
  });

  it('fails when one stack points at the other environment\'s repository', () => {
    const crossed = fixtureRoot({ withStack: true });
    const path = join(crossed, 'deploy/compose/preview.yml');
    writeFileSync(path, readFileSync(path, 'utf8').replace('image: yzgc-preview/web:', 'image: yzgc-production/web:'));
    const problems = validateEnvironmentFiles({ root: crossed }).problems.join('\n');
    expect(problems).toContain('yzgc-production/web:${IMAGE_TAG} 不属于 yzgc-preview/');
    expect(problems).toContain('同一个镜像引用 yzgc-production/web:<sha12>');
  });
});

describe('runtime env rendering', () => {
  it('injects the environment secrets and the release tag without echoing values', () => {
    const root = fixtureRoot();
    const out = join(root, 'runtime/.env.preview');
    const result = renderRuntimeEnv({ root, environment: 'preview', out, imageTag: 'a1b2c3d4e5f6', env: secrets });
    expect(result.secretFields).toEqual([...SECRET_FIELDS]);
    const rendered = readFileSync(out, 'utf8');
    expect(rendered).toContain('GEEK_DEPLOYMENT_ENVIRONMENT=preview');
    expect(rendered.split('\n').length).toBe(readFileSync(join(root, 'deploy/env/.env.preview'), 'utf8').split('\n').length + 1);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    const values = parseEnvFileText(rendered, 'rendered');
    expect(values.get('IMAGE_TAG')).toBe('a1b2c3d4e5f6');
    for (const field of SECRET_FIELDS) expect(values.get(field)).toBe(secrets[field]);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('refuses to render a half-configured file or a non-SHA release tag', () => {
    const root = fixtureRoot();
    const out = join(root, 'runtime/.env.production');
    const { SESSION_SECRET, ...incomplete } = secrets;
    void SESSION_SECRET;
    expect(() => renderRuntimeEnv({ root, environment: 'production', out, imageTag: 'a1b2c3d4e5f6', env: incomplete })).toThrow(/SESSION_SECRET/);
    expect(() => renderRuntimeEnv({
      root,
      environment: 'production',
      out,
      imageTag: 'a1b2c3d4e5f6',
      env: { ...secrets, SESSION_SECRET: 'value with spaces' },
    })).toThrow(/SESSION_SECRET/);
    for (const imageTag of ['latest', 'A1B2C3D4E5F6', 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4']) {
      expect(() => renderRuntimeEnv({ root, environment: 'production', out, imageTag, env: secrets })).toThrow(/IMAGE_TAG/);
    }
  });
});

describe('optional Turnstile pair', () => {
  it('treats both Turnstile keys empty as Turnstile off and writes them empty', () => {
    const root = fixtureRoot();
    const out = join(root, 'runtime/.env.preview');
    const { TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY, ...rest } = secrets;
    void TURNSTILE_SITE_KEY; void TURNSTILE_SECRET_KEY;
    const result = renderRuntimeEnv({ root, environment: 'preview', out, imageTag: 'a1b2c3d4e5f6', env: rest });
    expect(result.turnstile).toBe('off');
    expect(result.secretFields).toEqual(SECRET_FIELDS.filter(field => !OPTIONAL_SECRET_PAIR.includes(field)));
    const values = parseEnvFileText(readFileSync(out, 'utf8'), 'rendered');
    expect(values.get('TURNSTILE_SITE_KEY')).toBe('');
    expect(values.get('TURNSTILE_SECRET_KEY')).toBe('');
    expect(values.get('SESSION_SECRET')).toBe(secrets.SESSION_SECRET);
    // 空字符串与缺失一样算「没填」。
    expect(renderRuntimeEnv({ root, environment: 'preview', out, imageTag: 'a1b2c3d4e5f6', env: { ...rest, TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' } }).turnstile).toBe('off');
  });

  it('refuses exactly one Turnstile key and still requires every other secret', () => {
    const root = fixtureRoot();
    const out = join(root, 'runtime/.env.production');
    expect(() => renderRuntimeEnv({ root, environment: 'production', out, imageTag: 'a1b2c3d4e5f6', env: { ...secrets, TURNSTILE_SECRET_KEY: '' } })).toThrow(/只配了一项/);
    expect(() => renderRuntimeEnv({ root, environment: 'production', out, imageTag: 'a1b2c3d4e5f6', env: { ...secrets, TURNSTILE_SITE_KEY: '' } })).toThrow(/只配了一项/);
    // Turnstile 关闭时，其余每一个密钥仍然必填。
    const { TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY, ...required } = secrets;
    void TURNSTILE_SITE_KEY; void TURNSTILE_SECRET_KEY;
    for (const field of SECRET_FIELDS.filter(name => !OPTIONAL_SECRET_PAIR.includes(name))) {
      const { [field]: missing, ...rest } = required as Record<string, string>;
      void missing;
      expect(() => renderRuntimeEnv({ root, environment: 'production', out, imageTag: 'a1b2c3d4e5f6', env: rest })).toThrow(new RegExp(field));
    }
    expect(renderRuntimeEnv({ root, environment: 'production', out, imageTag: 'a1b2c3d4e5f6', env: secrets }).turnstile).toBe('on');
  });
});

describe('env file parsing', () => {
  it('rejects duplicates and non KEY=VALUE lines, and strips surrounding quotes', () => {
    expect(parseEnvFileText('# comment\nPORT=3000\nQUOTED="a b"\n').get('QUOTED')).toBe('a b');
    expect(() => parseEnvFileText('PORT=3000\nPORT=3001\n')).toThrow(/重复/);
    expect(() => parseEnvFileText('not an assignment\n')).toThrow();
    expect(() => parseEnvFileText('lower=1\n')).toThrow();
  });
});

describe('repo-wide secret guard', () => {
  it('rejects non-empty secret keys in template env files, credential material and private env files', () => {
    expect(scanText('deploy/env/.env.preview', 'PUBLIC_ORIGIN=https://yangtzeu.work\nOAUTH_CLIENT_ID=\nSESSION_SECRET=\n').join('\n')).toBe('');
    expect(scanText('deploy/env/.env.preview', 'SESSION_SECRET=committed-value').join('\n')).toContain('SESSION_SECRET');
    expect(scanText('deploy/env/.env.production', 'ENCRYPTION_KEY="dGhpcy1pcy1hLWtleQ=="').join('\n')).toContain('ENCRYPTION_KEY');
    expect(scanText('scripts/tooling-fixture.mjs', `const token = "ghp_${'a'.repeat(36)}"`).join('\n')).toContain('GitHub token');
    // 字面量拆开写：否则本测试文件自己会被密钥门禁命中（扫描的是仓库全部文本文件）。
    expect(scanText('deploy/x.conf', `-----BEGIN OPENSSH ${'PRIVATE KEY-----'}`).join('\n')).toContain('private key');

    const root = mkdtempSync(join(tmpdir(), 'geek-secret-fixture-'));
    roots.push(root);
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    writeFileSync(join(root, '.env.local'), 'SESSION_SECRET=local-only\n');
    writeFileSync(join(root, 'data.db'), '');
    const report = auditRepository({ repoRoot: root });
    expect(report.ok).toBe(false);
    expect(report.findings.join('\n')).toContain('.env.local');
    expect(report.findings.join('\n')).toContain('data.db');
  });

  it('passes on the real repository templates', () => {
    const report = auditRepository();
    expect(report.findings).toEqual([]);
    expect(report.checked).toBeGreaterThan(50);
  });
});
