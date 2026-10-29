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

function fixture(options: { prodClients?: string[]; discovery?: string; rb?: string; importOutput?: string; importExit?: number; previewMode?: string; productionMode?: string; stopExit?: number; backupExit?: number; baselineExit?: number; composeFailOnce?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cutover-"));
  dirs.push(dir);
  const config = join(dir, "config");
  const bin = join(dir, "bin");
  const calls = join(dir, "calls.log");
  mkdirSync(config);
  mkdirSync(bin);
  for (const environment of ['production', 'preview']) {
    const root = join(dir, environment);
    mkdirSync(root);
    const mode = environment === 'production' ? options.productionMode ?? 'on' : options.previewMode ?? 'off';
    writeFileSync(join(root, `.env.${environment}`), `GITLAB_SYNC=${mode}\nSECRET=kept-fixture-secret\n`);
    writeFileSync(join(root, 'compose.yml'), 'services: {}\n');
    writeFileSync(join(root, 'mode'), mode);
    writeFileSync(join(root, 'started'), 'before');
    writeFileSync(join(root, 'running'), 'true');
  }
  writeFileSync(join(bin, 'systemctl'), `#!/bin/bash\necho "backup $*" >> '${calls}'\nexit ${options.backupExit ?? 0}\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'flock'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(config, "gitlab.rb"), options.rb ?? RB_PREVIEW);
  writeFileSync(join(config, "yzgc-oidc-secret"), "preview-secret-value");
  writeFileSync(join(dir, "import-output.txt"), options.importOutput ?? "演算 sector=git.yangtzeu.work：可迁 0，冲突 0，目标库对不上 0，源账号无可对账身份 0");
  writeFileSync(join(dir, "prod-clients.json"), JSON.stringify((options.prodClients ?? []).map(client_id => ({ client_id }))));
  // 假 docker：client list 读 prod-clients.json，client add 返回固定 secret，其余只记录调用
  writeFileSync(join(bin, "docker"), `#!/usr/bin/env bash
echo "$*" >> "${calls}"
environment=preview
if [[ "$*" == *production* ]]; then environment=production; fi
root="${dir}/$environment"
if [[ "$1" == inspect ]]; then
  case "$3" in
    *Config.Image*) echo 'yzgc-fixture/server:unchanged' ;;
    *config_files*) echo "$root/compose.yml" ;;
    *StartedAt*) cat "$root/started" ;;
    *ExitCode*) echo '${options.stopExit ?? 0}' ;;
    *Health.Status*) echo healthy ;;
  esac
elif [[ "$1" == run ]]; then
  if [[ "$*" == *'set-mode '* ]]; then
    while [[ $# -gt 0 && "$1" != set-mode ]]; do shift; done
    printf '%s' "$2" > "$root/mode"
    echo '{"applied":true,"restart_required":true}'
  elif [[ "$*" == *check-baseline* ]]; then
    cat > /dev/null
    echo '{"failures":[]}'
    exit ${options.baselineExit ?? 0}
  elif [[ "$*" == *verify* ]]; then cat > /dev/null; echo '{"failures":[],"verified_members":1}'
  else printf '{"configuration":{"mode":"%s"},"bindings":[]}\n' "$(cat "$root/mode")"; fi
elif [[ "$1" == stop ]]; then echo false > "$root/running"
elif [[ "$1" == start ]]; then echo true > "$root/running"
elif [[ "$1" == compose ]]; then
  if [[ '${options.composeFailOnce ?? false}' == true && ! -f "$root/compose-failed" ]]; then touch "$root/compose-failed"; exit 1; fi
  echo after > "$root/started"
  echo true > "$root/running"
elif [[ "$1" == exec && "$*" == *process.env.GITLAB_SYNC* ]]; then sed -n 's/^GITLAB_SYNC=//p' "$root/.env.$environment"
elif [[ "$1" == exec && "$*" == *"client list"* ]]; then
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
  const run = (...args: string[]) => spawnSync("bash", [script, ...args, '--production-stack-root', join(dir, 'production'), '--preview-stack-root', join(dir, 'preview')], {
    encoding: "utf8",
    env: { ...process.env, GITLAB_CONFIG: config, DOCKER: join(bin, "docker"), CURL: join(bin, "curl"), SYSTEMCTL: join(bin, 'systemctl'), FLOCK: join(bin, 'flock') },
  });
  return { config, calls, dir, run, read: (name: string) => readFileSync(join(config, name), "utf8"), called: () => (existsSync(calls) ? readFileSync(calls, "utf8") : "") };
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
    const pending = fixture({ prodClients: ["gitlab"], importOutput: "演算 sector=git.yangtzeu.work：可迁 3，冲突 0，目标库对不上 0，源账号无可对账身份 0" });
    writeFileSync(join(pending.config, "yzgc-oidc-secret.production"), "production-secret-value");
    const refused = pending.run("switch-issuer", "--production-origin", PROD, "--apply");
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("还有 sub 没迁到正式库");
    expect(pending.read("gitlab.rb")).toBe(RB_PREVIEW);
    expect(pending.called()).not.toContain("reconfigure");
    const conflict = fixture({ prodClients: ["gitlab"], importOutput: "演算 sector=git.yangtzeu.work：可迁 0，冲突 1，目标库对不上 0，源账号无可对账身份 0", importExit: 1 });
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
    const f = fixture({ importOutput: "演算 sector=git.yangtzeu.work：可迁 0，冲突 1，目标库对不上 0，源账号无可对账身份 0", importExit: 1 });
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

describe('唯一同步写者切换', () => {
  it('预发布仍运行 on 或持久 on 时，正式不能启动，主体也不能写入', () => {
    const f = fixture({ previewMode: 'on', productionMode: 'off' });
    expect(f.run('enable-production-sync', '--production-origin', PROD, '--apply').status).toBe(1);
    expect(f.run('migrate-subjects', '--production-origin', PROD, '--apply').status).toBe(1);
    expect(readFileSync(join(f.dir, 'production/mode'), 'utf8')).toBe('off');
    expect(f.called()).not.toContain('set-mode on');
    expect(f.called()).not.toContain('import --sector');
  });

  it('停预发布先备份排空，再改持久设置和canonical env，启动原镜像的新进程', () => {
    const f = fixture({ previewMode: 'on', productionMode: 'off' });
    const dry = f.run('stop-preview-sync', '--production-origin', PROD);
    expect(dry.status, dry.stderr).toBe(0);
    expect(readFileSync(join(f.dir, 'preview/mode'), 'utf8')).toBe('on');
    expect(f.called()).not.toContain('stop --time');
    const result = f.run('stop-preview-sync', '--production-origin', PROD, '--apply');
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(f.dir, 'preview/mode'), 'utf8')).toBe('off');
    expect(readFileSync(join(f.dir, 'preview/.env.preview'), 'utf8')).toBe('GITLAB_SYNC=off\nSECRET=kept-fixture-secret\n');
    expect(readFileSync(join(f.dir, 'preview/started'), 'utf8')).toBe('after\n');
    const calls = f.called();
    expect(calls.indexOf('backup start yzgc-backup@preview')).toBeLessThan(calls.indexOf('stop --time 120'));
    expect(calls.indexOf('stop --time 120')).toBeLessThan(calls.indexOf('set-mode off'));
    expect(calls.indexOf('set-mode off')).toBeLessThan(calls.indexOf('compose --env-file'));
    expect(result.stdout + result.stderr).not.toContain('kept-fixture-secret');
    expect(readFileSync(join(f.dir, 'production/mode'), 'utf8')).toBe('off');
  });

  it.each([{ backupExit: 1 }, { stopExit: 137 }])('备份或正常排空失败时不改持久开关 %j', options => {
    const f = fixture({ ...options, previewMode: 'on', productionMode: 'off' });
    const result = f.run('stop-preview-sync', '--production-origin', PROD, '--apply');
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(f.dir, 'preview/mode'), 'utf8')).toBe('on');
    expect(f.called()).not.toContain('set-mode off');
    expect(f.called()).not.toContain('set-mode on');
  });

  it('两个 unmatched 或旧成员资格未对齐时，不先停止旧写者或开启新写者', () => {
    const missing = fixture({ previewMode: 'on', importOutput: '演算 sector=git.yangtzeu.work：可迁 0，冲突 0，目标库对不上 2，源账号无可对账身份 0', importExit: 1 });
    expect(missing.run('stop-preview-sync', '--production-origin', PROD, '--apply').status).toBe(1);
    expect(missing.called()).not.toContain('stop --time');
    const wrongRole = fixture({ productionMode: 'off', baselineExit: 1 });
    expect(wrongRole.run('enable-production-sync', '--production-origin', PROD, '--apply').status).toBe(1);
    expect(wrongRole.called()).not.toContain('set-mode on');
  });

  it('只有旧写者已关闭、主体和成员对齐后才开启正式，保留镜像与其他env字段', () => {
    const f = fixture({ productionMode: 'off' });
    const result = f.run('enable-production-sync', '--production-origin', PROD, '--apply');
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(f.dir, 'production/mode'), 'utf8')).toBe('on');
    expect(readFileSync(join(f.dir, 'production/.env.production'), 'utf8')).toBe('GITLAB_SYNC=on\nSECRET=kept-fixture-secret\n');
    expect(readFileSync(join(f.dir, 'preview/mode'), 'utf8')).toBe('off');
    expect(result.stdout + result.stderr).not.toContain('kept-fixture-secret');
  });

  it.each(['stop-preview-sync', 'enable-production-sync'])('启动失败恢复原有效模式与服务，不影响另一个环境：%s', step => {
    const stopping = step === 'stop-preview-sync';
    const environment = stopping ? 'preview' : 'production';
    const originalMode = stopping ? 'on' : 'off';
    const f = fixture({ previewMode: stopping ? 'on' : 'off', productionMode: 'off', composeFailOnce: true });
    const result = f.run(step, '--production-origin', PROD, '--apply');
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(f.dir, environment, 'mode'), 'utf8')).toBe(originalMode);
    expect(readFileSync(join(f.dir, environment, `.env.${environment}`), 'utf8')).toBe(`GITLAB_SYNC=${originalMode}\nSECRET=kept-fixture-secret\n`);
    expect(readFileSync(join(f.dir, environment, 'running'), 'utf8').trim()).toBe('true');
    const other = stopping ? 'production' : 'preview';
    expect(readFileSync(join(f.dir, other, 'started'), 'utf8')).toBe('before');
  });
});

