import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, type BuildAppOptions } from "../../app/server/src/app.js";
import { createConfig } from "../../app/server/src/config.js";
import { CAPABILITIES, IMPLIES } from "../../app/server/src/lib/roles.js";
import { registrationSource, type Evidence } from "./source.js";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
type Route = Parameters<NonNullable<BuildAppOptions["observeRoute"]>>[0];
type Row = Record<string, string | number | null>;

/** 只提供虚构配置；不调用 loadConfig、不监听、不开发信/会话清理循环。 */
export async function collectRuntime(root = ROOT) {
  if (resolve(root) !== resolve(ROOT)) throw new Error("运行时提取必须使用当前工具所属检出，不能把另一目录的源码与本检出的运行时混合");
  const config = {
    ...createConfig({
      NODE_ENV: "test", PUBLIC_ORIGIN: "https://catalog.invalid", STATIC_CDN_ORIGIN: "https://catalog.invalid", DB_PATH: ":memory:",
      FORUM_DB_PATH: "/catalog-must-not-open-a-file.db",
      SESSION_SECRET: randomBytes(32).toString("hex"), ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      OAUTH_CLIENT_ID: "catalog-fixture", OAUTH_CLIENT_SECRET: "catalog-fixture",
    }),
    forumContentDir: resolve(root, "tests/server/fixtures/forum-content"),
  };
  const deny = () => { throw new Error("项目目录禁止外部请求"); };
  const observed: { route: Route; source: Evidence & { column: number } }[] = [];
  const app = await buildApp({
    config, staticRoot: false,
    overrides: { octokitFactory: deny, httpRequest: deny, mailFetch: deny, clock: () => 0 },
    observeRoute(route) {
      const previous = Error.stackTraceLimit;
      try {
        Error.stackTraceLimit = 30;
        observed.push({ route, source: registrationSource(root, new Error().stack ?? "") });
      } finally {
        Error.stackTraceLimit = previous;
      }
    },
  });
  try {
    await app.ready();
    if (app.server.listening || app.services.storage.db.name !== ":memory:") throw new Error("目录隔离失败");
    const db = app.services.storage.db;
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
    const tableRows = db.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string; sql: string }[];
    const tables = tableRows.map(({ name, sql }) => ({
      name,
      sql,
      columns: db.pragma(`table_xinfo(${quote(name)})`) as Row[],
      foreignKeys: db.pragma(`foreign_key_list(${quote(name)})`) as Row[],
      indexes: (db.pragma(`index_list(${quote(name)})`) as Row[]).map(index => ({
        name: index.name, unique: index.unique, origin: index.origin, partial: index.partial,
        columns: db.pragma(`index_xinfo(${quote(String(index.name))})`) as Row[],
        sql: (db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?").get(index.name) as { sql: string | null } | undefined)?.sql ?? null,
      })).sort((a, b) => String(a.name).localeCompare(String(b.name), "en")),
    }));
    return {
      // 保留的是 onRoute 对象，等模块自己的合同 hook 执行完再读取 schema。
      routes: observed.flatMap(({ route, source }) => [route.method].flat().map(method => ({
        method, path: route.url, source, schema: route.schema ?? {},
      }))),
      tables,
      capabilities: CAPABILITIES.map(capability => ({ ...capability, implies: IMPLIES[capability.id] ?? [] })),
      isolation: { database: "memory", listening: false, externalRequests: "denied", backgroundWorkers: false },
    };
  } finally {
    await app.close();
  }
}
