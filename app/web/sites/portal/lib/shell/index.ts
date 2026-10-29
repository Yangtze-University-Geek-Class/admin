// 桌面终端的模拟 shell（#279）：createShell 造一台小 Linux，run 跑一行命令，complete 做 Tab 补全。
// 文件系统见 vfs.ts，切词见 parse.ts，命令见 commands.ts；这里负责展开变量和通配符、管道、重定向、&& || ;、脚本和存盘。
// 家目录使用极客班用户名；本机存盘按稳定账号与身份等级隔离，游客单独存盘，不认领旧用户名存盘。
// 桌面上的应用是 ~/Desktop 里的 .app 脚本，也装在 /usr/local/bin 里当命令用；运行它、敲应用名或 open <应用> 都会在桌面上打开那个窗口。
import type { Account } from "../account";
import type { CodeProject } from "../codeRepos";
import type { AppId, OsApp } from "../osApps";
import { COMMANDS, EXTERNAL, LEARN_TEXT, type Io, type ShellApi } from "./commands";
import { ParseError, lastWord, parse, type Chain, type Command, type Word } from "./parse";
import { FsError, Vfs, dir, file, hasGlob, type DirNode, type FsNode } from "./vfs";

export { LEARN_URL } from "./commands";

export type TermLine = { kind: "echo" | "out" | "err"; text: string; prompt?: string };
export type RunResult = { lines: TermLine[]; open: AppId[]; clear: boolean; exit: boolean };
export type Completion = { line: string; options: string[] };

type Store = Pick<Storage, "getItem" | "setItem">;

export type ShellOptions = {
  account: Account | null;
  apps: readonly OsApp[];
  repos?: readonly CodeProject[];
  storage?: Store | null;
};

export type Shell = {
  readonly user: string;
  readonly home: string;
  run(line: string): RunResult;
  complete(line: string): Completion;
  prompt(): string;
  /** 窗口标题：用户@主机: 目录 */
  title(): string;
  history(): readonly string[];
  setRepos(repos: readonly CodeProject[]): void;
};

const HOST = "yugc";
const PID = 1024;
const MAX_DEPTH = 16;
const HISTORY_LIMIT = 500;
const STORE_PREFIX = "yugc:term:";

export const MOTD = [
  "YUGC OS 2.0 (GNU/Linux 6.6.0-yugc x86_64)",
  "",
  "这是一台模拟的 Linux：命令、管道、重定向、变量和脚本都能用，家目录里的文件存在这台浏览器里。",
  "输入 help 看有哪些命令，man <命令> 看用法；桌面上的应用都在 ~/Desktop 里，输入 forum 或 open forum 就能打开论坛。",
  "想系统地学 Linux 命令行，输入 learn。",
];

const DEFAULT_BASHRC = `# ~/.bashrc：每次打开终端都会先执行这里的命令
alias ll='ls -la'
alias la='ls -A'
`;

const README = `# 欢迎来到 YUGC OS 的终端

这是一台跑在浏览器里的模拟 Linux。家目录里的东西：

  Desktop/    桌面上的应用，运行 ./Desktop/forum.app、forum 或 open forum 都能打开
  Documents/  文档，linux.md 是 Linux 启明道场每一关对应的命令
  projects/   代码仓库中可访问的项目
  .bashrc     每次打开终端先执行的命令（隐藏文件，ls -a 才看得到）

试试：
  ls -la
  cat Documents/linux.md | grep 管道
  echo "hello" > hi.txt && cat hi.txt
  grep -c open /var/log/yugc.log
`;

const LOG = [
  "2026-10-24 08:59:58 kernel: YUGC OS 2.0 booting",
  "2026-10-24 09:00:01 boot: 开机动画播完，进入桌面",
  "2026-10-24 09:00:03 desktop: wallpaper 晴空",
  "2026-10-24 09:00:12 window: open about",
  "2026-10-24 09:01:40 window: open competitions",
  "2026-10-24 09:02:05 window: close about",
  "2026-10-24 09:05:31 window: open terminal",
  "2026-10-24 09:06:02 window: open org",
  "2026-10-24 09:06:44 window: open join",
  "2026-10-24 09:08:19 apply: 投递成功",
  "2026-10-24 09:10:00 window: open gitlab",
  "2026-10-24 09:12:27 window: close competitions",
].join("\n");

function safeUser(account: Account | null): string {
  const name = account?.username?.toLowerCase() ?? "";
  return /^[a-z_][a-z0-9_-]{0,31}$/.test(name) ? name : "guest";
}

/** $((...)) 只算整数四则、取余、乘方（**）和括号，变量名换成它的值；不用 eval。和 bash 一样按 64 位有符号整数算，溢出回绕 */
function arithmetic(source: string, lookup: (name: string) => string): string | null {
  const substituted = source.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (name) => (/^-?\d+$/.test(lookup(name).trim()) ? lookup(name).trim() : "0"));
  const tokens = substituted.match(/\*\*|\d+|[-+*/%()]/g);
  if (!tokens || tokens.join("") !== substituted.replace(/\s+/g, "")) return null;
  const wrap = (value: bigint) => BigInt.asIntN(64, value);
  let at = 0;
  const peek = () => tokens[at];
  const factor = (): bigint => {
    const token = tokens[at++];
    if (token === "(") {
      const value = sum();
      if (tokens[at++] !== ")") throw new Error("paren");
      return value;
    }
    if (token === "-") return wrap(-factor());
    if (token === "+") return factor();
    if (token === undefined || !/^\d+$/.test(token)) throw new Error("token");
    return wrap(BigInt(token));
  };
  // 和 bash 一样，乘方右结合，一元负号比乘方绑得紧：$((-2**2)) 是 4；按位平方，指数再大也只算 64 步
  const power = (): bigint => {
    let base = factor();
    if (peek() !== "**") return base;
    at += 1;
    let exponent = power();
    if (exponent < 0n) throw new Error("exponent");
    let result = 1n;
    while (exponent > 0n) {
      if (exponent & 1n) result = wrap(result * base);
      base = wrap(base * base);
      exponent >>= 1n;
    }
    return result;
  };
  const product = (): bigint => {
    let value = power();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = tokens[at++];
      const right = power();
      if ((op === "/" || op === "%") && right === 0n) throw new Error("zero");
      value = wrap(op === "*" ? value * right : op === "/" ? value / right : value % right);
    }
    return value;
  };
  const sum = (): bigint => {
    let value = product();
    while (peek() === "+" || peek() === "-") value = wrap(tokens[at++] === "+" ? value + product() : value - product());
    return value;
  };
  try {
    const value = sum();
    return at === tokens.length ? String(value) : null;
  } catch {
    return null;
  }
}

/** 展开出错（算术写错）时整条命令不跑，和 bash 一样 */
class ExpandError extends Error {}

const escapeGlob = (text: string) => text.replace(/[*?[\]\\]/g, "\\$&");
const unescapeGlob = (text: string) => text.replace(/\\(.)/g, "$1");

export function createShell({ account, apps, repos: initialRepos = [], storage = defaultStorage() }: ShellOptions): Shell {
  const user = safeUser(account);
  const storageKey = account ? (account.accountId ? `${STORE_PREFIX}account:${account.accountId}:${account.level ?? "registered"}` : null) : `${STORE_PREFIX}guest`;
  const home = `/home/${user}`;
  const fs = new Vfs(home);
  const vars = new Map<string, string>();
  const exported = new Set<string>();
  const aliases = new Map<string, string>();
  const historyList: string[] = [];
  let repos = initialRepos;
  let cwd = home;
  let positional: string[] = ["bash"];
  let lastCode = 0;
  let depth = 0;
  // 一次 run 里攒下的副作用：打开哪些应用、要不要清屏、要不要关窗口
  let opened: AppId[] = [];
  let clearAt: number | null = null;
  let exitCode: number | null = null;
  let chunks: TermLine[] = [];

  const setVar = (name: string, value: string, exportIt = false) => {
    vars.set(name, value);
    if (exportIt) exported.add(name);
  };
  for (const [name, value] of Object.entries({
    USER: user,
    LOGNAME: user,
    HOME: home,
    PWD: home,
    OLDPWD: home,
    SHELL: "/bin/bash",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOSTNAME: HOST,
    TERM: "xterm-256color",
    LANG: "zh_CN.UTF-8",
  }))
    setVar(name, value, true);

  buildSystem(fs, user, home, apps);
  buildProjects(fs, home, repos);

  const api: ShellApi = {
    user,
    host: HOST,
    home,
    get cwd() {
      return cwd;
    },
    setCwd(path) {
      setVar("OLDPWD", cwd, true);
      cwd = path;
      setVar("PWD", path, true);
    },
    vars,
    exported,
    aliases,
    history: historyList,
    apps,
    get repos() {
      return repos;
    },
    account,
    startedAt: typeof performance !== "undefined" ? Date.now() - performance.now() : Date.now(),
    pid: PID,
    open: (id) => opened.push(id),
    clear: () => {
      clearAt = chunks.length;
    },
    exit: (code) => {
      exitCode = code;
    },
    runArgv: (argv, stdin) => invoke(argv, stdin, false),
    runScript,
    locate,
  };

  // 存盘内容和 .bashrc 要等 api 建好再读：.bashrc 里的 alias、export 要真的执行
  load();

  function locate(name: string): string | null {
    if (COMMANDS[name]?.builtin) return "builtin";
    for (const part of (vars.get("PATH") ?? "").split(":")) {
      if (!part) continue;
      const path = fs.resolve(name, part);
      const node = fs.get(path);
      if (node?.type === "file" && node.mode & 0o111) return path;
    }
    return null;
  }

  function lookup(name: string): string {
    if (name === "?") return String(lastCode);
    if (name === "$") return String(PID);
    if (name === "#") return String(positional.length - 1);
    if (name === "@") return positional.slice(1).join(" ");
    if (/^\d$/.test(name)) return positional[Number(name)] ?? "";
    return vars.get(name) ?? "";
  }

  /** 一个词展开成若干个参数：变量和 $(…) 没加引号时按空白拆开，没加引号的 * ? [ 去匹配文件 */
  function expandWord(word: Word): { fields: string[]; err: string } {
    let err = "";
    // keep：带过引号的部分（"" 也算一个参数）；只靠拆分得到的空串会被丢掉
    type Field = { text: string; pattern: string; glob: boolean; keep: boolean };
    const fields: Field[] = [{ text: "", pattern: "", glob: false, keep: false }];
    const current = () => fields[fields.length - 1];
    const addSplit = (text: string) => {
      const parts = text.split(/[ \t\n]+/);
      parts.forEach((part, index) => {
        if (index > 0) fields.push({ text: "", pattern: "", glob: false, keep: false });
        current().text += part;
        current().pattern += escapeGlob(part);
      });
    };
    word.forEach((segment, index) => {
      if (segment.kind === "lit") {
        let text = segment.text;
        if (!segment.quoted && index === 0 && (text === "~" || text.startsWith("~/"))) {
          current().text += home;
          current().pattern += escapeGlob(home);
          text = text.slice(1);
        }
        current().text += text;
        current().pattern += segment.quoted ? escapeGlob(text) : text;
        if (!segment.quoted && hasGlob(text)) current().glob = true;
        current().keep ||= segment.quoted || text !== "";
        return;
      }
      let value: string;
      if (segment.kind === "var") value = lookup(segment.name);
      else if (segment.kind === "arith") {
        const result = arithmetic(segment.source, lookup);
        if (result === null) throw new ExpandError(`bash: ${segment.source}: syntax error in expression`);
        value = result;
      } else {
        const io = capture(segment.source);
        err += io.err;
        value = io.out.replace(/\n+$/, "");
      }
      if (segment.quoted) {
        current().text += value;
        current().pattern += escapeGlob(value);
        current().keep = true;
      } else addSplit(value);
    });
    const out: string[] = [];
    for (const field of fields) {
      if (!field.text && !field.keep) continue;
      if (field.glob) {
        const absolute = field.pattern.startsWith("/") ? field.pattern : `${cwd === "/" ? "" : escapeGlob(cwd)}/${field.pattern}`;
        const matches = fs.glob(absolute);
        if (matches.length) {
          const prefix = field.pattern.startsWith("/") ? "" : cwd === "/" ? "/" : `${cwd}/`;
          out.push(...matches.map((match) => (prefix && match.startsWith(prefix) ? match.slice(prefix.length) : match)));
          continue;
        }
        out.push(unescapeGlob(field.pattern));
        continue;
      }
      out.push(field.text);
    }
    return { fields: out, err };
  }

  function expandOne(word: Word): { text: string; err: string } {
    const { fields, err } = expandWord(word);
    return { text: fields.join(" "), err };
  }

  /** $(…)：在子 shell 里跑（里面的 cd 和赋值不影响外面），只拿标准输出 */
  function capture(source: string): Io {
    const saved = chunks;
    const savedCwd = cwd;
    const savedVars = new Map(vars);
    chunks = [];
    const code = runChain(source, "");
    cwd = savedCwd;
    vars.clear();
    for (const [key, value] of savedVars) vars.set(key, value);
    const out = chunks.filter((chunk) => chunk.kind === "out").map((chunk) => chunk.text).join("");
    const err = chunks.filter((chunk) => chunk.kind === "err").map((chunk) => chunk.text).join("");
    chunks = saved;
    return { out, err, code };
  }

  function invoke(argv: string[], stdin: string, tty: boolean): Io {
    const [name, ...args] = argv;
    if (name === undefined) return { out: "", err: "", code: 0 };
    if (name.includes("/")) {
      const path = fs.resolve(name, cwd);
      const node = fs.get(path);
      if (!node) return { out: "", err: `bash: ${name}: No such file or directory\n`, code: 127 };
      if (node.type === "dir") return { out: "", err: `bash: ${name}: Is a directory\n`, code: 126 };
      if (!(node.mode & 0o111)) return { out: "", err: `bash: ${name}: Permission denied\n`, code: 126 };
      if (node.builtin) return runBuiltin(node.content.split("\n")[1] ?? "", argv, stdin, tty);
      return runScript(path, args, stdin, false);
    }
    const spec = COMMANDS[name];
    if (spec?.builtin) return runBuiltin(name, argv, stdin, tty);
    const where = locate(name);
    if (where) {
      const node = fs.get(where) as FsNode & { type: "file" };
      if (node.builtin) return runBuiltin(name, argv, stdin, tty);
      return runScript(where, args, stdin, false);
    }
    // 不联网、全屏这些命令不装在 /usr/bin，照样给出说明；装在 /usr/bin 的命令改了 PATH 就找不到，和真 shell 一样
    if (spec && !EXTERNAL.includes(name)) return runBuiltin(name, argv, stdin, tty);
    const app = apps.find((candidate) => candidate.id === name);
    return { out: "", err: `bash: ${name}: command not found\n${app ? `要打开「${app.name}」，输入 open ${app.id}\n` : ""}`, code: 127 };
  }

  function runBuiltin(name: string, argv: string[], stdin: string, tty: boolean): Io {
    const spec = COMMANDS[name];
    if (!spec) return { out: "", err: `bash: ${argv[0]}: command not found\n`, code: 127 };
    if (argv[1] === "--help") return COMMANDS.man.run({ name: "man", args: [name], stdin: "", tty, fs, sh: api });
    try {
      return spec.run({ name: argv[0].includes("/") ? name : argv[0], args: argv.slice(1), stdin, tty, fs, sh: api });
    } catch (error) {
      if (error instanceof FsError) return { out: "", err: `${name}: ${error.path}: ${error.message}\n`, code: 1 };
      throw error;
    }
  }

  function runScript(path: string, args: string[], stdin: string, sourced: boolean): Io {
    let content: string;
    try {
      content = fs.read(path);
    } catch (error) {
      if (error instanceof FsError) return { out: "", err: `bash: ${fs.pretty(path)}: ${error.message}\n`, code: error.code === "ENOENT" ? 127 : 126 };
      throw error;
    }
    if (depth >= MAX_DEPTH) return { out: "", err: "bash: 脚本嵌套太深，停下了\n", code: 1 };
    const saved = { positional, cwd, vars: new Map(vars), exported: new Set(exported), aliases: new Map(aliases) };
    const outer = chunks;
    chunks = [];
    positional = [fs.pretty(path), ...args];
    depth += 1;
    let code = 0;
    const exitBefore = exitCode;
    exitCode = null;
    try {
      for (const line of content.split("\n")) {
        if (!line.trim() || line.trimStart().startsWith("#")) continue;
        code = runChain(line, stdin);
        if (exitCode !== null) {
          code = exitCode;
          break;
        }
      }
    } finally {
      depth -= 1;
      exitCode = exitBefore;
      positional = saved.positional;
      if (!sourced) {
        cwd = saved.cwd;
        vars.clear();
        for (const [key, value] of saved.vars) vars.set(key, value);
        exported.clear();
        for (const key of saved.exported) exported.add(key);
        aliases.clear();
        for (const [key, value] of saved.aliases) aliases.set(key, value);
      }
    }
    const out = chunks.filter((chunk) => chunk.kind === "out").map((chunk) => chunk.text).join("");
    const err = chunks.filter((chunk) => chunk.kind === "err").map((chunk) => chunk.text).join("");
    chunks = outer;
    return { out, err, code };
  }

  function emit(kind: "out" | "err", text: string) {
    if (text) chunks.push({ kind, text });
  }

  function redirectTarget(word: Word): { path: string; shown: string; err: string } {
    const { text, err } = expandOne(word);
    return { path: fs.resolve(text, cwd), shown: text, err };
  }

  function runCommand(command: Command, stdin: string, last: boolean): { out: string; code: number } {
    let input = stdin;
    let errText = "";
    for (const redirect of command.redirects) {
      if (redirect.op !== "<") continue;
      const target = redirectTarget(redirect.target);
      errText += target.err;
      try {
        input = fs.read(target.path);
      } catch (error) {
        if (!(error instanceof FsError)) throw error;
        emit("err", `${errText}bash: ${target.shown}: ${error.message}\n`);
        return { out: "", code: 1 };
      }
    }
    const argv: string[] = [];
    for (const word of command.words) {
      const { fields, err } = expandWord(word);
      errText += err;
      argv.push(...fields);
    }
    // 别名只换第一个词，展开一层；别名里再用同名命令时不再换（alias ls='ls -1'）
    if (argv.length && aliases.has(argv[0])) {
      const value = aliases.get(argv[0])!;
      try {
        const words = parse(value)[0]?.pipeline[0]?.words ?? [];
        const replaced = words.flatMap((word) => expandWord(word).fields);
        argv.splice(0, 1, ...replaced);
      } catch {
        // 别名写坏了就当没有
      }
    }
    const assigned = command.assigns.map(({ name, value }) => {
      const { text, err } = expandOne(value);
      errText += err;
      return [name, text] as const;
    });
    if (!argv.length) {
      for (const [name, value] of assigned) setVar(name, value, exported.has(name));
      emit("err", errText);
      return { out: "", code: errText ? 1 : 0 };
    }
    const restore = assigned.map(([name]) => [name, vars.get(name), exported.has(name)] as const);
    for (const [name, value] of assigned) setVar(name, value, true);
    const toFile = command.redirects.some((redirect) => redirect.op !== "<" && redirect.op !== "dup" && redirect.fd !== 2);
    const io = invoke(argv, input, last && !toFile);
    for (const [name, value, wasExported] of restore) {
      if (value === undefined) vars.delete(name);
      else vars.set(name, value);
      if (!wasExported) exported.delete(name);
    }
    // 照 bash 从左到右处理重定向：> f 2>&1 是两路都进 f，2>&1 > f 是错误留在终端、输出进 f
    type Sink = { path: string; shown: string; append: boolean } | "stream";
    let sink1: Sink = "stream";
    let sink2: Sink = "stream";
    let stream2IsStdout = false;
    for (const redirect of command.redirects) {
      if (redirect.op === "<") continue;
      if (redirect.op === "dup") {
        sink2 = sink1;
        stream2IsStdout = sink1 === "stream";
        continue;
      }
      const target = redirectTarget(redirect.target);
      errText += target.err;
      const next: Sink = { path: target.path, shown: target.shown, append: redirect.op === ">>" };
      if (redirect.fd === 1 || redirect.fd === "both") sink1 = next;
      if (redirect.fd === 2 || redirect.fd === "both") {
        sink2 = redirect.fd === "both" ? sink1 : next;
        stream2IsStdout = false;
      }
    }
    let out = sink1 === "stream" ? io.out : "";
    let err = "";
    const errAll = errText + io.err;
    if (sink2 === "stream") {
      if (stream2IsStdout) out += errAll;
      else err = errAll;
    }
    const writes = new Map<string, { sink: Exclude<Sink, "stream">; text: string }>();
    const queue = (sink: Sink, text: string) => {
      if (sink === "stream") return;
      const pending = writes.get(sink.path);
      if (pending) pending.text += text;
      else writes.set(sink.path, { sink, text });
    };
    queue(sink1, io.out);
    queue(sink2, errAll);
    for (const { sink, text } of writes.values()) {
      try {
        fs.write(sink.path, text, sink.append);
      } catch (error) {
        if (!(error instanceof FsError)) throw error;
        emit("err", `bash: ${sink.shown}: ${error.message}\n`);
        return { out: "", code: 1 };
      }
    }
    emit("err", err);
    return { out, code: io.code };
  }

  function runPipeline(pipeline: Command[], stdin: string): number {
    let input = stdin;
    let code = 0;
    pipeline.forEach((command, index) => {
      const last = index === pipeline.length - 1;
      let result: { out: string; code: number };
      try {
        result = runCommand(command, input, last);
      } catch (error) {
        if (!(error instanceof ExpandError)) throw error;
        emit("err", `${error.message}\n`);
        result = { out: "", code: 1 };
      }
      code = result.code;
      if (last) emit("out", result.out);
      else input = result.out;
    });
    return code;
  }

  function runChain(line: string, stdin: string): number {
    let chain: Chain;
    try {
      chain = parse(line);
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      emit("err", `${error.message}\n`);
      lastCode = 2;
      return 2;
    }
    let previous: "&&" | "||" | ";" | null = null;
    for (const { pipeline, next } of chain) {
      const skip = (previous === "&&" && lastCode !== 0) || (previous === "||" && lastCode === 0);
      if (!skip) lastCode = runPipeline(pipeline, stdin);
      previous = next;
      if (exitCode !== null) break;
    }
    return lastCode;
  }

  function prompt(): string {
    return `${user}@${HOST}:${fs.pretty(cwd)}$`;
  }

  function persist() {
    if (!storage || !storageKey) return;
    const entries: Array<[string, "d" | "f", number, string?]> = [];
    const walk = (node: DirNode, rel: string) => {
      for (const [name, child] of [...node.children].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const path = rel ? `${rel}/${name}` : name;
        if (!child.generated) entries.push(child.type === "dir" ? [path, "d", child.mode] : [path, "f", child.mode, child.content]);
        if (child.type === "dir") walk(child, path);
      }
    };
    const homeNode = fs.get(home);
    if (homeNode?.type === "dir") walk(homeNode, "");
    try {
      storage.setItem(storageKey, JSON.stringify({ v: 1, entries }));
    } catch {
      // 存不下（隐私模式、配额满）就只在这次打开里有效
    }
  }

  function load() {
    let saved: unknown = null;
    try {
      saved = storageKey ? JSON.parse(storage?.getItem(storageKey) ?? "null") : null;
    } catch {
      saved = null;
    }
    const entries = (saved as { v?: number; entries?: unknown })?.v === 1 && Array.isArray((saved as { entries: unknown[] }).entries) ? (saved as { entries: unknown[] }).entries : [];
    for (const entry of entries) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || entry[0].split("/").some((part) => !part || part === "." || part === "..")) continue;
      const path = `${home}/${entry[0]}`;
      const mode = typeof entry[2] === "number" ? entry[2] & 0o777 : 0o644;
      try {
        if (entry[1] === "d") {
          fs.mkdir(path, true);
          const node = fs.get(path);
          if (node) node.mode = mode;
        } else if (entry[1] === "f" && typeof entry[3] === "string") {
          fs.mkdir(path.slice(0, path.lastIndexOf("/")), true);
          fs.write(path, entry[3]);
          const node = fs.get(path);
          if (node) node.mode = mode;
        }
      } catch {
        // 坏掉的一条跳过
      }
    }
    try {
      historyList.push(...fs.read(`${home}/.bash_history`).split("\n").filter(Boolean).slice(-HISTORY_LIMIT));
    } catch {
      // 还没有历史
    }
    try {
      for (const line of fs.read(`${home}/.bashrc`).split("\n")) if (line.trim() && !line.trimStart().startsWith("#")) runChain(line, "");
    } catch {
      // .bashrc 被删了
    }
    chunks = [];
    lastCode = 0;
  }

  function recordHistory(line: string) {
    if (!line.trim() || line.startsWith(" ") || historyList[historyList.length - 1] === line) return;
    historyList.push(line);
    if (historyList.length > HISTORY_LIMIT) historyList.splice(0, historyList.length - HISTORY_LIMIT);
    try {
      fs.write(`${home}/.bash_history`, `${historyList.join("\n")}\n`);
    } catch {
      // 家目录满了，历史只留在内存里
    }
  }

  function run(input: string): RunResult {
    opened = [];
    clearAt = null;
    exitCode = null;
    chunks = [];
    let line = input;
    const echoPrompt = prompt();
    const echo: TermLine = { kind: "echo", text: input, prompt: echoPrompt };
    if (line.includes("!!")) {
      const previous = historyList[historyList.length - 1];
      if (!previous) return { lines: [echo, { kind: "err", text: "bash: !!: event not found" }], open: [], clear: false, exit: false };
      line = line.replace(/!!/g, previous);
      chunks.push({ kind: "out", text: `${line}\n` });
    }
    recordHistory(line);
    if (line.trim()) runChain(line, "");
    persist();
    const produced = clearAt === null ? chunks : chunks.slice(clearAt);
    const lines: TermLine[] = clearAt === null ? [echo] : [];
    for (const chunk of produced) {
      const parts = chunk.text.split("\n");
      if (parts[parts.length - 1] === "") parts.pop();
      for (const text of parts) lines.push({ kind: chunk.kind, text });
    }
    return { lines, open: opened, clear: clearAt !== null, exit: exitCode !== null };
  }

  function complete(line: string): Completion {
    const { head, word, first } = lastWord(line);
    let candidates: string[];
    if (first && !word.includes("/")) {
      const names = new Set([...Object.keys(COMMANDS).filter((name) => /^[a-z]/.test(name)), ...aliases.keys()]);
      candidates = [...names].filter((name) => name.startsWith(word)).sort().map((name) => `${name} `);
    } else {
      const slash = word.lastIndexOf("/");
      const dirPart = slash >= 0 ? word.slice(0, slash + 1) : "";
      const prefix = word.slice(slash + 1);
      const base = fs.resolve(dirPart || ".", cwd);
      const node = fs.get(base);
      candidates =
        node?.type === "dir" && fs.readable(base, node)
          ? [...node.children]
              .filter(([name]) => name.startsWith(prefix) && (prefix.startsWith(".") || !name.startsWith(".")))
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([name, child]) => `${dirPart}${name}${child.type === "dir" ? "/" : " "}`)
          : [];
    }
    if (!candidates.length) return { line, options: [] };
    if (candidates.length === 1) return { line: head + candidates[0], options: [] };
    let common = candidates[0];
    for (const candidate of candidates) while (!candidate.startsWith(common)) common = common.slice(0, -1);
    const options = candidates.map((candidate) => candidate.trimEnd().slice(candidate.lastIndexOf("/", candidate.length - 2) + 1));
    return { line: head + common.replace(/ $/, ""), options: common.length > word.length ? [] : options };
  }

  return {
    user,
    home,
    run,
    complete,
    prompt,
    title: () => `${user}@${HOST}: ${fs.pretty(cwd)}`,
    history: () => historyList,
    setRepos(next) {
      repos = next;
      buildProjects(fs, home, next);
    },
  };
}

function defaultStorage(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const put = (parent: DirNode, name: string, node: FsNode) => {
  parent.children.set(name, node);
  return node;
};

/** 系统目录、/usr/bin 里的命令、/usr/local/bin 里的桌面应用命令、家目录的默认内容和桌面应用（都是 generated，不存盘） */
function buildSystem(fs: Vfs, user: string, home: string, apps: readonly OsApp[]) {
  const root = fs.root;
  const sub = (parent: DirNode, name: string, mode = 0o755) => put(parent, name, dir(true, mode)) as DirNode;
  const usr = sub(root, "usr");
  const bin = sub(usr, "bin");
  const localBin = sub(sub(usr, "local"), "bin");
  for (const name of EXTERNAL) put(bin, name, { ...file(`\x7fELF\n${name}\n`, 0o755, true), builtin: true });
  put(root, "bin", bin);
  const etc = sub(root, "etc");
  put(etc, "hostname", file(`${HOST}\n`, 0o644, true));
  put(etc, "os-release", file('NAME="YUGC OS"\nVERSION="2.0"\nID=yugc\nPRETTY_NAME="YUGC OS 2.0"\nHOME_URL="https://yangtzeu.work/"\n', 0o644, true));
  put(etc, "motd", file(`${MOTD.join("\n")}\n`, 0o644, true));
  put(etc, "passwd", file(`root:x:0:0:root:/root:/bin/bash\n${user}:x:1000:1000:${user}:${home}:/bin/bash\n`, 0o644, true));
  put(etc, "group", file(`root:x:0:\nsudo:x:27:\n${user}:x:1000:\nmembers:x:1001:\nalumni:x:1002:\nregistered:x:1003:\nvisitors:x:1004:\n`, 0o644, true));
  put(etc, "shadow", file("root:*:20000:0:99999:7:::\n", 0o640, true));
  sub(root, "root", 0o700);
  sub(root, "tmp", 0o1777);
  const log = sub(sub(root, "var"), "log");
  put(log, "yugc.log", file(`${LOG}\n`, 0o644, true));
  const homeDir = sub(sub(root, "home"), user);
  homeDir.mode = 0o750;
  put(homeDir, "README.md", file(README, 0o644, true));
  put(homeDir, ".bashrc", file(DEFAULT_BASHRC, 0o644, true));
  put(homeDir, "join", file("#!/bin/bash\n# 打开「加入我们」\nopen join\n", 0o755, true));
  const desktop = sub(homeDir, "Desktop");
  for (const app of apps) {
    const script = `#!/bin/bash\n# ${app.name}：${app.blurb}\nopen ${app.id}\n`;
    put(desktop, `${app.id}.app`, file(script, 0o755, true));
    put(localBin, app.id, file(script, 0o755, true));
  }
  const docs = sub(homeDir, "Documents");
  put(docs, "linux.md", file(LEARN_TEXT, 0o644, true));
}

/** ~/projects：代码仓库里每个公开项目一个目录，README 写说明和地址 */
function buildProjects(fs: Vfs, home: string, repos: readonly CodeProject[]) {
  const homeDir = fs.get(home);
  if (homeDir?.type !== "dir") return;
  const existing = homeDir.children.get("projects");
  const projects = existing?.type === "dir" ? existing : (put(homeDir, "projects", dir(true)) as DirNode);
  for (const [name, node] of [...projects.children]) if (node.generated) projects.children.delete(name);
  for (const repo of repos) {
    const name = repo.path.split("/").pop()?.replace(/[^\w.-]/g, "_") || repo.name;
    if (projects.children.has(name)) continue;
    const project = put(projects, name, dir(true)) as DirNode;
    put(project, "README.md", file(`# ${repo.name}\n\n${repo.description || "（没有说明）"}\n\n地址：${repo.url}\n克隆：git clone ${repo.cloneUrl}\n`, 0o644, true));
  }
}
