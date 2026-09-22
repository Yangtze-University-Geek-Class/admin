#!/usr/bin/env node
// Root orchestration only: the upstream forum keeps its own runtime and lockfile.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, openSync, closeSync, readdirSync, statSync } from 'node:fs';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
const moduleRoot = join(root, 'app/forum');
const stateDir = join(root, '.tools/tuff-forum');
const stateFile = join(stateDir, 'runtime.json');
const snapshotRoot = join(root, '.tools/forum-runtime');
const origin = 'http://127.0.0.1:3456';
const SNAPSHOT_FILES = ['content.json', 'asset-index.json', 'manifest.json'];

function isSnapshotDir(dir) {
  try {
    return statSync(dir).isDirectory()
      && SNAPSHOT_FILES.every(file => statSync(join(dir, file)).isFile())
      && statSync(join(dir, 'assets')).isDirectory();
  } catch { return false; }
}

// Only `start`/`dev` serve the private read-only 极客班 snapshot. Checks, the
// upstream CDP suites and static generation always run against the demo seed:
// those suites assert seeded behaviour, and the snapshot must never end up in
// a build artifact. GEEK_FORUM_SOURCE=demo forces the seed for start/dev too.
// A relative GEEK_FORUM_CONTENT_DIR is resolved against the repository root.
function snapshotDirectory() {
  if (process.env.GEEK_FORUM_SOURCE === 'demo') return '';
  const explicit = process.env.GEEK_FORUM_CONTENT_DIR?.trim();
  if (explicit) {
    const dir = resolve(root, explicit);
    if (!isSnapshotDir(dir)) throw new Error(`GEEK_FORUM_CONTENT_DIR is not a snapshot directory (needs ${SNAPSHOT_FILES.join(', ')} and assets/): ${dir}`);
    return dir;
  }
  if (!existsSync(snapshotRoot)) return '';
  const candidates = readdirSync(snapshotRoot)
    .map(name => join(snapshotRoot, name))
    .filter(isSnapshotDir)
    .sort();
  return candidates.at(-1) ?? '';
}

function toolchain({ contentDir = '' } = {}) {
  const candidates = [process.env.FORUM_NODE, process.execPath, '/opt/homebrew/bin/node', '/usr/local/bin/node'].filter(Boolean);
  const node = candidates.find(candidate => {
    if (!existsSync(candidate)) return false;
    const result = spawnSync(candidate, ['-p', 'process.versions.node'], { encoding: 'utf8', timeout: 5000 });
    return result.status === 0 && Number(result.stdout.trim().split('.')[0]) >= 26;
  });
  if (!node) throw new Error('Tuff Forum requires Node >=26. Set FORUM_NODE to that runtime; the core project stays on Node 22.');
  const pnpm = process.env.FORUM_PNPM || join(root, '.tools/pnpm11/package/bin/pnpm.cjs');
  if (!existsSync(pnpm)) throw new Error('Install pnpm 11.24.0 for the forum or set FORUM_PNPM to its pnpm.cjs. See docs/ops/TUFF-FORUM.md.');
  const version = spawnSync(node, [pnpm, '--version'], { encoding: 'utf8', timeout: 10000, cwd: moduleRoot });
  if (version.status !== 0 || version.stdout.trim() !== '11.24.0') throw new Error('Forum package manager must match upstream pnpm 11.24.0.');
  const bin = join(stateDir, 'bin');
  mkdirSync(bin, { recursive: true });
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(join(bin, 'pnpm'), `#!/bin/sh\nexec ${quote(node)} ${quote(pnpm)} "$@"\n`, { mode: 0o700 });
  const env = { PATH: `${bin}:${dirname(node)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: process.env.HOME || root, TMPDIR: process.env.TMPDIR || tmpdir(), NUXT_TELEMETRY_DISABLED: '1' };
  env.FORUM_NODE = node;
  env.FORUM_PNPM = pnpm;
  for (const key of ['GEEK_DEPLOYMENT_ENVIRONMENT', 'GEEK_RELEASE_VERSION', 'GEEK_RELEASE_COMMIT', 'GEEK_FORUM_BASE_PATH']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  // The snapshot reaches nuxt only through the explicit `contentDir` chosen for
  // start/dev; every other command is pinned to the seed even if a stray .env
  // inside app/forum names a directory.
  if (contentDir) env.GEEK_FORUM_CONTENT_DIR = contentDir;
  else env.GEEK_FORUM_SOURCE = 'demo';
  // The upstream CDP suites default to http://localhost:3456, which on macOS
  // may resolve to ::1 and reach a different listener than our 127.0.0.1 one.
  env.TUFF_FORUM_URL = process.env.TUFF_FORUM_URL || origin;
  if (process.env.TUFF_FORUM_CHROME) env.TUFF_FORUM_CHROME = process.env.TUFF_FORUM_CHROME;
  else {
    const bundledChrome = join(root, '.tools/playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
    if (existsSync(bundledChrome)) env.TUFF_FORUM_CHROME = bundledChrome;
  }
  return { node, pnpm, env };
}

// One fresh TCP connection per request. `fetch` keeps connections alive, and a
// probe that reached a stale listener during startup would keep reusing it and
// never see the new instance.
function httpOnce(path, method = 'GET') {
  return new Promise(resolve => {
    const req = httpRequest(`${origin}${path}`, { method, agent: false, timeout: 1500, headers: { connection: 'close' } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body, type: String(response.headers['content-type'] ?? '') }));
    });
    req.once('timeout', () => { req.destroy(); resolve(null); });
    req.once('error', () => resolve(null));
    req.end();
  });
}

async function probe() {
  const response = await httpOnce('/__geek_forum');
  if (!response || response.status !== 200) return null;
  try { const json = JSON.parse(response.body); return json.module === 'tuff-forum' ? json : null; } catch { return null; }
}

function portListening() {
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', () => resolve(true));
    server.listen(3456, '127.0.0.1', () => server.close(() => resolve(false)));
  });
}

async function readState() {
  try { return JSON.parse(await readFile(stateFile, 'utf8')); } catch { return null; }
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function status() {
  const recorded = await readState();
  if (!recorded) return null;
  const actual = await probe();
  if (!actual) return null;
  return actual.instance === recorded.instance && recorded.project === root
    ? { ...recorded, mode: actual.mode, contentSource: actual.contentSource, snapshotConfigured: actual.snapshotConfigured }
    : null;
}

async function serve(instance) {
  if (!instance) throw new Error('Missing instance identity');
  const contentDir = process.env.GEEK_FORUM_CONTENT_DIR ?? '';
  const { node, pnpm, env } = toolchain({ contentDir });
  // The pnpm wrapper and nuxt get their own process group so the supervisor can
  // signal both without signalling itself.
  const child = spawn(node, [pnpm, 'exec', 'nuxt', 'dev', '--host', '127.0.0.1', '--port', '3456', '--no-fork'], {
    cwd: moduleRoot, stdio: 'inherit', detached: true, env: { ...env, GEEK_FORUM_INSTANCE: instance },
  });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', async code => {
    const current = await readState();
    if (current?.instance === instance) await rm(stateFile, { force: true });
    process.exitCode = closing ? 0 : (code ?? 1);
  });
  await writeFile(stateFile, JSON.stringify({
    project: root, module: 'tuff-forum', instance, pid: process.pid, origin,
    contentSource: contentDir ? 'local-snapshot' : 'upstream-seed', contentDir,
    started_at: new Date().toISOString(), log: join(stateDir, 'dev.log'),
  }, null, 2), { mode: 0o600 });
}

async function waitForInstance(instance, child) {
  for (let i = 0; i < 180; i++) {
    const ready = await status();
    if (ready?.instance === instance) return ready;
    if (child && child.exitCode !== null) throw new Error('Forum exited; inspect .tools/tuff-forum/dev.log.');
    await delay(500);
  }
  throw new Error('Forum startup not confirmed. Inspect log and status before retrying.');
}

async function reportSnapshot(ready) {
  if (ready.contentSource !== 'local-snapshot') return;
  const head = await httpOnce('/api/local-forum/state', 'HEAD');
  if (head?.status === 200) { console.error('Snapshot loaded: /api/local-forum/state answers 200.'); return; }
  const detail = await httpOnce('/api/local-forum/state');
  let code = detail ? `HTTP ${detail.status}` : 'no response';
  try { code = JSON.parse(detail.body).data?.error ?? code; } catch { /* keep status */ }
  console.error(`Snapshot NOT loaded (${code}); the page will show the error instead of demo content. See .tools/tuff-forum/dev.log.`);
}

async function main() {
  const command = process.argv[2] || 'status';
  if (['check', 'generate', 'build'].includes(command)) {
    const proof = spawnSync(process.execPath, [join(root, 'scripts/check-forum-adoption.mjs')], { cwd: root, stdio: 'inherit' });
    if (proof.status !== 0) throw new Error('Forum provenance check failed; review the upstream adaptation record.');
  }
  if (command === 'status') { console.log(JSON.stringify((await status()) || { status: 'stopped' })); return; }
  if (command === 'stop') {
    const running = await status();
    if (!running) { console.log('No matching Tuff Forum preview; no unrelated process was stopped.'); return; }
    // The supervisor forwards the signal to the nuxt process group it owns.
    process.kill(running.pid, 'SIGTERM');
    for (let i = 0; i < 50; i++) {
      if (!await status() && !pidAlive(running.pid)) { console.log('Tuff Forum preview stopped. Browser localStorage has not been cleared.'); return; }
      await delay(200);
    }
    throw new Error('Shutdown not confirmed; no force kill attempted.');
  }
  if (command === '_serve') return serve(process.argv[3]);
  if (command === 'start') {
    const running = await status();
    if (running) { console.log(JSON.stringify({ status: 'already_running', ...running })); return; }
    // A supervisor that is still booting has written its record but cannot
    // answer yet: wait for it instead of racing a second nuxt onto the port.
    const booting = await readState();
    if (booting?.project === root && pidAlive(booting.pid)) {
      console.error(`Waiting for the preview already booting (pid ${booting.pid}).`);
      const ready = await waitForInstance(booting.instance, null);
      await reportSnapshot(ready);
      console.log(JSON.stringify({ status: 'running', ...ready }));
      return;
    }
    // Do not spawn over a foreign listener; an unknown result is not a retry.
    if (await portListening()) throw new Error('127.0.0.1:3456 is already held by another process (a `forum:dev` session, an orphaned nuxt, or another project). This script never stops it; check `lsof -iTCP:3456` yourself.');
    const contentDir = snapshotDirectory();
    console.error(contentDir ? `Content source: local snapshot ${contentDir}` : 'Content source: upstream demo seed (no snapshot directory found)');
    const { node, env } = toolchain({ contentDir });
    const instance = randomUUID();
    const output = openSync(join(stateDir, 'dev.log'), 'a', 0o600);
    const child = spawn(node, [script, '_serve', instance], { cwd: root, env, detached: true, stdio: ['ignore', output, output] });
    closeSync(output); child.unref();
    let spawnError; child.once('error', error => { spawnError = error; });
    await delay(100);
    if (spawnError) throw spawnError;
    const ready = await waitForInstance(instance, child);
    await reportSnapshot(ready);
    console.log(JSON.stringify({ status: 'running', ...ready }));
    return;
  }
  if (!['install', 'check', 'build', 'generate', 'verify', 'test', 'dev'].includes(command)) throw new Error('Usage: node scripts/forum.mjs start|status|stop|install|check|build|generate|verify|test|dev');
  if (command === 'verify') {
    // verify-all.mjs reuses whatever answers on TUFF_FORUM_URL; the upstream
    // CDP suites assert seeded demo behaviour. Only our own demo-mode preview
    // may be reused; a snapshot preview or a foreign listener must not be.
    const listening = await probe();
    if (listening?.mode === 'local-snapshot') throw new Error('A local-snapshot preview is on 3456. Run `pnpm forum:stop` first; `forum:verify` then starts its own demo-seed server.');
    if (!listening && await httpOnce('/')) throw new Error('Something that is not this repository\'s preview answers on 127.0.0.1:3456; stop it before `forum:verify`.');
  }
  const { node, pnpm, env } = toolchain(command === 'dev' ? { contentDir: snapshotDirectory() } : {});
  if (command === 'dev') console.error(env.GEEK_FORUM_CONTENT_DIR ? `Content source: local snapshot ${env.GEEK_FORUM_CONTENT_DIR}` : 'Content source: upstream demo seed');
  const args = command === 'install' ? [pnpm, 'install', '--frozen-lockfile'] : [pnpm, command, ...process.argv.slice(3)];
  const child = spawn(node, args, { cwd: moduleRoot, env, stdio: 'inherit' });
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
