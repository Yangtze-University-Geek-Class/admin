import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_SPA_ENTRY, PORTAL_SPA_ENTRY, resolveSiteEntry } from '../../app/server/src/app';

// web 镜像内的 nginx 配置写在 app/web/Dockerfile 的 heredoc 里。这里原样抽出来：
// 字符串断言永远执行；本机有 nginx 时再把它跑起来，按路径实测 SPA 入口选择。
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
const hostConf = (name: string) => readFileSync(join(repoRoot, `deploy/nginx/${name}.conf`), 'utf8');

describe('web container nginx picks the SPA entry by path', () => {
  it('declares the admin paths and entry in one location, before the image rule, with no host switch', () => {
    // 管理端路径清单与入口文件在 nginx 里各只出现一次，服务端对应的是 ADMIN_SPA_PATHS / ADMIN_SPA_ENTRY。
    expect(siteConf.match(/^\s*location ~ \^\/\(\?:\(\?:admin\|console\)\(\?:\/\|\$\)\|signin\$\) \{$/gm)).toHaveLength(1);
    expect(siteConf.split(`/${ADMIN_SPA_ENTRY}`)).toHaveLength(2);
    expect(siteConf.indexOf(`/${ADMIN_SPA_ENTRY}`)).toBeLessThan(siteConf.indexOf('location ~* \\.(?:png'));
    expect(siteConf).toMatch(new RegExp(`location / \\{\\s*try_files \\$uri /${PORTAL_SPA_ENTRY.replaceAll('/', '\\/').replaceAll('.', '\\.')};\\s*\\}`));
    expect(dockerfile).not.toMatch(/X-YZGC|x_yzgc|yzgc_spa_entry|render-web-config/i);
    // 论坛前缀必须是 ^~，否则下面的图片正则会截走 /forum/ 下的图片（#81）。
    expect(siteConf).toMatch(/^\s*location \^~ \/forum\/ \{$/m);
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

const nginxBinary = spawnSync('nginx', ['-v'], { encoding: 'utf8' }).status === 0 ? 'nginx' : null;

describe.skipIf(!nginxBinary)('web container nginx routing (live nginx on loopback)', () => {
  let root = '';
  let port = 0;
  let forumPort = 0;
  let child: ChildProcess | null = null;

  const freePort = () => new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'geek-web-nginx-'));
    port = await freePort();
    forumPort = await freePort();
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
    writeFileSync(join(html, 'logo.png'), 'png');
    writeFileSync(join(html, 'release.json'), '{"environment":"test"}\n');
    // 只替换运行环境相关的五处：监听端口、站点根、include 路径、上游地址（server 不访问；forum 换成同一 nginx 里回显路径的桩）、
    // 日志去向（容器写 /dev/stdout、/dev/stderr；CI runner 上没有可打开的终端设备，nginx -t 会失败）。
    const site = siteConf
      .replace('listen 8080;', `listen 127.0.0.1:${port};`)
      .replace('root /usr/share/nginx/html;', `root ${html};`)
      .replaceAll('/etc/nginx/conf.d/90-proxy-headers.conf', join(root, '90-proxy-headers.conf'))
      .replaceAll('http://forum:3000/', `http://127.0.0.1:${forumPort}/`)
      .replaceAll('http://server:3000', 'http://127.0.0.1:9')
      .replaceAll('/dev/stdout', join(root, 'access.log'))
      .replaceAll('/dev/stderr', join(root, 'error.log'));
    expect(site).not.toMatch(/listen 8080|\/usr\/share\/nginx|\/etc\/nginx|server:3000|forum:3000|\/dev\/std/);
    writeFileSync(join(root, '10-web.conf'), site);
    writeFileSync(join(root, '90-proxy-headers.conf'), proxyHeaders);
    for (const dir of ['client', 'proxy', 'fastcgi', 'uwsgi', 'scgi']) mkdirSync(join(root, `${dir}_temp`));
    writeFileSync(join(root, 'nginx.conf'), [
      'worker_processes 1;',
      'master_process off;',
      `pid ${join(root, 'nginx.pid')};`,
      `error_log ${join(root, 'error.log')} warn;`,
      'events { worker_connections 64; }',
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
    child = spawn(nginxBinary!, [...args, '-g', 'daemon off;'], { stdio: 'ignore' });
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/release.json`)).ok) return;
      } catch { /* 还没开始监听 */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`nginx 未能在 127.0.0.1:${port} 就绪：${readFileSync(join(root, 'error.log'), 'utf8')}`);
  }, 20000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child!.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  const entryOf = async (path: string, headers: Record<string, string> = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers, redirect: 'manual' });
    const body = await response.text();
    return { status: response.status, entry: /data-entry="(\w+)"/.exec(body)?.[1] ?? null };
  };

  it.each([
    ['/admin', 'admin'], ['/admin/', 'admin'], ['/admin/demo/repos', 'admin'], ['/admin/demo/repos/icons.svg', 'admin'],
    ['/console', 'admin'], ['/console/people', 'admin'], ['/signin', 'admin'], ['/admin/signin?return_to=/admin', 'admin'],
    ['/', 'portal'], ['/join-us', 'portal'], ['/join/abc123', 'portal'], ['/docs/usage', 'portal'],
    ['/administrator', 'portal'], ['/consoles', 'portal'], ['/signin/extra', 'portal'],
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
});
