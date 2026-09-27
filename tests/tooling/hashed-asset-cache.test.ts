import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForumCsp } from '../../app/forum/scripts/csp-header.mjs';

// #146 审查：带内容哈希的产物目录（官网 /assets/、控制台 /console-assets/、论坛 /_nuxt/）整个目录缓存一年。
// nginx 先挑最长的前缀，再按顺序试正则，正则命中就用正则；普通前缀 location 会被「图片/字体 7 天」的正则截走，
// 预发布实测 /assets/*.woff2 是 max-age=604800。所以这三个前缀必须是 ^~。
// 三层配置都取仓库里的原文：宿主 deploy/nginx/preview.conf（CSP 的 map 与 443 的 server，去掉 TLS），
// web 与论坛两个 Dockerfile 里的 heredoc；论坛的 CSP 用镜像构建时同一个 csp-header.mjs 生成。
// 字符串断言永远执行；本机有 nginx 时把三层放进同一个 nginx 进程，按真实请求核对缓存头与安全头。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');
const webDockerfile = read('app/web/Dockerfile');
const forumDockerfile = read('app/forum/Dockerfile');
const heredoc = (dockerfile: string, name: string) => {
  const match = new RegExp(`COPY <<'${name}' \\S+\\n([\\s\\S]*?)\\n${name}\\n`).exec(dockerfile);
  if (!match) throw new Error(`Dockerfile 里找不到 heredoc ${name}`);
  return match[1];
};
const webSite = heredoc(webDockerfile, 'NGINX_SITE');
const forumSite = heredoc(forumDockerfile, 'NGINX_SITE');
const locations = (site: string) => new Map([...site.matchAll(/^ {4}location ([^{]+) \{\n([\s\S]*?)^ {4}\}$/gm)].map(match => [match[1], match[2]]));

const YEAR = 'max-age=31536000';
const WEEK = 'max-age=604800';
// 宿主加的安全头，加上论坛容器自己的 CSP 与跨域头：长缓存的 location 不能多出、也不能少掉其中任何一个。
const SECURITY_HEADERS = [
  'strict-transport-security', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy',
  'cross-origin-opener-policy', 'content-security-policy', 'access-control-allow-origin',
];

describe('hashed output folders are cached for a year, whatever the file type (config)', () => {
  it('web: /assets/ and /console-assets/ are ^~ prefixes with a one-year expiry and no add_header of their own', () => {
    const web = locations(webSite);
    for (const prefix of ['^~ /assets/', '^~ /console-assets/']) {
      expect(web.get(prefix), prefix).toContain('        expires 1y;\n');
      expect(web.get(prefix), prefix).not.toMatch(/add_header/);
    }
    expect(web.has('/assets/')).toBe(false);
    expect(web.has('/console-assets/')).toBe(false);
    // 不在这两个目录里的图片、字体仍是 7 天。
    expect(web.get('~* \\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf)$')).toContain('expires 7d;');
  });

  it('forum: /_nuxt/ is a ^~ prefix with a one-year expiry, except builds/latest.json, which is never cached', () => {
    const forum = locations(forumSite);
    expect(forum.get('^~ /_nuxt/')).toContain('        expires 1y;\n');
    expect(forum.get('= /_nuxt/builds/latest.json')).toContain('        expires -1;\n');
    for (const name of ['^~ /_nuxt/', '= /_nuxt/builds/latest.json']) expect(forum.get(name), name).not.toMatch(/add_header/);
    expect(forum.has('/_nuxt/')).toBe(false);
    expect(forum.get('~* \\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf)$')).toContain('expires 7d;');
  });
});

const nginxBinary = spawnSync('nginx', ['-v'], { encoding: 'utf8' }).status === 0 ? 'nginx' : null;

describe.skipIf(!nginxBinary)('hashed output folders through host → web → forum (live nginx on loopback)', () => {
  let root = '';
  const ports = { host: 0, web: 0, forum: 0 };
  let child: ChildProcess | null = null;

  const freePort = () => new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });

  // 用 node:http：像线上一样带 Host: prev.yangtzeu.work，原样拿到全部响应头。
  const head = (path: string) => new Promise<{ status: number; headers: Record<string, string | undefined> }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: ports.host, path, method: 'HEAD', agent: false, headers: { host: 'prev.yangtzeu.work' } }, response => {
      response.resume();
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: Object.fromEntries(Object.entries(response.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value])),
      }));
    });
    req.on('error', reject);
    req.end();
  });
  const security = (headers: Record<string, string | undefined>) => Object.fromEntries(SECURITY_HEADERS.map(name => [name, headers[name] ?? null]));

  const webFiles = {
    '/assets/': ['portal-pdTh_Fhq.js', 'portal-CYuDQ6ZA.css', 'nunito-cyrillic-400-normal-xAOo5cBP.woff2', 'yugc-pA0riuuE.webp'],
    '/console-assets/': ['index-Da-v5ibB.js', 'index-BDUuSmcz.css', 'font-Ab_cd-12.woff2', 'logo-B8XWu1eE.png'],
  };
  const forumFiles = ['BsIrHTXA.js', 'entry.CWRjoBJd.css', 'inter.Dx3Kp_9a.woff2', 'logo.aFxUkDTw.webp'];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'geek-asset-cache-'));
    for (const name of Object.keys(ports) as (keyof typeof ports)[]) ports[name] = await freePort();
    const put = (path: string, body = 'x') => {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, body);
    };

    const webHtml = join(root, 'web-html');
    put(join(webHtml, 'sites', 'portal', 'index.html'), '<main data-entry="portal"></main>\n');
    put(join(webHtml, 'logo.png'));
    for (const [prefix, files] of Object.entries(webFiles)) for (const file of files) put(join(webHtml, prefix, file));
    const forumHtml = join(root, 'forum-html');
    // 带一段内联脚本：论坛 CSP 由 csp-header.mjs 按它算哈希，和镜像构建时一样。
    put(join(forumHtml, 'index.html'), '<!DOCTYPE html><html><body><script>window.__NUXT__={}</script></body></html>\n');
    put(join(forumHtml, '200.html'), '<!DOCTYPE html><html><body></body></html>\n');
    put(join(forumHtml, 'logo.png'));
    for (const file of forumFiles) put(join(forumHtml, '_nuxt', file));
    put(join(forumHtml, '_nuxt', 'builds', 'latest.json'), '{"id":"x"}');
    put(join(forumHtml, '_nuxt', 'builds', 'meta', '7bc7befa-4c9a-46aa-ad06-8073788e081b.json'), '{}');
    const { policy } = buildForumCsp({ htmlDir: forumHtml, siteConf: join(repoRoot, 'deploy/nginx/production.conf') });

    const logs = (text: string) => text.replaceAll('/dev/stdout', join(root, 'access.log')).replaceAll('/dev/stderr', join(root, 'error.log'));
    // 论坛容器：只换端口、站点根与日志去向；镜像里 CSP 在 http 层（conf.d/00-csp.conf），这里同一个进程里有三层，
    // 放在论坛 server 的开头，对论坛各 location 的继承关系相同。
    const forum = logs(forumSite)
      .replace('listen 3000;', `listen 127.0.0.1:${ports.forum};\n    add_header Content-Security-Policy "${policy}" always;`)
      .replace('root /usr/share/nginx/html;', `root ${forumHtml};`);
    expect(forum).not.toMatch(/listen 3000|\/usr\/share\/nginx|\/dev\/std/);
    // web 容器：只换端口、站点根、include 路径、上游地址与日志去向。
    const web = logs(webSite)
      .replace('listen 8080;', `listen 127.0.0.1:${ports.web};`)
      .replace('root /usr/share/nginx/html;', `root ${webHtml};`)
      .replaceAll('/etc/nginx/conf.d/90-proxy-headers.conf', join(root, '90-proxy-headers.conf'))
      .replaceAll('http://server:3000', 'http://127.0.0.1:9')
      .replaceAll('http://forum:3000/', `http://127.0.0.1:${ports.forum}/`);
    expect(web).not.toMatch(/listen 8080|\/usr\/share\/nginx|\/etc\/nginx|server:3000|forum:3000|\/dev\/std/);
    writeFileSync(join(root, '90-proxy-headers.conf'), heredoc(webDockerfile, 'NGINX_HEADERS'));
    // 宿主：preview.conf 的 CSP map 与 443 server 原样使用，只去掉 TLS、换监听端口与上游端口。
    const preview = read('deploy/nginx/preview.conf');
    const map = /^map [\s\S]*?^\}$/m.exec(preview)?.[0] ?? '';
    const server = /^server \{\n {4}listen 443[\s\S]*?^\}$/m.exec(preview)?.[0] ?? '';
    expect(map).toContain('$yzgc_preview_csp');
    expect(server).toContain('add_header Content-Security-Policy $yzgc_preview_csp always;');
    const host = server
      .replace(/^ {4}listen 443[^\n]*\n {4}listen \[::\]:443[^\n]*\n/m, `    listen 127.0.0.1:${ports.host};\n`)
      .replace(/^ {4}ssl_[^\n]*\n/gm, '')
      .replace('proxy_pass http://127.0.0.1:18200;', `proxy_pass http://127.0.0.1:${ports.web};`);
    expect(host).not.toMatch(/ssl|443|18200/);

    const temps = ['client', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].map(name => {
      mkdirSync(join(root, `${name}_temp`));
      return `  ${name === 'client' ? 'client_body' : name}_temp_path ${join(root, `${name}_temp`)};`;
    });
    writeFileSync(join(root, 'nginx.conf'), [
      'worker_processes 1;', 'master_process off;', `pid ${join(root, 'nginx.pid')};`, `error_log ${join(root, 'error.log')} warn;`,
      'events { worker_connections 64; }',
      'http {',
      '  types { text/html html; text/css css; text/javascript js; application/json json; font/woff2 woff2; image/webp webp; image/png png; }',
      '  default_type application/octet-stream;',
      `  access_log ${join(root, 'access.log')};`, ...temps,
      map, host, web, forum,
      '}', '',
    ].join('\n'));

    const args = ['-p', `${root}/`, '-e', join(root, 'error.log'), '-c', join(root, 'nginx.conf')];
    const syntax = spawnSync(nginxBinary!, ['-t', ...args], { encoding: 'utf8' });
    expect(syntax.status, syntax.stderr).toBe(0);
    child = spawn(nginxBinary!, [...args, '-g', 'daemon off;'], { stdio: 'ignore' });
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        await head('/');
        return;
      } catch { /* 还没开始监听 */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`nginx 未能在 127.0.0.1:${ports.host} 就绪：${readFileSync(join(root, 'error.log'), 'utf8')}`);
  }, 20000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child!.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('web: scripts, styles, fonts and images under /assets/ and /console-assets/ all get one year, with the same security headers as the page', async () => {
    const page = await head('/');
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toMatch(/^default-src 'self'/);
    for (const [prefix, files] of Object.entries(webFiles)) {
      for (const file of files) {
        const path = `${prefix}${file}`;
        const response = await head(path);
        expect([path, response.status, response.headers['cache-control']]).toEqual([path, 200, YEAR]);
        expect([path, security(response.headers)]).toEqual([path, security(page.headers)]);
      }
    }
    // 目录外的图片仍是 7 天；目录里没有的文件是 404，不回落到入口页。
    expect((await head('/logo.png')).headers['cache-control']).toBe(WEEK);
    expect((await head('/assets/missing-12345678.woff2')).status).toBe(404);
  });

  it('forum: every file under /forum/_nuxt/ gets one year with the forum CSP, latest.json is not cached', async () => {
    const page = await head('/forum/');
    expect(page.status).toBe(200);
    // 论坛页面只有一份 CSP：论坛容器那份（带内联脚本的哈希），宿主那份在 /forum/ 下留空。
    expect(page.headers['content-security-policy']).toMatch(/'sha256-/);
    for (const file of [...forumFiles, 'builds/meta/7bc7befa-4c9a-46aa-ad06-8073788e081b.json']) {
      const path = `/forum/_nuxt/${file}`;
      const response = await head(path);
      expect([path, response.status, response.headers['cache-control']]).toEqual([path, 200, YEAR]);
      expect([path, security(response.headers)]).toEqual([path, security(page.headers)]);
    }
    const latest = await head(`/forum/_nuxt/builds/latest.json?${Date.now()}`);
    expect([latest.status, latest.headers['cache-control']]).toEqual([200, 'no-cache']);
    expect(security(latest.headers)).toEqual(security(page.headers));
    expect((await head('/forum/logo.png')).headers['cache-control']).toBe(WEEK);
  });
});
