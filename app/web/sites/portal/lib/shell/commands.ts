// 终端的命令（#279）：照 GNU coreutils 和 bash 的行为与报错写，选项只做常用的那些，man <命令> 里写明支持哪些。
// builtin 是 shell 自己的命令（cd、export 这类），PATH 坏了也能用；其余命令装在 /usr/bin，按 PATH 查找。
// 输出到终端（tty）时 ls、grep、tree 会上色，接管道或重定向时不上色，和真终端一样。
import type { CodeProject } from "../codeRepos";
import type { Account } from "../account";
import type { AppId, OsApp } from "../osApps";
import { FsError, basename, dirname, globToRegExp, type FsNode, type Vfs } from "./vfs";

export type Io = { out: string; err: string; code: number };

export type ShellApi = {
  user: string;
  host: string;
  home: string;
  cwd: string;
  setCwd(path: string): void;
  vars: Map<string, string>;
  exported: Set<string>;
  aliases: Map<string, string>;
  history: string[];
  apps: readonly OsApp[];
  repos: readonly CodeProject[];
  account: Account | null;
  startedAt: number;
  pid: number;
  open(id: AppId): void;
  clear(): void;
  exit(code: number): void;
  /** 按 argv 直接运行一条命令（xargs 用），不经过解析 */
  runArgv(argv: string[], stdin: string): Io;
  /** 运行一个脚本文件；sourced 为真时在当前 shell 里改变量和目录（source / .） */
  runScript(path: string, args: string[], stdin: string, sourced: boolean): Io;
  /** 命令名在 PATH 里的位置；builtin 回 "builtin"，找不到回 null */
  locate(name: string): string | null;
};

export type Ctx = { name: string; args: string[]; stdin: string; tty: boolean; fs: Vfs; sh: ShellApi };

export type CommandSpec = {
  run(ctx: Ctx): Io;
  usage: string;
  summary: string;
  options?: Array<[string, string]>;
  example?: string;
  builtin?: boolean;
  topic: Topic;
};

export type Topic = "路径与文件" | "查看与处理文本" | "变量与 shell" | "用户、权限与系统" | "桌面";

export const LEARN_URL = "https://linux.yangtzeu.work";

const ok = (out = ""): Io => ({ out, err: "", code: 0 });
const fail = (err: string, code = 1, out = ""): Io => ({ out, err: err.endsWith("\n") ? err : `${err}\n`, code });
const linesOf = (text: string): string[] => {
  if (!text) return [];
  const parts = text.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
};
const joinLines = (lines: readonly string[]): string => (lines.length ? `${lines.join("\n")}\n` : "");
const bytes = (text: string): number => new TextEncoder().encode(text).length;

const C = { dir: "\x1b[1;34m", exec: "\x1b[1;32m", app: "\x1b[1;35m", match: "\x1b[1;31m", dim: "\x1b[90m", key: "\x1b[36m", reset: "\x1b[0m" };
const paint = (on: boolean, color: string, text: string) => (on ? `${color}${text}${C.reset}` : text);

/** 报错照 coreutils 的格式：ls: cannot access 'x': No such file or directory */
function fsMessage(error: unknown, shown: string): string {
  if (error instanceof FsError) return `'${shown}': ${error.message}`;
  throw error;
}

type Parsed = { flags: Map<string, string | true>; rest: string[]; bad: string | null };

/** 短选项解析：-la 拆成 -l -a，带值的选项（valued 里的字母）吃掉下一个参数或紧跟的部分，-- 之后全是参数 */
function parseFlags(args: readonly string[], letters: string, valued = ""): Parsed {
  const flags = new Map<string, string | true>();
  const rest: string[] = [];
  let bad: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-" || /^-\d/.test(arg)) {
      rest.push(arg);
      continue;
    }
    for (let j = 1; j < arg.length; j += 1) {
      const letter = arg[j];
      if (valued.includes(letter)) {
        const value = arg.slice(j + 1) || args[++i];
        if (value === undefined) bad ??= `option requires an argument -- '${letter}'`;
        else flags.set(letter, value);
        break;
      }
      if (!letters.includes(letter)) bad ??= `invalid option -- '${letter}'`;
      else flags.set(letter, true);
    }
  }
  return { flags, rest, bad };
}

const usageError = (name: string, bad: string) => fail(`${name}: ${bad}\nTry 'man ${name}' for more information.`, 2);

/** 读一组输入：没有文件或文件名是 - 时读 stdin */
function inputs(ctx: Ctx, files: readonly string[]): { texts: Array<{ name: string; text: string }>; err: string } {
  const texts: Array<{ name: string; text: string }> = [];
  let err = "";
  for (const name of files.length ? files : ["-"]) {
    if (name === "-") {
      texts.push({ name, text: ctx.stdin });
      continue;
    }
    try {
      texts.push({ name, text: ctx.fs.read(ctx.fs.resolve(name, ctx.sh.cwd)) });
    } catch (error) {
      err += `${ctx.name}: ${fsMessage(error, name).replace(/^'(.*)': /, "$1: ")}\n`;
    }
  }
  return { texts, err };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (value: number, width = 2) => String(value).padStart(width, "0");

function modeString(node: FsNode): string {
  const bits = "rwxrwxrwx";
  let text = node.type === "dir" ? "d" : "-";
  for (let i = 0; i < 9; i += 1) text += node.mode & (1 << (8 - i)) ? bits[i] : "-";
  if (node.mode & 0o1000) text = `${text.slice(0, 9)}t`;
  return text;
}

const sizeOf = (node: FsNode) => (node.type === "dir" ? 4096 : bytes(node.content));
const human = (size: number) => (size < 1024 ? String(size) : size < 1024 * 1024 ? `${(size / 1024).toFixed(1).replace(/\.0$/, "")}K` : `${(size / 1048576).toFixed(1)}M`);

function colorName(node: FsNode, name: string, tty: boolean): string {
  if (node.type === "dir") return paint(tty, C.dir, name);
  if (name.endsWith(".app")) return paint(tty, C.app, name);
  if (node.mode & 0o111) return paint(tty, C.exec, name);
  return name;
}

function ownerOf(fs: Vfs, path: string, user: string) {
  return fs.writable(path) ? user : "root";
}

function longLine(fs: Vfs, path: string, node: FsNode, name: string, user: string, tty: boolean, humanSize: boolean): string {
  const date = new Date(node.mtime);
  const owner = ownerOf(fs, path, user);
  const size = humanSize ? human(sizeOf(node)) : String(sizeOf(node));
  return `${modeString(node)} 1 ${owner.padEnd(6)} ${owner.padEnd(6)} ${size.padStart(6)} ${MONTHS[date.getMonth()]} ${String(date.getDate()).padStart(2)} ${pad(date.getHours())}:${pad(date.getMinutes())} ${colorName(node, name, tty)}`;
}

const join = (base: string, name: string) => (base === "/" ? `/${name}` : `${base}/${name}`);

function ls(ctx: Ctx): Io {
  const { flags, rest, bad } = parseFlags(ctx.args, "alAh1dFR");
  if (bad) return usageError("ls", bad);
  const { fs, sh } = ctx;
  const all = flags.has("a");
  const almost = flags.has("A");
  const long = flags.has("l");
  const oneLine = flags.has("1") || !ctx.tty;
  let out = "";
  let err = "";
  let code = 0;
  const format = (entries: Array<{ name: string; path: string; node: FsNode }>) => {
    if (long) return joinLines(entries.map((entry) => longLine(fs, entry.path, entry.node, entry.name, sh.user, ctx.tty, flags.has("h"))));
    const names = entries.map((entry) => colorName(entry.node, entry.name, ctx.tty) + (flags.has("F") && entry.node.type === "dir" ? "/" : ""));
    if (!names.length) return "";
    return oneLine ? joinLines(names) : `${names.join("  ")}\n`;
  };
  const targets = rest.length ? rest : ["."];
  const files: Array<{ name: string; path: string; node: FsNode }> = [];
  const dirs: Array<{ name: string; path: string }> = [];
  for (const target of targets) {
    const path = fs.resolve(target, sh.cwd);
    const node = fs.get(path);
    if (!node) {
      err += `ls: cannot access '${target}': No such file or directory\n`;
      code = 2;
    } else if (node.type === "dir" && !flags.has("d")) dirs.push({ name: target, path });
    else files.push({ name: target, path, node });
  }
  out += format(files);
  const listDir = (name: string, path: string, header: boolean) => {
    let dirNode;
    try {
      dirNode = fs.getDir(path);
    } catch (error) {
      err += `ls: cannot open directory ${fsMessage(error, name)}\n`;
      code = 2;
      return;
    }
    if (header) out += `${out ? "\n" : ""}${name}:\n`;
    const entries = [...dirNode.children.entries()]
      .filter(([child]) => all || almost || !child.startsWith("."))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([child, node]) => ({ name: child, path: join(path, child), node }));
    if (all) entries.unshift({ name: ".", path, node: dirNode }, { name: "..", path: dirname(path), node: fs.get(dirname(path)) ?? dirNode });
    if (long) out += `total ${entries.length * 4}\n`;
    out += format(entries);
    if (flags.has("R")) for (const entry of entries) if (entry.node.type === "dir" && entry.name !== "." && entry.name !== "..") listDir(`${name === "/" ? "" : name.replace(/\/$/, "")}/${entry.name}`, entry.path, true);
  };
  for (const target of dirs) listDir(target.name, target.path, targets.length > 1 || flags.has("R"));
  return { out, err, code };
}

function cat(ctx: Ctx): Io {
  const { flags, rest, bad } = parseFlags(ctx.args, "n");
  if (bad) return usageError("cat", bad);
  const { texts, err } = inputs(ctx, rest);
  let text = texts.map((entry) => entry.text).join("");
  if (flags.has("n")) text = joinLines(linesOf(text).map((line, index) => `${String(index + 1).padStart(6)}\t${line}`));
  return { out: text, err, code: err ? 1 : 0 };
}

function unescape(text: string): string {
  return text.replace(/\\([ntr\\]|0?[0-7]{1,3})/g, (_, code: string) => ({ n: "\n", t: "\t", r: "\r", "\\": "\\" })[code] ?? String.fromCharCode(parseInt(code, 8)));
}

function echo(ctx: Ctx): Io {
  let newline = true;
  let escapes = false;
  let index = 0;
  for (; index < ctx.args.length; index += 1) {
    const arg = ctx.args[index];
    if (!/^-[neE]+$/.test(arg)) break;
    if (arg.includes("n")) newline = false;
    if (arg.includes("e")) escapes = true;
    if (arg.includes("E")) escapes = false;
  }
  const text = ctx.args.slice(index).join(" ");
  return ok((escapes ? unescape(text) : text) + (newline ? "\n" : ""));
}

function printf(ctx: Ctx): Io {
  const [format, ...args] = ctx.args;
  if (format === undefined) return fail("printf: usage: printf format [arguments]", 2);
  let out = "";
  let used = 0;
  do {
    out += unescape(format).replace(/%([-0-9.]*)([sdif%])/g, (_, width: string, kind: string) => {
      if (kind === "%") return "%";
      const value = args[used++] ?? "";
      const text = kind === "s" ? value : kind === "f" ? (Number(value) || 0).toFixed(width.includes(".") ? Number(width.split(".")[1]) : 6) : String(Math.trunc(Number(value) || 0));
      const size = Number(width.split(".")[0]) || 0;
      return width.startsWith("-") ? text.padEnd(Math.abs(size)) : text.padStart(Math.abs(size));
    });
  } while (used > 0 && used < args.length);
  return ok(out);
}

function cd(ctx: Ctx): Io {
  const { fs, sh } = ctx;
  let target = ctx.args[0] ?? sh.home;
  let print = false;
  if (target === "-") {
    target = sh.vars.get("OLDPWD") ?? sh.cwd;
    print = true;
  }
  if (ctx.args.length > 1) return fail("bash: cd: too many arguments");
  const path = fs.resolve(target, sh.cwd);
  try {
    fs.getDir(path);
  } catch (error) {
    return fail(`bash: cd: ${fsMessage(error, target).replace(/^'(.*)': /, "$1: ")}`);
  }
  sh.setCwd(path);
  return ok(print ? `${path}\n` : "");
}

/** onError 回 null 表示忽略这个错误，回 undefined 用默认的报错 */
function eachPath(ctx: Ctx, run: (path: string, shown: string) => void, verb: string, onError?: (error: FsError, shown: string) => string | null | undefined): Io {
  let err = "";
  if (!ctx.args.length) return fail(`${ctx.name}: missing operand\nTry 'man ${ctx.name}' for more information.`);
  for (const shown of ctx.args) {
    try {
      run(ctx.fs.resolve(shown, ctx.sh.cwd), shown);
    } catch (error) {
      if (!(error instanceof FsError)) throw error;
      const custom = onError?.(error, shown);
      if (custom === null) continue;
      err += custom ?? `${ctx.name}: ${verb} ${fsMessage(error, shown)}\n`;
    }
  }
  return { out: "", err, code: err ? 1 : 0 };
}

function mkdir(ctx: Ctx): Io {
  const { flags, rest, bad } = parseFlags(ctx.args, "pv");
  if (bad) return usageError("mkdir", bad);
  return eachPath({ ...ctx, args: rest }, (path) => ctx.fs.mkdir(path, flags.has("p")), "cannot create directory");
}

function touch(ctx: Ctx): Io {
  return eachPath(ctx, (path) => ctx.fs.touch(path), "cannot touch");
}

function rm(ctx: Ctx): Io {
  const { flags, rest, bad } = parseFlags(ctx.args, "rRfiv");
  if (bad) return usageError("rm", bad);
  const recursive = flags.has("r") || flags.has("R");
  const force = flags.has("f");
  if (!rest.length) return force ? ok() : fail("rm: missing operand\nTry 'man rm' for more information.");
  for (const shown of rest) {
    if (recursive && ctx.fs.resolve(shown, ctx.sh.cwd) === "/") return fail("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe");
  }
  return eachPath(
    { ...ctx, args: rest },
    (path) => ctx.fs.remove(path, recursive),
    "cannot remove",
    (error) => (force && error.code === "ENOENT" ? null : undefined),
  );
}

function rmdir(ctx: Ctx): Io {
  return eachPath(ctx, (path) => ctx.fs.rmdir(path), "failed to remove");
}

function copyOrMove(ctx: Ctx, move: boolean): Io {
  const { flags, rest, bad } = parseFlags(ctx.args, move ? "fiv" : "rRfiv");
  if (bad) return usageError(ctx.name, bad);
  if (rest.length < 2) return fail(rest.length ? `${ctx.name}: missing destination file operand after '${rest[0]}'\nTry 'man ${ctx.name}' for more information.` : `${ctx.name}: missing file operand\nTry 'man ${ctx.name}' for more information.`);
  const { fs, sh } = ctx;
  const target = rest[rest.length - 1];
  const targetPath = fs.resolve(target, sh.cwd);
  const sources = rest.slice(0, -1);
  if (sources.length > 1 && fs.get(targetPath)?.type !== "dir") return fail(`${ctx.name}: target '${target}' is not a directory`);
  let err = "";
  for (const shown of sources) {
    const path = fs.resolve(shown, sh.cwd);
    try {
      if (!move && fs.get(path)?.type === "dir" && !(flags.has("r") || flags.has("R"))) {
        err += `cp: -r not specified; omitting directory '${shown}'\n`;
        continue;
      }
      if (move) fs.move(path, targetPath);
      else fs.copy(path, targetPath, true);
    } catch (error) {
      err += `${ctx.name}: cannot ${move ? "move" : "copy"} ${fsMessage(error, shown)}\n`;
    }
  }
  return { out: "", err, code: err ? 1 : 0 };
}

function headTail(ctx: Ctx, tail: boolean): Io {
  const args = ctx.args.map((arg) => (/^-\d+$/.test(arg) ? `-n${arg.slice(1)}` : arg));
  const { flags, rest, bad } = parseFlags(args, "qv", "nc");
  if (bad) return usageError(ctx.name, bad);
  const raw = String(flags.get("n") ?? "10");
  const fromStart = tail && raw.startsWith("+");
  const count = Number(raw.replace(/^[+-]/, ""));
  if (!Number.isFinite(count)) return fail(`${ctx.name}: invalid number of lines: '${raw}'`);
  const { texts, err } = inputs(ctx, rest);
  let out = "";
  texts.forEach((entry, index) => {
    if (texts.length > 1) out += `${index ? "\n" : ""}==> ${entry.name === "-" ? "standard input" : entry.name} <==\n`;
    const lines = linesOf(entry.text);
    const picked = !tail ? lines.slice(0, count) : fromStart ? lines.slice(Math.max(0, count - 1)) : count ? lines.slice(-count) : [];
    out += joinLines(picked);
  });
  return { out, err, code: err ? 1 : 0 };
}

function wc(ctx: Ctx): Io {
  const { flags, rest, bad } = parseFlags(ctx.args, "lwcm");
  if (bad) return usageError("wc", bad);
  const pick = flags.size ? ["l", "w", "c"].filter((key) => flags.has(key) || (key === "c" && flags.has("m"))) : ["l", "w", "c"];
  const { texts, err } = inputs(ctx, rest);
  const rows = texts.map((entry) => ({
    name: entry.name === "-" ? "" : entry.name,
    l: (entry.text.match(/\n/g) ?? []).length,
    w: entry.text.split(/\s+/).filter(Boolean).length,
    c: flags.has("m") ? [...entry.text].length : bytes(entry.text),
  }));
  if (rows.length > 1) rows.push({ name: "total", l: rows.reduce((s, r) => s + r.l, 0), w: rows.reduce((s, r) => s + r.w, 0), c: rows.reduce((s, r) => s + r.c, 0) });
  const width = pick.length === 1 && rows.length === 1 ? 0 : Math.max(1, ...rows.flatMap((row) => pick.map((key) => String(row[key as "l"]).length)));
  const out = joinLines(rows.map((row) => [...pick.map((key) => String(row[key as "l"]).padStart(width)), row.name].filter((part, index, all) => index < all.length - 1 || part).join(" ")));
  return { out, err, code: err ? 1 : 0 };
}

function makeRegExp(pattern: string, flags: Map<string, string | true>, global = false): RegExp | null {
  let source = flags.has("F") ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern;
  // 基本正则里 \| \( \) 才是元字符，换成 JS 的写法；-E 时照 JS 正则
  if (!flags.has("E") && !flags.has("F")) source = source.replace(/\\([|()])/g, "$1");
  if (flags.has("w")) source = `\\b(?:${source})\\b`;
  try {
    return new RegExp(source, `${flags.has("i") ? "i" : ""}${global ? "g" : ""}`);
  } catch {
    return null;
  }
}

function grep(ctx: Ctx): Io {
  const { flags, rest, bad } = parseFlags(ctx.args, "ivncrRlEFowHhq", "e");
  if (bad) return usageError("grep", bad);
  const pattern = flags.has("e") ? String(flags.get("e")) : rest.shift();
  if (pattern === undefined) return fail("Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'man grep' for more information.", 2);
  const re = makeRegExp(pattern, flags);
  if (!re) return fail(`grep: Invalid regular expression`, 2);
  const recursive = flags.has("r") || flags.has("R");
  let files = rest;
  let err = "";
  if (recursive) {
    files = [];
    for (const start of rest.length ? rest : ["."]) {
      const base = ctx.fs.resolve(start, ctx.sh.cwd);
      const walk = (path: string, shown: string) => {
        const node = ctx.fs.get(path);
        if (!node) {
          err += `grep: ${shown}: No such file or directory\n`;
          return;
        }
        if (node.type === "file") files.push(shown);
        else if (ctx.fs.readable(path, node)) for (const name of [...node.children.keys()].sort()) walk(join(path, name), `${shown.replace(/\/$/, "")}/${name}`);
      };
      walk(base, start);
    }
  }
  const read = inputs(ctx, files);
  err += read.err.replace(/^grep: (.*): Is a directory$/gm, "grep: $1: Is a directory");
  const named = flags.has("H") || (!flags.has("h") && (read.texts.length > 1 || recursive));
  const color = ctx.tty && !flags.has("v");
  let out = "";
  let matched = false;
  for (const entry of read.texts) {
    const prefix = named ? `${paint(ctx.tty, C.app, entry.name === "-" ? "(standard input)" : entry.name)}${paint(ctx.tty, C.key, ":")}` : "";
    let count = 0;
    linesOf(entry.text).forEach((line, index) => {
      const hit = re.test(line) !== flags.has("v");
      if (!hit) return;
      count += 1;
      matched = true;
      if (flags.has("c") || flags.has("l") || flags.has("q")) return;
      const number = flags.has("n") ? `${paint(ctx.tty, C.exec, String(index + 1))}${paint(ctx.tty, C.key, ":")}` : "";
      const global = makeRegExp(pattern, flags, true)!;
      if (flags.has("o")) for (const match of line.match(global) ?? []) out += `${prefix}${number}${paint(color, C.match, match)}\n`;
      else out += `${prefix}${number}${color ? line.replace(global, (match) => paint(true, C.match, match)) : line}\n`;
    });
    if (flags.has("c")) out += `${prefix}${count}\n`;
    if (flags.has("l") && count) out += `${paint(ctx.tty, C.app, entry.name)}\n`;
  }
  if (flags.has("q")) out = "";
  return { out, err, code: err && !matched ? 2 : matched ? 0 : 1 };
}

function sort(ctx: Ctx): Io {
  const { flags, rest, bad } = parseFlags(ctx.args, "rnufb", "tk");
  if (bad) return usageError("sort", bad);
  const { texts, err } = inputs(ctx, rest);
  const separator = flags.has("t") ? String(flags.get("t")) : null;
  const field = flags.has("k") ? Number(String(flags.get("k")).split(/[,.]/)[0]) : 0;
  const keyOf = (line: string) => {
    let key = line;
    if (field) key = (separator ? line.split(separator) : line.trim().split(/\s+/))[field - 1] ?? "";
    if (flags.has("b")) key = key.trim();
    return flags.has("f") ? key.toLowerCase() : key;
  };
  let lines = texts.flatMap((entry) => linesOf(entry.text));
  lines = [...lines].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (flags.has("n")) return (parseFloat(ka) || 0) - (parseFloat(kb) || 0) || (a < b ? -1 : a > b ? 1 : 0);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  if (flags.has("r")) lines.reverse();
  if (flags.has("u")) lines = lines.filter((line, index) => index === 0 || keyOf(line) !== keyOf(lines[index - 1]));
  return { out: joinLines(lines), err, code: err ? 2 : 0 };
}

function uniq(ctx: Ctx): Io {
  const { flags, rest, bad } = parseFlags(ctx.args, "cdui");
  if (bad) return usageError("uniq", bad);
  const { texts, err } = inputs(ctx, rest.slice(0, 1));
  const groups: Array<{ line: string; count: number }> = [];
  for (const line of linesOf(texts[0]?.text ?? "")) {
    const last = groups[groups.length - 1];
    const same = last && (flags.has("i") ? last.line.toLowerCase() === line.toLowerCase() : last.line === line);
    if (same) last.count += 1;
    else groups.push({ line, count: 1 });
  }
  const kept = groups.filter((group) => (flags.has("d") ? group.count > 1 : flags.has("u") ? group.count === 1 : true));
  return { out: joinLines(kept.map((group) => (flags.has("c") ? `${String(group.count).padStart(7)} ${group.line}` : group.line))), err, code: err ? 1 : 0 };
}

/** 1,3-4,5- 这种列表 → 判断第 n 个（从 1 数）在不在里面 */
function fieldList(spec: string): ((n: number) => boolean) | null {
  const ranges = spec.split(",").map((part) => {
    const match = /^(\d*)(-?)(\d*)$/.exec(part);
    if (!match || (!match[1] && !match[3])) return null;
    const from = match[1] ? Number(match[1]) : 1;
    const to = match[2] ? (match[3] ? Number(match[3]) : Infinity) : from;
    return [from, to] as const;
  });
  if (ranges.some((range) => range === null)) return null;
  return (n) => ranges.some((range) => n >= range![0] && n <= range![1]);
}

function cut(ctx: Ctx): Io {
  const { flags, rest, bad } = parseFlags(ctx.args, "s", "dfc");
  if (bad) return usageError("cut", bad);
  const spec = flags.get("f") ?? flags.get("c");
  if (typeof spec !== "string") return fail("cut: you must specify a list of bytes, characters, or fields\nTry 'man cut' for more information.");
  const inList = fieldList(spec);
  if (!inList) return fail(`cut: invalid field value '${spec}'`);
  const { texts, err } = inputs(ctx, rest);
  const delimiter = typeof flags.get("d") === "string" ? String(flags.get("d")) : "\t";
  const lines = texts.flatMap((entry) => linesOf(entry.text)).flatMap((line) => {
    if (flags.has("c")) return [[...line].filter((_, index) => inList(index + 1)).join("")];
    if (!line.includes(delimiter)) return flags.has("s") ? [] : [line];
    return [line.split(delimiter).filter((_, index) => inList(index + 1)).join(delimiter)];
  });
  return { out: joinLines(lines), err, code: err ? 1 : 0 };
}

function expandSet(set: string): string[] {
  const classes: Record<string, string> = { "[:lower:]": "a-z", "[:upper:]": "A-Z", "[:digit:]": "0-9", "[:alpha:]": "a-zA-Z", "[:alnum:]": "a-zA-Z0-9", "[:space:]": " \t\n" };
  const source = unescape(set.replace(/\[:[a-z]+:\]/g, (name) => classes[name] ?? name));
  const chars: string[] = [];
  const list = [...source];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i + 1] === "-" && list[i + 2] !== undefined) {
      for (let code = list[i].codePointAt(0)!; code <= list[i + 2].codePointAt(0)!; code += 1) chars.push(String.fromCodePoint(code));
      i += 2;
    } else chars.push(list[i]);
  }
  return chars;
}

function tr(ctx: Ctx): Io {
  const { flags, rest, bad } = parseFlags(ctx.args, "ds");
  if (bad) return usageError("tr", bad);
  if (!rest.length || (!flags.has("d") && rest.length < 2 && !flags.has("s"))) return fail("tr: missing operand\nTry 'man tr' for more information.");
  const from = expandSet(rest[0]);
  const to = rest[1] ? expandSet(rest[1]) : [];
  let out = "";
  let last = "";
  for (const char of ctx.stdin) {
    const index = from.indexOf(char);
    let next = char;
    if (index >= 0) {
      if (flags.has("d")) continue;
      if (to.length) next = to[Math.min(index, to.length - 1)];
    }
    if (flags.has("s") && next === last && (to.length ? to.includes(next) : from.includes(next))) continue;
    out += next;
    last = next;
  }
  return ok(out);
}

function sed(ctx: Ctx): Io {
  const { flags, rest, bad } = parseFlags(ctx.args, "nE", "e");
  if (bad) return usageError("sed", bad);
  const script = flags.has("e") ? String(flags.get("e")) : rest.shift();
  if (script === undefined) return fail("Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...", 1);
  const subst = /^s(.)(.*?)(?<!\\)\1(.*?)(?<!\\)\1([gip0-9]*)$/.exec(script);
  const print = /^(\d+)p$/.exec(script);
  const del = /^(\d+)d$/.exec(script);
  if (!subst && !print && !del) return fail(`sed: -e expression #1, char 1: 这个终端的 sed 只支持 s/找/换/g、Np、Nd`);
  const { texts, err } = inputs(ctx, rest);
  const lines = texts.flatMap((entry) => linesOf(entry.text));
  if (print || del) {
    const n = Number((print ?? del)![1]);
    const kept = print ? (flags.has("n") ? lines.filter((_, index) => index + 1 === n) : lines.flatMap((line, index) => (index + 1 === n ? [line, line] : [line]))) : lines.filter((_, index) => index + 1 !== n);
    return { out: joinLines(kept), err, code: err ? 2 : 0 };
  }
  const [, , find, replace, mode] = subst!;
  const re = makeRegExp(find, new Map(flags.has("E") ? [["E", true]] : []), mode.includes("g"));
  if (!re) return fail("sed: -e expression #1: Invalid regular expression");
  const insensitive = mode.includes("i") ? new RegExp(re.source, `${re.flags}i`) : re;
  const replacement = replace.replace(/\\(\d)/g, "$$$1").replace(/(^|[^\\])&/g, "$1$$&").replace(/\\&/g, "&");
  const out = lines.map((line) => line.replace(insensitive, replacement));
  return { out: joinLines(out), err, code: err ? 2 : 0 };
}

function find(ctx: Ctx): Io {
  const starts: string[] = [];
  let i = 0;
  while (i < ctx.args.length && !ctx.args[i].startsWith("-")) starts.push(ctx.args[i++]);
  let name: RegExp | null = null;
  let type: "f" | "d" | null = null;
  let maxDepth = Infinity;
  for (; i < ctx.args.length; i += 2) {
    const option = ctx.args[i];
    const value = ctx.args[i + 1];
    if (value === undefined) return fail(`find: missing argument to \`${option}'`);
    if (option === "-name" || option === "-iname") name = new RegExp(globToRegExp(value).source, option === "-iname" ? "i" : "");
    else if (option === "-type") {
      if (value !== "f" && value !== "d") return fail(`find: Unknown argument to -type: ${value}`);
      type = value;
    } else if (option === "-maxdepth") maxDepth = Number(value);
    else return fail(`find: unknown predicate \`${option}'`);
  }
  let out = "";
  let err = "";
  for (const start of starts.length ? starts : ["."]) {
    const walk = (path: string, shown: string, depth: number) => {
      const node = ctx.fs.get(path);
      if (!node) {
        err += `find: '${shown}': No such file or directory\n`;
        return;
      }
      const leaf = shown === start ? basename(path) : shown.slice(shown.lastIndexOf("/") + 1);
      if ((!type || (type === "f") === (node.type === "file")) && (!name || name.test(leaf))) out += `${shown}\n`;
      if (node.type !== "dir" || depth >= maxDepth) return;
      if (!ctx.fs.readable(path, node)) {
        err += `find: '${shown}': Permission denied\n`;
        return;
      }
      for (const child of [...node.children.keys()].sort()) walk(join(path, child), `${shown.replace(/\/$/, "")}/${child}`, depth + 1);
    };
    walk(ctx.fs.resolve(start, ctx.sh.cwd), start, 0);
  }
  return { out, err, code: err ? 1 : 0 };
}

function tree(ctx: Ctx): Io {
  const { flags, rest, bad } = parseFlags(ctx.args, "ad", "L");
  if (bad) return usageError("tree", bad);
  const limit = flags.has("L") ? Number(flags.get("L")) : Infinity;
  let out = "";
  let dirs = 0;
  let files = 0;
  for (const start of rest.length ? rest : ["."]) {
    const path = ctx.fs.resolve(start, ctx.sh.cwd);
    const node = ctx.fs.get(path);
    if (!node) {
      out += `${start}  [error opening dir]\n`;
      continue;
    }
    out += `${colorName(node, start, ctx.tty)}\n`;
    const walk = (dirPath: string, prefix: string, depth: number) => {
      const dirNode = ctx.fs.get(dirPath);
      if (dirNode?.type !== "dir" || depth > limit || !ctx.fs.readable(dirPath, dirNode)) return;
      const entries = [...dirNode.children.entries()].filter(([name, child]) => (flags.has("a") || !name.startsWith(".")) && (!flags.has("d") || child.type === "dir")).sort(([a], [b]) => (a < b ? -1 : 1));
      entries.forEach(([name, child], index) => {
        const last = index === entries.length - 1;
        out += `${prefix}${last ? "└── " : "├── "}${colorName(child, name, ctx.tty)}\n`;
        if (child.type === "dir") {
          dirs += 1;
          walk(join(dirPath, name), `${prefix}${last ? "    " : "│   "}`, depth + 1);
        } else files += 1;
      });
    };
    walk(path, "", 1);
  }
  out += `\n${dirs} ${dirs === 1 ? "directory" : "directories"}${flags.has("d") ? "" : `, ${files} ${files === 1 ? "file" : "files"}`}\n`;
  return ok(out);
}

function fileCommand(ctx: Ctx): Io {
  if (!ctx.args.length) return fail("Usage: file [-bchikLlNnprsSvzZ0] [--apple] [--extension] [--mime-encoding] [--mime-type] file...");
  const out = ctx.args.map((shown) => {
    const node = ctx.fs.get(ctx.fs.resolve(shown, ctx.sh.cwd));
    if (!node) return `${shown}: cannot open \`${shown}' (No such file or directory)`;
    if (node.type === "dir") return `${shown}: directory`;
    if (node.builtin) return `${shown}: ELF 64-bit LSB pie executable, x86-64, YUGC OS 内置命令`;
    if (shown.endsWith(".app")) return `${shown}: YUGC OS application, Bourne-Again shell script, UTF-8 text executable`;
    if (!node.content) return `${shown}: empty`;
    if (node.content.startsWith("#!")) return `${shown}: Bourne-Again shell script, ${/^[\x00-\x7f]*$/.test(node.content) ? "ASCII" : "UTF-8"} text executable`;
    return `${shown}: ${/^[\x00-\x7f]*$/.test(node.content) ? "ASCII text" : "Unicode text, UTF-8 text"}`;
  });
  return ok(joinLines(out));
}

function chmod(ctx: Ctx): Io {
  const [mode, ...paths] = ctx.args;
  if (!mode || !paths.length) return fail(mode ? `chmod: missing operand after '${mode}'\nTry 'man chmod' for more information.` : "chmod: missing operand\nTry 'man chmod' for more information.");
  const apply = (current: number): number | null => {
    if (/^[0-7]{3,4}$/.test(mode)) return parseInt(mode, 8);
    let next = current;
    for (const clause of mode.split(",")) {
      const match = /^([ugoa]*)([+\-=])([rwx]*)$/.exec(clause);
      if (!match) return null;
      const who = match[1] || "a";
      const perm = [...match[3]].reduce((sum, char) => sum | ({ r: 4, w: 2, x: 1 } as Record<string, number>)[char], 0);
      let mask = 0;
      if (who.includes("u") || who.includes("a")) mask |= perm << 6;
      if (who.includes("g") || who.includes("a")) mask |= perm << 3;
      if (who.includes("o") || who.includes("a")) mask |= perm;
      const clear = (who.includes("u") || who.includes("a") ? 0o700 : 0) | (who.includes("g") || who.includes("a") ? 0o070 : 0) | (who.includes("o") || who.includes("a") ? 0o007 : 0);
      next = match[2] === "+" ? next | mask : match[2] === "-" ? next & ~mask : (next & ~clear) | mask;
    }
    return next;
  };
  let err = "";
  for (const shown of paths) {
    const path = ctx.fs.resolve(shown, ctx.sh.cwd);
    const node = ctx.fs.get(path);
    if (!node) {
      err += `chmod: cannot access '${shown}': No such file or directory\n`;
      continue;
    }
    const next = apply(node.mode);
    if (next === null) return fail(`chmod: invalid mode: '${mode}'\nTry 'man chmod' for more information.`);
    try {
      ctx.fs.chmod(path, next);
    } catch (error) {
      err += `chmod: changing permissions of ${fsMessage(error, shown).replace("Permission denied", "Operation not permitted")}\n`;
    }
  }
  return { out: "", err, code: err ? 1 : 0 };
}

function stat(ctx: Ctx): Io {
  if (!ctx.args.length) return fail("stat: missing operand\nTry 'man stat' for more information.");
  let out = "";
  let err = "";
  for (const shown of ctx.args) {
    const path = ctx.fs.resolve(shown, ctx.sh.cwd);
    const node = ctx.fs.get(path);
    if (!node) {
      err += `stat: cannot statx '${shown}': No such file or directory\n`;
      continue;
    }
    const owner = ownerOf(ctx.fs, path, ctx.sh.user);
    const date = new Date(node.mtime);
    out += `  File: ${shown}\n  Size: ${sizeOf(node)}\t\t${node.type === "dir" ? "directory" : "regular file"}\nAccess: (0${(node.mode & 0o777).toString(8).padStart(3, "0")}/${modeString(node)})  Uid: (${owner === "root" ? 0 : 1000}/${owner})\nModify: ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}\n`;
  }
  return { out, err, code: err ? 1 : 0 };
}

function du(ctx: Ctx): Io {
  const { flags, rest, bad } = parseFlags(ctx.args, "sh");
  if (bad) return usageError("du", bad);
  const total = (node: FsNode): number => (node.type === "file" ? bytes(node.content) : [...node.children.values()].reduce((sum, child) => sum + total(child), 0));
  let out = "";
  for (const shown of rest.length ? rest : ["."]) {
    const node = ctx.fs.get(ctx.fs.resolve(shown, ctx.sh.cwd));
    if (!node) return fail(`du: cannot access '${shown}': No such file or directory`);
    const size = total(node);
    out += `${flags.has("h") ? human(size) : Math.ceil(size / 1024)}\t${shown}\n`;
  }
  return ok(out);
}

function df(ctx: Ctx): Io {
  const used = ctx.fs.homeUsage();
  const size = 100_000;
  const h = ctx.args.includes("-h");
  const show = (value: number) => (h ? human(value) : String(Math.ceil(value / 1024)));
  return ok(`Filesystem     ${h ? "Size" : "1K-blocks"}  Used Avail Use% Mounted on\nlocalStorage   ${show(size).padStart(h ? 4 : 9)} ${show(used).padStart(5)} ${show(size - used).padStart(5)} ${String(Math.round((used / size) * 100)).padStart(3)}% ${ctx.sh.home}\n`);
}

function which(ctx: Ctx): Io {
  let out = "";
  let code = 0;
  for (const name of ctx.args) {
    const where = ctx.sh.locate(name);
    if (where && where !== "builtin") out += `${where}\n`;
    else code = 1;
  }
  return { out, err: "", code: ctx.args.length ? code : 1 };
}

function type(ctx: Ctx): Io {
  let out = "";
  let err = "";
  for (const name of ctx.args) {
    const alias = ctx.sh.aliases.get(name);
    const where = ctx.sh.locate(name);
    if (alias) out += `${name} is aliased to \`${alias}'\n`;
    else if (where === "builtin") out += `${name} is a shell builtin\n`;
    else if (where) out += `${name} is ${where}\n`;
    else err += `bash: type: ${name}: not found\n`;
  }
  return { out, err, code: err ? 1 : 0 };
}

function history(ctx: Ctx): Io {
  if (ctx.args[0] === "-c") {
    ctx.sh.history.length = 0;
    return ok();
  }
  const count = ctx.args[0] ? Number(ctx.args[0]) : ctx.sh.history.length;
  const start = Math.max(0, ctx.sh.history.length - count);
  return ok(joinLines(ctx.sh.history.slice(start).map((line, index) => `${String(start + index + 1).padStart(5)}  ${line}`)));
}

function alias(ctx: Ctx): Io {
  if (!ctx.args.length) return ok(joinLines([...ctx.sh.aliases].sort().map(([name, value]) => `alias ${name}='${value}'`)));
  let err = "";
  let out = "";
  for (const arg of ctx.args) {
    const at = arg.indexOf("=");
    if (at > 0) ctx.sh.aliases.set(arg.slice(0, at), arg.slice(at + 1));
    else if (ctx.sh.aliases.has(arg)) out += `alias ${arg}='${ctx.sh.aliases.get(arg)}'\n`;
    else err += `bash: alias: ${arg}: not found\n`;
  }
  return { out, err, code: err ? 1 : 0 };
}

function unalias(ctx: Ctx): Io {
  let err = "";
  for (const name of ctx.args) if (!ctx.sh.aliases.delete(name)) err += `bash: unalias: ${name}: not found\n`;
  return { out: "", err, code: err ? 1 : 0 };
}

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function exportCommand(ctx: Ctx): Io {
  const args = ctx.args.filter((arg) => arg !== "-p");
  if (!args.length) return ok(joinLines([...ctx.sh.exported].sort().map((name) => `declare -x ${name}="${ctx.sh.vars.get(name) ?? ""}"`)));
  let err = "";
  for (const arg of args) {
    const at = arg.indexOf("=");
    const name = at >= 0 ? arg.slice(0, at) : arg;
    if (!VALID_NAME.test(name)) {
      err += `bash: export: \`${arg}': not a valid identifier\n`;
      continue;
    }
    if (at >= 0) ctx.sh.vars.set(name, arg.slice(at + 1));
    ctx.sh.exported.add(name);
  }
  return { out: "", err, code: err ? 1 : 0 };
}

function unset(ctx: Ctx): Io {
  for (const name of ctx.args) {
    ctx.sh.vars.delete(name);
    ctx.sh.exported.delete(name);
  }
  return ok();
}

function env(ctx: Ctx): Io {
  if (ctx.args.length) return fail("env: 这个终端的 env 只用来列出环境变量；临时改变量请写成 NAME=值 命令");
  return ok(joinLines([...ctx.sh.exported].sort().map((name) => `${name}=${ctx.sh.vars.get(name) ?? ""}`)));
}

function test(ctx: Ctx): Io {
  let args = ctx.args;
  if (ctx.name === "[") {
    if (args[args.length - 1] !== "]") return fail("bash: [: missing `]'", 2);
    args = args.slice(0, -1);
  }
  let negate = false;
  if (args[0] === "!") {
    negate = true;
    args = args.slice(1);
  }
  const node = (path: string) => ctx.fs.get(ctx.fs.resolve(path, ctx.sh.cwd));
  let result: boolean;
  if (args.length === 0) result = false;
  else if (args.length === 1) result = args[0] !== "";
  else if (args.length === 2) {
    const [op, value] = args;
    const target = node(value);
    const unary: Record<string, () => boolean> = {
      "-e": () => !!target,
      "-f": () => target?.type === "file",
      "-d": () => target?.type === "dir",
      "-s": () => target?.type === "file" && target.content.length > 0,
      "-x": () => !!target && (target.mode & 0o111) !== 0,
      "-r": () => !!target && (target.mode & 0o444) !== 0,
      "-w": () => !!target && ctx.fs.writable(ctx.fs.resolve(value, ctx.sh.cwd)),
      "-z": () => value === "",
      "-n": () => value !== "",
    };
    if (!unary[op]) return fail(`bash: ${ctx.name}: ${op}: unary operator expected`, 2);
    result = unary[op]();
  } else if (args.length === 3) {
    const [a, op, b] = args;
    const numeric = ["-eq", "-ne", "-lt", "-le", "-gt", "-ge"].includes(op);
    if (numeric && (!/^-?\d+$/.test(a) || !/^-?\d+$/.test(b))) return fail(`bash: ${ctx.name}: ${/^-?\d+$/.test(a) ? b : a}: integer expression expected`, 2);
    const x = Number(a);
    const y = Number(b);
    const binary: Record<string, boolean> = { "=": a === b, "==": a === b, "!=": a !== b, "-eq": x === y, "-ne": x !== y, "-lt": x < y, "-le": x <= y, "-gt": x > y, "-ge": x >= y };
    if (!(op in binary)) return fail(`bash: ${ctx.name}: ${op}: binary operator expected`, 2);
    result = binary[op];
  } else return fail(`bash: ${ctx.name}: too many arguments`, 2);
  return { out: "", err: "", code: result !== negate ? 0 : 1 };
}

function expr(ctx: Ctx): Io {
  const [a, op, b] = ctx.args;
  if (ctx.args.length !== 3 || !/^-?\d+$/.test(a) || !/^-?\d+$/.test(b)) return fail("expr: syntax error: 这个终端的 expr 只算两个整数，例如 expr 3 + 4", 2);
  const x = Number(a);
  const y = Number(b);
  if ((op === "/" || op === "%") && y === 0) return fail("expr: division by zero", 2);
  const results: Record<string, number> = { "+": x + y, "-": x - y, "*": x * y, "/": Math.trunc(x / y), "%": x % y, "<": +(x < y), ">": +(x > y), "=": +(x === y) };
  if (!(op in results)) return fail(`expr: syntax error: unexpected argument '${op}'`, 2);
  return { out: `${results[op]}\n`, err: "", code: results[op] === 0 ? 1 : 0 };
}

function seq(ctx: Ctx): Io {
  const numbers = ctx.args.map(Number);
  if (!numbers.length || numbers.length > 3 || numbers.some((n) => !Number.isFinite(n))) return fail("seq: missing operand\nTry 'man seq' for more information.");
  const [first, step, last] = numbers.length === 1 ? [1, 1, numbers[0]] : numbers.length === 2 ? [numbers[0], 1, numbers[1]] : numbers;
  if (step === 0) return fail("seq: invalid Zero increment value: '0'");
  const lines: string[] = [];
  for (let n = first; step > 0 ? n <= last : n >= last; n += step) {
    lines.push(String(n));
    if (lines.length >= 10000) break;
  }
  return ok(joinLines(lines));
}

function xargs(ctx: Ctx): Io {
  let size = 0;
  let index = 0;
  for (; index < ctx.args.length && ctx.args[index].startsWith("-"); index += 1) {
    const arg = ctx.args[index];
    if (arg === "-n") size = Number(ctx.args[++index]);
    else if (/^-n\d+$/.test(arg)) size = Number(arg.slice(2));
    else return usageError("xargs", `invalid option -- '${arg.slice(1)}'`);
  }
  const argv = ctx.args.length > index ? ctx.args.slice(index) : ["echo"];
  const words = ctx.stdin.split(/\s+/).filter(Boolean);
  size = size > 0 ? size : words.length || 1;
  const io: Io = { out: "", err: "", code: 0 };
  for (let i = 0; i < Math.max(1, words.length); i += size) {
    const result = ctx.sh.runArgv([...argv, ...words.slice(i, i + size)], "");
    io.out += result.out;
    io.err += result.err;
    io.code = result.code || io.code;
  }
  return io;
}

function tee(ctx: Ctx): Io {
  const { flags, rest } = parseFlags(ctx.args, "a");
  let err = "";
  for (const shown of rest) {
    try {
      ctx.fs.write(ctx.fs.resolve(shown, ctx.sh.cwd), ctx.stdin, flags.has("a"));
    } catch (error) {
      err += `tee: ${fsMessage(error, shown).replace(/^'(.*)': /, "$1: ")}\n`;
    }
  }
  return { out: ctx.stdin, err, code: err ? 1 : 0 };
}

function dateCommand(ctx: Ctx): Io {
  const now = new Date();
  const zone = (() => {
    const offset = -now.getTimezoneOffset() / 60;
    return offset === 8 ? "CST" : `UTC${offset >= 0 ? "+" : ""}${offset}`;
  })();
  const format = ctx.args.find((arg) => arg.startsWith("+"));
  const parts: Record<string, string> = {
    Y: String(now.getFullYear()),
    m: pad(now.getMonth() + 1),
    d: pad(now.getDate()),
    H: pad(now.getHours()),
    M: pad(now.getMinutes()),
    S: pad(now.getSeconds()),
    a: DAYS[now.getDay()],
    b: MONTHS[now.getMonth()],
    Z: zone,
    s: String(Math.floor(now.getTime() / 1000)),
    "%": "%",
  };
  parts.F = `${parts.Y}-${parts.m}-${parts.d}`;
  parts.T = `${parts.H}:${parts.M}:${parts.S}`;
  if (format) return ok(`${format.slice(1).replace(/%([A-Za-z%])/g, (whole, key: string) => parts[key] ?? whole)}\n`);
  return ok(`${parts.a} ${parts.b} ${String(now.getDate()).padStart(2)} ${parts.T} ${zone} ${parts.Y}\n`);
}

function uname(ctx: Ctx): Io {
  const { flags, bad } = parseFlags(ctx.args, "asnrmo");
  if (bad) return usageError("uname", bad);
  const all = flags.has("a");
  const parts: string[] = [];
  if (all || flags.has("s") || !flags.size) parts.push("Linux");
  if (all || flags.has("n")) parts.push(ctx.sh.host);
  if (all || flags.has("r")) parts.push("6.6.0-yugc");
  if (all) parts.push("#1 SMP PREEMPT_DYNAMIC YUGC OS 2.0");
  if (all || flags.has("m")) parts.push("x86_64");
  if (all || flags.has("o")) parts.push("GNU/Linux");
  return ok(`${parts.join(" ")}\n`);
}

/** 用户组：注册用户、成员、往届成员各一个组，部门再一个组（取账号的部门编号） */
function groupsOf(sh: ShellApi): Array<[number, string]> {
  const groups: Array<[number, string]> = [[1000, sh.user]];
  const level = sh.account?.level;
  if (level) groups.push([level === "member" ? 1001 : level === "alumni" ? 1002 : 1003, level === "member" ? "members" : level === "alumni" ? "alumni" : "registered"]);
  else groups.push([1004, "visitors"]);
  if (sh.account?.department) groups.push([1100, sh.account.department.id.replace(/[^a-z0-9_-]/gi, "")]);
  return groups;
}

function id(ctx: Ctx): Io {
  const groups = groupsOf(ctx.sh);
  return ok(`uid=1000(${ctx.sh.user}) gid=1000(${ctx.sh.user}) groups=${groups.map(([gid, name]) => `${gid}(${name})`).join(",")}\n`);
}

function uptime(ctx: Ctx): Io {
  const now = new Date();
  const minutes = Math.max(0, Math.floor((Date.now() - ctx.sh.startedAt) / 60000));
  const up = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
  return ok(` ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} up ${up},  1 user,  load average: 0.08, 0.03, 0.01\n`);
}

function ps(ctx: Ctx): Io {
  const rows: Array<[string, number, string]> = [
    ["root", 1, "/sbin/init"],
    ["root", 2, "yugc-desktop --wallpaper 晴空"],
    [ctx.sh.user, ctx.sh.pid, "-bash"],
    [ctx.sh.user, ctx.sh.pid + 1, `ps ${ctx.args.join(" ")}`.trim()],
  ];
  if (ctx.args.some((arg) => arg.includes("a") || arg.includes("u") || arg.includes("x") || arg === "-e" || arg === "-ef"))
    return ok(joinLines(["USER         PID %CPU %MEM COMMAND", ...rows.map(([user, pid, command]) => `${user.padEnd(10)} ${String(pid).padStart(5)}  0.0  0.1 ${command}`)]));
  return ok(joinLines(["    PID TTY          TIME CMD", ...rows.slice(2).map(([, pid, command]) => `${String(pid).padStart(7)} pts/0    00:00:00 ${command.split(" ")[0].replace(/^-/, "")}`)]));
}

function kill(ctx: Ctx): Io {
  const pids = ctx.args.filter((arg) => !arg.startsWith("-"));
  if (!pids.length) return fail("kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]", 2);
  let err = "";
  for (const value of pids) {
    const pid = Number(value);
    if (pid === ctx.sh.pid) ctx.sh.exit(137);
    else if (pid === 1 || pid === 2) err += `bash: kill: (${pid}) - Operation not permitted\n`;
    else err += `bash: kill: (${value}) - No such process\n`;
  }
  return { out: "", err, code: err ? 1 : 0 };
}

const LOGO = [
  [" __   __", " _   _ ", "  ____ ", "  ____ "],
  [" \\ \\ / /", "| | | |", " / ___|", " / ___|"],
  ["  \\ V / ", "| | | |", "| |  _ ", "| |    "],
  ["   | |  ", "| |_| |", "| |_| |", "| |___ "],
  ["   |_|  ", " \\___/ ", " \\____|", " \\____|"],
];
const LOGO_COLORS = ["\x1b[92m", "\x1b[94m", "\x1b[95m", "\x1b[96m"];

function neofetch(ctx: Ctx): Io {
  const account = ctx.sh.account;
  const minutes = Math.max(0, Math.floor((Date.now() - ctx.sh.startedAt) / 60000));
  const info = [
    `${paint(true, C.exec, ctx.sh.user)}@${paint(true, C.exec, ctx.sh.host)}`,
    "-".repeat(ctx.sh.user.length + ctx.sh.host.length + 1),
    `${paint(true, C.key, "OS")}: YUGC OS 2.0 x86_64`,
    `${paint(true, C.key, "Kernel")}: 6.6.0-yugc`,
    `${paint(true, C.key, "Uptime")}: ${minutes} mins`,
    `${paint(true, C.key, "Shell")}: bash 5.2`,
    `${paint(true, C.key, "Theme")}: 晴空`,
    `${paint(true, C.key, "身份")}: ${account?.levelName ?? (account ? "已登录" : "访客")}`,
  ];
  if (account?.department) info.push(`${paint(true, C.key, "部门")}: ${account.department.name}`);
  if (account?.titles.length) info.push(`${paint(true, C.key, "称号")}: ${account.titles.map((title) => title.name).join("、")}`);
  const rows = Math.max(LOGO.length, info.length);
  const lines: string[] = [];
  for (let i = 0; i < rows; i += 1) {
    const art = LOGO[i] ? LOGO[i].map((part, letter) => paint(ctx.tty, LOGO_COLORS[letter], part)).join("") : " ".repeat(29);
    lines.push(`${art}   ${ctx.tty ? (info[i] ?? "") : (info[i] ?? "").replace(/\x1b\[[0-9;]*m/g, "")}`.trimEnd());
  }
  return ok(joinLines(lines));
}

const MODULES: Array<[string, string]> = [
  ["你好，黑客", "echo、命令和参数、history"],
  ["探索路径", "pwd、cd、绝对路径和相对路径、~"],
  ["理解命令", "ls -a、cat、cp、mv、rm、mkdir、touch、隐藏文件"],
  ["研读文档", "man、help、--help"],
  ["文件通配符", "*、?、[abc]"],
  ["管道与重定向", "|、>、>>、<、2>、2>&1、tee"],
  ["Shell 变量", "NAME=值、$NAME、export、env、$?"],
  ["数据处理", "grep、sort、uniq、wc、head、tail、cut、tr、sed"],
  ["进程与作业", "ps、kill"],
  ["用户与身份", "whoami、id、sudo"],
  ["洞察权限", "ls -l、chmod、Permission denied"],
  ["命令串联与脚本", "&&、||、;、chmod +x 后 ./脚本、source"],
  ["深入 PATH", "which、type、PATH、把脚本放进 ~/bin"],
];

export const LEARN_TEXT = joinLines([
  "Linux 启明道场（Linux Luminarium）",
  `${LEARN_URL}`,
  "从零教 Linux 命令行，一关一个小挑战，在隔离的沙箱里做。这个终端可以先用来练手，下面每一关的命令这里都能敲：",
  "",
  ...MODULES.map(([name, commands]) => `  ${name.padEnd(8, "　")}${commands}`),
]);

function learn(): Io {
  return ok(LEARN_TEXT);
}

function open(ctx: Ctx): Io {
  if (!ctx.args.length) return fail("open: 要打开哪个应用？例如 open forum，ls ~/Desktop 列出全部");
  let err = "";
  for (const arg of ctx.args) {
    const id = basename(arg).replace(/\.app$/, "");
    const app = ctx.sh.apps.find((candidate) => candidate.id === id);
    if (app) ctx.sh.open(app.id);
    else err += `open: 没有叫 ${arg} 的应用，ls ~/Desktop 看看有哪些\n`;
  }
  return { out: "", err, code: err ? 1 : 0 };
}

function repos(ctx: Ctx): Io {
  if (!ctx.sh.repos.length) return ok(`${paint(ctx.tty, C.dim, "代码仓库里还没有公开项目")}\n`);
  return ok(joinLines(ctx.sh.repos.map((repo) => `${paint(ctx.tty, C.key, repo.path.padEnd(24))} ${repo.description || repo.url}${repo.description ? `  ${repo.url}` : ""}`)));
}

function sudo(ctx: Ctx): Io {
  if (!ctx.args.length) return fail("usage: sudo -h | -K | -k | -V\nusage: sudo [-u user] command");
  return fail(`[sudo] password for ${ctx.sh.user}: \n${ctx.sh.user} is not in the sudoers file.`);
}

const unavailable =
  (reason: string): CommandSpec["run"] =>
  (ctx) =>
    fail(`${ctx.name}: ${reason}`, 127);

const offline = unavailable("这个终端不联网，也装不了软件。代码在「代码仓库」里：open gitlab");
const fullscreen = unavailable("这个终端没有全屏程序。写文件用 echo 和重定向，例如 echo hello > a.txt，追加用 >>");

function manText(name: string, spec: CommandSpec): string {
  const lines = [`${name} - ${spec.summary}`, "", `用法：${spec.usage}`];
  if (spec.options?.length) lines.push("", ...spec.options.map(([flag, text]) => `  ${flag.padEnd(10)}${text}`));
  if (spec.example) lines.push("", "例子：", ...spec.example.split("\n").map((line) => `  ${line}`));
  return joinLines(lines);
}

function man(ctx: Ctx): Io {
  const name = ctx.args.find((arg) => !arg.startsWith("-"));
  if (!name) return fail("What manual page do you want?\nFor example, try 'man man'.");
  const spec = COMMANDS[name];
  if (!spec) return fail(`No manual entry for ${name}`, 16);
  return ok(manText(name, spec));
}

function help(ctx: Ctx): Io {
  const topics = new Map<Topic, string[]>();
  for (const [name, spec] of Object.entries(COMMANDS)) {
    if (spec.run === offline || spec.run === fullscreen || name === "[" || name === ".") continue;
    topics.set(spec.topic, [...(topics.get(spec.topic) ?? []), name]);
  }
  const lines = [
    "这是一台模拟的 Linux：命令、管道、重定向、变量和脚本都能用，家目录里的文件存在这台浏览器里。",
    "",
    ...[...topics].flatMap(([topic, names]) => [`${paint(ctx.tty, C.key, topic)}`, `  ${names.join("  ")}`]),
    "",
    "man <命令> 看用法和选项。想系统地学，输入 learn，或打开 Linux 启明道场：",
    LEARN_URL,
  ];
  return ok(joinLines(lines));
}

function sh(ctx: Ctx): Io {
  const [script, ...args] = ctx.args;
  if (!script) return fail(`${ctx.name}: 这个终端里 ${ctx.name} 只用来运行脚本文件：${ctx.name} 脚本.sh`);
  return ctx.sh.runScript(ctx.fs.resolve(script, ctx.sh.cwd), args, ctx.stdin, false);
}

function source(ctx: Ctx): Io {
  const [script, ...args] = ctx.args;
  if (!script) return fail(`bash: ${ctx.name}: filename argument required`, 2);
  return ctx.sh.runScript(ctx.fs.resolve(script, ctx.sh.cwd), args, ctx.stdin, true);
}

const control = (ctx: Ctx) => fail(`bash: ${ctx.name}: 这个终端不支持 if、for、while 这类控制结构，用 && 和 || 把命令串起来`, 2);

const F = "路径与文件" as const;
const T = "查看与处理文本" as const;
const V = "变量与 shell" as const;
const S = "用户、权限与系统" as const;
const D = "桌面" as const;

export const COMMANDS: Record<string, CommandSpec> = {
  pwd: { run: (ctx) => ok(`${ctx.sh.cwd}\n`), usage: "pwd", summary: "显示当前所在的目录", builtin: true, topic: F },
  cd: { run: cd, usage: "cd [目录]", summary: "进入目录；不带参数回家目录，cd - 回上一个目录", builtin: true, topic: F, example: "cd ~/Desktop\ncd ..\ncd -" },
  ls: {
    run: ls,
    usage: "ls [-alAh1dFR] [路径...]",
    summary: "列出目录内容",
    topic: F,
    options: [
      ["-a", "连以 . 开头的隐藏文件一起列，包括 . 和 .."],
      ["-A", "列隐藏文件，不列 . 和 .."],
      ["-l", "长格式：权限、所有者、大小、修改时间"],
      ["-h", "配合 -l，大小写成 1.2K 这样"],
      ["-1", "一行一个"],
      ["-d", "列目录本身，不列里面"],
      ["-F", "目录名后面加 /"],
      ["-R", "递归列出子目录"],
    ],
    example: "ls -la ~\nls ~/Desktop",
  },
  tree: { run: tree, usage: "tree [-ad] [-L 层数] [目录...]", summary: "用树形列出目录", topic: F, options: [["-a", "包括隐藏文件"], ["-d", "只列目录"], ["-L N", "最多 N 层"]] },
  cat: { run: cat, usage: "cat [-n] [文件...]", summary: "把文件内容打印出来；不带文件时读标准输入", topic: T, options: [["-n", "每行前面加行号"]], example: "cat README.md\ncat -n ~/.bashrc" },
  mkdir: { run: mkdir, usage: "mkdir [-p] 目录...", summary: "新建目录", topic: F, options: [["-p", "中间缺的目录一起建，已经有了也不报错"]], example: "mkdir -p notes/2026" },
  touch: { run: touch, usage: "touch 文件...", summary: "新建空文件；文件已存在时只更新修改时间", topic: F },
  rm: { run: rm, usage: "rm [-rf] 路径...", summary: "删除文件或目录", topic: F, options: [["-r", "删除目录和里面的全部内容"], ["-f", "文件不存在也不报错"]], example: "rm a.txt\nrm -r old" },
  rmdir: { run: rmdir, usage: "rmdir 目录...", summary: "删除空目录", topic: F },
  cp: { run: (ctx) => copyOrMove(ctx, false), usage: "cp [-r] 源... 目标", summary: "复制文件或目录", topic: F, options: [["-r", "复制目录"]], example: "cp README.md notes.md\ncp -r notes backup" },
  mv: { run: (ctx) => copyOrMove(ctx, true), usage: "mv 源... 目标", summary: "移动或改名", topic: F, example: "mv a.txt b.txt\nmv b.txt notes/" },
  find: { run: find, usage: "find [起点...] [-name 模式] [-iname 模式] [-type f|d] [-maxdepth N]", summary: "按名字或类型找文件", topic: F, example: 'find ~ -name "*.md"\nfind . -type d' },
  file: { run: fileCommand, usage: "file 路径...", summary: "看一个文件是什么类型", topic: F },
  stat: { run: stat, usage: "stat 路径...", summary: "显示文件的大小、权限和修改时间", topic: F },
  du: { run: du, usage: "du [-sh] [路径...]", summary: "统计占用的空间", topic: F },
  df: { run: df, usage: "df [-h]", summary: "家目录还剩多少空间（存在浏览器里，一共约 100K）", topic: F },
  chmod: { run: chmod, usage: "chmod 权限 文件...", summary: "改文件权限", topic: S, options: [["755", "八进制写法：所有者读写执行，其他人读和执行"], ["+x", "加上执行权限"], ["u-w", "去掉所有者的写权限"]], example: "chmod +x hello.sh\nchmod 600 secret.txt" },
  chown: { run: (ctx) => fail(`chown: changing ownership of '${ctx.args[ctx.args.length - 1] ?? ""}': Operation not permitted`), usage: "chown 用户 文件", summary: "改文件所有者（普通用户做不了）", topic: S },
  ln: { run: () => fail("ln: failed to create link: Operation not supported"), usage: "ln [-s] 目标 链接名", summary: "建链接（这个文件系统不支持）", topic: F },
  echo: { run: echo, usage: "echo [-ne] [文字...]", summary: "把参数打印出来", builtin: true, topic: T, options: [["-n", "末尾不换行"], ["-e", "认 \\n、\\t 这些转义"]], example: 'echo "hello $USER"\necho hi > a.txt' },
  printf: { run: printf, usage: "printf 格式 [参数...]", summary: "按格式打印，支持 %s %d %f 和 \\n", builtin: true, topic: T, example: 'printf "%s 有 %d 个文件\\n" docs 3' },
  head: { run: (ctx) => headTail(ctx, false), usage: "head [-n 行数] [文件...]", summary: "看开头几行，默认 10 行", topic: T, example: "head -n 3 /var/log/yugc.log" },
  tail: { run: (ctx) => headTail(ctx, true), usage: "tail [-n 行数|+行号] [文件...]", summary: "看最后几行，默认 10 行", topic: T, example: "tail -n 2 /var/log/yugc.log" },
  wc: { run: wc, usage: "wc [-lwc] [文件...]", summary: "数行数、词数、字节数", topic: T, options: [["-l", "只数行"], ["-w", "只数词"], ["-c", "只数字节"]], example: "ls ~/Desktop | wc -l" },
  grep: {
    run: grep,
    usage: "grep [-ivncrlEFow] 模式 [文件...]",
    summary: "找出含有某个模式的行",
    topic: T,
    options: [
      ["-i", "不分大小写"],
      ["-v", "反过来，找不含的行"],
      ["-n", "带行号"],
      ["-c", "只数有多少行"],
      ["-r", "在目录里递归找"],
      ["-l", "只列出匹配的文件名"],
      ["-o", "只打印匹配到的部分"],
      ["-E", "扩展正则"],
      ["-F", "按字面找，不当正则"],
    ],
    example: "grep -n open /var/log/yugc.log\ngrep -ri linux ~",
  },
  sort: { run: sort, usage: "sort [-rnufb] [-t 分隔符] [-k 列] [文件...]", summary: "按行排序", topic: T, options: [["-r", "倒序"], ["-n", "按数字大小"], ["-u", "去掉重复行"], ["-k N", "按第 N 列排"]] },
  uniq: { run: uniq, usage: "uniq [-cdu] [文件]", summary: "合并相邻的重复行，通常接在 sort 后面", topic: T, options: [["-c", "前面写出现次数"], ["-d", "只列重复过的"], ["-u", "只列没重复的"]], example: "cut -d' ' -f3 /var/log/yugc.log | sort | uniq -c" },
  cut: { run: cut, usage: "cut -d 分隔符 -f 列表 [文件...]", summary: "按列切出一部分", topic: T, example: "cut -d: -f1 /etc/passwd" },
  tr: { run: tr, usage: "tr [-ds] 字符集1 [字符集2]", summary: "替换或删掉字符，只读标准输入", topic: T, example: "echo hello | tr a-z A-Z" },
  sed: { run: sed, usage: "sed 's/找/换/[g]' [文件...]", summary: "按正则替换（这里支持 s 替换、Np 打印、Nd 删除）", topic: T, example: "echo 2025 | sed 's/5/6/'" },
  rev: { run: (ctx) => ok(joinLines(linesOf(inputs(ctx, ctx.args).texts.map((entry) => entry.text).join("")).map((line) => [...line].reverse().join("")))), usage: "rev [文件...]", summary: "把每一行倒过来", topic: T },
  tac: { run: (ctx) => ok(joinLines(linesOf(inputs(ctx, ctx.args).texts.map((entry) => entry.text).join("")).reverse())), usage: "tac [文件...]", summary: "倒序打印行", topic: T },
  less: { run: cat, usage: "less 文件", summary: "看文件（这里直接打印全文）", topic: T },
  more: { run: cat, usage: "more 文件", summary: "看文件（这里直接打印全文）", topic: T },
  tee: { run: tee, usage: "tee [-a] 文件...", summary: "把标准输入同时写进文件和屏幕", topic: T, options: [["-a", "追加，不覆盖"]], example: "ls | tee list.txt" },
  seq: { run: seq, usage: "seq [起点 [步长]] 终点", summary: "打印一串数字", topic: T, example: "seq 5\nseq 1 2 9" },
  xargs: { run: xargs, usage: "xargs [-n N] [命令 [参数...]]", summary: "把标准输入里的词当参数交给命令", topic: T, example: 'find ~ -name "*.md" | xargs wc -l' },
  basename: { run: (ctx) => (ctx.args[0] ? ok(`${basename(ctx.args[0]).replace(new RegExp(`${(ctx.args[1] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "")}\n`) : fail("basename: missing operand")), usage: "basename 路径 [后缀]", summary: "取路径最后一段", topic: F },
  dirname: { run: (ctx) => (ctx.args[0] ? ok(`${dirname(ctx.args[0])}\n`) : fail("dirname: missing operand")), usage: "dirname 路径", summary: "去掉路径最后一段", topic: F },
  expr: { run: expr, usage: "expr 整数 运算符 整数", summary: "算两个整数（+ - * / %），也可以用 $((1 + 2))", topic: V },
  test: { run: test, usage: "test 表达式", summary: "判断文件或字符串，结果放在 $? 里", builtin: true, topic: V, example: "test -f README.md && echo 有\n[ -d ~/Desktop ] && echo 是目录" },
  "[": { run: test, usage: "[ 表达式 ]", summary: "和 test 一样，最后要写 ]", builtin: true, topic: V },
  export: { run: exportCommand, usage: "export NAME=值", summary: "设置环境变量，让子进程也能看到", builtin: true, topic: V, example: "export GREETING=hi\necho $GREETING" },
  unset: { run: unset, usage: "unset NAME...", summary: "删掉变量", builtin: true, topic: V },
  env: { run: env, usage: "env", summary: "列出环境变量", topic: V },
  alias: { run: alias, usage: "alias [名字='命令']", summary: "给命令起个短名字；写进 ~/.bashrc 下次还在", builtin: true, topic: V, example: "alias ll='ls -la'\necho \"alias gs='git status'\" >> ~/.bashrc" },
  unalias: { run: unalias, usage: "unalias 名字...", summary: "删掉别名", builtin: true, topic: V },
  history: { run: history, usage: "history [N] | history -c", summary: "看敲过的命令（存在 ~/.bash_history），!! 重复上一条", builtin: true, topic: V },
  type: { run: type, usage: "type 名字...", summary: "看一个名字是别名、shell 内置命令还是程序", builtin: true, topic: V },
  which: { run: which, usage: "which 命令...", summary: "在 PATH 里找命令装在哪", topic: V },
  source: { run: source, usage: "source 文件", summary: "在当前 shell 里执行脚本，里面改的变量和目录会留下", builtin: true, topic: V, example: "source ~/.bashrc" },
  ".": { run: source, usage: ". 文件", summary: "和 source 一样", builtin: true, topic: V },
  bash: { run: sh, usage: "bash 脚本 [参数...]", summary: "在子 shell 里运行脚本", topic: V, example: "echo 'echo hi $1' > hi.sh\nbash hi.sh 同学" },
  sh: { run: sh, usage: "sh 脚本 [参数...]", summary: "和 bash 一样", topic: V },
  true: { run: () => ok(), usage: "true", summary: "什么也不做，返回 0", builtin: true, topic: V },
  false: { run: () => ({ out: "", err: "", code: 1 }), usage: "false", summary: "什么也不做，返回 1", builtin: true, topic: V },
  sleep: { run: (ctx) => (ctx.args[0] && Number.isFinite(Number(ctx.args[0])) ? ok() : fail("sleep: missing operand")), usage: "sleep 秒数", summary: "这里不会真的等，直接返回", topic: V },
  clear: { run: (ctx) => (ctx.sh.clear(), ok()), usage: "clear", summary: "清屏，也可以按 Ctrl+L", topic: V },
  reset: { run: (ctx) => (ctx.sh.clear(), ok()), usage: "reset", summary: "清屏", topic: V },
  exit: { run: (ctx) => (ctx.sh.exit(Number(ctx.args[0] ?? 0) || 0), ok()), usage: "exit [代码]", summary: "关掉终端窗口；在脚本里是结束脚本", builtin: true, topic: V },
  logout: { run: (ctx) => (ctx.sh.exit(0), ok()), usage: "logout", summary: "关掉终端窗口", builtin: true, topic: V },
  man: { run: man, usage: "man 命令", summary: "看命令的用法", topic: V, example: "man ls" },
  help: { run: help, usage: "help", summary: "列出这个终端能用的命令", builtin: true, topic: V },
  whoami: { run: (ctx) => ok(`${ctx.sh.user}\n`), usage: "whoami", summary: "显示当前用户名（登录后是你的极客班用户名）", topic: S },
  id: { run: id, usage: "id", summary: "显示用户编号和所在的组（身份和部门各是一个组）", topic: S },
  groups: { run: (ctx) => ok(`${groupsOf(ctx.sh).map(([, name]) => name).join(" ")}\n`), usage: "groups", summary: "显示所在的组", topic: S },
  hostname: { run: (ctx) => ok(`${ctx.sh.host}\n`), usage: "hostname", summary: "显示主机名", topic: S },
  uname: { run: uname, usage: "uname [-asnrmo]", summary: "显示系统信息", topic: S, options: [["-a", "全部"], ["-r", "内核版本"], ["-m", "硬件架构"]] },
  date: { run: dateCommand, usage: "date [+格式]", summary: "显示时间，格式里可以用 %Y %m %d %H %M %S %F %T", topic: S, example: "date +%F" },
  uptime: { run: uptime, usage: "uptime", summary: "这次打开官网过了多久", topic: S },
  ps: { run: ps, usage: "ps [aux]", summary: "列出进程", topic: S },
  kill: { run: kill, usage: "kill PID", summary: "结束进程；kill $$ 会关掉这个终端", builtin: true, topic: S },
  sudo: { run: sudo, usage: "sudo 命令", summary: "用管理员身份运行（你不在 sudoers 里）", topic: S },
  su: { run: () => fail("su: Authentication failure"), usage: "su [用户]", summary: "切换用户（需要对方的密码）", topic: S },
  passwd: { run: () => fail("passwd: 这台机器上的账号就是你的极客班账号，密码在资料卡和账号页改"), usage: "passwd", summary: "改密码", topic: S },
  neofetch: { run: neofetch, usage: "neofetch", summary: "显示系统和你的身份信息", topic: D },
  open: { run: open, usage: "open 应用...", summary: "打开桌面应用；也可以直接运行 ~/Desktop 里的 .app", topic: D, example: "open forum\n./Desktop/competitions.app" },
  repos: { run: repos, usage: "repos", summary: "列出代码仓库里的公开项目，~/projects 里也有", topic: D },
  learn: { run: learn, usage: "learn", summary: "Linux 启明道场的课程，以及每一关在这里练哪些命令", topic: D },
  if: { run: control, usage: "if", summary: "控制结构（不支持）", builtin: true, topic: V },
  for: { run: control, usage: "for", summary: "控制结构（不支持）", builtin: true, topic: V },
  while: { run: control, usage: "while", summary: "控制结构（不支持）", builtin: true, topic: V },
  vim: { run: fullscreen, usage: "vim", summary: "编辑器（没有）", topic: T },
  vi: { run: fullscreen, usage: "vi", summary: "编辑器（没有）", topic: T },
  nano: { run: fullscreen, usage: "nano", summary: "编辑器（没有）", topic: T },
  emacs: { run: fullscreen, usage: "emacs", summary: "编辑器（没有）", topic: T },
  top: { run: fullscreen, usage: "top", summary: "全屏程序（没有）", topic: S },
  htop: { run: fullscreen, usage: "htop", summary: "全屏程序（没有）", topic: S },
  curl: { run: offline, usage: "curl", summary: "联网（没有）", topic: S },
  wget: { run: offline, usage: "wget", summary: "联网（没有）", topic: S },
  ping: { run: offline, usage: "ping", summary: "联网（没有）", topic: S },
  ssh: { run: offline, usage: "ssh", summary: "联网（没有）", topic: S },
  git: { run: offline, usage: "git", summary: "版本控制（去代码仓库窗口）", topic: S },
  apt: { run: offline, usage: "apt", summary: "装软件（没有）", topic: S },
  python3: { run: offline, usage: "python3", summary: "Python（没有）", topic: S },
  node: { run: offline, usage: "node", summary: "Node.js（没有）", topic: S },
};

/** 装在 /usr/bin 的命令（不是 shell 内置的） */
export const EXTERNAL = Object.keys(COMMANDS).filter((name) => !COMMANDS[name].builtin && COMMANDS[name].run !== offline && COMMANDS[name].run !== fullscreen);
