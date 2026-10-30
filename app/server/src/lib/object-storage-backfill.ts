import type Database from "better-sqlite3";
import { avatarKey, uploadKey, type ObjectStorage } from "./object-storage.js";

/**
 * 启动时的一次性回填（#352）：库里还留着的头像字节与论坛上传的图片，对象存储里没有的就补传。
 * 每个对象先 HEAD，已经在的跳过，所以重启重跑不会重复上传；失败的下次启动再来。
 * 只记数量，不记哈希、地址、字节或错误原文。
 */
type Source = { label: string; list: string; read: string; keyOf(hash: string, mime: string): string };
const SOURCES: Source[] = [
  { label: "账号头像", list: "SELECT hash, mime FROM account_avatars", read: "SELECT data AS bytes FROM account_avatars WHERE hash = ?", keyOf: (hash: string) => avatarKey(hash) },
  { label: "论坛头像", list: "SELECT hash, 'image/webp' AS mime FROM forum_avatars", read: "SELECT data AS bytes FROM forum_avatars WHERE hash = ?", keyOf: (hash: string) => avatarKey(hash) },
  { label: "论坛图片", list: "SELECT hash, mime FROM forum_upload_files", read: "SELECT bytes FROM forum_upload_files WHERE hash = ?", keyOf: (hash: string, mime: string) => uploadKey(hash, mime) },
];

export async function backfillObjectStorage(
  db: Database.Database,
  storage: ObjectStorage,
  log: { info(fields: object, message: string): void },
): Promise<void> {
  if (!storage.enabled) return;
  for (const source of SOURCES) {
    const rows = db.prepare(source.list).all() as { hash: string; mime: string }[];
    const read = db.prepare(source.read);
    const counts = { total: rows.length, uploaded: 0, present: 0, failed: 0 };
    for (const row of rows) {
      try {
        const key = source.keyOf(row.hash, row.mime);
        if (await storage.exists(key)) {
          counts.present += 1;
          continue;
        }
        const bytes = (read.get(row.hash) as { bytes: Buffer } | undefined)?.bytes;
        if (!bytes) {
          counts.failed += 1;
          continue;
        }
        await storage.put(key, bytes, row.mime);
        counts.uploaded += 1;
      } catch {
        counts.failed += 1;
      }
    }
    log.info(counts, `对象存储回填：${source.label}`);
  }
}
