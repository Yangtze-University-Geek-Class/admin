import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// GitLab 改接正式的宿主侧步骤由流水线调用（#309）：用假 docker / curl 和临时配置目录演练，不连任何真实主机。
const script = resolve(process.cwd(), "deploy/gitlab/cutover.sh");
const PROD = "https://prod.example.test";
const PREVIEW = "https://preview.example.test";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const RB_PREVIEW = `# 其它配置\n    issuer: '${PREVIEW}/oidc', discovery: true, client_auth_method: 'basic',\n    client_options: { identifier: 'gitlab', secret: File.read('/etc/gitlab/yzgc-oidc-secret').strip },\n`;

function fixture(options: { prodClients?: string[]; discovery?: string; rb?: string; importOutput?: string; importExit?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cutover-"));
  dirs.push(dir);
  const config = join(dir, "config");
  const bin = join(dir, "bin");
  const calls = join(dir, "calls.log");
  mkdirSync(config);
  mkdirSync(bin);
  writeFileSync(join(config, "gitlab.rb"), options.rb ?? RB_PREVIEW);
  writeFileSync(join(config, "yzgc-oidc-secret"), "preview-secret-value");
  writeFileSync(join(dir, "import-output.txt"), options.importOutput ?? "演算 sector=git.yangtzeu.work：可迁 0，冲突 0，目标库对不上 0");
  writeFileSync(join(dir, "prod-clients.json"), JSON.stringify((options.prodClients ?? []).map(client_id => ({ client_id }))));
  // 假 docker：client list 读 prod-clients.json，client add 返回固定 secret，其余只记录调用
  writeFileSync(join(bin, "docker"), `#!/usr/bin/env bash
echo "$*" >> "${calls}"
if [[ "$1" == exec && "$*" == *"client list"* ]]; then
  if [[ "$2" == *production* ]]; then cat "${dir}/prod-clients.json"; else echo '[{"client_id":"gitlab"}]'; fi
elif [[ "$1" == exec && "$*" == *"client add"* ]]; then echo '{"client_id":"gitlab","client_secret":"brand-new-secret","redirect_uris":["x"]}'
elif [[ "$1" == exec && "$*" == *"export"* ]]; then echo '{"sector":"git.example.test","entries":[],"withoutIdentity":0}'
elif [[ "$1" == exec && "$*" == *"import"* ]]; then cat > /dev/null; cat "${dir}/import-output.txt"; exit ${options.importExit ?? 0}
fi
exit 0
`, { mode: 0o755 });
  writeFileSync(join(bin, "curl"), `#!/usr/bin/env bash
echo '${options.discovery ?? JSON.stringify({ issuer: `${PROD}/oidc` })}'
`, { mode: 0o755 });
  chmodSync(join(bin, "docker"), 0o755);
  const run = (...args: string[]) => spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, GITLAB_CONFIG: config, DOCKER: join(bin, "docker"), CURL: join(bin, "curl") },
  });
  return { config, calls, run, read: (name: string) => readFileSync(join(config, name), "utf8"), called: () => (existsSync(calls) ? readFileSync(calls, "utf8") : "") };
}

describe("cutover.sh status 与 register-client", () => {
  it("status 只读：列出客户端、签发者来源和文件是否就位，不出现任何 secret", () => {
    const f = fixture({ prodClients: [] });
    const result = f.run("status", "--production-origin", PROD);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("正式库客户端：");
    expect(result.stdout).toContain(`写死在 gitlab.rb：${PREVIEW}/oidc`);
    expect(result.stdout).toContain("yzgc-oidc-secret.production：缺");
    expect(result.stdout).toContain(`正式发现文档的 issuer：${PROD}/oidc`);
    expect(result.stdout + result.stderr).not.toContain("preview-secret-value");
    expect(f.called()).not.toMatch(/client add|reconfigure/);
  });

  it("register-client 缺省只演算；--apply 登记并把 secret 写进 0600 文件，不打印", () => {
    const f = fixture();
    const dry = f.run("register-client", "--production-origin", PROD);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain("演算");
    expect(existsSync(join(f.config, "yzgc-oidc-secret.production"))).toBe(false);
    expect(f.called()).not.toContain("client add");
    const applied = f.run("register-client", "--production-origin", PROD, "--apply");
    expect(applied.status, applied.stderr).toBe(0);
    expect(f.read("yzgc-oidc-secret.production")).toBe("brand-new-secret");
    expect(statSync(join(f.config, "yzgc-oidc-secret.production")).mode & 0o777).toBe(0o600);
    expect(applied.stdout + applied.stderr).not.toContain("brand-new-secret");
  });

  it("已经登记过就不动；登记了但 secret 文件丢了要报错而不是悄悄轮换", () => {
    const f = fixture({ prodClients: ["gitlab"] });
    const lost = f.run("register-client", "--production-origin", PROD, "--apply");
    expect(lost.status).toBe(1);
    expect(lost.stderr).toContain("需要轮换 secret");
    writeFileSync(join(f.config, "yzgc-oidc-secret.production"), "kept");
    expect(f.run("register-client", "--production-origin", PROD, "--apply").status).toBe(0);
    expect(f.read("yzgc-oidc-secret.production")).toBe("kept");
    expect(f.called()).not.toContain("client add");
  });
});

describe("cutover.sh switch-issuer 与 rollback-issuer", () => {
  const ready = () => {
    const f = fixture({ prodClients: ["gitlab"] });
    writeFileSync(join(f.config, "yzgc-oidc-secret.production"), "production-secret-value");
    return f;
  };

  it("前置不满足时拒绝：发现文档不对、没有客户端、没有正式 secret", () => {
    expect(fixture({ prodClients: ["gitlab"], discovery: JSON.stringify({ issuer: `${PREVIEW}/oidc` }) }).run("switch-issuer", "--production-origin", PROD, "--apply").status).toBe(1);
    const noClient = fixture();
    writeFileSync(join(noClient.config, "yzgc-oidc-secret.production"), "x");
    expect(noClient.run("switch-issuer", "--production-origin", PROD, "--apply").stderr).toContain("没有 gitlab 客户端");
    expect(fixture({ prodClients: ["gitlab"] }).run("switch-issuer", "--production-origin", PROD, "--apply").stderr).toContain("yzgc-oidc-secret.production");
    expect(fixture({ prodClients: ["gitlab"], rb: "没有 issuer 行" }).run("switch-issuer", "--production-origin", PROD).status).toBe(1);
  });

  it("缺省只演算；--apply 备份后改签发者、换 secret，再 reconfigure，输出不含 secret", () => {
    const f = ready();
    const dry = f.run("switch-issuer", "--production-origin", PROD);
    expect(dry.status, dry.stderr).toBe(0);
    expect(f.read("gitlab.rb")).toBe(RB_PREVIEW);
    expect(f.called()).not.toContain("reconfigure");
    const applied = f.run("switch-issuer", "--production-origin", PROD, "--apply");
    expect(applied.status, applied.stderr).toBe(0);
    expect(f.read("gitlab.rb")).toContain("issuer: File.read('/etc/gitlab/yzgc-oidc-issuer').strip, discovery: true");
    expect(f.read("gitlab.rb")).not.toContain(PREVIEW);
    expect(f.read("yzgc-oidc-issuer")).toBe(`${PROD}/oidc\n`);
    expect(f.read("yzgc-oidc-secret")).toBe("production-secret-value");
    expect(statSync(join(f.config, "yzgc-oidc-secret")).mode & 0o777).toBe(0o600);
    const names = readdirSync(f.config);
    expect(names.filter(name => name.startsWith("gitlab.rb.bak-") && name.endsWith("-issuer"))).toHaveLength(1);
    expect(names.filter(name => name.startsWith("yzgc-oidc-secret.bak-"))).toHaveLength(1);
    expect(f.called()).toContain("exec gitlab gitlab-ctl reconfigure");
    expect(applied.stdout + applied.stderr).not.toContain("production-secret-value");
  });

  it("还有 sub 没迁到正式库、或迁移有冲突时拒绝切换：否则现有 GitLab 用户首次登录会变成新账号", () => {
    const pending = fixture({ prodClients: ["gitlab"], importOutput: "演算 sector=git.yangtzeu.work：可迁 3，冲突 0，目标库对不上 0" });
    writeFileSync(join(pending.config, "yzgc-oidc-secret.production"), "production-secret-value");
    const refused = pending.run("switch-issuer", "--production-origin", PROD, "--apply");
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("还有 sub 没迁到正式库");
    expect(pending.read("gitlab.rb")).toBe(RB_PREVIEW);
    expect(pending.called()).not.toContain("reconfigure");
    const conflict = fixture({ prodClients: ["gitlab"], importOutput: "演算 sector=git.yangtzeu.work：可迁 0，冲突 1，目标库对不上 0", importExit: 1 });
    writeFileSync(join(conflict.config, "yzgc-oidc-secret.production"), "production-secret-value");
    expect(conflict.run("switch-issuer", "--production-origin", PROD, "--apply").status).toBe(1);
    expect(conflict.called()).not.toContain("reconfigure");
  });

  it("reconfigure 失败后重跑 switch-issuer：回滚点仍是预发布的 secret，不会把正式的当成备份", () => {
    const f = ready();
    f.run("switch-issuer", "--production-origin", PROD, "--apply");
    const again = f.run("switch-issuer", "--production-origin", PROD, "--apply");
    expect(again.status, again.stderr).toBe(0);
    const secretBackups = readdirSync(f.config).filter(name => name.startsWith("yzgc-oidc-secret.bak-"));
    expect(secretBackups).toHaveLength(1);
    expect(readFileSync(join(f.config, secretBackups[0]), "utf8")).toBe("preview-secret-value");
    const rbBackups = readdirSync(f.config).filter(name => name.startsWith("gitlab.rb.bak-"));
    expect(rbBackups).toHaveLength(1);
    expect(readFileSync(join(f.config, rbBackups[0]), "utf8")).toBe(RB_PREVIEW);
    const rolled = f.run("rollback-issuer", "--preview-origin", PREVIEW, "--apply");
    expect(rolled.status, rolled.stderr).toBe(0);
    expect(f.read("yzgc-oidc-secret")).toBe("preview-secret-value");
    expect(f.read("yzgc-oidc-issuer")).toBe(`${PREVIEW}/oidc\n`);
  });

  it("最新的 secret 备份就是正式 secret 时 rollback 拒绝，不写出一个必然登录失败的状态", () => {
    const f = ready();
    f.run("switch-issuer", "--production-origin", PROD, "--apply");
    for (const name of readdirSync(f.config).filter(name => name.startsWith("yzgc-oidc-secret.bak-"))) writeFileSync(join(f.config, name), "production-secret-value");
    const rolled = f.run("rollback-issuer", "--preview-origin", PREVIEW, "--apply");
    expect(rolled.status).toBe(1);
    expect(rolled.stderr).toContain("就是正式的 secret");
    expect(f.read("yzgc-oidc-secret")).toBe("production-secret-value");
  });

  it("rollback-issuer 用最近一次备份恢复 gitlab.rb 与 secret，issuer 写回预发布", () => {
    const f = ready();
    f.run("switch-issuer", "--production-origin", PROD, "--apply");
    const rolled = f.run("rollback-issuer", "--preview-origin", PREVIEW, "--apply");
    expect(rolled.status, rolled.stderr).toBe(0);
    expect(f.read("gitlab.rb")).toBe(RB_PREVIEW);
    expect(f.read("yzgc-oidc-secret")).toBe("preview-secret-value");
    expect(f.read("yzgc-oidc-issuer")).toBe(`${PREVIEW}/oidc\n`);
    expect(fixture().run("rollback-issuer", "--preview-origin", PREVIEW, "--apply").stderr).toContain("没有 switch-issuer 留下的备份");
  });
});

describe("cutover.sh migrate-subjects 与参数校验", () => {
  it("缺省演算、--apply 才带 --apply 调用正式容器里的导入，用完删掉容器里的脚本", () => {
    const f = fixture();
    expect(f.run("migrate-subjects", "--production-origin", PROD).status).toBe(0);
    expect(f.called()).toMatch(/import --sector git\.yangtzeu\.work\n/);
    expect(f.called()).not.toContain("--apply");
    f.run("migrate-subjects", "--production-origin", PROD, "--apply");
    expect(f.called()).toMatch(/import --sector git\.yangtzeu\.work --apply/);
    expect(f.called()).toContain("rm -f /tmp/migrate-oidc-subjects.mjs");
  });

  it("导入有冲突以非 0 退出时，容器里的脚本也要删掉", () => {
    const f = fixture({ importOutput: "演算 sector=git.yangtzeu.work：可迁 0，冲突 1，目标库对不上 0", importExit: 1 });
    const result = f.run("migrate-subjects", "--production-origin", PROD, "--apply");
    expect(result.status).toBe(1);
    expect(f.called().match(/rm -f \/tmp\/migrate-oidc-subjects\.mjs/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("origin、sector、步骤名不合法时退出", () => {
    const f = fixture();
    expect(f.run("status", "--production-origin", "http://x").status).toBe(1);
    expect(f.run("status", "--production-origin", "https://a;rm").status).toBe(1);
    expect(f.run("migrate-subjects", "--production-origin", PROD, "--sector", "a b").status).toBe(1);
    expect(f.run("explode").status).toBe(2);
    expect(f.run("status", "--bogus").status).toBe(2);
  });
});

describe("gitlab-cutover.yml", () => {
  const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/gitlab-cutover.yml"), "utf8");

  it("只手动触发，写入默认不勾，必须过 production 环境审批和部署开关", () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(workflow).not.toMatch(/^ {2}(push|pull_request|schedule):/m);
    expect(workflow).toMatch(/apply:[\s\S]*?default: false/);
    expect(workflow).toContain("vars.DEPLOY_PRODUCTION_ENABLED == 'enabled' && github.ref == 'refs/heads/main'");
    expect(workflow).toMatch(/environment:\n {6}name: production/);
    expect(workflow).toContain("required_reviewers");
    expect(workflow).toContain("DEPLOY_TARGET_ENVIRONMENT");
    expect(workflow).not.toMatch(/continue-on-error|\|\| true/);
  });

  it("步骤选项与 cutover.sh 的子命令一致，只带 cutover.sh 和对账脚本，origin 取自 env 模板", () => {
    const options = [...workflow.matchAll(/^ {10}- ([a-z-]+)$/gm)].map(match => match[1]);
    expect(options).toEqual(["status", "register-client", "migrate-subjects", "switch-issuer", "rollback-issuer"]);
    const sh = readFileSync(script, "utf8");
    for (const name of options) expect(sh).toContain(`${name})`);
    expect(workflow).toContain("tar -C deploy/gitlab -cf - cutover.sh migrate-oidc-subjects.mjs");
    expect(workflow).toContain("deploy/env/.env.production");
    expect(workflow).not.toMatch(/https:\/\/(prev\.)?yangtzeu\.work/);
  });
});
