// 窄屏版式（#287）：和这个目录里其他测试一样不挂载组件，核对源码里的约定。
// 这些约定一旦掉了，手机上要么表格的列被截断、要么空状态落在可见区域外、要么动作列盖住别的列。
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../app/console/src", import.meta.url));
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const sources = walk(join(root, "pages")).filter(path => path.endsWith(".vue")).map(path => ({ name: relative(root, path), text: readFileSync(path, "utf8") }));
const layout = readFileSync(join(root, "styles/layout.css"), "utf8");

// 窄屏一行一张卡的表格：宽屏显示表格、窄屏显示卡片，两边的空状态都要有。
const CARD_PAGES = [
  "pages/Invites.vue", "pages/gitlab/Accounts.vue", "pages/forum/CategoriesTab.vue", "pages/Backup.vue",
  "pages/permissions/NodesTab.vue", "pages/competition/RulesPanel.vue", "pages/Security.vue",
];

describe("narrow screens (#287)", () => {
  it("never names a data column `action`: Tuffex pins columns called action(s) to the right edge, over the neighbouring columns", () => {
    // 操作记录里「动作」那一列曾经叫 action，窄屏横向滚动时钉在右边，盖住「谁」。真放按钮的列叫 actions，不受这条限制。
    const offenders = sources.filter(({ text }) => /key:\s*["']action["']/.test(text)).map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it("swaps a wide table for one card per row below 640px on the pages that list invite codes, GitLab accounts, forum categories, backups, nodes and the rubric", () => {
    for (const name of CARD_PAGES) {
      const text = sources.find(source => source.name === name)?.text ?? "";
      expect(text, name).toMatch(/class="[^"]*\btable-wide\b[^"]*"/);
      expect(text, name).toMatch(/<ul[^>]*class="[^"]*\brow-cards\b/);
    }
    // 反过来：用了卡片列表的页面都在上面，没有悬空的 .row-cards。
    const used = sources.filter(({ text }) => /\brow-cards\b/.test(text)).map(({ name }) => name).sort();
    expect(used).toEqual([...CARD_PAGES].sort());
  });

  it("hides .table-wide and shows .row-cards below 640px", () => {
    const media = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/.exec(layout.slice(layout.indexOf(".row-cards {")))?.[1] ?? "";
    expect(media).toMatch(/\.table-wide \{\s*display: none;/);
    expect(media).toMatch(/\.row-cards \{\s*display: block;/);
    expect(layout).toMatch(/\.row-cards \{\s*display: none;/);
  });

  it("keeps the empty state of a horizontally scrolling table inside the visible area", () => {
    expect(layout).toMatch(/\.tx-data-table\.is-scroll-x \{\s*container-type: inline-size;/);
    expect(layout).toMatch(/\.tx-data-table\.is-scroll-x \.tx-data-table__empty > \* \{[^}]*position: sticky;[^}]*left: 0;[^}]*width: calc\(100cqw - 24px\);/);
  });
});
