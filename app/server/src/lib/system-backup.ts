// 一键系统备份（#282，所有者 2026-10-24 22:22 要求把论坛和所有系统的信息数据都能一键备份下载，
// 方便后续服务出问题或搬迁）。
//
// 这个服务没有独立的论坛数据库或上传目录：账号资料、头像、表情包、论坛帖子/图片全部是 data.db 里的行
// 或 BLOB 列（见 lib/account-avatar.ts、lib/forum-store.ts 的表情/上传表），唯一落在数据库之外的是比赛
// 官网的站点包文件（lib/competition-site-store.ts 的 `sites/` 目录）。所以一份完整备份只需要两件东西：
// 1) better-sqlite3 的在线备份快照（db.backup()，读写中也能拍一致的快照，不用停服务）；
// 2) `sites/` 目录原样打进去。
// 打包用 lib/tar-stream.ts 的流式 tar+gzip：先对快照与每个站点文件各算一遍 sha256（manifest.json 要用，
// 也顺手验证了文件可读），再把同一批文件按已知大小流式写进归档——两次读盘但从不把整份归档放进内存。
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { Readable } from "node:stream";
import Database from "better-sqlite3";
import { packTarGz, type TarSourceEntry } from "./tar-stream.js";

export const BACKUP_FORMAT = "yzgc-system-backup@1";

/**
 * 快照里清空的短时安全数据：会话、设备授权、对外授权的授权码/令牌/交互、邮箱验证码、注册限额与各种
 * 限流桶。这些行按设计就是几分钟到几天的生命周期，搬到新环境后一律要重新登录或重新同意，留着没有迁移
 * 价值，反而会带走加密会话令牌、验证码哈希这类不必要的敏感内容。账号、密码哈希、`oauth_clients`/
 * `oauth_subjects`（下游应用与 OIDC `sub` 映射）、`gitlab_accounts` 不在这张表里：迁移之后还要让已有
 * 账号认得出同一个人、让已经登录过的下游应用（如 GitLab）不用重新建号。
 */
export const BACKUP_EXCLUDED_TABLES: readonly string[] = [
  "sessions",
  "device_grants",
  "oauth_grants",
  "oidc_payloads",
  "email_challenges",
  "invite_attempts",
  "application_limits",
  "limit_events",
  "forum_rate_events",
];

export type SystemBackupManifest = {
  format: typeof BACKUP_FORMAT;
  created_at: string;
  app: { version: string; image_tag: string | null };
  environment: string;
  database: { tables: string[]; row_counts: Record<string, number>; excluded_tables: string[] };
  files: { path: string; sha256: string; size: number }[];
  required_env: string[];
};

export type SystemBackupResult = { manifest: SystemBackupManifest; stream: NodeJS.ReadableStream };

export type PrepareSystemBackupOptions = {
  /** 活库连接（services.storage.db）：只用来起一次在线备份，不会被这个函数改动。 */
  db: Database.Database;
  /** 站点包文件根目录（services.sitesRoot）；不存在时视为没有站点文件。 */
  sitesRoot: string;
  environment: string;
  imageTag: string | null;
  appVersion: string;
  requiredEnv: string[];
};

async function sha256File(path: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest("hex"), size };
}

function listFilesRecursive(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

/** 读一份 `deploy/env/.env.<environment>` 的键名（绝不读值）：告诉恢复的人新环境要准备哪些变量。 */
export function readEnvKeyNames(envFilePath: string): string[] {
  if (!existsSync(envFilePath)) return [];
  const names: string[] = [];
  for (const line of readFileSync(envFilePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    names.push(trimmed.slice(0, eq).trim());
  }
  return names;
}

/**
 * 准备一份完整系统备份：快照数据库、清空短时安全数据、给快照与站点文件算 sha256、拼出 manifest，
 * 返回 manifest（已经算好，调用方可以直接拿去记操作记录）和一个边读边产出字节的 gzip tar 流。
 * 流读完（`close`）或读到一半出错（`error`）都会删掉临时目录；调用方不需要、也不应该自己删。
 */
export async function prepareSystemBackup(options: PrepareSystemBackupOptions): Promise<SystemBackupResult> {
  const tmpDir = mkdtempSync(join(tmpdir(), "yzgc-backup-"));
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    rmSync(tmpDir, { recursive: true, force: true });
  };
  try {
    const snapshotPath = join(tmpDir, "data.db");
    await options.db.backup(snapshotPath);

    const snapshot = new Database(snapshotPath);
    const existingTables = new Set(
      (snapshot.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
        .map(row => row.name),
    );
    const excluded = BACKUP_EXCLUDED_TABLES.filter(table => existingTables.has(table));
    snapshot.pragma("secure_delete = ON");
    snapshot.transaction(() => {
      for (const table of excluded) snapshot.prepare(`DELETE FROM "${table}"`).run();
    })();
    snapshot.exec("VACUUM");
    const rowCounts: Record<string, number> = {};
    for (const table of existingTables) {
      rowCounts[table] = (snapshot.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
    }
    snapshot.close();

    const dbHash = await sha256File(snapshotPath);
    const siteAbsPaths = listFilesRecursive(options.sitesRoot);
    const siteFiles: { path: string; absPath: string; sha256: string; size: number }[] = [];
    for (const absPath of siteAbsPaths) {
      const relPath = relative(options.sitesRoot, absPath).split(sep).join("/");
      siteFiles.push({ path: `sites/${relPath}`, absPath, ...(await sha256File(absPath)) });
    }

    const manifest: SystemBackupManifest = {
      format: BACKUP_FORMAT,
      created_at: new Date().toISOString(),
      app: { version: options.appVersion, image_tag: options.imageTag },
      environment: options.environment,
      database: { tables: [...existingTables].sort(), row_counts: rowCounts, excluded_tables: excluded },
      files: [{ path: "data.db", sha256: dbHash.sha256, size: dbHash.size }, ...siteFiles.map(({ path, sha256, size }) => ({ path, sha256, size }))],
      required_env: options.requiredEnv,
    };
    const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");

    const tarEntries: TarSourceEntry[] = [
      { path: "manifest.json", size: manifestBuffer.length, open: () => Readable.from([manifestBuffer]) },
      { path: "data.db", size: dbHash.size, open: () => createReadStream(snapshotPath) },
      ...siteFiles.map(file => ({ path: file.path, size: file.size, open: () => createReadStream(file.absPath) })),
    ];
    const stream = packTarGz(tarEntries);
    stream.on("close", cleanup);
    stream.on("error", cleanup);
    return { manifest, stream };
  } catch (error) {
    cleanup();
    throw error;
  }
}
