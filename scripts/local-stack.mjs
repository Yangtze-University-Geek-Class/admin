#!/usr/bin/env node
// 本机全栈：核心 API（3000）与官网（5173）、控制台（5186）、论坛（3456）一起起停，只绑回环地址。
// 只包装已有入口：核心用 scripts/local-preview.mjs，论坛用 scripts/forum.mjs，各自的 start / stop 核对自己的实例标识；
// 控制台是本脚本启动的 vite dev。停止只针对本脚本启动、记在 .tools/local/stack.json 里的进程；端口被别的进程占着就拒绝启动，
// 不按端口杀进程，也不强制结束。本机密钥首次生成到 .tools/local/secrets.json（0600，不入库），之后复用。
// 不连远端、不碰 Docker、不动共享浏览器配置；OAuth 凭据只从调用方环境变量透传，不给就是隔离模式。
// 用法：node scripts/local-stack.mjs up|down|status（根目录 pnpm local:up / local:down / local:status）
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), "..");
const stateDir = join(root, ".tools/local");
const stateFile = join(stateDir, "stack.json");
const secretsFile = join(stateDir, "secrets.json");
const stackLog = join(stateDir, "stack.log");
const consoleLog = join(stateDir, "console.log");
const consoleUrl = "http://127.0.0.1:5186/console";
const forumNeedle = /requires Node >=26|Install pnpm 11\.24\.0|must match upstream pnpm 11\.24\.0/;

/** 与 app/server/src/config.ts 的 createConfig 相同的规则：会话密钥至少 32 字符，加密密钥解码后 32 字节。 */
export function validKeyPair(session, encryption) {
  return typeof session === "string" && session.length >= 32
    && typeof encryption === "string" && Buffer.from(encryption, "base64").length === 32;
}

export function newKeyPair() {
  return { session: randomBytes(32).toString("hex"), encryption: randomBytes(32).toString("base64") };
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

function rel(file) {
  return relative(root, file);
}

function log(line) {
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(stackLog, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
}

function readState() {
  return readJson(stateFile) ?? {};
}

function writeState(state) {
  if (Object.keys(state).length === 0) return rmSync(stateFile, { force: true });
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
}

/** 本机会话与加密密钥：首次生成，之后复用；已有 local-preview 的 keys.json 时沿用它，免得 GitHub 登录模式里已加密的令牌解不开。 */
function localSecrets() {
  const saved = readJson(secretsFile);
  if (saved) {
    if (validKeyPair(saved.SESSION_SECRET, saved.ENCRYPTION_KEY)) return saved;
    throw new Error(`${rel(secretsFile)} 格式不对。确认里面的密钥没有还在用的数据后删除它，再 local:up 重新生成。`);
  }
  const inherited = readJson(join(root, ".tools/local-preview/keys.json"));
  const pair = validKeyPair(inherited?.session, inherited?.encryption) ? inherited : newKeyPair();
  const secrets = { SESSION_SECRET: pair.session, ENCRYPTION_KEY: pair.encryption };
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600, flag: "wx" });
  return secrets;
}

function requireNode22() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major !== 22) throw new Error(`本机启动按根 package.json 的 engines 使用 Node 22（当前 ${process.version}）。先把 Node 22 放到 PATH 前面再运行，例如 fnm use 22。`);
}

function tryRun(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return ""; }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

function startedAt(pid) {
  return tryRun("ps", ["-o", "lstart=", "-p", String(pid)]);
}

/** 控制台记录的 pid 还活着、且启动时间一致（防止 pid 被别的进程复用）才算本脚本的进程。 */
function ownedConsole(record) {
  return Boolean(record?.pid && record.lstart && alive(record.pid) && startedAt(record.pid) === record.lstart);
}

function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); } catch { /* 进程组已经没有了 */ }
}

function portFree(port) {
  return new Promise(done => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
  });
}

function portHolder(port) {
  const pid = tryRun("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).split("\n")[0];
  if (!pid) return "其它进程";
  return `进程 ${pid}（${tryRun("ps", ["-o", "command=", "-p", pid]).slice(0, 120)}）`;
}

async function httpStatus(url) {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10000) });
    response.body?.cancel().catch(() => {});
    return response.status;
  } catch { return 0; }
}

function runTool(file, args, env = process.env) {
  const result = spawnSync(process.execPath, [join(root, file), ...args], {
    cwd: root, env, encoding: "utf8", timeout: 240000, stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error?.message };
}

/** 工具的输出末尾是一行 JSON，前面可能有提示行。 */
function lastJson(text) {
  for (const line of text.split("\n").reverse()) {
    try { return JSON.parse(line); } catch { /* 不是 JSON 行 */ }
  }
  return null;
}

function lastLine(text) {
  return text.trim().split("\n").filter(Boolean).pop() ?? "";
}

async function startCore(state, secrets) {
  const current = lastJson(runTool("scripts/local-preview.mjs", ["status"]).stdout);
  if (!current?.instance) {
    for (const port of [3000, 5173]) {
      if (!(await portFree(port))) throw new Error(`端口 ${port} 已被${portHolder(port)}占用；本脚本不停止它，请自行处理后再 local:up。`);
    }
  }
  const run = runTool("scripts/local-preview.mjs", ["start"], { ...process.env, LOCAL_PREVIEW_SESSION_SECRET: secrets.SESSION_SECRET, LOCAL_PREVIEW_ENCRYPTION_KEY: secrets.ENCRYPTION_KEY });
  const info = lastJson(run.stdout);
  if (run.code !== 0 || !info?.instance) throw new Error(lastLine(run.stderr) || `核心没有确认启动，见 ${rel(join(root, ".tools/local-preview/preview.log"))}`);
  if (info.status === "running") state.core = { instance: info.instance, pid: info.pid };
  else if (state.core?.instance !== info.instance) delete state.core;
}

async function startConsole() {
  if (!(await portFree(5186))) throw new Error(`端口 5186 已被${portHolder(5186)}占用；本脚本不停止它。`);
  const output = openSync(consoleLog, "a", 0o600);
  const child = spawn("pnpm", ["--filter", "@yzgc/console", "dev"], { cwd: root, detached: true, stdio: ["ignore", output, output] });
  closeSync(output);
  child.unref();
  let spawnError;
  child.once("error", error => { spawnError = error; });
  await delay(200);
  if (spawnError) throw spawnError;
  const record = { pid: child.pid, lstart: startedAt(child.pid), started_at: new Date().toISOString() };
  for (let attempt = 0; attempt < 120; attempt++) {
    await delay(500);
    if (child.exitCode !== null) break;
    if (await httpStatus(consoleUrl) === 200) return record;
  }
  // 启动没有确认：停掉自己起的进程组，不留孤儿
  signalGroup(child.pid, "SIGTERM");
  throw new Error(`控制台没有应答，见 ${rel(consoleLog)}`);
}

function startForum(state) {
  if (!existsSync(join(root, "app/forum/node_modules"))) {
    return `论坛依赖未安装，跳过。先运行 pnpm forum:install（需要 Node ≥26 与 pnpm 11.24.0，见 docs/ops/TUFF-FORUM.md）`;
  }
  const run = runTool("scripts/forum.mjs", ["start"]);
  const info = lastJson(run.stdout);
  if (run.code !== 0 || !info) {
    if (forumNeedle.test(run.stderr)) return "论坛工具链未就绪，跳过。需要 Node ≥26 与 pnpm 11.24.0（设置 FORUM_NODE、FORUM_PNPM，见 docs/ops/TUFF-FORUM.md）";
    throw new Error(lastLine(run.stderr) || `论坛没有确认启动，见 ${rel(join(root, ".tools/tuff-forum/dev.log"))}`);
  }
  if (info.status === "running") state.forum = { instance: info.instance, pid: info.pid };
  else if (state.forum?.instance !== info.instance) delete state.forum;
  return "";
}

async function printStatus(state) {
  const core = lastJson(runTool("scripts/local-preview.mjs", ["status"]).stdout);
  const forum = lastJson(runTool("scripts/forum.mjs", ["status"]).stdout);
  const coreOwned = Boolean(core?.instance && state.core?.instance === core.instance);
  const forumOwned = Boolean(forum?.instance && state.forum?.instance === forum.instance);
  const rows = [
    { name: "核心 API", url: "http://127.0.0.1:3000/healthz", owned: coreOwned },
    { name: "官网", url: "http://127.0.0.1:5173/sites/portal/", owned: coreOwned },
    { name: "控制台", url: consoleUrl, owned: ownedConsole(state.console) },
    { name: "论坛", url: "http://127.0.0.1:3456/", owned: forumOwned },
  ];
  for (const row of rows) {
    row.http = await httpStatus(row.url);
    const owner = row.owned ? "本脚本启动" : row.http ? "已有进程应答（不是本脚本启动的）" : "未运行";
    console.log(`${row.name}  ${row.url}  HTTP ${row.http || "无应答"}  ${owner}`);
  }
  console.log(`日志：${rel(join(root, ".tools/local-preview/preview.log"))}（核心与官网）、${rel(consoleLog)}（控制台）、${rel(join(root, ".tools/tuff-forum/dev.log"))}（论坛）、${rel(stackLog)}（本脚本）`);
}

async function up() {
  requireNode22();
  const state = readState();
  const build = spawnSync("pnpm", ["--filter", "@yzgc/server", "build"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) throw new Error("服务端构建失败，核心未启动（构建输出见上）。");
  const secrets = localSecrets();
  const steps = [
    ["核心与官网", () => startCore(state, secrets)],
    ["控制台", async () => { if (!ownedConsole(state.console)) state.console = await startConsole(); }],
    ["论坛", () => startForum(state)],
  ];
  let failed = 0;
  for (const [name, run] of steps) {
    try {
      const skipped = await run();
      if (skipped) { console.log(`${name}：${skipped}`); log(`${name} 跳过：${skipped}`); }
      else log(`${name} 已启动`);
    } catch (error) {
      failed += 1;
      console.error(`${name} 启动失败：${error.message}`);
      log(`${name} 启动失败：${error.message}`);
    }
  }
  writeState(state);
  await printStatus(state);
  process.exitCode = failed ? 1 : 0;
}

async function down() {
  const state = readState();
  if (Object.keys(state).length === 0) {
    console.log("没有本脚本启动的服务，未停止任何进程。");
    return;
  }
  let unconfirmed = 0;
  if (state.console) {
    if (ownedConsole(state.console)) {
      signalGroup(state.console.pid, "SIGTERM");
      let stopped = false;
      for (let attempt = 0; attempt < 100 && !stopped; attempt++) {
        await delay(100);
        stopped = !alive(state.console.pid);
      }
      if (stopped) delete state.console;
      else { unconfirmed += 1; console.error("控制台没有确认停止，未强制结束。"); }
    } else delete state.console;
  }
  for (const [key, file, label] of [["forum", "scripts/forum.mjs", "论坛"], ["core", "scripts/local-preview.mjs", "核心与官网"]]) {
    if (!state[key]) continue;
    const run = runTool(file, ["stop"]);
    if (run.code === 0) {
      delete state[key];
      console.log(`${label}：${lastLine(run.stdout)}`);
    } else {
      unconfirmed += 1;
      console.error(`${label}：${lastLine(run.stderr) || "停止没有确认"}`);
    }
  }
  writeState(state);
  log(unconfirmed ? "down：有服务没有确认停止" : "down 完成");
  process.exitCode = unconfirmed ? 1 : 0;
}

async function main() {
  const command = process.argv[2];
  if (command === "up") return up();
  if (command === "down") return down();
  if (command === "status") return printStatus(readState());
  throw new Error("Usage: node scripts/local-stack.mjs up|down|status");
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(script)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
