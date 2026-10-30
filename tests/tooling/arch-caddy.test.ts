import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'geek-arch-caddy-'));
  roots.push(root);
  for (const dir of ['scripts', 'deploy/nginx', 'deploy/env']) mkdirSync(join(root, dir), { recursive: true });
  for (const script of ['render-arch-caddy.mjs', 'deployment-environment.mjs']) copyFileSync(join(repo, 'scripts', script), join(root, 'scripts', script));
  for (const [environment, port, host] of [['production', 18100, 'yangtzeu.work'], ['preview', 18200, 'prev.yangtzeu.work']] as const) {
    copyFileSync(join(repo, `deploy/nginx/${environment}.conf`), join(root, `deploy/nginx/${environment}.conf`));
    writeFileSync(join(root, `deploy/env/.env.${environment}`), `WEB_BIND=10.66.0.2:${port}\nPUBLIC_ORIGIN=https://${host}\n`);
  }
  const out = join(root, 'generated');
  const run = (output = out, args: string[] = []) => spawnSync(process.execPath, [join(root, 'scripts/render-arch-caddy.mjs'), '--out', output, ...args], { encoding: 'utf8', timeout: 5000 });
  return { root, out, run };
}

it('never writes public sites into a Caddy activation directory, including through a symlink', () => {
  const f = fixture();
  const active = join(f.root, 'etc/caddy/sites');
  mkdirSync(active, { recursive: true });
  const link = join(f.root, 'innocent-output');
  symlinkSync(active, link);
  const result = f.run(link);
  expect(result.status, result.stderr).not.toBe(0);
  expect(readdirSync(active)).toEqual([]);
});

it('rejects divergent gateway body limits instead of silently generating a third policy', () => {
  const f = fixture();
  const path = join(f.root, 'deploy/nginx/preview.conf');
  writeFileSync(path, readFileSync(path, 'utf8').replace('client_max_body_size 6m;', 'client_max_body_size 7m;'));
  const result = f.run();
  expect(result.status, result.stderr).not.toBe(0);
  expect(readdirSync(f.out)).toEqual([]);
});

it('refuses ambiguous default CSP without leaving usable partial configuration', () => {
  const f = fixture();
  const path = join(f.root, 'deploy/nginx/production.conf');
  writeFileSync(path, `${readFileSync(path, 'utf8')}\nmap $fixture $ambiguous {\n default "default-src 'none'";\n}\n`);
  const result = f.run();
  expect(result.status, result.stderr).not.toBe(0);
  expect(readdirSync(f.out)).toEqual([]);
});

it('validates both environment bindings before writing any public or preflight file', () => {
  const f = fixture();
  writeFileSync(join(f.root, 'deploy/env/.env.preview'), 'WEB_BIND=10.66.0.2:18100\nPUBLIC_ORIGIN=https://prev.yangtzeu.work\n');
  const result = f.run();
  expect(result.status, result.stderr).not.toBe(0);
  expect(readdirSync(f.out)).toEqual([]);
});

it('rejects duplicate target bindings rather than accepting only the first value', () => {
  const f = fixture();
  writeFileSync(join(f.root, 'deploy/env/.env.preview'), 'WEB_BIND=10.66.0.2:18200\nPUBLIC_ORIGIN=https://prev.yangtzeu.work\n  WEB_BIND = 10.66.0.2:18100\n');
  const result = f.run();
  expect(result.status, result.stderr).not.toBe(0);
  expect(readdirSync(f.out)).toEqual([]);
});

it('includes legacy admin sites only when explicitly requested, keeping the default four files restricted to approved domains', () => {
  const f = fixture();
  const standard = f.run();
  expect(standard.status, standard.stderr).toBe(0);
  expect(readdirSync(f.out).sort()).toEqual(['common.caddy', 'preflight.caddy', 'preview.caddy', 'production.caddy']);
  for (const file of readdirSync(f.out)) expect(readFileSync(join(f.out, file), 'utf8')).not.toContain('github.yangtzeu.work');
  const optional = join(f.root, 'legacy-generated');
  const legacy = f.run(optional, ['--include-legacy-admin']);
  expect(legacy.status, legacy.stderr).toBe(0);
  expect(readFileSync(join(optional, 'production.caddy'), 'utf8')).toContain('github.yangtzeu.work {');
  for (const file of ['common.caddy', 'preflight.caddy', 'preview.caddy']) expect(readFileSync(join(optional, file), 'utf8')).not.toContain('github.yangtzeu.work');
});

it('gives each environment only its own contest-site prefix in the host CSP, and changes nothing else', () => {
  const f = fixture();
  const plain = f.run();
  expect(plain.status, plain.stderr).toBe(0);
  writeFileSync(join(f.root, 'deploy/env/.env.preview'), 'WEB_BIND=10.66.0.2:18200\nPUBLIC_ORIGIN=https://prev.yangtzeu.work\nOBJECT_STORAGE_PUBLIC_BASE=https://cdn.example.test/\nOBJECT_STORAGE_PREFIX=yzgc/preview/\n');
  writeFileSync(join(f.root, 'deploy/env/.env.production'), 'WEB_BIND=10.66.0.2:18100\nPUBLIC_ORIGIN=https://yangtzeu.work\nOBJECT_STORAGE_PUBLIC_BASE=https://cdn.example.test/\nOBJECT_STORAGE_PREFIX=yzgc/production/\n');
  const out = join(f.root, 'with-storage');
  const result = f.run(out);
  expect(result.status, result.stderr).toBe(0);
  const snippet = (text: string, name: string) => text.slice(text.indexOf(`(${name}) {`), text.indexOf('\n}\n', text.indexOf(`(${name}) {`)));
  const policy = (text: string, name: string) => /@forum \?Content-Security-Policy "([^"]+)"/.exec(snippet(text, name))![1];
  const withStorage = readFileSync(join(out, 'common.caddy'), 'utf8');
  const baseline = readFileSync(join(f.out, 'common.caddy'), 'utf8');
  for (const [name, prefix] of [['yzgc-security-preview', 'https://cdn.example.test/yzgc/preview/contest-sites/'], ['yzgc-security-production', 'https://cdn.example.test/yzgc/production/contest-sites/']] as const) {
    expect(snippet(withStorage, name)).toContain(prefix);
    // 同一条策略在 /forum/ 与其它路径各出现一次，每次写进 script-src、style-src、font-src 三条
    expect(snippet(withStorage, name).split(prefix).length - 1, name).toBe(6);
    expect(policy(withStorage, name).replaceAll(` ${prefix}`, ''), name).toBe(policy(baseline, name));
    expect(snippet(withStorage, name).includes(name === 'yzgc-security-preview' ? 'yzgc/production/contest-sites' : 'yzgc/preview/contest-sites'), name).toBe(false);
  }
  expect(readFileSync(join(out, 'preview.caddy'), 'utf8')).toContain('import yzgc-security-preview ');
  expect(readFileSync(join(out, 'production.caddy'), 'utf8')).toContain('import yzgc-security-production ');
});

const caddyImage = process.env.ARCH_CADDY_IMAGE;
const nodeImage = process.env.ARCH_RUNTIME_IMAGE ?? 'node:22-bookworm-slim';
const liveAvailable = caddyImage && spawnSync('docker', ['image', 'inspect', caddyImage, nodeImage], { stdio: 'ignore', timeout: 5000 }).status === 0;

describe.skipIf(!liveAvailable)('generated Caddy routes (real Caddy, synthetic upstream, no network access)', () => {
  let root = '';
  let node = '';
  let caddy = '';

  function docker(args: string[]) {
    const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`docker ${args[0]}: ${result.error?.message ?? result.stderr}`);
    return result.stdout;
  }

  function request(port: number, path: string, headers: Record<string, string> = {}, size = 0) {
    const client = `const http = require('node:http'); const [port, path, headers, size] = process.argv.slice(1); const req = http.request({host: '127.0.0.1', port: Number(port), path, method: Number(size) ? 'POST' : 'GET', headers: {...JSON.parse(headers), ...(Number(size) ? {'Content-Length': size} : {})}}, res => { let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk); res.on('end', () => console.log(JSON.stringify({status: res.statusCode, headers: res.headers, raw: res.rawHeaders, body}))); }); req.on('error', error => { console.error(error.message); process.exitCode = 1; }); req.setTimeout(3000, () => req.destroy(new Error('timeout'))); req.end(Number(size) ? Buffer.alloc(Number(size), 97) : undefined);`;
    return JSON.parse(docker(['exec', node, 'node', '-e', client, String(port), path, JSON.stringify(headers), String(size)]));
  }

  beforeAll(() => {
    const f = fixture();
    root = roots.pop()!;
    for (const environment of ['production', 'preview']) {
      const path = join(f.root, `deploy/nginx/${environment}.conf`);
      writeFileSync(path, readFileSync(path, 'utf8').replace('X-Frame-Options DENY', 'X-Frame-Options SAMEORIGIN'));
    }
    const generated = f.run();
    expect(generated.status, generated.stderr).toBe(0);
    const common = readFileSync(join(f.out, 'common.caddy'), 'utf8');
    const sites = ['production', 'preview'].map((environment, i) => readFileSync(join(f.out, `${environment}.caddy`), 'utf8')
      .replace(/^((?:prev\.)?yangtzeu\.work) \{/m, `http://$1:${18800 + i} {`));
    const legacyOut = join(f.root, 'legacy-generated');
    const legacy = f.run(legacyOut, ['--include-legacy-admin']);
    expect(legacy.status, legacy.stderr).toBe(0);
    const legacySites = readFileSync(join(legacyOut, 'production.caddy'), 'utf8')
      .replace(/^((?:github\.)?yangtzeu\.work) \{/gm, 'http://$1:18802 {')
      .replace(/^http:\/\/((?:github\.)?yangtzeu\.work) \{/gm, 'http://$1:18803 {');
    const config = `{
 admin off
 auto_https off
 servers {
  trusted_proxies static 0.0.0.0/0
 }
}
${common}
${sites.join('\n')}
${legacySites}
${readFileSync(join(f.out, 'preflight.caddy'), 'utf8')}`.replaceAll('10.66.0.2:', '127.0.0.1:');
    writeFileSync(join(f.out, 'Caddyfile'), config);
    docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--mount', `type=bind,src=${f.out},dst=/fixtures,readonly`, '--entrypoint', 'caddy', caddyImage!, 'adapt', '--adapter', 'caddyfile', '--config', '/fixtures/Caddyfile', '--validate']);
    const upstream = `const http = require('node:http'); for (const port of [18100, 18200]) http.createServer((req, res) => {
      let bytes = 0; req.on('data', chunk => bytes += chunk.length); req.on('end', () => {
        if (req.url === '/api/ip-gate' && req.headers['x-forwarded-for'] !== '127.0.0.1') { res.writeHead(403); res.end('untrusted client'); return; }
        if (req.url === '/forum') { res.writeHead(308, {Location: '/forum/'}); res.end(); return; }
        if (req.url === '/api/redirect') { res.writeHead(302, {Location: '/signin?return_to=%2Fconsole'}); res.end(); return; }
        if (req.url.startsWith('/forum/') && req.url !== '/forum/no-policy') res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'sha256-U3ludGhldGljSGFzaA=='");
        if (req.url.startsWith('/c/')) res.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'self'; frame-ancestors 'none'");
        if (req.url === '/asset.wasm' || req.url === '/model.glb') { res.setHeader('Content-Type', req.url.endsWith('wasm') ? 'application/wasm' : 'model/gltf-binary'); res.end('x'.repeat(2048)); return; }
        res.setHeader('Content-Type', 'text/html'); res.end(bytes ? String(bytes) : 'synthetic page');
      });
    }).listen(port, '127.0.0.1');`;
    node = docker(['run', '-d', '--pull', 'never', '--network', 'none', nodeImage, 'node', '-e', upstream]).trim();
    caddy = docker(['run', '-d', '--pull', 'never', '--network', `container:${node}`, '--read-only', '--tmpfs', '/data', '--tmpfs', '/config', '--mount', `type=bind,src=${f.out},dst=/fixtures,readonly`, '--entrypoint', 'caddy', caddyImage!, 'run', '--adapter', 'caddyfile', '--config', '/fixtures/Caddyfile']).trim();
    for (let attempt = 0; attempt < 40; attempt++) {
      try { if (request(18480, '/').status === 200) return; } catch { /* Wait for our own isolated listeners. */ }
    }
    throw new Error(`Caddy did not become ready: ${docker(['logs', caddy])}`);
  }, 30000);

  afterAll(() => {
    for (const id of [caddy, node]) if (id) docker(['rm', '-f', id]);
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('preserves the forum inline hash and applies the fallback policy only when upstream has none', () => {
    const forum = request(18480, '/forum/');
    expect(forum.status).toBe(200);
    expect(forum.headers['content-security-policy']).toBe("default-src 'self'; script-src 'self' 'sha256-U3ludGhldGljSGFzaA=='");
    expect(request(18481, '/forum/no-policy').headers['content-security-policy']).toContain("connect-src 'self' blob:");
  });

  it('keeps the competition sandbox while appending the authoritative site policy', () => {
    const response = request(18480, '/c/demo/');
    expect(response.status).toBe(200);
    expect(response.headers['content-security-policy']).toContain("sandbox allow-scripts;");
    expect(response.headers['content-security-policy']).toContain("script-src 'self' https://challenges.cloudflare.com");
  });

  it('keeps upstream relative redirects and canonicalizes old topic URLs to the public HTTPS host', () => {
    expect(request(18480, '/forum')).toMatchObject({ status: 308, headers: { location: '/forum/' } });
    expect(request(18480, '/api/redirect')).toMatchObject({ status: 302, headers: { location: '/signin?return_to=%2Fconsole' } });
    expect(request(18800, '/forum/archive/t/7', { Host: 'yangtzeu.work' })).toMatchObject({ status: 301, headers: { location: 'https://yangtzeu.work/forum/t/t7' } });
  });

  it('enforces the same 6 MiB upload limit at the edge without dropping security headers', () => {
    expect(request(18480, '/api/upload', {}, 6 * 1024 * 1024)).toMatchObject({ status: 200, body: '6291456' });
    const rejected = request(18480, '/api/upload', {}, 6 * 1024 * 1024 + 1);
    expect(rejected.status).toBe(413);
    expect(rejected.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects forged client IP headers even when another site enabled global trusted proxies', () => {
    expect(request(18480, '/api/ip-gate', { 'X-Forwarded-For': '203.0.113.8', 'X-Real-IP': '203.0.113.9' }).status).toBe(200);
  });

  it('takes security headers from the authority and keeps no-referrer confined to loopback preflight', () => {
    const publicHeaders = request(18800, '/', { Host: 'yangtzeu.work' }).headers;
    expect(publicHeaders).toMatchObject({
      'x-frame-options': 'SAMEORIGIN', 'x-content-type-options': 'nosniff',
      'strict-transport-security': 'max-age=63072000; includeSubDomains',
      'referrer-policy': 'strict-origin-when-cross-origin', 'cross-origin-opener-policy': 'same-origin',
      'permissions-policy': 'geolocation=(), camera=(), microphone=(), payment=(), usb=()',
    });
    expect(request(18480, '/').headers['referrer-policy']).toBe('no-referrer');
  });

  it('preserves the approved main host HTTP upgrade and query string', () => {
    expect(request(80, '/console?a=1', { Host: 'yangtzeu.work' })).toMatchObject({ status: 301, headers: { location: 'https://yangtzeu.work/console?a=1' } });
  });

  it('keeps the retired admin redirect and query string only in the explicitly requested configuration', () => {
    expect(request(18803, '/join/synthetic?from=old', { Host: 'github.yangtzeu.work' })).toMatchObject({ status: 301, headers: { location: 'https://github.yangtzeu.work/join/synthetic?from=old' } });
    expect(request(18802, '/join/synthetic?from=old', { Host: 'github.yangtzeu.work' })).toMatchObject({ status: 301, headers: { location: 'https://yangtzeu.work/join/synthetic?from=old' } });
  });

  it.each(['/asset.wasm', '/model.glb'])('retains gateway gzip support for %s', path => {
    const response = request(18480, path, { 'Accept-Encoding': 'gzip' });
    expect(response.status).toBe(200);
    expect(response.headers['content-encoding'], JSON.stringify(response.headers)).toBe('gzip');
  });
});
