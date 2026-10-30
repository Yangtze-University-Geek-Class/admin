import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { loadStickerManifest, type StickerManifest } from "../sticker-manifest.js";
import { seedStickerPacks } from "./2026-10-sticker-packs.js";

/**
 * #276 论坛 v2 迁移：分类可见范围种子、表情包种子。只增不改所有者改过的数据——
 * `forum_category_settings` 按 `category_id` 幂等插入（已经有的不覆盖，控制台可能已经改过）；
 * 表情包按清单播种（#286，`seedStickerPacks`，第一套「极客娘」也在清单里），同样只补库里没有的；
 * 2026-10-25 第一套里 15 张换成带小字的图，库里还是原图的才换（`recaptionYugcStickers`）。
 * 可以重复执行，第二次运行不改变任何行
 * （见 tests/server/forum-v2-migration.test.ts、tests/server/sticker-packs-migration.test.ts）。
 *
 * 回滚：本迁移只加表、加列、加行，不删旧表旧列旧行，回滚就是部署上一个镜像。
 */

export type ForumV2MigrationReport = {
  tables: { table: string; before: number; after: number }[];
  packs_seeded_this_run: number;
  stickers_seeded_this_run: number;
  stickers_missing_files: string[];
  stickers_recaptioned_this_run: number;
};

function tableCount(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/**
 * 分类默认的可见范围（SPEC §5「分级可见」，所有者 2026-10-24 交接时告知的初始值，控制台可以改）：
 * 公开——招新与机试、竞赛与项目、人工智能；注册可见——课程与作业、求职与升学；成员可见——班级公告。
 * 这里按固定 id 种子，不依赖 app/forum/content/curation.json 实际有没有这些分类：某个环境的分类集合
 * 和这份清单不完全一致时，多出来的设置行不会被任何查询用到（EFFECTIVE_VISIBILITY_EXPR 按 category_id
 * 联接，联不上的分类按 'public' 兜底），缺的分类等那个分类真的存在时由控制台手动设置。
 */
export const CATEGORY_VISIBILITY_SEED: { categoryId: string; visibility: "public" | "registered" | "member" }[] = [
  { categoryId: "c-exam", visibility: "public" },
  { categoryId: "c-competitions", visibility: "public" },
  { categoryId: "c-ai", visibility: "public" },
  { categoryId: "c-courses", visibility: "registered" },
  { categoryId: "c-careers", visibility: "registered" },
  { categoryId: "c-announcements", visibility: "member" },
];

export function seedCategoryVisibility(db: Database.Database, now: number): void {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO forum_category_settings(category_id, visibility, updated_at, updated_by) VALUES (?, ?, ?, 'migration:2026-10-forum-v2')",
  );
  const tx = db.transaction(() => {
    for (const row of CATEGORY_VISIBILITY_SEED) insert.run(row.categoryId, row.visibility, now);
  });
  tx();
}

/** 第一套「极客娘」的包 id；它的表情和图片在 app/server/assets/stickers/yugc/（清单与 pack.json），短码是 `yugc-<表情 id>`。 */
export const YUGC_STICKER_PACK_ID = "yugc";

/**
 * 第一套「极客娘」里 15 张原图的 sha256（2026-10-25 换成带小字的版本，#276，所有者认为带小字的版本更可爱）。库里这张表情还指着原图的，换成仓库里现在的图；管理员自己换过图的（哈希对不上）不动。
 * 原图的文件行留着：页面缓存里的旧地址照样能打开。
 */
export const YUGC_UNCAPTIONED: Record<string, string> = {
  wave: "8d421f54cca80e1b2b0fe929211d0d721d75691a1d7b811f7de760203b5c439c",
  thumbsup: "b31c83ecaed5408371494decd3f57e1ed696304415e18be76821d3a544fb7db8",
  confused: "78da33f1a055c6b04f4a566882d4e9e3091ef6e3fa479558c54c2d0e1f86b6f7",
  shocked: "d5338c82b6fe7c430c99de14ad9b472d4976f4d76a152eaba305084b340134ad",
  sleepy: "634d3faed00b3746b594c58e6962108ce19737981cb8586adaa8fcf1f192c4b1",
  cheer: "f905e91ca9847888621cf714c951ed980af6babc245d8df4913c1e23a83e1c4f",
  thanks: "98d14c49567bf0f56e693dedc2a11e6ded5b81dfd7040719cc8185d4d1c8187b",
  think: "8c79fb7310370d8bccb59d8a9cf6e88dcde8c6ad773476eb58bf92b50831ecbb",
  smirk: "25bc916aa256b9001e2c09fe185c60ebb7421093dc7c08afbbd4072e1df52792",
  proud: "76bfcc905b3bdab5c9d4700cffe371356e0048e257565fce684de844b08737fc",
  speechless: "3cb68a476fb7caa60afa39f522a36a3bbe8ae383d5687fbfc20ea03e4f16660e",
  merged: "4e1a1f35ab3af7704e278d85a93122b35fcfeb0e5f25d71158ab940fafd5f522",
  go: "98340ed718cfb75d248414dc28903e0e0644193a735da0ce827aaf2bd8148241",
  goodnight: "b08cfaa8cbc4e4d75f98c6f5d9fa8cb247d2bd304b59498ece22370826ba5520",
  roger: "90108616d7be531e4816502e113b2dd07c711955864f1a67b8ad67bb9935a0ea",
};

/** `packDir` 是「极客娘」包的目录（<表情目录>/yugc），里面的图片按 `<表情 id>.webp` 命名。 */
export function recaptionYugcStickers(db: Database.Database, now: number, packDir: string): number {
  const insertFile = db.prepare("INSERT OR IGNORE INTO forum_sticker_files(hash, mime, bytes, created_at) VALUES (?, 'image/webp', ?, ?)");
  const swap = db.prepare("UPDATE forum_stickers SET file_hash = ? WHERE id = ? AND file_hash = ?");
  let swapped = 0;
  db.transaction(() => {
    for (const [code, oldHash] of Object.entries(YUGC_UNCAPTIONED)) {
      let data: Buffer;
      try {
        data = readFileSync(join(packDir, `${code}.webp`));
      } catch {
        continue;
      }
      const hash = createHash("sha256").update(data).digest("hex");
      if (hash === oldHash) continue;
      const shortcode = `${YUGC_STICKER_PACK_ID}-${code}`;
      if (!db.prepare("SELECT 1 FROM forum_stickers WHERE id = ? AND file_hash = ?").get(shortcode, oldHash)) continue;
      insertFile.run(hash, data, now);
      swapped += swap.run(hash, shortcode, oldHash).changes;
    }
  })();
  return swapped;
}

const REPORT_TABLES = ["forum_category_settings", "forum_sticker_packs", "forum_stickers", "forum_sticker_files"];

/** `stickerAssetsDir` 是表情目录（里面有 manifest.json 和各包的目录）；`manifest` 不传就从目录读，db.ts 读好了传进来，启动只读一次。 */
export function runForumV2Migration(
  db: Database.Database, now: number, stickerAssetsDir: string, manifest: StickerManifest = loadStickerManifest(stickerAssetsDir),
): ForumV2MigrationReport {
  const before = Object.fromEntries(REPORT_TABLES.map(table => [table, tableCount(db, table)]));
  seedCategoryVisibility(db, now);
  const stickers = seedStickerPacks(db, now, stickerAssetsDir, manifest);
  const stickersRecaptioned = recaptionYugcStickers(db, now, join(stickerAssetsDir, YUGC_STICKER_PACK_ID));
  const after = Object.fromEntries(REPORT_TABLES.map(table => [table, tableCount(db, table)]));
  return {
    tables: REPORT_TABLES.map(table => ({ table, before: before[table], after: after[table] })),
    ...stickers,
    stickers_recaptioned_this_run: stickersRecaptioned,
  };
}
