// 修复 mbbs 迁移遗留的 hash 路由链接。
//
// 老论坛是 hash-router 单页应用，帖子内链写成
//   https://yangtzeu.work/#/thread/detail/12       （12 = 老站 thread id）
//   http://yangtzeu.work/#/thread/category/4       （4  = 老站 category id）
// 新站是 BrowserRouter，路由为 /forum/archive/t/<新 id>、/forum/archive?category=<slug>。
// 迁移时正文原样搬运，这些内链全部落到 portal 的 catch-all（`*` → Navigate "/"），
// 读者点进去只看到官网首页，正文像是"消失了"。
//
//   pnpm --filter @yzgc/server exec tsx scripts/fix-legacy-hash-links.ts           # dry-run
//   pnpm --filter @yzgc/server exec tsx scripts/fix-legacy-hash-links.ts --apply   # 写库
//
// 用 FORUM_DB_PATH 指向副本可对拷贝做演练：
//   FORUM_DB_PATH=/tmp/forum.db.bak tsx scripts/fix-legacy-hash-links.ts
//
// 幂等：改写后的 URL 不再匹配老式模式，重复执行是 no-op。
import { forumDb } from "../src/lib/forum-db.js";

const SITE = "https://yangtzeu.work";
const APPLY = process.argv.includes("--apply");

// 老站 id -> 新站地址。站内锚点（本站路径）始终用绝对 URL 写，
// 这样论坛将来换到 forum.yangtzeu.work 子域时正文内链依然有效。
function threadHref(legacyId: number): string | null {
  const row = forumDb
    .prepare(
      `SELECT t.id, c.is_legacy FROM forum_threads t
       LEFT JOIN forum_categories c ON c.id = t.category_id
       WHERE t.legacy_mbbs_id = ?`,
    )
    .get(legacyId) as { id: number; is_legacy: number | null } | undefined;
  if (!row) return null;
  return `${SITE}/forum/${row.is_legacy ? "archive/t/" : "t/"}${row.id}`;
}

function categoryHref(legacyId: number): string | null {
  const row = forumDb
    .prepare(`SELECT slug, is_legacy FROM forum_categories WHERE legacy_mbbs_id = ?`)
    .get(legacyId) as { slug: string; is_legacy: number } | undefined;
  if (!row) return null;
  return row.is_legacy
    ? `${SITE}/forum/archive?category=${encodeURIComponent(row.slug)}`
    : `${SITE}/forum/c/${encodeURIComponent(row.slug)}`;
}

const THREAD_RE = /(?:https?:\/\/(?:www\.)?yangtzeu\.work\/)?#\/thread\/detail\/(\d+)/g;
const CATEGORY_RE = /(?:https?:\/\/(?:www\.)?yangtzeu\.work\/)?#\/thread\/category\/(\d+)/g;

function rewrite(content: string): { text: string; hits: number; unresolved: number[] } {
  let hits = 0;
  const unresolved: number[] = [];
  const text = content
    .replace(THREAD_RE, (whole, id: string) => {
      const href = threadHref(Number(id));
      if (!href) {
        unresolved.push(Number(id));
        return whole;
      }
      hits++;
      return href;
    })
    .replace(CATEGORY_RE, (whole, id: string) => {
      const href = categoryHref(Number(id));
      if (!href) {
        unresolved.push(Number(id));
        return whole;
      }
      hits++;
      return href;
    });
  return { text, hits, unresolved };
}

const tables = [
  { name: "forum_threads", key: "id", touch: "updated_at" },
  { name: "forum_posts", key: "id", touch: "updated_at" },
];

let totalRows = 0;
let totalHits = 0;
const unresolvedAll = new Set<number>();

for (const table of tables) {
  const rows = forumDb.prepare(`SELECT ${table.key} AS id, content FROM ${table.name}`).all() as {
    id: number;
    content: string;
  }[];
  const update = forumDb.prepare(`UPDATE ${table.name} SET content = ? WHERE ${table.key} = ?`);
  const changed: number[] = [];

  for (const row of rows) {
    const { text, hits, unresolved } = rewrite(row.content ?? "");
    for (const id of unresolved) unresolvedAll.add(id);
    if (hits === 0) continue;
    changed.push(row.id);
    totalHits += hits;
    if (APPLY) update.run(text, row.id);
    if (changed.length <= 3) {
      console.log(`\n--- ${table.name}#${row.id} (${hits} 处) ---`);
      console.log("  before: " + (row.content.match(THREAD_RE) ?? []).slice(0, 2).join("  "));
      console.log("  after : " + (text.match(/https:\/\/yangtzeu\.work\/forum\/[^)\s]+/g) ?? []).slice(0, 2).join("  "));
    }
  }

  console.log(`\n${table.name}: ${changed.length} 行需要改写 → [${changed.join(", ")}]`);
  totalRows += changed.length;
}

console.log(`\n合计 ${totalRows} 行 / ${totalHits} 处链接`);
if (unresolvedAll.size) {
  console.log(`未迁移、保持原样的老 id: ${[...unresolvedAll].sort((a, b) => a - b).join(", ")}`);
}
console.log(APPLY ? "已写库。" : "dry-run，未改动数据库（加 --apply 生效）。");

// 不改 updated_at：正文改写不是用户编辑，不能污染"最后编辑时间"。
forumDb.close();
