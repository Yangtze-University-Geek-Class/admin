import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export type Evidence = { path: string; line: number };

export function sourceReader(root: string) {
  const inputs = new Map<string, string>();
  const files = new Map<string, string>();
  function read(path: string) {
    const absolute = resolve(root, path);
    const inside = relative(realpathSync(root), realpathSync(absolute));
    if (inside.startsWith(`..${sep}`) || inside === ".." || isAbsolute(inside)) throw new Error(`源码路径越界：${path}`);
    const normalized = relative(root, absolute).split(sep).join("/");
    if ([normalized, inside.split(sep).join("/")].some(name => /(^|\/)\.env(?:\.|$)/.test(name))) throw new Error(`目录不得读取环境文件：${normalized}`);
    if (!files.has(normalized)) {
      const text = readFileSync(absolute, "utf8").replaceAll("\r\n", "\n");
      files.set(normalized, text);
      inputs.set(normalized, createHash("sha256").update(text).digest("hex"));
    }
    return files.get(normalized)!;
  }
  function evidence(path: string, needle: string): Evidence {
    const text = read(path);
    const start = text.indexOf(needle);
    if (!needle || start < 0) throw new Error(`证据锚点不存在：${path} ${needle}`);
    if (text.indexOf(needle, start + needle.length) >= 0) throw new Error(`证据锚点不唯一：${path} ${needle}`);
    return { path, line: text.slice(0, start).split("\n").length };
  }
  return {
    read,
    evidence,
    provenance() {
      const sources = [...inputs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, sha256]) => ({ path, sha256 }));
      return { basis: "source-and-isolated-runtime" as const, fingerprint: createHash("sha256").update(JSON.stringify(sources)).digest("hex"), sources };
    },
  };
}

export function registrationSource(root: string, stack: string): Evidence & { column: number } {
  for (const line of stack.replaceAll("\\", "/").split("\n")) {
    const match = /((?:file:\/\/)?(?:[A-Za-z]:)?\/[^()\n]+\/app\/server\/src\/[^()\n]+\.ts):(\d+):(\d+)/.exec(line);
    if (!match) continue;
    const absolute = match[1].startsWith("file:") ? fileURLToPath(match[1]) : match[1];
    const path = relative(root, absolute).split(sep).join("/");
    if (path.startsWith("app/server/src/")) return { path, line: Number(match[2]), column: Number(match[3]) };
  }
  throw new Error("路由注册没有可追溯的 TypeScript 源码位置；请通过项目的 tsx 命令运行");
}

const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "route", "all"]);

/** 注册栈给出实际执行位置，AST 只解释这个位置，不靠正则猜测路由总数。 */
export function registrationDetails(text: string, source: Evidence & { column: number }) {
  const file = ts.createSourceFile(source.path, text, ts.ScriptTarget.Latest, true);
  const point = file.getPositionOfLineAndCharacter(source.line - 1, source.column - 1);
  const candidates: ts.CallExpression[] = [];
  const authHooks: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (methods.has(node.expression.name.text) && node.getStart(file) <= point && point <= node.getEnd()) candidates.push(node);
      const hookName = node.arguments[0];
      if (node.expression.name.text === "addHook" && hookName && ts.isStringLiteral(hookName) && hookName.text === "preHandler"
        && node.arguments[1]?.getText(file) === "requireAuth") authHooks.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  const call = candidates.sort((a, b) => (a.getEnd() - a.getStart(file)) - (b.getEnd() - b.getStart(file)))[0];
  if (!call || !ts.isPropertyAccessExpression(call.expression)) throw new Error(`无法解释路由注册：${source.path}:${source.line}`);
  const method = call.expression.name.text;
  let declaredMethods: string[] = [];
  if (method === "route") {
    const options = call.arguments[0];
    if (options && ts.isObjectLiteralExpression(options)) {
      const property = options.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(file) === "method");
      if (property && ts.isPropertyAssignment(property)) {
        const values = ts.isArrayLiteralExpression(property.initializer) ? property.initializer.elements : [property.initializer];
        declaredMethods = [...values].filter(ts.isStringLiteral).map(value => value.text);
      }
    }
  } else if (method !== "all") declaredMethods = [method.toUpperCase()];
  const scopes = new Set<ts.Node>();
  for (let node: ts.Node | undefined = call.parent; node; node = node.parent) {
    if (ts.isFunctionLike(node)) scopes.add(node);
  }
  const checks = new Set<string>();
  for (const hook of authHooks) {
    let scope: ts.Node | undefined = hook.parent;
    while (scope && !ts.isFunctionLike(scope)) scope = scope.parent;
    if (scope && scopes.has(scope)) checks.add("requireAuth");
  }
  const capabilityGroups: string[][] = [];
  const checkNames = new Set(["requireCapability", "requireOrgRole", "requireMember", "forumViewer", "can", "checkOrigin"]);
  function checksIn(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && checkNames.has(node.expression.text)) {
      checks.add(`${node.expression.text}(${node.arguments.map(a => a.getText(file)).join(", ")})`);
      if (node.expression.text === "requireCapability" && node.arguments.every(ts.isStringLiteral)) {
        capabilityGroups.push(node.arguments.map(a => (a as ts.StringLiteral).text));
      }
    }
    ts.forEachChild(node, checksIn);
  }
  checksIn(call);
  return {
    declaredMethods,
    authorization: {
      assessment: "partial-static-evidence" as const,
      checks: [...checks].sort(),
      capabilityGroups,
      note: "仅列注册作用域和 handler 中可定位的检查；条件、对象归属及间接调用仍以实现和权限测试为准，不等于完整授权策略。",
    },
  };
}

export function canonical(value: unknown): unknown {
  if (typeof value === "string") return value.replaceAll("\r\n", "\n");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  }
  throw new Error(`目录包含不可序列化的值：${typeof value}`);
}

export function serialize(value: unknown) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}
