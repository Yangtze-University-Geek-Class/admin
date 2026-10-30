import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ENVIRONMENTS,
  IMAGE_SERVICES,
  GOOGLE_SECRET_PAIR,
  MAIL_ALIYUN_SECRET_PAIR,
  OIDC_GITLAB_SECRETS,
  OBJECT_STORAGE_SECRETS,
  BACKUP_SECRETS,
  OPTIONAL_SECRETS,
  OPTIONAL_SECRET_PAIR,
  PROXY_HOPS,
  REQUIRED_SECRET_FIELDS,
  SECRET_FIELDS,
  composeImageReferences,
  deploymentTarget,
  imageReference,
  imageRepositoryPrefix,
  isAddressList,
  isPlainAddress,
  parseEnvFileText,
  parseMailAssetBase,
  parseProxyJump,
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

// 收件名单是逗号隔开的邮箱，其余密钥用「字段名-fixture-value」形状的假值。
const ALLOWLIST = 'tester@example.com,Second.Tester@Example.org';
const secrets: Record<string, string> = {
  ...Object.fromEntries(SECRET_FIELDS.map(field => [field, `${field.toLowerCase()}-fixture-value`])),
  MAIL_ALLOWLIST: ALLOWLIST,
  MAIL_ALIYUN_FROM: 'notify@mail.example.test',
  MAIL_RESEND_FROM: 'notify@example.test',
};
const without = (source: Record<string, string>, fields: readonly string[]) =>
  Object.fromEntries(Object.entries(source).filter(([field]) => !fields.includes(field)));

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
  it('keeps both stacks fully isolated with controlled bind ports and empty secret fields', () => {
    const report = validateEnvironmentFiles({ checkCompose: false });
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.environments.map(item => item.name)).toEqual([...ENVIRONMENTS]);

    const production = report.environments.find(item => item.name === 'production').values;
    const preview = report.environments.find(item => item.name === 'preview').values;
    expect(production.get('WEB_BIND')).toBe('10.66.0.2:18100');
    expect(preview.get('WEB_BIND')).toBe('10.66.0.2:18200');
    expect(production.get('SERVER_BIND')).toBe('127.0.0.1:18101');
    expect(preview.get('SERVER_BIND')).toBe('127.0.0.1:18201');
    expect(production.get('DEPLOY_HOST')).toBe('10.66.0.2');
    expect(preview.get('DEPLOY_HOST')).toBe('10.66.0.2');
    expect(production.get('DEPLOY_PORT')).toBe('22');
    expect(preview.get('DEPLOY_PORT')).toBe('22');
    expect(production.get('DEPLOY_USER')).toBe('root');
    expect(preview.get('DEPLOY_USER')).toBe('root');
    expect(production.get('DEPLOY_PROXY_JUMP')).toBe('root@156.238.244.78:22');
    expect(preview.get('DEPLOY_PROXY_JUMP')).toBe('root@156.238.244.78:22');

    expect(production.get('WEB_BIND')).not.toBe(preview.get('WEB_BIND'));
    expect(production.get('SERVER_BIND')).not.toBe(preview.get('SERVER_BIND'));
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
    // 发信：发件地址是环境密钥，模板里留空、渲染时注入；图片前缀相同，回复地址留空。
    for (const values of [production, preview]) {
      expect(values.get('MAIL_ALIYUN_FROM')).toBe('');
      expect(values.get('MAIL_RESEND_FROM')).toBe('');
      expect(values.get('MAIL_ASSET_BASE')).toBe('https://cdn.crosery.com/yzgc/mail/v1/');
      expect(values.get('MAIL_REPLY_TO')).toBe('');
    }
    expect(preview.get('MAIL_RECIPIENTS')).toBe('all');
    expect(production.get('MAIL_RECIPIENTS')).toBe('all');
    for (const field of [...MAIL_ALIYUN_SECRET_PAIR, ...OPTIONAL_SECRETS, 'MAIL_ALIYUN_FROM', 'MAIL_RESEND_FROM']) {
      expect(SECRET_FIELDS).toContain(field);
      expect(REQUIRED_SECRET_FIELDS).not.toContain(field);
    }
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
    writeFileSync(collidedPath, readFileSync(collidedPath, 'utf8').replace('WEB_BIND=10.66.0.2:18200', 'WEB_BIND=10.66.0.2:18100'));
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

  it('trusts exactly the two nginx hops in front of the server, never the whole X-Forwarded-For chain', () => {
    // 层数来自真实配置：宿主 nginx 与 web 容器 nginx 各往 X-Forwarded-For 末尾追加一段，server 前面恰好两层。
    const appends = (text: string) => text.match(/proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/g)?.length ?? 0;
    const webProxyHeaders = readFileSync(join(repoRoot, 'app/web/Dockerfile'), 'utf8').match(/<<'NGINX_HEADERS'[^\n]*\n([\s\S]*?)\nNGINX_HEADERS/)?.[1] ?? '';
    expect(readFileSync(join(repoRoot, 'app/web/Dockerfile'), 'utf8')).toMatch(/location (?:\^~ )?\/api\/ \{\n\s*proxy_pass http:\/\/server:3000;\n\s*include \/etc\/nginx\/conf\.d\/90-proxy-headers\.conf;/);
    expect(appends(webProxyHeaders)).toBe(1);
    for (const name of ENVIRONMENTS) {
      expect(appends(readFileSync(join(repoRoot, `deploy/nginx/${name}.conf`), 'utf8')), name).toBe(1);
      expect(readEnvironment(repoRoot, name).values.get('TRUST_PROXY')).toBe(String(PROXY_HOPS));
    }
    expect(PROXY_HOPS).toBe(2);

    for (const [name, value] of [['production', 'true'], ['preview', 'true'], ['production', '1'], ['preview', '3']]) {
      const root = fixtureRoot();
      const path = join(root, `deploy/env/.env.${name}`);
      writeFileSync(path, readFileSync(path, 'utf8').replace('\nTRUST_PROXY=2\n', `\nTRUST_PROXY=${value}\n`));
      const report = validateEnvironmentFiles({ root, checkCompose: false });
      expect(report.ok, `${name}: TRUST_PROXY=${value}`).toBe(false);
      expect(report.problems.join('\n')).toMatch(/TRUST_PROXY 必须是反代层数 2/);
    }
  });

  it('checks the visible mail fields', () => {
    const edit = (name: string, from: string, to: string) => {
      const root = fixtureRoot();
      const path = join(root, `deploy/env/.env.${name}`);
      const before = readFileSync(path, 'utf8');
      expect(before).toContain(from);
      writeFileSync(path, before.replace(from, to));
      return validateEnvironmentFiles({ root, checkCompose: false });
    };
    const failing: Array<[string, string, string, RegExp]> = [
      ['preview', '\nMAIL_RECIPIENTS=all\n', '\nMAIL_RECIPIENTS=everyone\n', /MAIL_RECIPIENTS 只能是 all 或 allowlist/],
      ['production', '\nMAIL_RECIPIENTS=all\n', '\nMAIL_RECIPIENTS=everyone\n', /MAIL_RECIPIENTS 只能是 all 或 allowlist/],
      ['production', '\nMAIL_RECIPIENTS=all\n', '\nMAIL_RECIPIENTS=\n', /MAIL_RECIPIENTS 只能是/],
      ['production', '\nMAIL_RECIPIENTS=all\n', '\n', /缺少字段 MAIL_RECIPIENTS/],
      // 图片前缀：https、以 / 结尾、规范形式。
      ['production', '\nMAIL_ASSET_BASE=https://cdn.crosery.com/yzgc/mail/v1/\n', '\nMAIL_ASSET_BASE=http://cdn-old.example.test/yzgc/mail/v1/\n', /MAIL_ASSET_BASE 必须是 https/],
      ['preview', '\nMAIL_ASSET_BASE=https://cdn.crosery.com/yzgc/mail/v1/\n', '\nMAIL_ASSET_BASE=https://cdn.crosery.com/yzgc/mail/v1\n', /MAIL_ASSET_BASE 必须写成规范形式并以 \/ 结尾/],
      ['preview', '\nMAIL_ASSET_BASE=https://cdn.crosery.com/yzgc/mail/v1/\n', '\nMAIL_ASSET_BASE=https://cdn.crosery.com/yzgc/mail/v1/?v=2\n', /MAIL_ASSET_BASE 不得包含/],
      ['preview', '\nMAIL_ASSET_BASE=https://cdn.crosery.com/yzgc/mail/v1/\n', '\nMAIL_ASSET_BASE=https://cdn.crosery.com/yzgc/mail/v1/?\n', /MAIL_ASSET_BASE 必须写成规范形式/],
      ['production', '\nMAIL_ASSET_BASE=https://cdn.crosery.com/yzgc/mail/v1/\n', '\nMAIL_ASSET_BASE=\n', /MAIL_ASSET_BASE 不是合法 URL/],
      // 发件地址不带显示名；回复地址留空或是一个地址。
      // 发件地址是环境密钥：模板里必须留空，真实地址只在渲染时从环境密钥注入。
      ['production', '\nMAIL_ALIYUN_FROM=\n', '\nMAIL_ALIYUN_FROM=notify@mail.example.test\n', /MAIL_ALIYUN_FROM 必须在入库模板里留空/],
      ['preview', '\nMAIL_RESEND_FROM=\n', '\nMAIL_RESEND_FROM=notify@example.test\n', /MAIL_RESEND_FROM 必须在入库模板里留空/],
      ['preview', '\nMAIL_REPLY_TO=\n', '\nMAIL_REPLY_TO=not-an-address\n', /MAIL_REPLY_TO 只能留空或写一个不带显示名的邮箱地址/],
      ['production', '\nMAIL_REPLY_TO=\n', '\n', /缺少字段 MAIL_REPLY_TO/],
      // 发信密钥与收件名单同样只能在目标机上有值。
      ['preview', '\nMAIL_ALLOWLIST=\n', '\nMAIL_ALLOWLIST=tester@example.com\n', /MAIL_ALLOWLIST 必须在入库模板里留空/],
      ['production', '\nMAIL_RESEND_API_KEY=\n', '\nMAIL_RESEND_API_KEY=re_committed\n', /MAIL_RESEND_API_KEY 必须在入库模板里留空/],
      ['production', '\nMAIL_ALIYUN_ACCESS_KEY_SECRET=\n', '\nMAIL_ALIYUN_ACCESS_KEY_SECRET=committed\n', /MAIL_ALIYUN_ACCESS_KEY_SECRET 必须在入库模板里留空/],
    ];
    for (const [name, from, to, message] of failing) {
      const report = edit(name, from, to);
      expect(report.ok, `${name}: ${to}`).toBe(false);
      expect(report.problems.join('\n')).toMatch(message);
    }
    // 回复地址写成一个地址、任何一个环境改成只发名单，都是合法配置。
    expect(edit('production', '\nMAIL_REPLY_TO=\n', '\nMAIL_REPLY_TO=geek@example.com\n').problems).toEqual([]);
    expect(edit('production', '\nMAIL_RECIPIENTS=all\n', '\nMAIL_RECIPIENTS=allowlist\n').problems).toEqual([]);
    expect(edit('preview', '\nMAIL_RECIPIENTS=all\n', '\nMAIL_RECIPIENTS=allowlist\n').problems).toEqual([]);
  });

  it('recognises plain addresses, address lists and the asset base', () => {
    for (const value of ['notify@mail.example.test', 'Second.Tester+tag@Example.org', 'a_b-c@example.test']) expect(isPlainAddress(value), value).toBe(true);
    for (const value of ['', 'notify', '@example.com', 'a@b', 'a@@example.com', 'a b@example.com', 'Name <a@example.com>', '"a"@example.com', 'a@example.com ']) {
      expect(isPlainAddress(value), value).toBe(false);
    }
    expect(isAddressList(ALLOWLIST)).toBe(true);
    expect(isAddressList('solo@example.com')).toBe(true);
    for (const value of ['', 'a@example.com, b@example.org', 'a@example.com,,b@example.org', 'a@example.com,', 'a@example.com;b@example.org', '"a@example.com"', 'a@example.com#x']) {
      expect(isAddressList(value), value).toBe(false);
    }
    expect(parseMailAssetBase('https://cdn.crosery.com/yzgc/mail/v1/')).toBe('https://cdn.crosery.com/yzgc/mail/v1/');
    for (const value of ['https://user:pw@cdn-old.example.test/v1/', 'https://cdn-old.example.test:8443/v1/', 'https://CDN-OLD.example.test/v1/', 'https://cdn-old.example.test/v1/#x', 'https://cdn-old.example.test/a/../v1/']) {
      expect(() => parseMailAssetBase(value), value).toThrow(/MAIL_ASSET_BASE/);
    }
  });

  it('validates WEB_BIND and SERVER_BIND: supports Arch tun0 and loopback, rejects 0.0.0.0, unknown interfaces and wrong ports', () => {
    const edit = (name: string, from: string, to: string) => {
      const root = fixtureRoot();
      const path = join(root, `deploy/env/.env.${name}`);
      const before = readFileSync(path, 'utf8');
      expect(before).toContain(from);
      writeFileSync(path, before.replace(from, to));
      return validateEnvironmentFiles({ root, checkCompose: false });
    };

    // 允许回环兼容旧快照
    expect(edit('production', 'WEB_BIND=10.66.0.2:18100', 'WEB_BIND=127.0.0.1:18100').problems).toEqual([]);
    expect(edit('preview', 'WEB_BIND=10.66.0.2:18200', 'WEB_BIND=127.0.0.1:18200').problems).toEqual([]);

    // 拒绝 0.0.0.0 暴露
    expect(edit('production', 'WEB_BIND=10.66.0.2:18100', 'WEB_BIND=0.0.0.0:18100').problems.join('\n')).toMatch(/禁止绑定 0\.0\.0\.0/);
    expect(edit('preview', 'WEB_BIND=10.66.0.2:18200', 'WEB_BIND=0.0.0.0:18200').problems.join('\n')).toMatch(/禁止绑定 0\.0\.0\.0/);

    // 拒绝未知或公网网卡
    expect(edit('production', 'WEB_BIND=10.66.0.2:18100', 'WEB_BIND=103.117.123.226:18100').problems.join('\n')).toMatch(/只能是 Arch tun0/);
    expect(edit('preview', 'WEB_BIND=10.66.0.2:18200', 'WEB_BIND=192.168.1.100:18200').problems.join('\n')).toMatch(/只能是 Arch tun0/);

    // 拒绝错误端口
    expect(edit('production', 'WEB_BIND=10.66.0.2:18100', 'WEB_BIND=10.66.0.2:18200').problems.join('\n')).toMatch(/WEB_BIND 端口非法/);
    expect(edit('preview', 'WEB_BIND=10.66.0.2:18200', 'WEB_BIND=10.66.0.2:18100').problems.join('\n')).toMatch(/WEB_BIND 端口非法/);
    expect(edit('production', 'WEB_BIND=10.66.0.2:18100', 'WEB_BIND=10.66.0.2:18999').problems.join('\n')).toMatch(/WEB_BIND 端口非法/);

    // SERVER_BIND 必须保持回环且端口正确
    expect(edit('production', 'SERVER_BIND=127.0.0.1:18101', 'SERVER_BIND=10.66.0.2:18101').problems.join('\n')).toMatch(/SERVER_BIND 必须保持回环/);
    expect(edit('production', 'SERVER_BIND=127.0.0.1:18101', 'SERVER_BIND=127.0.0.1:18201').problems.join('\n')).toMatch(/SERVER_BIND 端口非法/);
    expect(edit('preview', 'SERVER_BIND=127.0.0.1:18201', 'SERVER_BIND=127.0.0.1:18101').problems.join('\n')).toMatch(/SERVER_BIND 端口非法/);
  });

  it('validates DEPLOY_PROXY_JUMP: checks canonical format and rejects shell-injection and malformed values', () => {
    expect(parseProxyJump('root@156.238.244.78:22')).toEqual({
      user: 'root',
      host: '156.238.244.78',
      port: '22',
      destination: 'root@156.238.244.78:22',
    });
    expect(parseProxyJump('deployer@jump.example.test:2222')).toEqual({
      user: 'deployer',
      host: 'jump.example.test',
      port: '2222',
      destination: 'deployer@jump.example.test:2222',
    });

    for (const bad of [
      '',
      'root@156.238.244.78; rm -rf /',
      'root@156.238.244.78 && echo 1',
      'root@156.238.244.78|id',
      'root@156.238.244.78`id`',
      'root@156.238.244.78$(id)',
      '-oProxyCommand=x',
      '-root@156.238.244.78:22',
      'root@-156.238.244.78:22',
      'root@156.238.244.78:99999',
      'root@156.238.244.78:0',
      'root@999.999.999.999:22',
    ]) {
      expect(() => parseProxyJump(bad), bad).toThrow();
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

  it('tightens an existing loose file to 0600 and refuses a symlinked output path', () => {
    const root = fixtureRoot();
    const out = join(root, 'runtime/.env.preview');
    mkdirSync(dirname(out), { recursive: true });
    // 上一次渲染/手工拷贝留下的宽权限文件：0600 只在新建时生效，必须显式收紧而不是沿用旧权限。
    writeFileSync(out, 'STALE=1\n', { mode: 0o644 });
    chmodSync(out, 0o644);
    renderRuntimeEnv({ root, environment: 'preview', out, imageTag: 'a1b2c3d4e5f6', env: secrets });
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(readFileSync(out, 'utf8')).toContain('GEEK_DEPLOYMENT_ENVIRONMENT=preview');

    // 输出路径是符号链接时，密钥不能顺着链接写到别处。
    const victim = join(root, 'runtime/victim.txt');
    writeFileSync(victim, 'untouched\n');
    const linked = join(root, 'runtime/.env.preview.link');
    symlinkSync(victim, linked);
    expect(() => renderRuntimeEnv({ root, environment: 'preview', out: linked, imageTag: 'a1b2c3d4e5f6', env: secrets })).toThrow(/符号链接/);
    expect(readFileSync(victim, 'utf8')).toBe('untouched\n');
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
    // Turnstile 与发信都关闭时，其余每一个密钥仍然必填；发件地址只在对应的发信商开启时必填。
    const required = without(secrets, [...OPTIONAL_SECRET_PAIR, ...MAIL_ALIYUN_SECRET_PAIR, ...GOOGLE_SECRET_PAIR, ...OPTIONAL_SECRETS, ...OIDC_GITLAB_SECRETS, ...OBJECT_STORAGE_SECRETS, ...BACKUP_SECRETS, 'MAIL_ALIYUN_FROM', 'MAIL_RESEND_FROM']);
    expect(Object.keys(required)).toEqual([...REQUIRED_SECRET_FIELDS]);
    for (const field of REQUIRED_SECRET_FIELDS) {
      expect(() => renderRuntimeEnv({ root, environment: 'production', out, imageTag: 'a1b2c3d4e5f6', env: without(required, [field]) })).toThrow(new RegExp(field));
    }
    expect(renderRuntimeEnv({ root, environment: 'production', out, imageTag: 'a1b2c3d4e5f6', env: secrets }).turnstile).toBe('on');
  });

  it('treats the Google client as an optional pair: both empty is off, one alone is refused (#262)', () => {
    const root = fixtureRoot();
    const out = join(root, 'runtime/.env.preview');
    const render = (env: Record<string, string>) => renderRuntimeEnv({ root, environment: 'preview', out, imageTag: 'a1b2c3d4e5f6', env });
    for (const field of GOOGLE_SECRET_PAIR) {
      expect(SECRET_FIELDS).toContain(field);
      expect(REQUIRED_SECRET_FIELDS).not.toContain(field);
      expect(() => render(without(secrets, [field]))).toThrow(/只配了一项/);
    }
    const off = render(without(secrets, GOOGLE_SECRET_PAIR));
    expect(off.google).toBe('off');
    expect(off.notices.some(text => text.includes('Google 登录关闭'))).toBe(true);
    expect(parseEnvFileText(readFileSync(out, 'utf8'), 'rendered').get('GOOGLE_CLIENT_ID')).toBe('');
    expect(render(secrets).google).toBe('on');
  });

});

describe('OIDC signing key and GitLab sync (#270)', () => {
  const fixture = (environment: string, edit?: [string, string]) => {
    const root = fixtureRoot();
    const path = join(root, `deploy/env/.env.${environment}`);
    const before = readFileSync(path, 'utf8');
    if (edit) expect(before).toContain(edit[0]);
    writeFileSync(path, edit ? before.replace(edit[0], edit[1]) : before);
    return root;
  };


  it('rejects invalid sync modes, insecure base URLs, malformed groups and committed credentials', () => {
    const failing: Array<[string, string, string]> = [
      ['preview', '\nGITLAB_SYNC=on\n', '\nGITLAB_SYNC=yes\n'],
      ['production', '\nGITLAB_SYNC=off\n', '\n'],
      ['production', '\nGITLAB_URL=https://yangtzeu.work/gitlab\n', '\nGITLAB_URL=http://yangtzeu.work/gitlab\n'],
      ['production', '\nGITLAB_URL=https://yangtzeu.work/gitlab\n', '\nGITLAB_URL=https://user:secret@git.example.test/gitlab\n'],
      ['production', '\nGITLAB_URL=https://yangtzeu.work/gitlab\n', '\nGITLAB_URL=https://git.example.test/gitlab?key=x\n'],
      // 一个环境一个域名（#335）：GitLab 只能挂在本环境入口的 /gitlab 下
      ['production', '\nGITLAB_URL=https://yangtzeu.work/gitlab\n', '\nGITLAB_URL=https://code.example.test/gitlab\n'],
      ['production', '\nGITLAB_URL=https://yangtzeu.work/gitlab\n', '\nGITLAB_URL=https://yangtzeu.work\n'],
      ['preview', '\nGITLAB_URL=https://prev.yangtzeu.work/gitlab\n', '\nGITLAB_URL=https://yangtzeu.work/gitlab\n'],
      ['production', '\nGITLAB_OIDC_SECTOR=', '\nGITLAB_OIDC_SECTOR=https://'],
      ['preview', '\nGITLAB_OIDC_SECTOR=prev.yangtzeu.work\n', '\nGITLAB_OIDC_SECTOR=prev.yangtzeu.work/gitlab\n'],
      ['production', '\nGITLAB_OIDC_SECTOR=', '\nGITLAB_OIDC_SECTOR_RETIRED='],
      ['production', '\nGITLAB_GROUP=geek\n', '\nGITLAB_GROUP=geek group\n'],
      // GitLab 项目事件间隔（#370）：分钟，1 到 1440 的整数
      ['production', '\nGITLAB_EVENTS_INTERVAL_MINUTES=10\n', '\nGITLAB_EVENTS_INTERVAL_MINUTES=-1\n'],
      ['preview', '\nGITLAB_EVENTS_INTERVAL_MINUTES=10\n', '\nGITLAB_EVENTS_INTERVAL_MINUTES=01\n'],
      ['production', '\nGITLAB_EVENTS_INTERVAL_MINUTES=10\n', '\nGITLAB_EVENTS_INTERVAL_MINUTES=1441\n'],
      ['preview', '\nGITLAB_EVENTS_INTERVAL_MINUTES=10\n', '\nGITLAB_EVENTS_INTERVAL_MINUTES=10.5\n'],
      ['production', '\nOIDC_JWKS=\n', '\nOIDC_JWKS=eyJrZXlzIjpbXX0=\n'],
      ['preview', '\nGITLAB_API_TOKEN=\n', '\nGITLAB_API_TOKEN=glpat-committed\n'],
    ];
    for (const [name, from, to] of failing) {
      const report = validateEnvironmentFiles({ root: fixture(name, [from, to]), checkCompose: false });
      expect(report.ok, `${name}: ${to}`).toBe(false);
    }
  });

  it('renders both secrets when given, leaves them empty when not, and refuses GITLAB_SYNC=on without the token', () => {
    const render = (env: Record<string, string>, environment = 'production', edit?: [string, string]) => {
      const root = fixture(environment, edit);
      const out = join(root, `runtime/.env.${environment}`);
      const result = renderRuntimeEnv({ root, environment, out, imageTag: 'a1b2c3d4e5f6', env });
      return { result, values: parseEnvFileText(readFileSync(out, 'utf8'), 'rendered') };
    };
    // keygen 的输出是一行 base64，原样写入
    const jwks = Buffer.from(JSON.stringify({ keys: [{ kty: 'RSA', d: 'x', n: 'y', e: 'AQAB' }] })).toString('base64');
    const on = render({ ...secrets, OIDC_JWKS: jwks, GITLAB_API_TOKEN: 'glpat-fixture-token' });
    expect(on.result).toMatchObject({ oidc: 'on', gitlabSync: 'off' });
    expect(on.values.get('GITLAB_SYNC')).toBe('off');
    expect(on.values.get('OIDC_JWKS')).toBe(jwks);
    expect(on.values.get('GITLAB_API_TOKEN')).toBe('glpat-fixture-token');
    const off = render(without(secrets, [...OIDC_GITLAB_SECRETS]));
    expect(off.result).toMatchObject({ oidc: 'off', gitlabSync: 'off' });
    expect(off.values.get('GITLAB_SYNC')).toBe('off');
    expect(off.result.notices.join('\n')).toMatch(/OIDC_JWKS 为空：对外授权关闭/);
    for (const field of OIDC_GITLAB_SECRETS) expect(off.values.get(field)).toBe('');
    // JWK Set 的 JSON 原文带引号，环境文件不收
    expect(() => render({ ...secrets, OIDC_JWKS: '{"keys":[]}' })).toThrow(/OIDC_JWKS 含非法字符/);
    // preview 已是权威源；production 夹具显式开启，两个环境均验证缺 token 时拒绝渲染。
    for (const environment of ['preview', 'production']) {
      const enable: [string, string] | undefined = environment === 'production' ? ['\nGITLAB_SYNC=off\n', '\nGITLAB_SYNC=on\n'] : undefined;
      expect(() => render(without(secrets, ['GITLAB_API_TOKEN']), environment, enable)).toThrow(/GITLAB_SYNC=on 要 GITLAB_API_TOKEN/);
      expect(render(secrets, environment, enable).result.gitlabSync).toBe('on');
    }
    expect(render(without(secrets, ['GITLAB_API_TOKEN']), 'preview', ['\nGITLAB_SYNC=on\n', '\nGITLAB_SYNC=dry-run\n']).result.gitlabSync).toBe('dry-run');
  });
});

describe('optional mail secrets', () => {
  const render = (env: Record<string, string>, environment = 'preview', edit?: [string | RegExp, string]) => {
    const root = fixtureRoot();
    if (edit) {
      const path = join(root, `deploy/env/.env.${environment}`);
      writeFileSync(path, readFileSync(path, 'utf8').replace(edit[0], edit[1]));
    }
    const out = join(root, `runtime/.env.${environment}`);
    const result = renderRuntimeEnv({ root, environment, out, imageTag: 'a1b2c3d4e5f6', env });
    return { result, values: parseEnvFileText(readFileSync(out, 'utf8'), 'rendered'), text: readFileSync(out, 'utf8') };
  };
  const mailFields = [...MAIL_ALIYUN_SECRET_PAIR, ...OPTIONAL_SECRETS, 'MAIL_ALIYUN_FROM', 'MAIL_RESEND_FROM'];

  it('treats every mail secret empty as mail off, writes them empty and says so', () => {
    for (const env of [without(secrets, mailFields), { ...secrets, ...Object.fromEntries(mailFields.map(field => [field, ''])) }]) {
      const { result, values } = render(env);
      expect(result.mail).toBe('off');
      expect(result.mailProviders).toEqual([]);
      expect(result.secretFields).toEqual(SECRET_FIELDS.filter(field => !mailFields.includes(field)));
      for (const field of mailFields) expect(values.get(field)).toBe('');
      expect(values.get('SESSION_SECRET')).toBe(secrets.SESSION_SECRET);
      expect(result.notices.join('\n')).toMatch(/发信关闭，server 把每封信记为「发信没有配置」/);
    }
    // 收件名单单独配着也不算开启发信：没有能发信的通道。
    expect(render(without(secrets, [...MAIL_ALIYUN_SECRET_PAIR, 'MAIL_RESEND_API_KEY'])).result.mail).toBe('off');
  });

  it('takes the sender addresses from the environment secrets, required only with their provider', () => {
    expect(REQUIRED_SECRET_FIELDS).not.toContain('MAIL_ALIYUN_FROM');
    expect(REQUIRED_SECRET_FIELDS).not.toContain('MAIL_RESEND_FROM');
    const both = render(secrets);
    expect(both.values.get('MAIL_ALIYUN_FROM')).toBe(secrets.MAIL_ALIYUN_FROM);
    expect(both.values.get('MAIL_RESEND_FROM')).toBe(secrets.MAIL_RESEND_FROM);
    // 对应的发信商没开，发件地址照模板写空。
    expect(render(without(secrets, MAIL_ALIYUN_SECRET_PAIR)).values.get('MAIL_ALIYUN_FROM')).toBe('');
    expect(render(without(secrets, ['MAIL_RESEND_API_KEY'])).values.get('MAIL_RESEND_FROM')).toBe('');
    // 开了就必填：缺发件地址拒绝渲染，并点名是哪一项。
    expect(() => render(without(secrets, ['MAIL_ALIYUN_FROM']))).toThrow(/MAIL_ALIYUN_FROM/);
    expect(() => render(without(secrets, ['MAIL_RESEND_FROM']))).toThrow(/MAIL_RESEND_FROM/);
    // 渲染前仍要是不带显示名的邮箱地址。
    expect(() => render({ ...secrets, MAIL_RESEND_FROM: '极客班 <notify@example.test>' })).toThrow(/MAIL_RESEND_FROM 必须是不带显示名的邮箱地址/);
  });

  it('refuses a half-configured Aliyun pair', () => {
    for (const field of MAIL_ALIYUN_SECRET_PAIR) {
      expect(() => render({ ...secrets, [field]: '' })).toThrow(/MAIL_ALIYUN_ACCESS_KEY_ID 与 MAIL_ALIYUN_ACCESS_KEY_SECRET 只配了一项/);
      expect(() => render(without(secrets, [field]), 'production')).toThrow(/只配了一项/);
    }
  });

  it('turns on each provider on its own and keeps the other empty', () => {
    const aliyunOnly = render(without(secrets, ['MAIL_RESEND_API_KEY']));
    expect(aliyunOnly.result.mailProviders).toEqual(['aliyun']);
    expect(aliyunOnly.values.get('MAIL_RESEND_API_KEY')).toBe('');
    expect(aliyunOnly.values.get('MAIL_ALIYUN_ACCESS_KEY_ID')).toBe(secrets.MAIL_ALIYUN_ACCESS_KEY_ID);
    const resendOnly = render(without(secrets, MAIL_ALIYUN_SECRET_PAIR), 'production');
    expect(resendOnly.result.mailProviders).toEqual(['resend']);
    expect(resendOnly.result.mail).toBe('on');
    expect(resendOnly.values.get('MAIL_ALIYUN_ACCESS_KEY_SECRET')).toBe('');
    expect(render(secrets).result.mailProviders).toEqual(['aliyun', 'resend']);
  });

  it('renders the allowlist verbatim and refuses malformed lists without echoing them', () => {
    const { values, text } = render(secrets);
    expect(values.get('MAIL_ALLOWLIST')).toBe(ALLOWLIST);
    // 逗号在安全字符里：原样写出，不加引号。
    expect(text.split('\n')).toContain(`MAIL_ALLOWLIST=${ALLOWLIST}`);
    for (const list of ['tester@example.com, other@example.org', 'tester@example.com,', 'tester@example.com,,other@example.org', '"tester@example.com"', 'Tester <tester@example.com>', 'tester@example.com;other@example.org', 'tester@example.com#x', '$HOME@example.com']) {
      let message = '';
      try {
        render({ ...secrets, MAIL_ALLOWLIST: list });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, list).toMatch(/MAIL_ALLOWLIST 必须是英文逗号隔开的邮箱地址/);
      expect(message).not.toContain('tester@example.com');
    }
    // 别的密钥照旧不收逗号与空白，报错也不回显取值。
    expect(() => render({ ...secrets, MAIL_RESEND_API_KEY: 're_a,b' })).toThrow(/MAIL_RESEND_API_KEY 含非法字符/);
    expect(() => render({ ...secrets, MAIL_ALIYUN_ACCESS_KEY_SECRET: 'with space' })).toThrow(/^(?!.*with space).*MAIL_ALIYUN_ACCESS_KEY_SECRET/);
  });

  it('warns when the configuration can send nothing or cannot carry Reply-To', () => {
    // 改成只发名单、名单又是空的：发信开着，一封也发不出去。
    const emptyList = render(without(secrets, ['MAIL_ALLOWLIST']), 'preview', [/^MAIL_RECIPIENTS=.*$/m, 'MAIL_RECIPIENTS=allowlist']);
    expect(emptyList.result.mail).toBe('on');
    expect(emptyList.result.notices.join('\n')).toMatch(/MAIL_RECIPIENTS=allowlist 而 MAIL_ALLOWLIST 为空/);
    // 显式合成 all 模式：名单为空不应阻止发给所有人。
    for (const environment of ['preview', 'production']) {
      expect(render(without(secrets, ['MAIL_ALLOWLIST']), environment, [/^MAIL_RECIPIENTS=.*$/m, 'MAIL_RECIPIENTS=all']).result.notices.join('\n')).not.toMatch(/MAIL_ALLOWLIST 为空/);
    }
    // 只有阿里云时带不了 Reply-To，server 按没有配置发信商处理。
    const replyTo: [string, string] = ['MAIL_REPLY_TO=\n', 'MAIL_REPLY_TO=geek@example.com\n'];
    expect(render(without(secrets, ['MAIL_RESEND_API_KEY']), 'production', replyTo).result.notices.join('\n')).toMatch(/MAIL_REPLY_TO 不为空却只配了阿里云/);
    expect(render(secrets, 'production', replyTo).result.notices.join('\n')).not.toMatch(/MAIL_REPLY_TO 不为空/);
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
