import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForumCsp, inlineScriptHashes, siteCsp, withScriptHashes } from '../../app/forum/scripts/csp-header.mjs';
import { ADMIN_SPA_ENTRY, PORTAL_SPA_ENTRY } from '../../app/server/src/app';

// 论坛页面的 CSP（#78）：站点策略只写在宿主 nginx 模板的 map 里，论坛镜像构建时加上内联脚本的哈希，
// 宿主只在 /forum/ 下、上游已带 CSP 时不再叠加。这里核对脚本本身、两份宿主模板与两份 Dockerfile 的接线，
// 本机有 nginx 时再用真实的 web 与论坛容器配置把「宿主 → web → 论坛」三跳跑起来看响应头。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');
const hostConf = (name: string) => read(`deploy/nginx/${name}.conf`);
const forumDockerfile = read('app/forum/Dockerfile');
const webDockerfile = read('app/web/Dockerfile');
const heredoc = (dockerfile: string, name: string) => {
  const match = new RegExp(`COPY <<'${name}' \\S+\\n([\\s\\S]*?)\\n${name}\\n`).exec(dockerfile);
  if (!match) throw new Error(`Dockerfile 里找不到 heredoc ${name}`);
  return match[1];
};
const sha = (body: string) => `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;

const IMPORTMAP = '{"imports":{"#entry":"/forum/_nuxt/entry.js"}}';
const COLOR_MODE = '(function(){document.documentElement.dataset.theme="light"})()';
const NUXT_CONFIG = 'window.__NUXT__={};window.__NUXT__.config={app:{baseURL:"/forum/"}}';
const page = (extra = '') => `<!DOCTYPE html><html><head>
<script type="importmap">${IMPORTMAP}</script>
<script>${COLOR_MODE}</script>
<script type="module" src="/forum/_nuxt/entry.js" crossorigin></script>
<script type="application/json" data-nuxt-data="nuxt-app">[{"state":1}]</script>
</head><body><div id="__nuxt"></div><script>${NUXT_CONFIG}</script>${extra}</body></html>`;

describe('forum CSP script', () => {
  it('hashes every inline executable script once, skipping external scripts and JSON data blocks', () => {
    expect(inlineScriptHashes(page() + page())).toEqual([sha(IMPORTMAP), sha(COLOR_MODE), sha(NUXT_CONFIG)]);
    expect(inlineScriptHashes('<script src="/a.js"></script><script type="application/ld+json">{}</script>')).toEqual([]);
    // 空的内联脚本也会被浏览器执行检查，照样要有哈希；data-src、data-type 不是 src、type。
    expect(inlineScriptHashes('<script></script>')).toEqual([sha('')]);
    expect(inlineScriptHashes('<script data-src="x" data-type="application/json">run()</script>')).toEqual([sha('run()')]);
  });

  it('fails instead of guessing when it cannot read every script exactly', () => {
    expect(() => inlineScriptHashes('<script>a()</script><script>b()')).toThrow(/2 个 <script> 开始标签，只认出 1 段/);
    expect(() => inlineScriptHashes('<script>a()\r\nb()</script>')).toThrow(/CR/);
    expect(() => inlineScriptHashes('<script data-x="a>b">a()</script>')).toThrow(/认不准/);
    expect(inlineScriptHashes('<script/>a()</script>')).toEqual([sha('a()')]);
  });

  it('reads the site policy from each host template and keeps both templates on the same policy', () => {
    const preview = siteCsp(hostConf('preview'));
    expect(preview).toMatch(/^default-src 'self'; script-src 'self' https:\/\/challenges\.cloudflare\.com;/);
    expect(preview).toContain("object-src 'none'");
    expect(preview).toContain("frame-ancestors 'none'");
    expect(siteCsp(hostConf('production'))).toBe(preview);
    expect(() => siteCsp('add_header Content-Security-Policy "default-src \'self\'" always;')).toThrow(/找不到站点 CSP/);
  });

  it('adds the hashes to script-src only and refuses a policy it cannot tighten', () => {
    const policy = "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; object-src 'none'";
    expect(withScriptHashes(policy, ["'sha256-A='", "'sha256-B='"]))
      .toBe("default-src 'self'; script-src 'self' https://challenges.cloudflare.com 'sha256-A=' 'sha256-B='; object-src 'none'");
    expect(() => withScriptHashes("default-src 'self'", ["'sha256-A='"])).toThrow(/没有 script-src/);
    expect(() => withScriptHashes("script-src 'self' 'unsafe-inline'", [])).toThrow(/unsafe-inline/);
  });

  it('builds one policy over every HTML file in the output and fails on an empty output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geek-forum-csp-'));
    try {
      expect(() => buildForumCsp({ htmlDir: dir, siteConf: join(repoRoot, 'deploy/nginx/production.conf') })).toThrow(/没有 HTML/);
      mkdirSync(join(dir, 'about'));
      writeFileSync(join(dir, '200.html'), page());
      writeFileSync(join(dir, 'about', 'index.html'), page('<script>window.extra=1</script>'));
      const { files, hashes, policy } = buildForumCsp({ htmlDir: dir, siteConf: join(repoRoot, 'deploy/nginx/production.conf') });
      expect(files).toBe(2);
      expect(hashes).toHaveLength(4);
      expect(policy).toBe(withScriptHashes(siteCsp(hostConf('production')), hashes));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('forum CSP wiring', () => {
  it('host templates step aside only for forum pages that already carry a CSP', () => {
    for (const env of ['preview', 'production']) {
      const text = hostConf(env);
      const variable = `$yzgc_${env}_csp`;
      const map = [
        `map "$upstream_http_content_security_policy|$uri" ${variable} {`,
        '    "~^[^|]+\\|/forum/"  "";',
        `    default             "${siteCsp(text)}";`,
        '}',
      ].join('\n');
      expect(text).toContain(`\n${map}\n`);
      expect(text.match(/add_header Content-Security-Policy [^\n]*/g)).toEqual([`add_header Content-Security-Policy ${variable} always;`]);
      // map 必须在 server 之外（http 层），否则 nginx -t 直接失败。
      expect(text.indexOf('map "$upstream_http_content_security_policy|$uri"')).toBeLessThan(text.indexOf('server {'));
    }
  });

  it('forum image generates its CSP from the production template after nuxt generate', () => {
    expect(forumDockerfile).toContain('COPY app/forum/scripts/csp-header.mjs ./scripts/csp-header.mjs');
    expect(forumDockerfile).toContain('COPY deploy/nginx/production.conf /repo/deploy/nginx/production.conf');
    expect(forumDockerfile).toMatch(/RUN node scripts\/csp-header\.mjs --html \.output\/public --site-conf \/repo\/deploy\/nginx\/production\.conf --out \/nginx-out\/conf\.d\/00-csp\.conf \\\n && grep -q "sha256-" \/nginx-out\/conf\.d\/00-csp\.conf/);
    expect(forumDockerfile.indexOf('csp-header.mjs --html')).toBeGreaterThan(forumDockerfile.indexOf('pnpm exec nuxt generate'));
    // 构建上下文默认排除 deploy/nginx，只放回论坛要读的这一份模板。
    const ignore = read('.dockerignore').split('\n').map(line => line.trim());
    expect(ignore.indexOf('!deploy/nginx/production.conf')).toBeGreaterThan(ignore.indexOf('deploy/nginx'));
    // 容器站点里没有自己 add_header 的页面 location 才会继承 http 层的 CSP：add_header 只许出现在 .md 与 llms.txt 两处。
    const site = heredoc(forumDockerfile, 'NGINX_SITE');
    const locations = [...site.matchAll(/^    location ([^{]+) \{\n([\s\S]*?)^    \}$/gm)].map(match => ({ name: match[1], body: match[2] }));
    expect(locations.map(location => location.name)).toEqual(['~ \\.md$', '= /llms.txt', '/_nuxt/', '~* \\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf)$', '= /200.html', '= /404.html', '/']);
    expect(site.match(/^\s*add_header /gm)).toHaveLength(2);
    expect(locations.filter(location => location.body.includes('add_header')).map(location => location.name)).toEqual(['~ \\.md$', '= /llms.txt']);
    // 页面不缓存：发版后旧页面配新哈希会白屏。
    for (const name of ['= /200.html', '= /404.html', '/']) expect(locations.find(location => location.name === name)?.body, name).toContain('expires -1;');
    // web 容器不发 CSP（server 也不发，已搜过 app/server/src）；要发必须从同一份站点策略出发，并同步这里。
    expect(webDockerfile).not.toMatch(/Content-Security-Policy/i);
  });
});

const nginxBinary = spawnSync('nginx', ['-v'], { encoding: 'utf8' }).status === 0 ? 'nginx' : null;

describe.skipIf(!nginxBinary)('forum CSP through host → web → forum (live nginx on loopback)', () => {
  let root = '';
  const ports = { host: 0, web: 0, forum: 0, server: 0 };
  const children: ChildProcess[] = [];
  let forumPolicy = '';

  const freePort = () => new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
  const start = async (dir: string, probePort: number) => {
    const args = ['-p', `${dir}/`, '-e', join(dir, 'error.log'), '-c', join(dir, 'nginx.conf')];
    const syntax = spawnSync(nginxBinary!, ['-t', ...args], { encoding: 'utf8' });
    expect(syntax.status, syntax.stderr).toBe(0);
    children.push(spawn(nginxBinary!, [...args, '-g', 'daemon off; master_process off;'], { stdio: 'ignore' }));
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        await fetch(`http://127.0.0.1:${probePort}/`);
        return;
      } catch { /* 还没开始监听 */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`nginx 未能在 127.0.0.1:${probePort} 就绪：${readFileSync(join(dir, 'error.log'), 'utf8')}`);
  };
  const temps = (dir: string) => ['client', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].map(name => {
    mkdirSync(join(dir, `${name}_temp`), { recursive: true });
    return `  ${name === 'client' ? 'client_body' : name}_temp_path ${join(dir, `${name}_temp`)};`;
  });

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'geek-forum-csp-nginx-'));
    for (const name of Object.keys(ports) as (keyof typeof ports)[]) ports[name] = await freePort();

    // 论坛容器：Dockerfile 里的站点配置原样使用，只替换端口、站点根、日志去向；CSP 由脚本 CLI 生成。
    const forum = join(root, 'forum');
    const html = join(forum, 'html');
    mkdirSync(join(html, '_nuxt'), { recursive: true });
    mkdirSync(join(html, 't'), { recursive: true });
    writeFileSync(join(html, 'index.html'), page());
    writeFileSync(join(html, '200.html'), page());
    writeFileSync(join(html, '_nuxt', 'entry.js'), 'export {};\n');
    writeFileSync(join(html, 't', 't1.md'), '# t1\n');
    const cli = spawnSync(process.execPath, [join(repoRoot, 'app/forum/scripts/csp-header.mjs'),
      '--html', html, '--site-conf', join(repoRoot, 'deploy/nginx/production.conf'), '--out', join(forum, '00-csp.conf')], { encoding: 'utf8' });
    expect(cli.status, cli.stderr).toBe(0);
    forumPolicy = /add_header Content-Security-Policy "([^"]+)" always;/.exec(readFileSync(join(forum, '00-csp.conf'), 'utf8'))?.[1] ?? '';
    const site = heredoc(forumDockerfile, 'NGINX_SITE')
      .replace('listen 3000;', `listen 127.0.0.1:${ports.forum};`)
      .replace('root /usr/share/nginx/html;', `root ${html};`)
      .replaceAll('/dev/stdout', join(forum, 'access.log'))
      .replaceAll('/dev/stderr', join(forum, 'error.log'));
    expect(site).not.toMatch(/listen 3000|\/usr\/share\/nginx|\/dev\/std/);
    writeFileSync(join(forum, '10-forum.conf'), site);
    writeFileSync(join(forum, 'nginx.conf'), [
      'worker_processes 1;', `pid ${join(forum, 'nginx.pid')};`, `error_log ${join(forum, 'error.log')} warn;`, 'events { worker_connections 64; }',
      'http {', '  types { text/html html; application/javascript js; }', '  default_type application/octet-stream;', ...temps(forum),
      // 与容器 nginx.conf 相同：conf.d 按文件名顺序在 http 层 include，00-csp.conf 的 add_header 在 http 层。
      `  include ${join(forum, '00-csp.conf')};`, `  include ${join(forum, '10-forum.conf')};`, '}', '',
    ].join('\n'));
    await start(forum, ports.forum);

    // 宿主 + web + server 桩，放在同一个 nginx 里，各自一个 server：
    // - 宿主：preview.conf 的 map 与全部 add_header 原样使用，去掉 TLS；
    // - web：app/web/Dockerfile 的 NGINX_SITE 原样使用，只替换端口、站点根、include 路径、上游地址与日志去向；
    // - server 桩：/api/ 的上游，故意自己带一份宽松的 CSP，用来证明宿主在论坛以外的路径不会让出站点策略。
    const front = join(root, 'front');
    const webRoot = join(front, 'html');
    for (const [name, entry] of [['portal', PORTAL_SPA_ENTRY], ['admin', ADMIN_SPA_ENTRY]]) {
      mkdirSync(join(webRoot, entry, '..'), { recursive: true });
      writeFileSync(join(webRoot, entry), `<main data-entry="${name}"></main>\n`);
    }
    writeFileSync(join(front, '90-proxy-headers.conf'), heredoc(webDockerfile, 'NGINX_HEADERS'));
    const web = heredoc(webDockerfile, 'NGINX_SITE')
      .replace('listen 8080;', `listen 127.0.0.1:${ports.web};`)
      .replace('root /usr/share/nginx/html;', `root ${webRoot};`)
      .replaceAll('/etc/nginx/conf.d/90-proxy-headers.conf', join(front, '90-proxy-headers.conf'))
      .replaceAll('http://server:3000', `http://127.0.0.1:${ports.server}`)
      .replaceAll('http://forum:3000/', `http://127.0.0.1:${ports.forum}/`)
      .replaceAll('/dev/stdout', join(front, 'access.log'))
      .replaceAll('/dev/stderr', join(front, 'error.log'));
    expect(web).not.toMatch(/listen 8080|\/usr\/share\/nginx|\/etc\/nginx|server:3000|forum:3000|\/dev\/std/);
    const preview = hostConf('preview');
    const map = /^map [\s\S]*?\n\}$/m.exec(preview)?.[0] ?? '';
    const headers = preview.match(/^\s+add_header [^\n]+$/gm) ?? [];
    expect(map).toContain('$yzgc_preview_csp');
    writeFileSync(join(front, 'nginx.conf'), [
      'worker_processes 1;', `pid ${join(front, 'nginx.pid')};`, `error_log ${join(front, 'error.log')} warn;`, 'events { worker_connections 64; }',
      'http {', '  types { text/html html; application/javascript js; image/png png; }', '  default_type application/octet-stream;', '  access_log off;', ...temps(front), map,
      `  server { listen 127.0.0.1:${ports.host};`, ...headers,
      `    location / { proxy_pass http://127.0.0.1:${ports.web}; proxy_http_version 1.1; proxy_set_header Connection ""; } }`,
      web,
      `  server { listen 127.0.0.1:${ports.server};`,
      `    location / { add_header Content-Security-Policy "${UPSTREAM_CSP}" always; default_type application/json; return 200 '{}'; } }`,
      '}', '',
    ].join('\n'));
    await start(front, ports.host);
  }, 20000);

  afterAll(async () => {
    for (const child of children) {
      if (child.exitCode !== null) continue;
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  const UPSTREAM_CSP = "default-src * 'unsafe-inline'";
  // fetch 把重复的响应头用 ", " 连起来；CSP 里没有逗号，所以值等于某一份策略就说明只有一份。
  const rawCspOf = (path: string) => new Promise<string | undefined>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: ports.host, path, agent: false }, response => {
      response.resume();
      const value = response.headers['content-security-policy'];
      resolve(Array.isArray(value) ? value.join(', ') : value);
    });
    req.on('error', reject);
    req.end();
  });
  const cspOf = async (path: string) => (await fetch(`http://127.0.0.1:${ports.host}${path}`, { redirect: 'manual' })).headers.get('content-security-policy');

  it('forum pages carry exactly the forum policy with the inline script hashes', async () => {
    expect(forumPolicy).toContain(sha(NUXT_CONFIG));
    for (const path of ['/forum/', '/forum/t/t1', '/forum/_nuxt/entry.js']) expect(await cspOf(path), path).toBe(forumPolicy);
  });

  it('everything else keeps exactly the host policy', async () => {
    const site = siteCsp(hostConf('preview'));
    // /forum/t/t1.md 的 location 有自己的 add_header，不继承论坛那份，由宿主补上站点策略。
    for (const path of ['/', '/console', '/forum', '/forum/t/t1.md']) expect(await cspOf(path), path).toBe(site);
    // 点段绕行原样发给宿主（fetch 会先在客户端规整路径，测不到宿主），宿主规整成 /console，拿到的是站点策略。
    for (const path of ['/forum/../console', '/forum/%2e%2e/console', '/forum/..%2fconsole']) expect(await rawCspOf(path), path).toBe(site);
  });

  it('never drops the site policy outside the forum, even when an upstream sends its own', async () => {
    // 两份同时下发，浏览器取交集，只会比站点策略更严。
    expect(await cspOf('/api/anything')).toBe(`${UPSTREAM_CSP}, ${siteCsp(hostConf('preview'))}`);
  });
});
