import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_SPA_ENTRY, PORTAL_SPA_ENTRY, resolveSiteEntry } from '../../app/server/src/app';
import { SHIELD_NOTICE, parseShieldAllowlist } from '../../app/server/src/lib/shield';

// web 镜像内的 nginx 配置与防护开关的渲染脚本写在 app/web/Dockerfile 的 heredoc 里。这里原样抽出来：
// 渲染脚本用本机 sh 实跑；本机有 nginx 时再把配置跑起来，按路径实测 SPA 入口选择与第一层限流。
// 只启动、只关闭本测试自己创建的 nginx 进程，监听回环上的临时端口，不碰其它进程。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const dockerfile = readFileSync(join(repoRoot, 'app/web/Dockerfile'), 'utf8');
const heredoc = (name: string) => {
  const match = new RegExp(`COPY <<'${name}' \\S+\\n([\\s\\S]*?)\\n${name}\\n`).exec(dockerfile);
  if (!match) throw new Error(`app/web/Dockerfile 里找不到 heredoc ${name}`);
  return match[1];
};
const siteConf = heredoc('NGINX_SITE');
const proxyHeaders = heredoc('NGINX_HEADERS');
const shieldRender = heredoc('SHIELD_RENDER');
const hostConf = (name: string) => readFileSync(join(repoRoot, `deploy/nginx/${name}.conf`), 'utf8');

describe('web container nginx picks the SPA entry by path', () => {
  it('declares the admin paths and entry in one location, before the image rule, with no host switch', () => {
    // 管理端路径清单与入口文件在 nginx 里各只出现一次，服务端对应的是 ADMIN_SPA_PATHS / ADMIN_SPA_ENTRY。
    expect(siteConf.match(/^\s*location ~ \^\/\(\?:\(\?:admin\|console\)\(\?:\/\|\$\)\|signin\$\|device\$\|account\$\|authorize\$\|bind-email\$\|complete-profile\$\) \{$/gm)).toHaveLength(1);
    expect(siteConf.split(`/${ADMIN_SPA_ENTRY}`)).toHaveLength(2);
    expect(siteConf.indexOf(`/${ADMIN_SPA_ENTRY}`)).toBeLessThan(siteConf.indexOf('location ~* \\.(?:png'));
    expect(siteConf).toMatch(new RegExp(`location / \\{\\s*try_files \\$uri /${PORTAL_SPA_ENTRY.replaceAll('/', '\\/').replaceAll('.', '\\.')};\\s*\\}`));
    expect(dockerfile).not.toMatch(/X-YZGC|x_yzgc|yzgc_spa_entry|render-web-config/i);
    // 论坛前缀必须是 ^~，否则下面的图片正则会截走 /forum/ 下的图片（#81）。
    expect(siteConf).toMatch(/^\s*location \^~ \/forum\/ \{$/m);
    // 对外授权的端点整段交给 server（#270）
    expect(siteConf).toMatch(/^\s*location \^~ \/oidc\/ \{\n\s*proxy_pass http:\/\/server:3000;$/m);
    // 比赛官网（#278）：/c/ 整段交给 server，SDK 是本镜像里的静态文件并放开来源
    expect(siteConf).toMatch(/^\s*location \^~ \/c\/ \{\n\s*proxy_pass http:\/\/server:3000;$/m);
    expect(siteConf).toMatch(/location \^~ \/sdk\/ \{[^}]*add_header Access-Control-Allow-Origin "\*" always;[^}]*try_files \$uri =404;/);
    expect(dockerfile).toContain('test -f app/web/dist/sdk/competition/v1.js');
  });

  it('raises the body limit only for the contest site upload inside the container, and leaves both host templates at 6m (#278)', () => {
    const upload = /location ~ \^\/api\/console\/competitions\/\[\^\/\]\+\/site\/versions\$ \{\s*client_max_body_size 21m;/;
    expect(siteConf).toMatch(upload);
    // 放在 /api/ 里面：^~ /api/ 命中后不再看外层的正则
    const api = /location \^~ \/api\/ \{([\s\S]*?)\n    \}/.exec(siteConf)?.[1] ?? '';
    expect(api).toMatch(upload);
    expect(siteConf.match(/client_max_body_size/g)).toHaveLength(2);
    // 宿主模板只有一个反代 location（X-Forwarded-For 只追加一次、上游端口只写一处），放宽上传要所有者另定，见 DEPLOY
    for (const name of ['production', 'preview']) {
      const text = hostConf(name);
      expect(text).not.toMatch(upload);
      expect(text.match(/client_max_body_size [^;]+;/g)).toEqual(['client_max_body_size 6m;']);
    }
  });

  it('lets connect-src read blob: URLs, which GLTFLoader fetches for the embedded textures of the phone model (#240)', () => {
    // GLB 内嵌贴图由 GLTFLoader 先转成 blob: 地址，再由 ImageBitmapLoader 用 fetch 读取，受 connect-src 约束。
    const connectSrc = (text: string) => /connect-src ([^;"]+);/.exec(text)?.[1] ?? '';
    const production = connectSrc(hostConf('production'));
    const preview = connectSrc(hostConf('preview'));
    expect(production.split(' ')).toContain('blob:');
    expect(preview).toBe(production);
    // 只放开 blob:，不多放任何外部域名
    expect(production).toBe("'self' blob: https://challenges.cloudflare.com https://cdn.crosery.com");
  });

  it('keeps each host nginx template to one origin, with the retired admin domain redirected', () => {
    const production = hostConf('production');
    const preview = hostConf('preview');
    for (const text of [production, preview]) {
      expect(text).not.toMatch(/X-YZGC|prev-admin/i);
      expect(text).toContain('client_max_body_size 6m;');
      expect(text).toContain('/.well-known/acme-challenge/');
      expect(text).toContain('Content-Security-Policy');
    }
    expect(production).toContain('proxy_pass http://127.0.0.1:18100;');
    const retired = /server_name github\.yangtzeu\.work;([\s\S]*?)\n\}/.exec(production)?.[1] ?? '';
    expect(retired).toContain('return 301 https://yangtzeu.work$request_uri;');
    expect(retired).not.toContain('proxy_pass');
    expect(preview).toContain('proxy_pass http://127.0.0.1:18200;');
    expect(preview.match(/server_name [^;]+;/g)).toEqual(['server_name prev.yangtzeu.work;', 'server_name prev.yangtzeu.work;']);
  });
});

describe('web container nginx limits by the real client IP (#333)', () => {
  it('reads the client from X-Forwarded-For only from the tunnel ends and the Docker bridge range, never from everything', () => {
    // 信任名单只有这三条：隧道两端和 Docker 网桥网段。0.0.0.0/0、all 这类写法会让任何来源都能冒充客户端。
    expect([...siteConf.matchAll(/^set_real_ip_from (\S+);$/gm)].map(match => match[1])).toEqual(['10.66.0.1', '10.66.0.2', '172.16.0.0/12']);
    expect(siteConf).toMatch(/^real_ip_header X-Forwarded-For;$/m);
    expect(siteConf).toMatch(/^real_ip_recursive on;$/m);
  });
});

// 防护开关的渲染脚本（SHIELD_RENDER）用本机 sh 实跑：env 只给 PATH 与这次要测的 SHIELD_* 两个键。
const renderShield = (target: string, shield: Record<string, string>) => {
  const script = join(target, '..', 'yzgc-shield-render.sh');
  writeFileSync(script, `${shieldRender}\n`);
  return spawnSync('sh', [script, target], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...shield } });
};

describe('web container nginx renders the shield switch and allowlist from the same keys as the server (#333)', () => {
  let dir = '';
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'geek-web-shield-')); });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  const render = (shield: Record<string, string>) => {
    const target = join(dir, 'exempt.conf');
    rmSync(target, { force: true });
    const result = renderShield(target, shield);
    return { status: result.status, stderr: result.stderr, lines: result.status === 0 ? readFileSync(target, 'utf8').trim().split('\n') : null };
  };

  it('limits every source when the switch is on or unset, and none when it is off', () => {
    expect(render({}).lines).toEqual(['0.0.0.0/0 0;', '::/0 0;']);
    expect(render({ SHIELD_ENABLED: ' on ' }).lines).toEqual(['0.0.0.0/0 0;', '::/0 0;']);
    expect(render({ SHIELD_ENABLED: 'off' }).lines).toEqual(['0.0.0.0/0 1;', '::/0 1;']);
    const wrong = render({ SHIELD_ENABLED: 'yes' });
    expect(wrong.status).not.toBe(0);
    expect(wrong.lines).toBeNull();
  });

  it('exempts allowlisted ranges with their host bits cleared and duplicates merged, so nginx never warns with a range in its log', () => {
    const result = render({ SHIELD_ALLOWLIST: ' 198.51.100.77/24, ,198.51.100.0/24,2001:DB8::1/32,1:2:3:4:5:6:7::,fe80::1%eth0/64' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.lines).toEqual([
      '0.0.0.0/0 0;', '::/0 0;',
      '198.51.100.0/24 1;', '2001:db8:0:0:0:0:0:0/32 1;', '1:2:3:4:5:6:7:0/128 1;', 'fe80:0:0:0:0:0:0:0/64 1;',
    ]);
    // /0 并进对应地址族的兜底行，不另起一行（另起一行 nginx 会报 duplicate network）
    expect(render({ SHIELD_ALLOWLIST: '0.0.0.0/0' }).lines).toEqual(['0.0.0.0/0 1;', '::/0 0;']);
    // 日志只有开关与项数，没有任何网段
    expect(result.stderr).not.toMatch(/198\.51|2001|db8|fe80|eth0/i);
  });

  it.each<[string, string[], string[], string[]]>([
    // IPv6 网段覆盖到 IPv4 映射段（::ffff:0:0/96）时，server 的 BlockList 对 IPv4 客户端也算命中；nginx 的 geo 对 IPv4（含映射地址）查 IPv4 表，所以另写一行 IPv4
    ['::ffff:192.0.2.1', ['0.0.0.0/0 0;', '::/0 0;', '0:0:0:0:0:ffff:c000:201/128 1;', '192.0.2.1/32 1;'], ['192.0.2.1'], ['192.0.2.2']],
    ['::ffff:192.0.2.77/120', ['0.0.0.0/0 0;', '::/0 0;', '0:0:0:0:0:ffff:c000:200/120 1;', '192.0.2.0/24 1;'], ['192.0.2.7'], ['192.0.3.1']],
    ['::/64', ['0.0.0.0/0 1;', '::/0 0;', '0:0:0:0:0:0:0:0/64 1;'], ['10.0.0.1', '192.0.2.1'], []],
    ['::/0', ['0.0.0.0/0 1;', '::/0 1;'], ['10.0.0.1'], []],
    ['::/95', ['0.0.0.0/0 0;', '::/0 0;', '0:0:0:0:0:0:0:0/95 1;'], [], ['10.0.0.1']],
  ])('gives IPv4 clients the same answer as the server for %s', (item, lines, exempt, limited) => {
    expect(render({ SHIELD_ALLOWLIST: item }).lines).toEqual(lines);
    const list = parseShieldAllowlist([item]);
    for (const ip of exempt) expect(list.check(ip, 'ipv4'), ip).toBe(true);
    for (const ip of limited) expect(list.check(ip, 'ipv4'), ip).toBe(false);
  });

  it.each([
    '10.0.0.1/33', '2001:db8::/129', '10.0.0.256', '01.2.3.4', '10.0.0.0/8/1', '10.0.0.0/', '1::2::3', '1.2.3.4::', 'example.com', 'default', 'include x',
    'fe80::1%', '1.2.3.4%eth0', 'fe80::1%eth0;',
  ])('refuses %s like the server does, without printing the allowlist', item => {
    const result = render({ SHIELD_ALLOWLIST: `203.0.113.9,${item}` });
    expect(result.status).not.toBe(0);
    expect(result.lines).toBeNull();
    expect(result.stderr).toContain('第 2 段');
    expect(result.stderr).not.toContain('203.0.113.9');
    expect(result.stderr).not.toContain(item);
    expect(() => parseShieldAllowlist(['203.0.113.9', item])).toThrow();
  });

  it('accepts every form the server accepts in the allowlists above', () => {
    for (const item of ['198.51.100.77/24', '198.51.100.0/24', '2001:DB8::1/32', '::ffff:192.0.2.1', '1:2:3:4:5:6:7::', '0.0.0.0/0', '::/0', '10.0.0.0/08', 'fe80::1%eth0', 'fe80::1%1/64']) {
      expect(() => parseShieldAllowlist([item])).not.toThrow();
      expect(render({ SHIELD_ALLOWLIST: item }).status).toBe(0);
    }
  });
});

const nginxBinary = spawnSync('nginx', ['-v'], { encoding: 'utf8' }).status === 0 ? 'nginx' : null;

const freePort = () => new Promise<number>((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    probe.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
  });
});

type LiveNginx = { port: number; root: string; stop: () => Promise<void> };

// 起一份本测试自己的 nginx：防护开关文件由 SHIELD_RENDER 按给定的 SHIELD_* 渲染，和容器启动时同一条路径。
const launchNginx = async (shield: Record<string, string>): Promise<LiveNginx> => {
  const root = mkdtempSync(join(tmpdir(), 'geek-web-nginx-'));
  const port = await freePort();
  const forumPort = await freePort();
  const html = join(root, 'html');
  // 管理端入口是控制台产物（app/console）叠进同一个站点根的 sites/console/index.html。
  for (const [site, entry] of [['portal', PORTAL_SPA_ENTRY], ['admin', ADMIN_SPA_ENTRY]]) {
    mkdirSync(join(html, entry, '..'), { recursive: true });
    writeFileSync(join(html, entry), `<main data-entry="${site}"></main>\n`);
  }
  mkdirSync(join(html, 'assets'), { recursive: true });
  writeFileSync(join(html, 'assets', 'app-abc123.js'), 'export {};\n');
  mkdirSync(join(html, 'console-assets'), { recursive: true });
  writeFileSync(join(html, 'console-assets', 'index-abc123.js'), 'export {};\n');
  mkdirSync(join(html, 'sdk', 'competition'), { recursive: true });
  writeFileSync(join(html, 'sdk', 'competition', 'v1.js'), 'export {};\n');
  writeFileSync(join(html, 'logo.png'), 'png');
  writeFileSync(join(html, 'release.json'), '{"environment":"test"}\n');
  const rendered = renderShield(join(root, 'exempt.conf'), shield);
  expect(rendered.status, rendered.stderr).toBe(0);
  // 只替换运行环境相关的几处：监听端口、站点根、include 路径（含防护开关文件）、上游地址（server 不访问；forum 换成同一 nginx 里回显路径的桩）、
  // 日志去向（容器写 /dev/stdout、/dev/stderr；CI runner 上没有可打开的终端设备，nginx -t 会失败）。
  // 测试专用：本机回环当作可信上游，这样 X-Forwarded-For 才会被读取；生产信任名单由上面的断言钉住，这里不替换它。
  const site = siteConf
    .replace('set_real_ip_from 10.66.0.1;', 'set_real_ip_from 10.66.0.1;\nset_real_ip_from 127.0.0.1;')
    .replace('listen 8080;', `listen 127.0.0.1:${port};`)
    .replace('root /usr/share/nginx/html;', `root ${html};`)
    .replaceAll('/etc/nginx/conf.d/90-proxy-headers.conf', join(root, '90-proxy-headers.conf'))
    .replaceAll('/etc/nginx/yzgc-shield/exempt.conf', join(root, 'exempt.conf'))
    .replaceAll('http://forum:3000/', `http://127.0.0.1:${forumPort}/`)
    .replaceAll('http://server:3000', 'http://127.0.0.1:9')
    .replaceAll('/dev/stdout', join(root, 'access.log'))
    .replaceAll('/dev/stderr', join(root, 'error.log'));
  expect(site).not.toMatch(/listen 8080|\/usr\/share\/nginx|\/etc\/nginx|server:3000|forum:3000|\/dev\/std/);
  expect(site).toContain('set_real_ip_from 127.0.0.1;');
  writeFileSync(join(root, '10-web.conf'), site);
  writeFileSync(join(root, '90-proxy-headers.conf'), proxyHeaders);
  for (const dir of ['client', 'proxy', 'fastcgi', 'uwsgi', 'scgi']) mkdirSync(join(root, `${dir}_temp`));
  writeFileSync(join(root, 'nginx.conf'), [
    'worker_processes 1;',
    'master_process off;',
    `pid ${join(root, 'nginx.pid')};`,
    `error_log ${join(root, 'error.log')} warn;`,
    'events { worker_connections 512; }',
    'http {',
    '  types { text/html html; application/json json; application/javascript js; image/png png; }',
    '  default_type application/octet-stream;',
    ...['client', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].map(dir => `  ${dir === 'client' ? 'client_body' : dir}_temp_path ${join(root, `${dir}_temp`)};`),
    `  include ${join(root, '10-web.conf')};`,
    // 桩 server 自己不写日志：否则 nginx 用编译时的默认路径（CI 上是不可写的 /var/log/nginx/access.log），-t 直接失败。
    `  server { listen 127.0.0.1:${forumPort}; access_log off; location / { default_type text/plain; return 200 "forum $uri"; } }`,
    '}',
    '',
  ].join('\n'));
  const args = ['-p', `${root}/`, '-e', join(root, 'error.log'), '-c', join(root, 'nginx.conf')];
  const syntax = spawnSync(nginxBinary!, ['-t', ...args], { encoding: 'utf8' });
  expect(syntax.status, syntax.stderr).toBe(0);
  const child: ChildProcess = spawn(nginxBinary!, [...args, '-g', 'daemon off;'], { stdio: 'ignore' });
  const stop = async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    rmSync(root, { recursive: true, force: true });
  };
  // 等的是另一个真实进程开始监听，没有可等待的事件，只能按间隔探测。
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/release.json`)).ok) return { port, root, stop };
    } catch { /* 还没开始监听 */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const log = readFileSync(join(root, 'error.log'), 'utf8');
  await stop();
  throw new Error(`nginx 未能在 127.0.0.1:${port} 就绪：${log}`);
};

// 同一个客户端（X-Forwarded-For 里的地址）一口气发 count 个请求，返回每个回应的状态与正文。
const volley = (port: number, client: string, { path = '/api/feedback', method = 'POST', count = 120 } = {}) =>
  Promise.all(Array.from({ length: count }, async () => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'x-forwarded-for': client, 'content-type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined,
    });
    return { status: response.status, text: await response.text() };
  }));
// 第一层限流的拒绝：limit_req 回 429，limit_conn 没改状态码时是 503
const refused = (results: { status: number }[]) => results.filter(item => item.status === 429 || item.status === 503);

describe.skipIf(!nginxBinary)('web container nginx routing (live nginx on loopback)', () => {
  let stack: LiveNginx | null = null;
  let port = 0;

  beforeAll(async () => {
    stack = await launchNginx({});
    port = stack.port;
  }, 20000);

  afterAll(async () => {
    await stack?.stop();
  });

  const entryOf = async (path: string, headers: Record<string, string> = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers, redirect: 'manual' });
    const body = await response.text();
    return { status: response.status, entry: /data-entry="(\w+)"/.exec(body)?.[1] ?? null };
  };

  it.each([
    ['/admin', 'admin'], ['/admin/', 'admin'], ['/admin/demo/repos', 'admin'], ['/admin/demo/repos/icons.svg', 'admin'],
    ['/console', 'admin'], ['/console/people', 'admin'], ['/signin', 'admin'], ['/admin/signin?return_to=/admin', 'admin'],
    ['/device', 'admin'], ['/device?user_code=BCDF-GHJK', 'admin'], ['/authorize', 'admin'], ['/authorize?uid=Ab3_-xyz0123', 'admin'],
    ['/bind-email', 'admin'], ['/bind-email?return_to=%2Fforum%2F', 'admin'],
    ['/complete-profile', 'admin'], ['/complete-profile?return_to=%2Fforum%2F', 'admin'],
    ['/', 'portal'], ['/join-us', 'portal'], ['/join/abc123', 'portal'], ['/docs/usage', 'portal'],
    ['/administrator', 'portal'], ['/consoles', 'portal'], ['/signin/extra', 'portal'], ['/device/extra', 'portal'], ['/devices', 'portal'], ['/authorize/extra', 'portal'], ['/bind-email/extra', 'portal'], ['/complete-profile/extra', 'portal'],
  ])('%s → %s', async (path, site) => {
    expect(await entryOf(path)).toEqual({ status: 200, entry: site });
    // 服务端直连时（resolveSiteEntry）必须给出同一个入口。
    expect(resolveSiteEntry(path)).toBe(site === 'admin' ? ADMIN_SPA_ENTRY : PORTAL_SPA_ENTRY);
  });

  it('sends everything under /forum/ to the forum, images and fonts included', async () => {
    for (const [path, upstream] of [['/forum/', '/'], ['/forum/logo.png', '/logo.png'], ['/forum/fonts/x.woff2', '/fonts/x.woff2'], ['/forum/_nuxt/a.js', '/_nuxt/a.js']]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      expect([path, response.status, await response.text()]).toEqual([path, 200, `forum ${upstream}`]);
    }
    // 官网自己的图片仍由 web 的站点根服务。
    expect(await (await fetch(`http://127.0.0.1:${port}/logo.png`)).text()).toBe('png');
  });

  it('ignores a client-supplied site header and still serves real files', async () => {
    expect(await entryOf('/', { 'X-YZGC-Site': 'admin' })).toEqual({ status: 200, entry: 'portal' });
    expect((await fetch(`http://127.0.0.1:${port}/logo.png`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/assets/missing.js`)).status).toBe(404);
    // 控制台自己的哈希资源目录：真实文件长缓存，缺失文件 404，不回落到入口页。
    const consoleAsset = await fetch(`http://127.0.0.1:${port}/console-assets/index-abc123.js`);
    expect(consoleAsset.status).toBe(200);
    expect(consoleAsset.headers.get('cache-control')).toContain('max-age=31536000');
    expect((await fetch(`http://127.0.0.1:${port}/console-assets/missing.js`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/release.json`)).headers.get('cache-control')).toBe('no-store');
  });

  it('serves the contest SDK with an open origin and short cache, and never falls back to the portal for it (#278)', async () => {
    const sdk = await fetch(`http://127.0.0.1:${port}/sdk/competition/v1.js`, { headers: { Origin: 'null' } });
    expect(sdk.status).toBe(200);
    expect(sdk.headers.get('access-control-allow-origin')).toBe('*');
    expect(sdk.headers.get('cache-control')).toBe('max-age=300');
    expect((await fetch(`http://127.0.0.1:${port}/sdk/competition/v2.js`)).status).toBe(404);
  });

  it('counts each real client separately behind the trusted proxy, and leaves static and forum paths alone (#333)', async () => {
    // 同一个客户端一口气发 120 个写请求：突发额度 60 之外会被 429，而且返回的体与服务端的 rate_limited 同形，notice 与 SHIELD_NOTICE 逐字相同
    const limited = (await volley(port, '198.51.100.1')).filter(item => item.status === 429);
    expect(limited.length).toBeGreaterThan(0);
    expect(JSON.parse(limited[0].text)).toEqual({ error: 'rate_limited', message: '操作太频繁，请稍后再试', notice: SHIELD_NOTICE });
    // 同一个代理后面的另一位用户不受影响：计数按 X-Forwarded-For 里的客户端走，不是按代理的地址
    expect(refused(await volley(port, '198.51.100.2', { count: 1 }))).toEqual([]);
    // 静态文件和论坛不在限流范围内
    expect(refused(await volley(port, '198.51.100.3', { path: '/logo.png', method: 'GET' }))).toEqual([]);
    expect(refused(await volley(port, '198.51.100.3', { path: '/forum/', method: 'GET' }))).toEqual([]);
  });

  it('keeps reads out of the write bucket, and limits writes to /auth/ like /api/ (#333)', async () => {
    // 90 个：超过写桶的突发 60，低于读桶的突发 200 与每个来源 100 个连接
    expect(refused(await volley(port, '198.51.100.4', { path: '/api/feedback', method: 'GET', count: 90 }))).toEqual([]);
    expect(refused(await volley(port, '198.51.100.5', { path: '/api/feedback', count: 90 })).length).toBeGreaterThan(0);
    expect(refused(await volley(port, '198.51.100.6', { path: '/auth/github/callback', count: 90 })).length).toBeGreaterThan(0);
  });
});

describe.skipIf(!nginxBinary)('web container nginx honours SHIELD_ENABLED and SHIELD_ALLOWLIST at the edge (live nginx on loopback, #333)', () => {
  const stacks: LiveNginx[] = [];
  afterAll(async () => {
    for (const stack of stacks) await stack.stop();
  });

  it('lets an allowlisted source through the first layer while everyone else is still limited', async () => {
    // 白名单项故意带主机位：渲染时清零，nginx 加载时不出现带网段的警告
    const stack = await launchNginx({ SHIELD_ENABLED: 'on', SHIELD_ALLOWLIST: '203.0.113.200, 198.51.100.77/24' });
    stacks.push(stack);
    expect(refused(await volley(stack.port, '198.51.100.7'))).toEqual([]);
    expect(refused(await volley(stack.port, '198.51.100.7', { path: '/auth/github/callback' }))).toEqual([]);
    expect(refused(await volley(stack.port, '192.0.2.10')).length).toBeGreaterThan(0);
    expect(readFileSync(join(stack.root, 'error.log'), 'utf8')).not.toMatch(/low address bits|duplicate network/);
  }, 20000);

  it('does not limit anyone when the shield is off', async () => {
    const stack = await launchNginx({ SHIELD_ENABLED: 'off' });
    stacks.push(stack);
    expect(refused(await volley(stack.port, '192.0.2.20'))).toEqual([]);
    // 健康检查与普通页面照常
    expect((await fetch(`http://127.0.0.1:${stack.port}/release.json`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${stack.port}/signin`)).status).toBe(200);
  }, 20000);
});
