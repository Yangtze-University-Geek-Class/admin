import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// 宿主层物料由流水线安装（#309）：开发者不登录目标机。这里用临时根目录和假 systemctl 演练 plan / apply / verify。
const installer = resolve(process.cwd(), "deploy/remote/install-host.sh");
const source = resolve(process.cwd(), "deploy/remote");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture(systemd: { requires?: string; watchdog?: string } | null = null) {
  const dir = mkdtempSync(join(tmpdir(), "install-host-"));
  dirs.push(dir);
  const root = join(dir, "root");
  mkdirSync(root);
  const calls = join(dir, "calls.log");
  const stub = join(dir, "systemctl");
  writeFileSync(stub, `#!/usr/bin/env bash
echo "$*" >> "${calls}"
case "$1" in
  show) echo "${systemd?.requires ?? "docker.service"}" ;;
  cat) echo "${systemd?.watchdog ?? "# tolerate-loss.conf"}" ;;
esac
exit 0
`, { mode: 0o755 });
  chmodSync(stub, 0o755);
  const run = (mode: string, extra: string[] = [], input?: string) => spawnSync("bash", [installer, mode, "--source", source, "--root", root, ...extra], {
    encoding: "utf8", input,
    env: { ...process.env, ...(systemd ? { INSTALL_HOST_SYSTEMCTL: stub } : {}) },
  });
  return { root, calls, run, read: (path: string) => readFileSync(join(root, path), "utf8") };
}

describe("install-host.sh", () => {
  it("空目标机上 plan 全是 missing，不写任何文件", () => {
    const f = fixture();
    const result = f.run("plan");
    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(8);
    expect(lines.every(line => line.startsWith("missing"))).toBe(true);
    expect(readdirSync(f.root)).toEqual([]);
  });

  it("apply 装好全部物料并设好权限，第二次 apply 全是 same 且不再备份", () => {
    const f = fixture();
    expect(f.run("apply").status).toBe(0);
    expect(statSync(join(f.root, "opt/yzgc/tools/cdn-mirror.sh")).mode & 0o777).toBe(0o755);
    expect(f.read("etc/systemd/system/yzgc-compose@.service")).toContain("Wants=yzgc-egress.service");
    expect(f.read("etc/cdn-mirror/hosts")).toContain("cdn.yangtzeu.work");
    const again = f.run("apply");
    expect(again.stdout.trim().split("\n").every(line => line.startsWith("same"))).toBe(true);
    expect(readdirSync(join(f.root, "etc/systemd/system")).filter(name => name.includes(".bak-"))).toEqual([]);
  });

  it("目标机上的文件被改过时 plan 报 changed，apply 先备份再覆盖", () => {
    const f = fixture();
    f.run("apply");
    const unit = join(f.root, "etc/systemd/system/cdn-mirror.service");
    writeFileSync(unit, "手工改过\n");
    expect(f.run("plan").stdout).toMatch(/changed\s+\/etc\/systemd\/system\/cdn-mirror\.service/);
    expect(f.run("verify").status).toBe(1);
    expect(f.run("apply").status).toBe(0);
    expect(readFileSync(unit, "utf8")).toContain("Type=oneshot");
    const backups = readdirSync(join(f.root, "etc/systemd/system")).filter(name => name.startsWith("cdn-mirror.service.bak-"));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(f.root, "etc/systemd/system", backups[0]), "utf8")).toBe("手工改过\n");
  });

  it("镜像凭据从 stdin 写入 0600 文件，不出现在输出里，缺一项或含非法字符时不动原文件", () => {
    const f = fixture();
    const result = f.run("apply", ["--mirror-env-stdin"], "CDN_MIRROR_ACCESS_KEY_ID=GKabc123\nCDN_MIRROR_SECRET_ACCESS_KEY=s3cr3tValue+/=\n");
    expect(result.status, result.stderr).toBe(0);
    const envFile = join(f.root, "etc/cdn-mirror/env");
    expect(statSync(envFile).mode & 0o777).toBe(0o600);
    expect(readFileSync(envFile, "utf8")).toContain("CDN_MIRROR_SECRET_ACCESS_KEY=s3cr3tValue+/=");
    expect(result.stdout + result.stderr).not.toContain("s3cr3tValue");
    expect(f.run("apply", ["--mirror-env-stdin"], "CDN_MIRROR_ACCESS_KEY_ID=GKnew\n").status).toBe(0);
    expect(readFileSync(envFile, "utf8")).toContain("GKabc123");
    expect(f.run("apply", ["--mirror-env-stdin"], "CDN_MIRROR_ACCESS_KEY_ID=GK;rm\nCDN_MIRROR_SECRET_ACCESS_KEY=x\n").status).toBe(2);
  });

  it("凭据不合法时在动任何文件之前退出，不留下装了一半的单元", () => {
    const f = fixture({});
    const result = f.run("apply", ["--mirror-env-stdin"], "CDN_MIRROR_ACCESS_KEY_ID=GK;rm\nCDN_MIRROR_SECRET_ACCESS_KEY=x\n");
    expect(result.status).toBe(2);
    expect(readdirSync(f.root)).toEqual([]);
    expect(existsSync(f.calls)).toBe(false);
  });

  it("接入 systemd 时只 daemon-reload 并在有凭据时启用定时器，绝不重启或停止任何服务", () => {
    const f = fixture({});
    expect(f.run("apply").status).toBe(0);
    expect(readFileSync(f.calls, "utf8")).toBe("daemon-reload\n");
    const withKey = fixture({});
    withKey.run("apply", ["--mirror-env-stdin"], "CDN_MIRROR_ACCESS_KEY_ID=GKabc\nCDN_MIRROR_SECRET_ACCESS_KEY=secretvalue\n");
    const calls = readFileSync(withKey.calls, "utf8");
    expect(calls).toContain("enable --now cdn-mirror.timer cdn-mirror-watch.timer");
    expect(calls).not.toMatch(/restart|stop|kill|start /);
  });

  it("verify：物料一致且 systemd 状态符合意图才通过，egress 仍被 Requires 或覆盖项没加载都会失败", () => {
    const ok = fixture({});
    ok.run("apply", ["--mirror-env-stdin"], "CDN_MIRROR_ACCESS_KEY_ID=GKabc\nCDN_MIRROR_SECRET_ACCESS_KEY=secretvalue\n");
    expect(ok.run("verify").status).toBe(0);
    const bad = fixture({ requires: "docker.service yzgc-egress.service" });
    bad.run("apply");
    const result = bad.run("verify");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("仍然 Requires=yzgc-egress");
    const noDropIn = fixture({ watchdog: "没有覆盖项" });
    noDropIn.run("apply");
    expect(noDropIn.run("verify").stderr).toContain("tolerate-loss");
  });

  it("参数错误、物料缺文件时退出码 2", () => {
    const f = fixture();
    expect(spawnSync("bash", [installer, "delete"], { encoding: "utf8" }).status).toBe(2);
    expect(spawnSync("bash", [installer, "plan", "--source", "/nonexistent"], { encoding: "utf8" }).status).toBe(2);
    const empty = mkdtempSync(join(tmpdir(), "install-host-empty-"));
    dirs.push(empty);
    expect(spawnSync("bash", [installer, "plan", "--source", empty, "--root", f.root], { encoding: "utf8" }).status).toBe(2);
    expect(existsSync(join(f.root, "etc"))).toBe(false);
  });
});

describe("部署工作流里的宿主层步骤", () => {
  for (const name of ["preview", "production", "hotfix"]) {
    it(`deploy-${name}.yml 在栈部署成功后安装并核对宿主层物料，镜像凭据只走 stdin`, () => {
      const workflow = readFileSync(resolve(process.cwd(), `.github/workflows/deploy-${name}.yml`), "utf8");
      const step = workflow.slice(workflow.indexOf("- name: 同步宿主层物料"), workflow.indexOf("- name: 输出入口与身份"));
      expect(step.length).toBeGreaterThan(0);
      expect(step).not.toContain("if:");
      expect(step).toContain("install-host.sh apply --source $host_dir --mirror-env-stdin");
      expect(step).toContain("install-host.sh verify --source $host_dir");
      expect(step).toContain("tar -C deploy/remote -cf - install-host.sh cdn-mirror.sh cdn-mirror.hosts systemd");
      expect(step).toMatch(/CDN_MIRROR_SECRET_ACCESS_KEY: \$\{\{ secrets\.CDN_MIRROR_SECRET_ACCESS_KEY \}\}/);
      expect(step).not.toMatch(/echo[^\n]*\$\{?CDN_MIRROR_SECRET|--mirror-env-stdin[^\n]*\$\{?CDN_MIRROR_SECRET/);
      expect(workflow.indexOf("- name: 记录部署结果")).toBeLessThan(workflow.indexOf("- name: 同步宿主层物料"));
      // preview 与 production 可能同时发布到同一台机器：目录按运行编号分开，只清一天前遗留的
      expect(step).toContain("host_dir=/opt/yzgc/host-incoming-${GITHUB_RUN_ID}");
      expect(step).toContain("-mmin +1440");
    });
  }
});
