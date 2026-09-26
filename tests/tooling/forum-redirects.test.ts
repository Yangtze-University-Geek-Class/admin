import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// #140：直接打开 /forum、刷新 /forum/users 这类地址时，跳转不能带容器自己的协议和端口，也不能丢掉 /forum 前缀。
// 三层配置都取仓库里的原文：宿主 deploy/nginx/preview.conf 的 location /、web 与论坛两个 Dockerfile 里的 heredoc。
// 字符串断言永远执行；本机有 nginx 时把三层放进同一个 nginx 进程，按真实请求核对状态码和 Location。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');
const hostConf = (name: string) => read(`deploy/nginx/${name}.conf`);
const webDockerfile = read('app/web/Dockerfile');
const forumDockerfile = read('app/forum/Dockerfile');
const heredoc = (dockerfile: string, name: string) => {
  const match = new RegExp(`COPY <<'${name}' \\S+\\n([\\s\\S]*?)\\n${name}\\n`).exec(dockerfile);
  if (!match) throw new Error(`Dockerfile 里找不到 heredoc ${name}`);
  return match[1];
};
const webSite = heredoc(webDockerfile, 'NGINX_SITE');
const forumSite = heredoc(forumDockerfile, 'NGINX_SITE');
// server 块里第一个 location 之前的部分：absolute_redirect 写在这里，对整个 server 生效。
const serverLevel = (site: string) => site.slice(0, site.indexOf('\n    location '));
const locationBody = (site: string, name: string) =>
  [...site.matchAll(/^    location ([^{]+) \{\n([\s\S]*?)^    \}$/gm)].find(match => match[1] === name)?.[2] ?? '';

// 论坛里 nuxt generate 预渲染成 <路由>/index.html 的页面，issue 里逐个报过。
const PRERENDERED = ['users', 'new', 'about', 'categories', 'tags', 'search', 'bookmarks', 'notifications'];

describe('forum redirects stay relative (config)', () => {
  it('web container: /forum redirects to a relative /forum/, and forum redirects get the prefix back', () => {
    expect(serverLevel(webSite).match(/^    absolute_redirect off;$/gm)).toHaveLength(1);
    expect(locationBody(webSite, '= /forum')).toBe('        return 308 /forum/;\n');
    const forum = locationBody(webSite, '^~ /forum/');
    expect(forum).toContain('proxy_pass http://forum:3000/;');
    // 写了任何一条 proxy_redirect，默认那条（http://forum:3000/ → /forum/）就不再生效；它本来也碰不上，
    // 因为转发时 Host 是外面的域名。所以这里只留这一条，别的写法都要同步本测试。
    expect(forum.match(/^\s*proxy_redirect [^\n]*$/gm)).toEqual(['        proxy_redirect / /forum/;']);
  });

  it('forum container: prerendered route directories are served in place, never through a trailing-slash redirect', () => {
    expect(serverLevel(forumSite).match(/^    absolute_redirect off;$/gm)).toHaveLength(1);
    expect(locationBody(forumSite, '/')).toContain('try_files $uri $uri/index.html /200.html;');
    // 任何 try_files 里都不能再有 `$uri/`（目录检查）：命中目录后 nginx 会 301 补斜杠，跳转里没有 /forum 前缀。
    expect(forumSite.match(/try_files[^;]*\$uri\/(?=[\s;])/g)).toBeNull();
  });

  it('host templates redirect only to explicit https URLs and pass upstream redirects through untouched', () => {
    for (const name of ['preview', 'production']) {
      const text = hostConf(name);
      for (const line of text.match(/^\s*return 30\d [^\n]*$/gm) ?? []) expect(line, name).toMatch(/return 301 https:\/\//);
      expect(text, name).not.toMatch(/proxy_redirect|absolute_redirect|port_in_redirect/);
    }
  });
});

const nginxBinary = spawnSync('nginx', ['-v'], { encoding: 'utf8' }).status === 0 ? 'nginx' : null;

describe.skipIf(!nginxBinary)('forum redirects through host → web → forum (live nginx on loopback)', () => {
  let root = '';
  // legacyForum 是把目录检查 $uri/ 放回去的第二份论坛配置（修复前的写法，会发补斜杠的 301），
  // webLegacy 是指向它的第二份 web 配置：用来核对论坛万一再发跳转时，两层兜底合起来仍然只给出带前缀的相对地址。
  const ports = { host: 0, web: 0, forum: 0, server: 0, legacyForum: 0, webLegacy: 0 };
  let child: ChildProcess | null = null;

  const freePort = () => new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });

  // 用 node:http 而不是 fetch：要像线上一样带 Host: prev.yangtzeu.work，并且原样拿到 Location。
  const get = (port: number, path: string) => new Promise<{ status: number; location: string | null; page: string | null }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, agent: false, headers: { host: 'prev.yangtzeu.work' } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        location: response.headers.location ?? null,
        page: /data-page="([\w-]+)"/.exec(body)?.[1] ?? null,
      }));
    });
    req.on('error', reject);
    req.end();
  });

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'geek-forum-redirects-'));
    for (const name of Object.keys(ports) as (keyof typeof ports)[]) ports[name] = await freePort();

    // 论坛产物的形状：预渲染页面是 <路由>/index.html，动态路由（/t/<id>、/u/<name>）走 200.html；
    // published/ 是只放图片、没有 index.html 的目录。
    const forumHtml = join(root, 'forum-html');
    const page = (name: string) => `<!DOCTYPE html><html><body><div id="__nuxt" data-page="${name}"></div></body></html>\n`;
    mkdirSync(join(forumHtml, '_nuxt'), { recursive: true });
    mkdirSync(join(forumHtml, 't'), { recursive: true });
    mkdirSync(join(forumHtml, 'published'), { recursive: true });
    writeFileSync(join(forumHtml, 'index.html'), page('index'));
    writeFileSync(join(forumHtml, '200.html'), page('spa'));
    writeFileSync(join(forumHtml, '404.html'), page('not-found'));
    writeFileSync(join(forumHtml, '_nuxt', 'entry.js'), 'export {};\n');
    writeFileSync(join(forumHtml, 't', 't89.md'), '# t89\n');
    writeFileSync(join(forumHtml, 'published', 'a.webp'), 'webp');
    for (const name of PRERENDERED) {
      mkdirSync(join(forumHtml, name));
      writeFileSync(join(forumHtml, name, 'index.html'), page(name));
    }
    const webHtml = join(root, 'web-html');
    mkdirSync(join(webHtml, 'sites', 'portal'), { recursive: true });
    writeFileSync(join(webHtml, 'sites', 'portal', 'index.html'), page('portal'));

    const logs = (text: string) => text.replaceAll('/dev/stdout', join(root, 'access.log')).replaceAll('/dev/stderr', join(root, 'error.log'));
    // 论坛容器：只换端口、站点根与日志去向。
    const forum = (listen: number) => {
      const text = logs(forumSite)
        .replace('listen 3000;', `listen 127.0.0.1:${listen};`)
        .replace('root /usr/share/nginx/html;', `root ${forumHtml};`);
      expect(text).not.toMatch(/listen 3000|\/usr\/share\/nginx|\/dev\/std/);
      return text;
    };
    const legacyForum = forum(ports.legacyForum).replace('try_files $uri $uri/index.html /200.html;', 'try_files $uri $uri/ /200.html;');
    expect(legacyForum).toContain('try_files $uri $uri/ /200.html;');
    // web 容器：只换端口、站点根、include 路径、上游地址与日志去向；第二份的论坛上游是 legacyForum。
    const web = (listen: number, forumUpstream: number) => {
      const text = logs(webSite)
        .replace('listen 8080;', `listen 127.0.0.1:${listen};`)
        .replace('root /usr/share/nginx/html;', `root ${webHtml};`)
        .replaceAll('/etc/nginx/conf.d/90-proxy-headers.conf', join(root, '90-proxy-headers.conf'))
        .replaceAll('http://server:3000', `http://127.0.0.1:${ports.server}`)
        .replaceAll('http://forum:3000/', `http://127.0.0.1:${forumUpstream}/`);
      expect(text).not.toMatch(/listen 8080|\/usr\/share\/nginx|\/etc\/nginx|server:3000|forum:3000|\/dev\/std/);
      return text;
    };
    writeFileSync(join(root, '90-proxy-headers.conf'), heredoc(webDockerfile, 'NGINX_HEADERS'));
    // 宿主：preview.conf 里 443 server 的 location / 原样使用（去掉 TLS），只换上游端口。
    const hostLocation = /^    location \/ \{\n        proxy_pass http:\/\/127\.0\.0\.1:18200;\n[\s\S]*?^    \}$/m.exec(hostConf('preview'))?.[0] ?? '';
    expect(hostLocation).toContain('proxy_set_header Host $host;');
    const host = hostLocation.replace('http://127.0.0.1:18200;', `http://127.0.0.1:${ports.web};`);

    const temps = ['client', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].map(name => {
      mkdirSync(join(root, `${name}_temp`));
      return `  ${name === 'client' ? 'client_body' : name}_temp_path ${join(root, `${name}_temp`)};`;
    });
    writeFileSync(join(root, 'nginx.conf'), [
      'worker_processes 1;', 'master_process off;', `pid ${join(root, 'nginx.pid')};`, `error_log ${join(root, 'error.log')} warn;`,
      'events { worker_connections 64; }',
      'http {', '  types { text/html html; application/javascript js; image/webp webp; }', '  default_type application/octet-stream;',
      `  access_log ${join(root, 'access.log')};`, ...temps,
      `  server { listen 127.0.0.1:${ports.host};`, host, '  }',
      web(ports.web, ports.forum),
      web(ports.webLegacy, ports.legacyForum),
      forum(ports.forum),
      legacyForum,
      `  server { listen 127.0.0.1:${ports.server}; access_log off; location / { default_type application/json; return 200 '{}'; } }`,
      '}', '',
    ].join('\n'));

    const args = ['-p', `${root}/`, '-e', join(root, 'error.log'), '-c', join(root, 'nginx.conf')];
    const syntax = spawnSync(nginxBinary!, ['-t', ...args], { encoding: 'utf8' });
    expect(syntax.status, syntax.stderr).toBe(0);
    child = spawn(nginxBinary!, [...args, '-g', 'daemon off;'], { stdio: 'ignore' });
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        await get(ports.host, '/');
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

  it('/forum redirects to the relative /forum/, from the web container and through the host', async () => {
    for (const port of [ports.web, ports.host]) expect(await get(port, '/forum')).toEqual({ status: 308, location: '/forum/', page: null });
  });

  it('forum container serves prerendered routes with and without the trailing slash, no redirect', async () => {
    for (const name of PRERENDERED) {
      for (const path of [`/${name}`, `/${name}/`]) {
        expect([path, await get(ports.forum, path)]).toEqual([path, { status: 200, location: null, page: name }]);
      }
    }
    expect(await get(ports.forum, '/')).toEqual({ status: 200, location: null, page: 'index' });
  });

  it('forum container falls back to 200.html for unknown paths, dynamic routes and directories without a page', async () => {
    for (const path of ['/no/such/page', '/t/t89', '/u/someone', '/published', '/published/']) {
      expect([path, await get(ports.forum, path)]).toEqual([path, { status: 200, location: null, page: 'spa' }]);
    }
  });

  it('refreshing any forum page through host → web → forum returns the page itself', async () => {
    const paths = ['/forum/', '/forum/t/t89', ...PRERENDERED.flatMap(name => [`/forum/${name}`, `/forum/${name}/`])];
    for (const path of paths) {
      const response = await get(ports.host, path);
      const expected = path === '/forum/' ? 'index' : path === '/forum/t/t89' ? 'spa' : path.split('/')[2];
      expect([path, response]).toEqual([path, { status: 200, location: null, page: expected }]);
    }
  });

  it('if the forum ever redirects again, the browser still gets a relative Location with the /forum prefix', async () => {
    // 论坛只发相对地址（absolute_redirect off），web 把 /users/ 补成 /forum/users/（proxy_redirect）；缺一层都会跳错。
    for (const [path, location] of [['/forum/users', '/forum/users/'], ['/forum/published', '/forum/published/']]) {
      expect([path, await get(ports.webLegacy, path)]).toEqual([path, { status: 301, location, page: null }]);
    }
  });

  it('no response on the forum paths carries an absolute Location or an internal port', async () => {
    const internal = [ports.web, ports.forum, ports.webLegacy, ports.legacyForum].map(port => `:${port}`);
    for (const port of [ports.host, ports.web, ports.webLegacy]) {
      for (const path of ['/forum', '/forum/', ...PRERENDERED.map(name => `/forum/${name}`)]) {
        const { location } = await get(port, path);
        if (location === null) continue;
        expect([path, location]).toEqual([path, expect.stringMatching(/^\/forum\//)]);
        for (const needle of ['://', ...internal]) expect(location, path).not.toContain(needle);
      }
    }
  });
});
