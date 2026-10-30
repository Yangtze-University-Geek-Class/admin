import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planHotfix, publishVerifiedCheck, verifyLive } from "../../scripts/hotfix-policy.mjs";
import { validateWindows } from "../../scripts/hotfix-windows.mjs";

const root = process.cwd();
const dirs: string[] = [];
const openWindow = { issue: 306, tag: "v0.1.1", status: "open", approvedBy: "所有者", approvedAt: "2026-10-28T19:11:00+08:00", expiresAt: "2026-11-04T19:11:00+08:00", approval: "这是一个必须走 hotfix 的 P0 问题" };
const registryOf = (...windows: Record<string, unknown>[]) => JSON.stringify({ schemaVersion: 1, windows });
function fixture(registry: string | null = registryOf(openWindow)) {
  const repo = mkdtempSync(resolve(tmpdir(), "hotfix-policy-")); dirs.push(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.test");
  const commitFile = (version = "0.1.1") => { writeFileSync(resolve(repo, "package.json"), JSON.stringify({ version })); git("add", "package.json"); if (registry !== null) { mkdirSync(resolve(repo, "deploy/hotfix"), { recursive: true }); writeFileSync(resolve(repo, "deploy/hotfix/windows.json"), registry); git("add", "deploy/hotfix/windows.json"); } git("commit", "-qm", "fixture", "--allow-empty"); return git("rev-parse", "HEAD"); };
  const base = commitFile(); git("tag", "v0.1.1");
  const commit = commitFile(); git("update-ref", "refs/remotes/origin/main", commit);
  const options = { repo, root, tag: "v0.1.1", commit, event: "workflow_dispatch", ref: "refs/heads/main", workflowSha: commit, issue: "306", now: new Date("2026-10-30T00:00:00+08:00") };
  return { repo, git, base, commit, options, commitFile };
}
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }); });

// 迁移前的登记：署名是旧的个人账号名（拼出来，测试文件里不写明文），批准摘要字段叫 quote
const legacyName = ["Cros", "ery"].join("");
const legacyWindow = { issue: 308, tag: "v0.1.0", status: "closed", approvedBy: legacyName, approvedAt: "2026-10-28T19:11:00+08:00", quote: "这是一个必须走 hotfix 的 P0 问题", commits: [], closedAt: "2026-10-29T10:00:00+08:00", evidence: "已合回 stage 并线上核对" };
describe("登记校验：从提交里读的走兼容，工作区与新写入的严格", () => {
  it("旧格式（quote 与旧署名）的登记：从提交里读出来通过，按工作区严格判定报批准不合规", () => {
    const registry = { schemaVersion: 1, windows: [legacyWindow] };
    expect(validateWindows(registry, { legacy: true })).toEqual([]);
    expect(validateWindows(registry)).toEqual([expect.stringMatching(/^#308：要有所有者的 approvedBy、approvedAt 和批准摘要 approval/)]);
  });

  it("新格式的登记两边都通过", () => {
    const registry = { schemaVersion: 1, windows: [{ ...legacyWindow, approvedBy: "所有者", approval: "这是一个必须走 hotfix 的 P0 问题", quote: undefined }] };
    expect(validateWindows(registry, { legacy: true })).toEqual([]);
    expect(validateWindows(registry)).toEqual([]);
  });

  it("兼容不放宽署名与时间：别的人名、非北京时间的批准时间、过短的摘要，读提交里的登记也不通过", () => {
    expect(validateWindows({ schemaVersion: 1, windows: [{ ...legacyWindow, approvedBy: "someone" }] }, { legacy: true })).toEqual([expect.stringMatching(/^#308：/)]);
    expect(validateWindows({ schemaVersion: 1, windows: [{ ...legacyWindow, approvedAt: "2026-10-28T11:11:00Z" }] }, { legacy: true })).toEqual([expect.stringMatching(/^#308：/)]);
    expect(validateWindows({ schemaVersion: 1, windows: [{ ...legacyWindow, quote: "走 hot" }] }, { legacy: true })).toEqual([expect.stringMatching(/^#308：/)]);
  });
});

describe("同版本 hotfix 规划", () => {
  it("既有 tag 保持原提交，main 修复使用新 SHA 与原版本", () => {
    const f = fixture(); const result = planHotfix(f.options);
    expect(result).toMatchObject({ model: "hotfix", tag: "v0.1.1", baseCommit: f.base, commit: f.commit, releaseVersion: "0.1.1", previewTags: [], deploymentAuthorized: false });
    expect(f.git("rev-parse", "v0.1.1")).toBe(f.base);
    expect(f.git("status", "--porcelain")).toBe("");
  });
  it.each([
    { event: "push" }, { ref: "refs/heads/stage" }, { ref: "refs/tags/v0.1.1" },
    { commit: "main" }, { commit: "abcdef123456" }, { workflowSha: "0".repeat(40) },
    { tag: "v0.1.1-rc.30" }, { tag: "latest" }, { tag: "v0.1.2" }, { issue: "0" }, { issue: "306;echo" },
  ])("拒绝未经明确绑定的输入 %j", overrides => {
    const f = fixture(); expect(() => planHotfix({ ...f.options, ...overrides })).toThrow();
  });
  it("issue 必须是 main 上登记、仍开着的 hotfix 窗口，并且绑定的就是这次的正式版本", () => {
    const now = new Date("2026-10-30T00:00:00+08:00");
    expect(() => planHotfix({ ...fixture().options, now })).not.toThrow();
    expect(() => planHotfix({ ...fixture().options, issue: "307", now })).toThrow(/没有开着的 hotfix 窗口/);
    expect(() => planHotfix({ ...fixture(null).options, now })).toThrow(/windows\.json 不存在/);
    expect(() => planHotfix({ ...fixture(registryOf({ ...openWindow, status: "closed", closedAt: "2026-10-29", evidence: "已合回 stage，线上核对通过" })).options, now })).toThrow(/没有开着的 hotfix 窗口/);
    expect(() => planHotfix({ ...fixture().options, now: new Date("2026-11-05T00:00:00+08:00") })).toThrow(/过期/);
    expect(() => planHotfix({ ...fixture(registryOf({ ...openWindow, tag: "v0.1.0" })).options, now })).toThrow(/绑定的是 v0\.1\.0/);
    expect(() => planHotfix({ ...fixture(registryOf({ ...openWindow, approval: "" })).options, now })).toThrow(/登记不可用/);
  });

  it("拒绝新的版本号", () => {
    const f = fixture(); const sha = f.commitFile("0.1.2"); f.git("update-ref", "refs/remotes/origin/main", sha);
    expect(() => planHotfix({ ...f.options, commit: sha, workflowSha: sha })).toThrow(/版本号/);
  });
  it("拒绝 main 在工作流等待时前进", () => {
    const f = fixture(); f.git("update-ref", "refs/remotes/origin/main", f.base);
    expect(() => planHotfix(f.options)).toThrow(/origin\/main/);
  });
  it("拒绝 tag 本身而不是新修复提交", () => {
    const f = fixture(); f.git("checkout", "--detach", f.base); f.git("update-ref", "refs/remotes/origin/main", f.base);
    expect(() => planHotfix({ ...f.options, commit: f.base, workflowSha: f.base })).toThrow(/新修复提交/);
  });
  it("拒绝不相关 tag 的历史", () => {
    const f = fixture(); f.git("checkout", "--orphan", "other"); f.git("commit", "-qm", "unrelated");
    const sha = f.git("rev-parse", "HEAD"); f.git("update-ref", "refs/remotes/origin/main", sha);
    expect(() => planHotfix({ ...f.options, commit: sha, workflowSha: sha })).toThrow();
  });
});

describe("真实生产证据的失败关闭", () => {
  async function run({ state = "success", version = "0.1.1", environment = "production", tag = "v0.1.1", http = 200 } = {}) {
    const f = fixture(); const plan = planHotfix(f.options); const calls: { url: string; auth: boolean }[] = [];
    const fetcher: typeof fetch = async (input, options) => {
      const url = String(input);
      calls.push({ url, auth: new Headers(options?.headers).has("Authorization") });
      const body = url.endsWith("release.json") ? { environment, version, commit: f.base }
        : url.includes("/statuses?") ? [{ state }] : [{ id: 123, environment: "production", sha: f.base, payload: { tag } }];
      return new Response(JSON.stringify(body), { status: http, headers: { "content-type": "application/json" } });
    };
    const result = await verifyLive(plan, { fetcher, repo: "fixture/repo", token: "fixture-token", gitRepo: f.repo });
    return { result, calls, base: f.base };
  }
  it("只接受线上版本与同 SHA 成功生产记录；令牌不发往站点", async () => {
    const { result, calls, base } = await run();
    expect(result.rollbackCommit).toBe(base);
    expect(calls[0].auth).toBe(false); expect(calls.slice(1).every(c => c.auth)).toBe(true);
  });
  it.each([{ state: "failure" }, { state: "inactive" }, { environment: "preview" }, { version: "0.2.0" }, { tag: "v0.1.0" }, { http: 503 }])("证据异常时不允许上线 %j", async options => {
    await expect(run(options)).rejects.toThrow();
  });
});

describe("部署状态只承认本次真实成功检查", () => {
  function evidence() {
    const repo = "fixture/repo";
    const commit = "a".repeat(40);
    const evidenceUrl = `https://github.com/${repo}/actions/runs/7/job/11`;
    const run = { id: 7, run_attempt: 2, head_sha: commit, event: "workflow_dispatch", head_branch: "main", status: "in_progress", path: ".github/workflows/deploy-hotfix.yml", repository: { full_name: repo }, check_suite_id: 13 };
    const job = { id: 11, run_id: 7, run_attempt: 1, head_sha: commit, name: "hotfix-verify", status: "completed", conclusion: "success", check_run_url: `https://api.github.com/repos/${repo}/check-runs/11` };
    const check = { id: 11, name: "hotfix-verify", head_sha: commit, status: "completed", conclusion: "success", app: { id: 15368, slug: "github-actions" }, check_suite: { id: 13 }, details_url: evidenceUrl };
    const page = { total_count: 1, jobs: [job] };
    const writes: { url: string; body: Record<string, unknown> }[] = [];
    const options = { repo, token: "fixture-token", runId: "7", runAttempt: "2", fetcher: (async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        writes.push({ url, body });
        return new Response(JSON.stringify({ id: 17, ...body }), { status: 201 });
      }
      const body = url.endsWith("/actions/runs/7") ? run : url.includes("/jobs?") ? page : check;
      return new Response(JSON.stringify(body));
    }) as typeof fetch };
    return { commit, evidenceUrl, run, job, check, page, writes, options };
  }

  it("失败阶段重试可复用同一运行的成功检查，并把证据绑定到唯一修复提交", async () => {
    const f = evidence();
    expect(await publishVerifiedCheck({ commit: f.commit }, f.options)).toMatchObject({ checkRunId: 11, statusId: 17, evidenceUrl: f.evidenceUrl });
    expect(f.writes).toEqual([{ url: `https://api.github.com/repos/fixture/repo/statuses/${f.commit}`, body: { state: "success", context: "hotfix-verify", target_url: f.evidenceUrl, description: expect.stringContaining("projection") } }]);
  });

  it.each([
    { target: "run", patch: { head_sha: "b".repeat(40) } },
    { target: "run", patch: { head_branch: "stage" } },
    { target: "run", patch: { event: "push" } },
    { target: "run", patch: { path: ".github/workflows/ci.yml" } },
    { target: "run", patch: { run_attempt: 1 } },
    { target: "run", patch: { repository: { full_name: "another/repo" } } },
    { target: "job", patch: { run_id: 8 } },
    { target: "job", patch: { head_sha: "b".repeat(40) } },
    { target: "job", patch: { status: "in_progress" } },
    { target: "job", patch: { conclusion: "failure" } },
    { target: "job", patch: { check_run_url: "https://example.test/check-runs/11" } },
    { target: "check", patch: { app: { id: 99, slug: "github-actions" } } },
    { target: "check", patch: { check_suite: { id: 99 } } },
    { target: "check", patch: { conclusion: "failure" } },
    { target: "check", patch: { details_url: "https://example.test/evidence" } },
    { target: "page", patch: { total_count: 101 } },
  ] as const)("来源不完整、跨运行或失败时绝不发布成功状态 %#", async ({ target, patch }) => {
    const f = evidence();
    Object.assign(f[target], patch);
    await expect(publishVerifiedCheck({ commit: f.commit }, f.options)).rejects.toThrow();
    expect(f.writes).toEqual([]);
  });

  it("同一次运行出现重名检查时不能任挑一个成功结果", async () => {
    const f = evidence();
    f.page.jobs.push({ ...f.job, id: 12 });
    f.page.total_count = 2;
    await expect(publishVerifiedCheck({ commit: f.commit }, f.options)).rejects.toThrow(/不唯一/);
    expect(f.writes).toEqual([]);
  });

  it("读取检查的上游 HTTP 失败不能投影为成功", async () => {
    const f = evidence();
    const fetcher: typeof fetch = async (url, init) => String(url).includes("/check-runs/") ? new Response("unavailable", { status: 503 }) : f.options.fetcher(url, init);
    await expect(publishVerifiedCheck({ commit: f.commit }, { ...f.options, fetcher })).rejects.toThrow(/HTTP 503/);
    expect(f.writes).toEqual([]);
  });
});

describe("hotfix 工作流保持生产保护", () => {
  const workflow = readFileSync(resolve(root, ".github/workflows/deploy-hotfix.yml"), "utf8");
  it("只有 main 手工触发，核心/论坛全验，不制造 rc", () => {
    expect(workflow).toContain('test "$GITHUB_REF" = refs/heads/main');
    expect(workflow).toContain("needs: [plan, core, forum]");
    expect(workflow).toContain("run: pnpm check"); expect(workflow).toContain("run: pnpm test");
    expect(workflow).toContain("run: node scripts/forum.mjs check");
    expect(workflow).not.toMatch(/^  (push|pull_request):/m);
    expect(workflow).not.toMatch(/git tag|continue-on-error|\|\| true/);
  });
  it("CDN、镜像构建和内容校验与常规生产流程逐字一致", () => {
    const normal = readFileSync(resolve(root, ".github/workflows/deploy-production.yml"), "utf8");
    const shared = (text: string) => text.slice(text.indexOf("  cdn-plan:\n"), text.indexOf("  deploy:\n"));
    expect(shared(workflow)).toBe(shared(normal));
  });
  it("复用生产锁、审批、凭据隔离、备份、镜像校验和回滚", () => {
    for (const literal of ["group: deploy-production", "cancel-in-progress: false", "required_reviewers", "name: production", "name: static-cdn", "hotfix-verify", "yzgc-backup@production.service", "rollback-stack.sh", "sha256sum -c", "payload[mode]=hotfix", "payload[base_tag_commit]", "GOOGLE_CLIENT_SECRET", "deployment-environment.mjs ssh-config", "hotfix-policy.mjs verify-live"]) expect(workflow).toContain(literal);
    expect(workflow.indexOf("生产一致性备份与隔离恢复门禁")).toBeLessThan(workflow.indexOf("分发镜像、env 文件与 compose 物料"));
  });
});
