import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const workflow = readFileSync(new URL("../../.github/workflows/github-entry.yml", import.meta.url), "utf8");
const config = readFileSync(new URL("../../.github/ISSUE_TEMPLATE/config.yml", import.meta.url), "utf8");

it("GitHub 入口只在新开 issue 与 PR 时留说明，不检出 PR 代码，不碰 secrets（#330）", () => {
  expect(workflow).toContain("issues:\n    types: [opened]");
  expect(workflow).toContain("pull_request_target:\n    types: [opened]");
  expect(workflow).toContain("permissions: {}");
  expect(workflow).toContain("issues: write");
  expect(workflow).toContain("pull-requests: write");
  expect(workflow).not.toMatch(/contents:\s*write/);
  expect(workflow).not.toContain("actions/checkout");
  expect(workflow).not.toContain("secrets.");
  expect(workflow).not.toMatch(/pnpm |npm |node scripts\//);
  expect(workflow).not.toContain("author_association");
});

it("只豁免机器人，成员与协作者也留说明；说明指向 GitLab 主平台，不 @ 任何人", () => {
  expect(workflow).not.toContain("OWNER|MEMBER|COLLABORATOR");
  expect(workflow).toContain('AUTHOR_TYPE" = "Bot"');
  expect(workflow).toContain("https://yangtzeu.work/gitlab/geek/admin");
  expect(workflow).not.toMatch(/echo ".*@/);
});

it("ISSUE_TEMPLATE/config.yml 的 contact_links 指向 GitLab 新建 issue", () => {
  expect(config).toContain("contact_links:\n  - name: 在 GitLab 提 issue（主平台）\n    url: https://yangtzeu.work/gitlab/geek/admin/-/issues/new");
  // 原表单内容保留，只在前面加入 contact_links
  expect(config).toContain("name: 配置\ndescription: 调整仓库配置、模板或标签体系。");
});
