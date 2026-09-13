#!/usr/bin/env node
import ts from "typescript";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith(".") || ["node_modules", "dist", "coverage"].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : /\.(?:tsx?|m?js)$/.test(entry.name) ? [path] : [];
  });
}
export function specifiers(source, filename = "source.ts") {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const result = [];
  const add = node => {
    if (node && ts.isStringLiteralLike(node)) result.push({ spec: node.text, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
    else if (node) result.push({ spec: null, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
  };
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}
export function domainOf(path, root = ROOT) {
  const name = relative(root, path).split(sep).join("/");
  const web = name.match(/^web\/sites\/([^/]+)\//);
  if (web) return { layer: "web", kind: "site", name: web[1] };
  if (name.startsWith("web/shared/")) return { layer: "web", kind: "shared", name: "shared" };
  const server = name.match(/^server\/src\/routes\/([^/]+)\//);
  if (server) return { layer: "server", kind: "route", name: server[1] };
  if (/^server\/src\/(lib|middleware)\//.test(name)) return { layer: "server", kind: "infrastructure", name: "shared" };
  if (name.startsWith("server/src/")) return { layer: "server", kind: "composition", name: "server" };
  return null;
}
function compilerOptions(file, root) {
  const configPath = join(root, relative(root, file).split(sep).join("/").startsWith("web/") ? "web/tsconfig.json" : "server/tsconfig.json");
  if (!existsSync(configPath)) return { moduleResolution: ts.ModuleResolutionKind.Bundler };
  const source = ts.readConfigFile(configPath, ts.sys.readFile);
  if (source.error) throw new Error(`Cannot read module configuration: ${relative(root, configPath)}`);
  const parsed = ts.parseJsonConfigFileContent(source.config, ts.sys, dirname(configPath));
  // Missing inputs in a synthetic test workspace are not configuration errors.
  if (parsed.errors.some(error => error.code !== 18003)) throw new Error(`Invalid module configuration: ${relative(root, configPath)}`);
  return parsed.options;
}
function isLocalSpecifier(spec, options) {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@shared/")) return true;
  return Object.keys(options.paths ?? {}).some(pattern => {
    const star = pattern.indexOf("*");
    return star === -1 ? spec === pattern : spec.startsWith(pattern.slice(0, star)) && spec.endsWith(pattern.slice(star + 1));
  });
}
export function resolveSpec(file, spec, root = ROOT, options = compilerOptions(file, root)) {
  const resolved = ts.resolveModuleName(spec, file, options, ts.sys).resolvedModule?.resolvedFileName;
  if (resolved) return resolve(resolved);
  const base = spec.startsWith("@shared/") ? join(root, "web/shared", spec.slice(8)) : spec.startsWith(".") ? resolve(dirname(file), spec) : null;
  if (!base) return null;
  const clean = base.split("?")[0];
  const candidates = [clean, clean.replace(/\.js$/, ".ts"), clean.replace(/\.js$/, ".tsx"), `${clean}.ts`, `${clean}.tsx`, join(clean,"index.ts"), join(clean,"index.tsx")];
  return candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}
export function checkProject(root = ROOT) {
  const files = ["web/sites", "web/shared", "server/src"].flatMap(dir => walk(join(root,dir)));
  const violations = [];
  let imports = 0;
  for (const file of files) {
    const from = domainOf(file,root);
    if (!from) continue;
    const options = compilerOptions(file, root);
    for (const item of specifiers(readFileSync(file,"utf8"),file)) {
      imports++;
      const at = `${relative(root,file)}:${item.line}`;
      if (item.spec === null) { violations.push(`${at}: nonliteral module import requires a static module map`); continue; }
      const local = isLocalSpecifier(item.spec, options);
      const target = resolveSpec(file,item.spec,root,options);
      if (!target) { if (local) violations.push(`${at}: unresolved local import ${item.spec}`); continue; }
      if (target.split(sep).includes("node_modules")) continue;
      if (relative(root,target).startsWith("..")) { if (local) violations.push(`${at}: local import escapes repository`); continue; }
      const to = domainOf(target,root);
      if (!to) continue;
      if (from.layer !== to.layer) violations.push(`${at}: frontend/backend implementation import is forbidden`);
      if (from.kind === "site" && to.kind === "site" && from.name !== to.name) violations.push(`${at}: cross-site dependency ${from.name} -> ${to.name}`);
      if (from.kind === "shared" && to.kind === "site") violations.push(`${at}: shared depends on site ${to.name}`);
      if (from.kind === "route" && to.kind === "route" && from.name !== to.name) violations.push(`${at}: cross-module route dependency ${from.name} -> ${to.name}`);
      if (relative(root, file).split(sep).join("/").startsWith("server/src/lib/") && relative(root, target).split(sep).join("/").startsWith("server/src/middleware/")) violations.push(`${at}: identity/storage adapters depend on HTTP middleware`);
      if (from.kind === "infrastructure" && ["route","composition"].includes(to.kind) && !target.endsWith(`${sep}config.ts`)) violations.push(`${at}: infrastructure depends on application composition/routes`);
    }
  }
  return { files: files.length, imports, violations };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const report = checkProject();
  if (report.violations.length) { console.error(report.violations.join("\n")); process.exitCode = 1; }
  else console.log(`Boundaries passed: ${report.files} files, ${report.imports} imports (static, dynamic, re-export, import-type).`);
}
