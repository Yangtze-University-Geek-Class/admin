#!/usr/bin/env node
// Local integration preview only. Never import index.ts or load an existing .env.
// GitHub 登录：启动时环境里有 OAUTH_CLIENT_ID 与 OAUTH_CLIENT_SECRET（由调用方从钥匙串 / 本机凭据取，不进仓库、不打印），
// 就走真实 GitHub 登录，数据库与会话密钥落在 .tools/local-preview/（不入库），重启不丢登录；没有就保持原来的隔离模式。
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, openSync, closeSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), "..");
const stateDir = join(root, ".tools/local-preview");
const stateFile = join(stateDir, "runtime.json");
const logFile = join(stateDir, "preview.log");
const markerUrl = "http://127.0.0.1:3000/__local_preview";
const webOrigin = "http://127.0.0.1:5173";

async function current() {
  try {
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    const response = await fetch(markerUrl, { signal: AbortSignal.timeout(1000) });
    const actual = await response.json();
    return actual.instance === state.instance && actual.pid === state.pid && actual.project === root ? state : null;
  } catch { return null; }
}

function runtime() {
  if (Number(process.versions.node.split(".")[0]) === 22) return process.execPath;
  // Reuse the already provisioned project runtime; never change global Node.
  const local = join(root, ".tools/node-v22.23.2-darwin-arm64/bin/node");
  if (existsSync(local)) return local;
  throw new Error("Select the project's Node 22 runtime before starting preview.");
}

async function start() {
  const existing = await current();
  if (existing) { console.log(JSON.stringify({ status: "already_running", ...existing })); return; }
  if (!existsSync(join(root, "app/server/dist/app.js"))) throw new Error("Build the project first with pnpm build.");
  await mkdir(stateDir, { recursive: true });
  const instance = randomUUID();
  const executable = runtime();
  const output = openSync(logFile, "a", 0o600);
  const child = spawn(executable, [script, "serve", instance], {
    cwd: root, detached: true, stdio: ["ignore", output, output],
    env: {
      PATH: `${dirname(executable)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: process.env.HOME ?? root, TMPDIR: process.env.TMPDIR ?? tmpdir(), NODE_ENV: "development",
      // 只透传 GitHub 登录需要的两项；其余环境变量一概不带进预览进程
      ...(process.env.OAUTH_CLIENT_ID && process.env.OAUTH_CLIENT_SECRET && { OAUTH_CLIENT_ID: process.env.OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET: process.env.OAUTH_CLIENT_SECRET }),
    },
  });
  closeSync(output);
  let spawnError;
  child.once("error", error => { spawnError = error; });
  child.unref();
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnError) throw spawnError;
    const ready = await current();
    if (ready?.instance === instance) { console.log(JSON.stringify({ status: "running", ...ready })); return; }
    if (child.exitCode !== null) throw new Error(`Preview exited; inspect ${logFile}`);
    await delay(250);
  }
  throw new Error(`Startup not confirmed. Inspect ${logFile}; do not assume the process stopped.`);
}

async function serve(instance) {
  if (!instance) throw new Error("Missing preview instance identifier");
  const scratch = await mkdtemp(join(tmpdir(), "geek-main-local-"));
  let app;
  let vite;
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    if (vite) await vite.close();
    if (app) await app.close();
    await rm(scratch, { recursive: true, force: true });
    try {
      const state = JSON.parse(await readFile(stateFile, "utf8"));
      if (state.instance === instance) await rm(stateFile, { force: true });
    } catch { /* No state was published by this instance. */ }
  };
  try {
    const { createConfig } = await import(pathToFileURL(join(root, "app/server/dist/config.js")).href);
    const { buildApp } = await import(pathToFileURL(join(root, "app/server/dist/app.js")).href);
    const github = Boolean(process.env.OAUTH_CLIENT_ID && process.env.OAUTH_CLIENT_SECRET);
    const keys = github ? await localKeys() : { session: randomBytes(32).toString("hex"), encryption: randomBytes(32).toString("base64") };
    const config = createConfig({
      NODE_ENV: "development", PUBLIC_ORIGIN: webOrigin, PORT: "3000", POW_DIFFICULTY: "0",
      DB_PATH: github ? join(stateDir, "core.db") : ":memory:",
      FORUM_DB_PATH: github ? join(stateDir, "forum.db") : ":memory:",
      FORUM_UPLOAD_DIR: scratch,
      SESSION_SECRET: keys.session, ENCRYPTION_KEY: keys.encryption,
      OAUTH_CLIENT_ID: github ? process.env.OAUTH_CLIENT_ID : "local-preview-disabled",
      OAUTH_CLIENT_SECRET: github ? process.env.OAUTH_CLIENT_SECRET : "local-preview-disabled",
    });
    const unavailable = () => { throw Object.assign(new Error("External integrations are disabled in local preview"), { statusCode: 503, code: "local_preview_external_disabled" }); };
    app = await buildApp({ config, staticRoot: false, ...(!github && { overrides: { httpRequest: unavailable, octokitFactory: unavailable } }) });
    if (!github) {
      app.addHook("onRequest", async (req, reply) => {
        const path = req.url.split("?")[0];
        if (["/auth/github", "/auth/callback"].includes(path)) return reply.code(503).send({ error: "local_preview_external_disabled", message: "本地预览没有配置 GitHub 登录：启动时在环境里提供 OAUTH_CLIENT_ID 与 OAUTH_CLIENT_SECRET。" });
      });
    }
    app.get("/__local_preview", async () => ({ instance, pid: process.pid, project: root, database: github ? "file" : "memory", external_integrations: github }));
    await app.listen({ host: "127.0.0.1", port: 3000 });

    const requireWeb = createRequire(join(root, "app/web/package.json"));
    const { createServer } = await import(pathToFileURL(requireWeb.resolve("vite")).href);
    vite = await createServer({
      root: join(root, "app/web"), configFile: join(root, "app/web/vite.config.ts"), envFile: false, envDir: scratch,
      plugins: [{ name: "local-preview-root", configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // 接了 GitHub 登录就用真实数据（本机后端），否则用样板数据
          if (req.url === "/") { res.statusCode = 302; res.setHeader("Location", `/sites/portal/?__data=${github ? "live" : "mock"}`); res.end(); return; }
          next();
        });
      } }],
      server: { host: "127.0.0.1", port: 5173, strictPort: true, open: false,
        proxy: { "/__local_preview": "http://127.0.0.1:3000" },
        fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.tools/**", "**/data/**", "**/docs/**", "**/app/server/**"] },
      },
    });
    await vite.listen();
    await writeFile(stateFile, JSON.stringify({ instance, pid: process.pid, project: root, web: webOrigin, api: "http://127.0.0.1:3000", database: github ? "file" : "memory", github_login: github, started_at: new Date().toISOString(), log: logFile }, null, 2), { mode: 0o600 });
    const shutdown = () => { close().catch(error => { console.error(error); process.exitCode = 1; }); };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    console.log(`Core preview ready: ${webOrigin} (GitHub login ${github ? "on, data in .tools/local-preview" : "off, in-memory data"}; forum at http://127.0.0.1:3456)`);
  } catch (error) { await close(); throw error; }
}

/** 本机预览自己的会话与加密密钥：首次随机生成，存在不入库的 .tools/local-preview/keys.json（0600），重启后旧会话仍能解密。 */
async function localKeys() {
  const file = join(stateDir, "keys.json");
  try {
    const saved = JSON.parse(await readFile(file, "utf8"));
    if (saved.session && saved.encryption) return saved;
  } catch { /* 第一次启动 */ }
  const keys = { session: randomBytes(32).toString("hex"), encryption: randomBytes(32).toString("base64") };
  await mkdir(stateDir, { recursive: true });
  await writeFile(file, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}

async function main() {
  const command = process.argv[2] ?? "start";
  if (command === "start") return start();
  if (command === "serve") return serve(process.argv[3]);
  if (command === "status") { console.log(JSON.stringify({ status: "stopped", ...((await current()) && { status: "running", ...await current() }) })); return; }
  if (command === "stop") {
    const state = await current();
    if (!state) { console.log("No matching local preview; no process was stopped."); return; }
    process.kill(state.pid, "SIGTERM");
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!await current()) { console.log("Local preview stopped; isolated in-memory data cleared."); return; }
      await delay(100);
    }
    throw new Error("Shutdown not confirmed; no force kill was attempted.");
  }
  throw new Error("Usage: node scripts/local-preview.mjs start|status|stop");
}
if (process.argv[1] && resolve(process.argv[1]) === script) main().catch(error => { console.error(error.message); process.exitCode = 1; });
