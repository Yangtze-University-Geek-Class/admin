#!/usr/bin/env node
// 比赛官网站点包（#278，CONTRACT-278 §1）的本地打包、校验与带示例数据的预览。规则只在
// app/server/src/lib/site-package.ts，服务端上传接口用的是同一份，所以本地通过的包，上传时也会通过。
//
//   node scripts/contest-site.mjs pack <构建产物目录> [--out <文件.zip>] [--competition <比赛 id>]
//        把目录里的文件按路径排序打成 zip（UTF-8 文件名、固定时间戳，同样的输入得到同样的 zip），
//        打完立刻跑一遍校验；不通过时逐条列出原因、不写文件、退出码 1。默认写到 <目录>.zip。
//   node scripts/contest-site.mjs check <文件.zip> [--competition <比赛 id>]
//        只校验。--competition 给了时，yzgc-site.json 里的 competition_id 必须等于它。
//   node scripts/contest-site.mjs dev <构建产物目录> [--port 5196] [--competition <比赛 id>]
//                                     [--variant individual|team] [--prizes|--no-prizes] [--api <https 源>]
//        本地起一个不依赖后端和数据库的预览服务：静态文件原样服务，`/api/public/competitions/*` 和
//        `/sdk/competition/v1.js` 用带真实感的示例数据应答（人员、队伍、奖励、天梯、动态、统计一次给齐），
//        开发者 `pnpm --filter web build:contest` 之后直接 `dev dist/site` 就能看到最终效果，不用先建比赛、
//        报名、发分。`--variant team` 给团队赛的示例（含一支还在招募的队），默认 `individual`；
//        `--prizes` 给示例奖项，默认不给（和真实比赛一样，奖项可选）。
//        `--api <源>`（例如 `--api https://prev.yangtzeu.work`）给了之后，这几个公开接口改成原样转发到
//        那个源上的真实比赛数据，不再用示例数据应答；只转发 GET，只转发这几条公开只读路径，不转发浏览器带来的
//        cookie / 鉴权头，上游的 set-cookie 也不会带回来。只接受 https:// 源，或本机的
//        http://127.0.0.1 / http://localhost。见 docs/services/server/contest-site-quickstart.md「本地对接线上数据」。
//
// 目录里的符号链接、以 . 开头的文件都算不通过，不会被悄悄跳过。需要 Node 22.18 以上（直接加载 .ts）。
import { createServer } from "node:http";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkSitePackage, siteContentType, sitePathProblem, writeZip } from "../app/server/src/lib/site-package.ts";
import { DEFAULT_GRADE_FACTORS, GRADE_KEYS, GRADE_KEY_LABELS, scoringView } from "../app/server/src/lib/competition-rubric.ts";

const USAGE = "用法：node scripts/contest-site.mjs pack <目录> [--out <文件.zip>] [--competition <比赛 id>]\n"
  + "      node scripts/contest-site.mjs check <文件.zip> [--competition <比赛 id>]\n"
  + "      node scripts/contest-site.mjs dev <目录> [--port 5196] [--competition <比赛 id>] [--variant individual|team] [--prizes|--no-prizes] [--api <https 源>]";

/**
 * `--api` 只接受 https:// 源，或本机的 http://127.0.0.1 / http://localhost（含端口）；别的一律拒绝，
 * 不把这个本地预览进程变成任意地址的开放代理。
 */
export function isAllowedApiOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.pathname !== "/" && url.pathname !== "" || url.search || url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

/** 收集目录下的全部文件；符号链接不跟进去，记成一条问题（和服务端的校验同一句话）。 */
export function collectFiles(root) {
  const files = [];
  const problems = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) problems.push(`${rel}：不能是符号链接`);
      else if (stat.isDirectory()) walk(path, rel);
      else if (stat.isFile()) files.push({ path: rel, data: readFileSync(path) });
      else problems.push(`${rel}：不是普通文件`);
    }
  };
  walk(root, "");
  return { files, problems };
}

/** 打包并校验；返回 { zip, check }。有符号链接时不打包，check 里只有这些问题。 */
export function packDirectory(root, competitionId = null) {
  const { files, problems } = collectFiles(root);
  if (problems.length) return { zip: null, check: { ok: false, report: problems, sha256: "", size: 0, files: [], manifest: null, totalBytes: 0 } };
  const zip = writeZip(files);
  return { zip, check: checkSitePackage(zip, competitionId) };
}

const DEV_SAMPLE_COMPETITION_ID = "oss-challenge-2026-1";
/** 五个示例参赛者：部门名照抄真实的部门种子（见 lib/migrations/2026-10-yugc-v2.ts），其中一人没有部门——
 * 「没分配部门」在真实数据里也合法，示例要带出这种情况，不能全员都有部门。 */
const DEV_SAMPLE_PEOPLE = [
  { username: "linxiaoman", display_name: "林小满", avatar_url: null, department: { id: "dept.algo", name: "算法部门", tone: "u" }, score: 320 },
  { username: "zhouzhixing", display_name: "周知行", avatar_url: null, department: { id: "dept.security", name: "网安部门", tone: "g" }, score: 210 },
  { username: "suqing", display_name: "苏晴", avatar_url: null, department: null, score: 140 },
  { username: "luyan", display_name: "陆言", avatar_url: null, department: { id: "dept.ai", name: "AI部门", tone: "y" }, score: 90 },
  { username: "hezhou", display_name: "何舟", avatar_url: null, department: { id: "dept.hardware", name: "硬件部门", tone: "c" }, score: 20 },
];
const DEV_SAMPLE_PRIZES = [
  { from: 1, to: 1, amount_cny: 700, title: "一等奖" },
  { from: 2, to: 3, amount_cny: 200, title: "二等奖" },
];

function publicPerson(person) {
  return { username: person.username, display_name: person.display_name, avatar_url: person.avatar_url };
}

/**
 * 示例数据：`variant` 决定人员要不要分进队伍，`withPrizes` 决定奖励是不是空数组——这两样都是真实比赛里
 * 「有或没有」的正常状态，示例要能分别演示，不是只有一种长相。字段形状和公开接口、SDK 类型逐一对应。
 */
function devSampleSnapshot(competitionId, variant, withPrizes) {
  const now = Date.now();
  const teamMin = 1;
  const teamMax = variant === "team" ? 3 : 1;
  const teamOf = variant === "team" ? new Map([["linxiaoman", "夜猫子小队"], ["zhouzhixing", "夜猫子小队"], ["suqing", "破壁人"]]) : null;
  const individuals = DEV_SAMPLE_PEOPLE.map((person, index) => ({
    rank: index + 1, ...publicPerson(person), team_name: teamOf?.get(person.username) ?? null, score: person.score,
  }));
  const teamsList = variant === "team" ? [
    { rank: 1, name: "夜猫子小队", members: ["linxiaoman", "zhouzhixing"].map(login => publicPerson(DEV_SAMPLE_PEOPLE.find(p => p.username === login))), score: 530 },
    { rank: 2, name: "破壁人", members: ["suqing"].map(login => publicPerson(DEV_SAMPLE_PEOPLE.find(p => p.username === login))), score: 140 },
  ] : [];
  const feedItems = [
    { id: "sample-1", at: now - 3_600_000, ...publicPerson(DEV_SAMPLE_PEOPLE[0]), kind: "pr", title: "修复站点包的符号链接校验", url: "https://example.test/gitlab/geek/admin/-/merge_requests/1", points: 45, importance: "important", core: "business" },
    { id: "sample-2", at: now - 7_200_000, ...publicPerson(DEV_SAMPLE_PEOPLE[1]), kind: "issue", title: "官网倒计时在零点前后跳了一秒", url: "https://example.test/gitlab/geek/admin/-/issues/1", points: 8, importance: "normal", core: "business" },
    { id: "sample-3", at: now - 10_800_000, ...publicPerson(DEV_SAMPLE_PEOPLE[3]), kind: "penalty", title: null, url: null, points: -50, importance: null, core: null },
  ];
  const participants = { items: DEV_SAMPLE_PEOPLE.map(person => ({ ...publicPerson(person), department: person.department })), next_cursor: null };
  const teams = {
    enabled: variant === "team", team_min: teamMin, team_max: teamMax,
    teams: variant === "team" ? [
      { name: "夜猫子小队", slogan: "肝到天亮", status: "locked", member_count: 2, members: teamsList[0].members },
      { name: "破壁人", slogan: "还差两个人", status: "recruiting", member_count: 1, members: teamsList[1].members },
    ] : [],
  };
  const competition = {
    id: competitionId, name: "示例赛·开发预览", kind: "internal",
    start_at: now - 3 * 86_400_000, end_at: now + 27 * 86_400_000, signup_deadline: now + 5 * 86_400_000,
    url: null, description: "这是 contest-site.mjs dev 生成的示例数据，不连真实后端。",
    status: "ongoing", planning: false,
    signup: { enabled: true, participation: variant, team_min: teamMin, team_max: teamMax, scoring: "contribution" },
    site_url: `/c/sample/`, app_url: `/?open=competitions&competition=${encodeURIComponent(competitionId)}`,
    prizes: withPrizes ? DEV_SAMPLE_PRIZES : [],
    grade_factors: GRADE_KEYS.map(key => ({ grade: key, label: GRADE_KEY_LABELS[key], factor: DEFAULT_GRADE_FACTORS[key] / 100 })),
    scoring: scoringView(),
    finalized_at: null,
  };
  const leaderboard = { updated_at: now, individuals, teams: teamsList };
  const stats = {
    participants: DEV_SAMPLE_PEOPLE.length, teams: teamsList.length,
    merged_prs: feedItems.filter(item => item.kind === "pr").length, accepted_issues: feedItems.filter(item => item.kind === "issue").length,
    total_points: individuals.reduce((sum, row) => sum + row.score, 0), updated_at: now,
  };
  const feed = { items: feedItems, next_cursor: null };
  return { competition, leaderboard, feed, stats, participants, teams };
}

const DEV_API_PARTS = new Set(["", "leaderboard", "feed", "stats", "snapshot", "participants", "teams"]);

/**
 * `/api/public/competitions/:id[/leaderboard|feed|stats|snapshot|participants|teams]` 的路径形状，和
 * app/web/shared/competition-sdk 实际会调的那几条一一对应。认不出的路径给 null；示例数据应答和 `--api`
 * 转发都按这同一份白名单放行，不是各自写一套判断。
 */
export function publicCompetitionApiPart(pathname) {
  const match = /^\/api\/public\/competitions\/[^/]+(?:\/([a-z]*))?$/.exec(pathname);
  if (!match) return null;
  const part = match[1] ?? "";
  return DEV_API_PARTS.has(part) ? part : null;
}

/** 任何 :id 都应答同一份示例数据，方便站点在本机用任意比赛 id 预览。 */
function devApiResponse(pathname, snapshot) {
  const part = publicCompetitionApiPart(pathname);
  if (part === null) return null;
  if (part === "") return snapshot.competition;
  if (part === "snapshot") return { competition: snapshot.competition, leaderboard: snapshot.leaderboard, feed: snapshot.feed, stats: snapshot.stats };
  return snapshot[part];
}

/** 转发给真实后端时不带回的响应头：这些公开接口本来就不该读写会话，上游真的带了也不转给站点；编码、长度类的头按实际响应体重写。 */
const STRIP_PROXY_RESPONSE_HEADERS = new Set([
  "set-cookie",
  // fetch 已经把响应体解压成明文：原来的编码与长度头不再描述现在的响应体，透传会让浏览器按 gzip 再解一次而失败（#288）。
  "content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive",
]);

/**
 * 原样转发到真实源：不带浏览器传来的任何请求头（自然也就不转发 cookie / 鉴权头），只发一个干净的 GET；
 * 上游的 set-cookie 也会被摘掉。连不上、超时都当成网关失败，不装成示例数据的形状回退。
 */
async function proxyPublicCompetition(apiOrigin, pathname, search) {
  const response = await fetch(`${apiOrigin}${pathname}${search}`, { method: "GET", redirect: "follow" });
  const headers = { "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8" };
  const acao = response.headers.get("access-control-allow-origin");
  if (acao) headers["access-control-allow-origin"] = acao;
  for (const [key, value] of response.headers) {
    if (STRIP_PROXY_RESPONSE_HEADERS.has(key.toLowerCase()) || key.toLowerCase() in headers) continue;
    headers[key] = value;
  }
  const body = Buffer.from(await response.arrayBuffer());
  headers["content-length"] = String(body.length);
  return { status: response.status, headers, body };
}

/** 把目录里的一个相对路径安全地读出来；越界、不存在、扩展名不在站点包白名单里都算读不到（和生产的 readSiteFile 同一套判断）。 */
function readDevFile(root, rawPath) {
  const path = rawPath === "" || rawPath.endsWith("/") ? `${rawPath}index.html` : rawPath;
  if (sitePathProblem(path)) return null;
  const full = resolve(root, path);
  if (!full.startsWith(`${root}/`) && full !== root) return null;
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  return { data: readFileSync(full), contentType: siteContentType(path) };
}

function startDevServer(root, { port, competitionId, variant, withPrizes, api }) {
  const sdkPath = fileURLToPath(new URL("../app/web/shared/competition-sdk/index.ts", import.meta.url));
  // 转发模式下不需要示例数据；按需造一份就行，不用在转发时也算一遍。
  const snapshot = api ? null : devSampleSnapshot(competitionId, variant, withPrizes);
  const server = createServer((req, res) => {
    try {
      const pathname = decodeURI((req.url ?? "/").split("?")[0]);
      if (pathname === "/sdk/competition/v1.js") {
        const stripped = stripTypeScriptTypes(readFileSync(sdkPath, "utf8"), { mode: "strip" });
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "access-control-allow-origin": "*" });
        res.end(stripped);
        return;
      }
      if (pathname.startsWith("/api/public/competitions/")) {
        if (api) {
          if (req.method !== "GET" && req.method !== "HEAD") {
            res.writeHead(405, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "method_not_allowed", message: "转发到真实源只认 GET" }));
            return;
          }
          if (publicCompetitionApiPart(pathname) === null) {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "not_found", message: "转发只认比赛公开接口的几个固定路径" }));
            return;
          }
          const search = req.url && req.url.includes("?") ? `?${req.url.split("?")[1]}` : "";
          proxyPublicCompetition(api, pathname, search).then(result => {
            res.writeHead(result.status, result.headers);
            res.end(result.body);
          }).catch(error => {
            res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "upstream_unreachable", message: error instanceof Error ? error.message : String(error) }));
          });
          return;
        }
        const body = devApiResponse(pathname, snapshot);
        if (body === null) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "not_found", message: "示例服务只认比赛公开接口的几个固定路径" })); return; }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
        res.end(JSON.stringify(body));
        return;
      }
      const hit = readDevFile(root, pathname.replace(/^\/+/, ""));
      if (!hit) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("没有这个页面"); return; }
      res.writeHead(200, { "content-type": hit.contentType });
      res.end(hit.data);
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(error instanceof Error ? error.message : String(error));
    }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`预览已启动：http://127.0.0.1:${port}/`);
    if (api) console.log(`公开接口转发到 ${api}（只转发 GET，不转发 cookie / 鉴权头，比赛 id 以站点自己调用的为准）`);
    else console.log(`示例数据：比赛 id ${competitionId}，${variant === "team" ? "团队赛（含一支还在招募的队）" : "个人赛"}，${withPrizes ? "带示例奖励" : "没有奖励（和真实比赛一样，奖项可选）"}`);
    console.log(api ? "Ctrl+C 退出；这个服务不连数据库，公开接口转发到真实源，别的静态文件仍是本地的。" : "Ctrl+C 退出；这个服务不连后端和数据库，只用来看站点包最终效果。");
  });
  return server;
}

function parse(argv) {
  const [command, target, ...rest] = argv;
  const options = { out: null, competition: null, port: 5196, variant: "individual", withPrizes: false, api: null };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--out") options.out = rest[++i] ?? null;
    else if (rest[i] === "--competition") options.competition = rest[++i] ?? null;
    else if (rest[i] === "--port") options.port = Number(rest[++i]);
    else if (rest[i] === "--variant") options.variant = rest[++i] ?? null;
    else if (rest[i] === "--prizes") options.withPrizes = true;
    else if (rest[i] === "--no-prizes") options.withPrizes = false;
    else if (rest[i] === "--api") options.api = rest[++i] ?? null;
    else throw new Error(`不认识的参数：${rest[i]}\n${USAGE}`);
  }
  if (!["pack", "check", "dev"].includes(command) || !target) throw new Error(USAGE);
  if (command === "dev" && !["individual", "team"].includes(options.variant)) throw new Error(`--variant 只能是 individual 或 team\n${USAGE}`);
  if (command === "dev" && (!Number.isInteger(options.port) || options.port <= 0)) throw new Error(`--port 要是正整数\n${USAGE}`);
  if (command === "dev" && options.api !== null) {
    if (!isAllowedApiOrigin(options.api)) throw new Error(`--api 只接受 https:// 源，或本机的 http://127.0.0.1 / http://localhost（不带路径）\n${USAGE}`);
    options.api = options.api.replace(/\/+$/, "");
  }
  return { command, target, ...options };
}

function report(check) {
  if (check.ok) {
    console.log(`通过：${check.files.length} 个文件，解压后 ${check.totalBytes} 字节，zip ${check.size} 字节`);
    console.log(`sha256 ${check.sha256}`);
    if (check.manifest) console.log(`yzgc-site.json：${check.manifest.name} ${check.manifest.version}（sdk ${check.manifest.sdk}${check.manifest.competition_id ? `，比赛 ${check.manifest.competition_id}` : ""}）`);
  } else {
    console.error(`没通过，共 ${check.report.length} 条：`);
    for (const line of check.report) console.error(`  - ${line}`);
  }
}

export function main(argv = process.argv.slice(2)) {
  const { command, target, out, competition, port, variant, withPrizes, api } = parse(argv);
  const path = resolve(target);
  if (command === "pack") {
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`${target} 不是目录`);
    const { zip, check } = packDirectory(path, competition);
    report(check);
    if (!check.ok) return 1;
    const file = resolve(out ?? `${path.replace(/\/+$/, "")}.zip`);
    writeFileSync(file, zip);
    console.log(`已写入 ${file}`);
    return 0;
  }
  if (command === "dev") {
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`${target} 不是目录`);
    // 去掉结尾的 /，readDevFile 用 `${root}/` 判断越界
    startDevServer(path.replace(/\/+$/, ""), { port, competitionId: competition ?? DEV_SAMPLE_COMPETITION_ID, variant, withPrizes, api });
    return undefined; // 服务器在跑，进程不退出；main() 不替它决定退出码
  }
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${target} 不是文件`);
  const check = checkSitePackage(readFileSync(path), competition);
  report(check);
  return check.ok ? 0 : 1;
}

// 取 realpath：经符号链接的路径运行时 argv 与 import.meta.url 不同
if (process.argv[1] && pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
