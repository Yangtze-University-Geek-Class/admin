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

function fixture(options: { prodClients?: string[]; discovery?: string; rb?: string; importOutput?: string; importExit?: number; previewMode?: string; productionMode?: string; stopExit?: number; backupExit?: number; baselineExit?: number; composeFailOnce?: boolean; repairExit?: number } = {}) {
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
  writeFileSync(join(dir, "import-output.txt"), options.importOutput ?? "演算 sector=git.example.test：可迁 0，冲突 0，目标库对不上 0，源账号无可对账身份 0");
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
  elif [[ "$*" == *repair-duplicates* ]]; then cat > /dev/null; echo '演算 sector=git.example.test：重复号 1，拒绝 0'; exit ${options.repairExit ?? 0}
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
  // 流水线总是带上正式 env 模板里的 GITLAB_OIDC_SECTOR；用例自己给的 --sector 写在后面，覆盖它
  const run = (step: string, ...args: string[]) => spawnSync("bash", [script, step, '--sector', 'git.example.test', ...args, '--production-stack-root', join(dir, 'production'), '--preview-stack-root', join(dir, 'preview')], {
    encoding: "utf8",
    env: { ...process.env, GITLAB_CONFIG: config, DOCKER: join(bin, "docker"), CURL: join(bin, "curl"), SYSTEMCTL: join(bin, 'systemctl'), FLOCK: join(bin, 'flock'), PROD_ENV_FILE: join(dir, 'production-template.env'), PREVIEW_GITLAB_CONFIG: join(dir, 'preview-gitlab-config'), PREVIEW_ENV_FILE: join(dir, 'preview-template.env') },
  });
  writeFileSync(join(dir, 'production-template.env'), `PUBLIC_ORIGIN=${PROD}\nGITLAB_URL=${PROD}/gitlab\n`);
  mkdirSync(join(dir, 'preview-gitlab-config'));
  writeFileSync(join(dir, 'preview-template.env'), `PUBLIC_ORIGIN=${PREVIEW}\nGITLAB_URL=${PREVIEW}/gitlab\n`);
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
    // 回调按正式 env 模板的 GITLAB_URL 拼，sector 钉成 --sector（#335）
    expect(f.called()).toContain(`client add --name GitLab --client-id gitlab --redirect-uri ${PROD}/gitlab/users/auth/openid_connect/callback --sector git.example.test`);
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
    const pending = fixture({ prodClients: ["gitlab"], importOutput: "演算 sector=git.example.test：可迁 3，冲突 0，目标库对不上 0，源账号无可对账身份 0" });
    writeFileSync(join(pending.config, "yzgc-oidc-secret.production"), "production-secret-value");
    const refused = pending.run("switch-issuer", "--production-origin", PROD, "--apply");
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("还有 sub 没迁到正式库");
    expect(pending.read("gitlab.rb")).toBe(RB_PREVIEW);
    expect(pending.called()).not.toContain("reconfigure");
    const conflict = fixture({ prodClients: ["gitlab"], importOutput: "演算 sector=git.example.test：可迁 0，冲突 1，目标库对不上 0，源账号无可对账身份 0", importExit: 1 });
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
    expect(f.called()).toMatch(/import --sector git\.example\.test\n/);
    expect(f.called()).not.toContain("--apply");
    f.run("migrate-subjects", "--production-origin", PROD, "--apply");
    expect(f.called()).toMatch(/import --sector git\.example\.test --apply/);
    expect(f.called()).toContain("rm -f /tmp/migrate-oidc-subjects.mjs");
  });

  it("导入有冲突以非 0 退出时，容器里的脚本也要删掉", () => {
    const f = fixture({ importOutput: "演算 sector=git.example.test：可迁 0，冲突 1，目标库对不上 0，源账号无可对账身份 0", importExit: 1 });
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

describe('cutover.sh repair-duplicates', () => {
  it('缺省演算：从预发布导出、只读挂载正式库调用修复，不备份、不带 --apply', () => {
    const f = fixture({ previewMode: 'on' });
    const result = f.run('repair-duplicates', '--production-origin', PROD);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('演算');
    const calls = f.called();
    expect(calls).toContain('migrate-oidc-subjects.mjs export --sector git.example.test');
    expect(calls).toMatch(/--network container:yzgc-production-server --volumes-from yzgc-production-server:ro .*repair-duplicates --source-stdin --sector git\.example\.test/);
    expect(calls).not.toContain('backup start');
    expect(calls).not.toMatch(/repair-duplicates.*--apply/);
    expect(calls).toContain('rm -f /tmp/migrate-oidc-subjects.mjs');
  });

  it('--apply 要求正式同步已停：持久或运行 env 还是 on 就拒绝，什么也不写', () => {
    const f = fixture({ previewMode: 'on', productionMode: 'on' });
    const result = f.run('repair-duplicates', '--production-origin', PROD, '--apply');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('stop-production-sync');
    expect(f.called()).not.toContain('backup start');
    expect(f.called()).not.toMatch(/repair-duplicates --source-stdin --apply/);
  });

  it('--apply 先跑正式备份，再以读写挂载带 --apply 修复；修复拒绝时非 0 退出', () => {
    const f = fixture({ previewMode: 'on', productionMode: 'off' });
    const result = f.run('repair-duplicates', '--production-origin', PROD, '--apply');
    expect(result.status, result.stderr).toBe(0);
    const calls = f.called();
    expect(calls.indexOf('backup start yzgc-backup@production.service')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('backup start yzgc-backup@production.service')).toBeLessThan(calls.indexOf('repair-duplicates --source-stdin --apply'));
    expect(calls).toMatch(/--volumes-from yzgc-production-server:rw .*repair-duplicates --source-stdin --apply --sector git\.example\.test/);
    expect(fixture({ productionMode: 'off', repairExit: 1 }).run('repair-duplicates', '--production-origin', PROD, '--apply').status).toBe(1);
  });

  it('stop-production-sync 缺省演算；--apply 经备份、排空把正式改 off，不动预发布', () => {
    const f = fixture({ previewMode: 'on', productionMode: 'on' });
    expect(f.run('stop-production-sync', '--production-origin', PROD).status).toBe(0);
    expect(readFileSync(join(f.dir, 'production/mode'), 'utf8')).toBe('on');
    const result = f.run('stop-production-sync', '--production-origin', PROD, '--apply');
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(f.dir, 'production/mode'), 'utf8')).toBe('off');
    expect(readFileSync(join(f.dir, 'production/.env.production'), 'utf8')).toBe('GITLAB_SYNC=off\nSECRET=kept-fixture-secret\n');
    expect(readFileSync(join(f.dir, 'preview/mode'), 'utf8')).toBe('on');
    expect(f.called().indexOf('backup start yzgc-backup@production')).toBeLessThan(f.called().indexOf('set-mode off'));
  });

  it('停预发布写者之前的演算带 --provision-unmatched，切签发者与开正式写者的演算不带', () => {
    const f = fixture({ previewMode: 'on', productionMode: 'off' });
    expect(f.run('stop-preview-sync', '--production-origin', PROD).status).toBe(0);
    expect(f.called()).toContain('import --sector git.example.test --provision-unmatched');
    const g = fixture({ productionMode: 'off' });
    expect(g.run('enable-production-sync', '--production-origin', PROD).status).toBe(0);
    expect(g.called()).not.toContain('--provision-unmatched');
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
    const missing = fixture({ previewMode: 'on', importOutput: '演算 sector=git.example.test：可迁 0，冲突 0，目标库对不上 2，源账号无可对账身份 0', importExit: 1 });
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


// GitLab 搬到主站路径（#335）：假 docker 记下 compose 重建、健康检查、账号核对与正式库的回调改动（预发布库的客户端文件只用来核对没被碰过）；GitLab 配置放在演练目录。
const OLD = "https://git.example.test";
const NEW = `${PROD}/gitlab`;
const CB = "/users/auth/openid_connect/callback";
const RB_MOVE = `# 其它配置
    issuer: '${PREVIEW}/oidc', discovery: true, client_auth_method: 'basic', uid_field: 'sub', pkce: true,
    client_options: { identifier: 'gitlab', secret: File.read('/etc/gitlab/yzgc-oidc-secret').strip,
                      redirect_uri: '${OLD}${CB}' },
gitlab_rails['gravatar_plain_url'] = '${OLD}/nano-avatar/20261025/%{hash}?s=%{size}'
gitlab_rails['gravatar_ssl_url'] = '${OLD}/nano-avatar/20261025/%{hash}?s=%{size}'
`;
const TEMPLATE_ENV = `GEEK_DEPLOYMENT_ENVIRONMENT=production
PUBLIC_ORIGIN=${PROD}
DEPLOY_HOST=10.66.0.2
GITLAB_URL=${NEW}
GITLAB_OIDC_SECTOR=git.example.test
GITLAB_STACK_ROOT=/srv/gitlab
GITLAB_HTTP_BIND=10.66.0.2:8929
GITLAB_DOCKER_SUBNET=172.31.29.0/24
GITLAB_DOCKER_GATEWAY=172.31.29.1
`;

function renderCompose(url: string) {
  const values: Record<string, string> = { GITLAB_URL: url, GITLAB_STACK_ROOT: "/srv/gitlab", GITLAB_HTTP_BIND: "10.66.0.2:8929", GITLAB_HTTP_PORT: "8929", GITLAB_DOCKER_SUBNET: "172.31.29.0/24", GITLAB_DOCKER_GATEWAY: "172.31.29.1" };
  return readFileSync(resolve(process.cwd(), "deploy/gitlab/docker-compose.yml"), "utf8").replace(/\$\{([A-Z_]+)\}/g, (_, key: string) => values[key]);
}

function pathFixture(options: { legacy?: boolean; sector?: string; issuer?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cutover-path-"));
  dirs.push(dir);
  const root = realpathOf(dir, "root");
  const stacks = realpathOf(dir, "stacks");
  const gitlab = join(root, "srv/gitlab");
  const config = join(gitlab, "config");
  const bin = join(dir, "bin");
  const state = join(dir, "state");
  const calls = join(dir, "calls.log");
  for (const path of [config, bin, state, join(dir, "clients"), join(stacks, "production"), join(stacks, "preview")]) mkdirSync(path, { recursive: true });
  for (const environment of ["production", "preview"]) writeFileSync(join(stacks, environment, `.env.${environment}`), `GITLAB_SYNC=${environment === "production" ? "on" : "off"}\n`);
  // 现在的正式 GitLab：旧模板渲染出的 compose 带着旧地址和 hostname，也还没有日志轮转
  const original = renderCompose(OLD).replace("    container_name: gitlab\n", "    container_name: gitlab\n    hostname: git.example.test\n").replace(/ {4}# 容器日志的轮转[^\n]*\n {4}logging:\n(?: {6,}[^\n]*\n)+/, "");
  writeFileSync(join(gitlab, "docker-compose.yml"), original);
  writeFileSync(join(config, "gitlab.rb"), RB_MOVE.replace(`${PREVIEW}/oidc`, `${options.issuer ?? PROD}/oidc`));
  writeFileSync(join(dir, "template.env"), TEMPLATE_ENV);
  writeFileSync(join(state, "running-url"), OLD);
  // 搬家前后：抽样成员的 sub 摘要、GitLab 的账号数与新增账号、正式库映射着的 GitLab 号
  writeFileSync(join(state, "digest"), "digest-1");
  writeFileSync(join(state, "new-accounts"), JSON.stringify({ users: 10, new_ids: [] }));
  const client = (environment: string) => ({ client_id: "gitlab", redirect_uris: [`${OLD}${CB}`], sector: environment === "production" ? options.sector ?? "git.example.test" : "git.example.test", sector_id: null });
  for (const environment of ["production", "preview"]) writeFileSync(join(dir, `clients/${environment}.json`), JSON.stringify(client(environment)));
  writeFileSync(join(bin, "systemctl"), `#!/usr/bin/env bash
echo "systemctl $*" >> '${calls}'
if [[ -f '${state}/fail-unit-'"$2" ]]; then exit 1; fi
exit 0
`, { mode: 0o755 });
  writeFileSync(join(bin, "flock"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(bin, "docker"), `#!/usr/bin/env bash
echo "docker $*" >> '${calls}'
state='${state}'
case "$1" in
  compose)
    [[ -f "$state/compose-fail" ]] && exit 1
    sed -n "s/^ *external_url '\\(.*\\)'$/\\1/p" "$3" > "$state/running-url"
    if grep -q 'max-size: "10m"' "$3"; then touch "$state/log-rotated"; else rm -f "$state/log-rotated"; fi ;;
  inspect)
    if [[ "$*" == *LogConfig* ]]; then
      if [[ -f "$state/log-rotated" ]]; then echo '{"Type":"json-file","Config":{"max-file":"3","max-size":"10m"}}'; else echo '{"Type":"json-file","Config":{}}'; fi
    else echo server-image; fi ;;
  run)
    if [[ "$*" == *"sync-control.mjs status"* ]]; then
      mode=on; [[ "$*" == *yzgc-preview-server* ]] && mode=off
      echo "{\\"configuration\\":{\\"mode\\":\\"$mode\\"},\\"bindings\\":[{\\"gitlab_id\\":101},{\\"gitlab_id\\":null}]}"
    elif [[ "$*" == *"sync-control.mjs verify"* ]]; then
      cat >/dev/null; echo '{"failures":[]}'
    fi ;;
  exec)
    shift
    [[ "$1" == -i ]] && shift
    if [[ "$1" == gitlab && "$2" == curl ]]; then
      running="$(cat "$state/running-url")"
      relative="$(sed -E 's#^https?://[^/]+##' <<<"$running")"
      [[ "\${!#}" == "http://127.0.0.1\${relative}/-/health" ]] || exit 22
      [[ -n "$relative" && -f "$state/new-unhealthy" ]] && exit 22
      exit 0
    fi
    if [[ "$1" == gitlab && "$2" == gitlab-rails ]]; then
      echo "rails 启动的杂项输出"
      if [[ "$*" == *maximum* ]]; then echo '{"users":10,"max_id":100}'; else cat "$state/new-accounts"; fi
      exit 0
    fi
    if [[ "$2" == node && "$3" == -p ]]; then echo off; exit 0; fi
    environment=preview
    [[ "$1" == *production* ]] && environment=production
    file='${dir}/clients/'"$environment.json"
    if [[ "$*" == *"client show"* ]]; then
      ${options.legacy ? 'echo "usage: oidc.js client add|list|rotate|disable|enable|add-redirect|remove-redirect …" >&2; exit 2' : 'cat "$file"'}
    elif [[ "$*" == *"client subjects"* ]]; then
      [[ "$*" == *--accounts-stdin* ]] && [[ "$(cat)" != '["acct-a","acct-b"]' ]] && exit 1
      jq -c --arg digest "$(cat "$state/digest")" '{client_id, sector, accounts: ["acct-a","acct-b"], count: 2, missing: 0, digest: $digest}' "$file"
    elif [[ "$*" == *-redirect* ]]; then
      [[ -f "$state/fail-redirect-$environment" ]] && exit 1
      uri="\${!#}"
      before="$(cat "$file")"
      if [[ "$*" == *add-redirect* ]]; then jq -c --arg u "$uri" 'if (.redirect_uris | index($u)) then . else .redirect_uris += [$u] end | .sector_id = .sector' <<<"$before" > "$file"
      else jq -c --arg u "$uri" '.redirect_uris -= [$u] | .sector_id = .sector' <<<"$before" > "$file"; fi
      jq -c --argjson before "$before" '{client_id, redirect_uris, sector, changed: (.redirect_uris != $before.redirect_uris)}' "$file"
    fi ;;
esac
exit 0
`, { mode: 0o755 });
  const run = (step: string, ...args: string[]) => spawnSync("bash", [script, step, "--production-origin", PROD, "--preview-origin", PREVIEW, "--production-stack-root", join(stacks, "production"), "--preview-stack-root", join(stacks, "preview"), "--sector", "git.example.test", ...args], {
    encoding: "utf8",
    env: { ...process.env, GITLAB_CONFIG: config, GITLAB_ROOT: root, DOCKER: join(bin, "docker"), SYSTEMCTL: join(bin, "systemctl"), FLOCK: join(bin, "flock"), PROD_ENV_FILE: join(dir, "template.env"), GITLAB_HEALTH_TIMEOUT: "0" },
  });
  const clients = (environment: string) => JSON.parse(readFileSync(join(dir, `clients/${environment}.json`), "utf8")).redirect_uris as string[];
  return {
    run, clients, original, state, gitlab, config,
    baseline: join(gitlab, "path-move/accounts.json"),
    compose: () => readFileSync(join(gitlab, "docker-compose.yml"), "utf8"),
    rb: () => readFileSync(join(config, "gitlab.rb"), "utf8"),
    called: () => (existsSync(calls) ? readFileSync(calls, "utf8") : ""),
  };
}

function realpathOf(dir: string, name: string) {
  const path = join(dir, name);
  mkdirSync(path, { recursive: true });
  return spawnSync("realpath", [path], { encoding: "utf8" }).stdout.trim();
}

describe("cutover.sh GitLab 搬到主站路径（#335）", () => {
  it("path-status 与缺省的 move 都只读：报现在与目标地址、正式库的回调，不备份、不改回调、不重建", () => {
    const f = pathFixture();
    const status = f.run("path-status");
    expect(status.status, status.stderr).toBe(0);
    expect(status.stdout).toContain(`GitLab 现在：${OLD}；目标：${NEW}；已搬：false`);
    expect(status.stdout).toContain(`GitLab 信任的签发者：${PROD}/oidc`);
    expect(status.stdout).toContain("GitLab 容器日志：json-file，每份 不限，留 不限 份");
    expect(status.stdout).toContain("正式库：认得 sector 钉住，sector=git.example.test，钉住值=还没钉（第一次改回调时钉住），回调 1 个，现地址回调在，目标地址回调不在");
    const dry = f.run("move-production-path");
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("演算");
    expect(f.called()).not.toMatch(/systemctl|redirect|compose|gitlab-rails|subjects/);
    expect(f.compose()).toBe(f.original);
    // 旧版本的 server：path-status 照样报，只说先发版本
    const old = pathFixture({ legacy: true }).run("path-status");
    expect(old.status, old.stderr).toBe(0);
    expect(old.stdout).toContain("正式库：server 还不认得 sector 钉住（或没有 gitlab 客户端），搬家前先用 deploy-hotfix 发带 #335 的版本");
  });

  it("--apply 先备份、记账号基线，再给正式库加新回调，按模板重建容器（带日志轮转）并等健康；旧回调留着，预发布库不动", () => {
    const f = pathFixture();
    const result = f.run("move-production-path", "--apply");
    expect(result.status, result.stderr).toBe(0);
    const calls = f.called();
    const order = ["systemctl start gitlab-backup.service", "systemctl start yzgc-backup@production.service", "client subjects --client-id gitlab --limit 50", "gitlab-rails runner", "add-redirect", "docker compose"].map(item => calls.indexOf(item));
    expect(order.every(index => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(calls).not.toContain("yzgc-backup@preview");
    expect(calls).not.toMatch(/exec yzgc-preview-server/);
    expect(f.clients("production")).toEqual([`${OLD}${CB}`, `${NEW}${CB}`]);
    expect(f.clients("preview")).toEqual([`${OLD}${CB}`]);
    expect(JSON.parse(readFileSync(f.baseline, "utf8"))).toEqual({ sector: "git.example.test", accounts: ["acct-a", "acct-b"], count: 2, missing: 0, digest: "digest-1", gitlab_users: 10, gitlab_max_id: 100 });
    expect(statSync(f.baseline).mode & 0o777).toBe(0o600);
    expect(result.stdout).toContain("搬家前基线：抽样 2 个成员（有 sub 的 2 个），GitLab 账号 10 个");
    expect(f.compose()).toBe(renderCompose(NEW));
    expect(f.compose()).not.toMatch(/hostname:/);
    expect(f.compose()).toContain('    logging:\n      driver: json-file\n      options:\n        max-size: "10m"\n        max-file: "3"\n');
    expect(readFileSync(join(f.config, "yzgc-gitlab-url"), "utf8")).toBe(`${NEW}\n`);
    expect(f.rb()).toContain("redirect_uri: File.read('/etc/gitlab/yzgc-gitlab-url').strip + '/users/auth/openid_connect/callback' },");
    expect(f.rb()).toContain("gitlab_rails['gravatar_ssl_url'] = File.read('/etc/gitlab/yzgc-gitlab-url').strip + '/nano-avatar/20261025/%{hash}?s=%{size}'");
    expect(f.rb()).not.toContain(OLD);
    expect(f.rb()).toContain(`issuer: '${PROD}/oidc'`);
    expect(calls).toContain("docker exec gitlab curl --fail --silent --max-time 10 http://127.0.0.1/gitlab/-/health");
    // 重跑不再改任何东西，也不覆盖搬家前的基线
    writeFileSync(join(f.state, "digest"), "digest-after");
    const again = f.run("move-production-path", "--apply");
    expect(again.status, again.stderr).toBe(0);
    expect(f.clients("production")).toEqual([`${OLD}${CB}`, `${NEW}${CB}`]);
    expect(JSON.parse(readFileSync(f.baseline, "utf8")).digest).toBe("digest-1");
    const moved = f.run("path-status").stdout;
    expect(moved).toContain("已搬：true");
    expect(moved).toContain("GitLab 容器日志：json-file，每份 10m，留 3 份");
  });

  it("新容器健康检查失败：恢复原 compose 与 gitlab.rb、重建原容器，撤回新回调，返回失败", () => {
    const f = pathFixture();
    const before = f.rb();
    writeFileSync(join(f.state, "new-unhealthy"), "");
    const result = f.run("move-production-path", "--apply");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("已恢复原地址");
    expect(f.compose()).toBe(f.original);
    expect(f.rb()).toBe(before);
    expect(existsSync(join(f.config, "yzgc-gitlab-url"))).toBe(false);
    expect(readFileSync(join(f.state, "running-url"), "utf8").trim()).toBe(OLD);
    expect(f.clients("production")).toEqual([`${OLD}${CB}`]);
    expect(f.called().match(/docker compose/g)).toHaveLength(2);
  });

  it("加新回调失败时 GitLab 不动；server 还是旧版本、sector 不对、GitLab 还信任预发布签发者时什么都不改", () => {
    const f = pathFixture();
    writeFileSync(join(f.state, "fail-redirect-production"), "");
    const failed = f.run("move-production-path", "--apply");
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("正式库加新回调失败");
    expect(f.compose()).toBe(f.original);
    expect(f.called()).not.toContain("docker compose");

    for (const [options, message] of [
      [{ legacy: true }, /先用 deploy-hotfix 发带 #335 的版本/],
      [{ sector: "example.test" }, /sector 不是 git\.example\.test/],
      [{ issuer: PREVIEW }, /不是正式的：先完成 switch-issuer/],
    ] as const) {
      const g = pathFixture(options);
      for (const step of ["move-production-path", "rollback-production-path", "finish-production-path"]) {
        const refused = g.run(step, "--apply");
        expect(refused.status).toBe(1);
      }
      const refused = g.run("move-production-path", "--apply");
      expect(refused.stderr).toMatch(message);
      expect(g.called()).not.toMatch(/systemctl|redirect|compose|gitlab-rails|subjects/);
    }
  });

  it("check-production-path 只读：抽样成员的 sub 与搬家前一样、新增的 GitLab 账号都是同步建的成员号才通过", () => {
    const f = pathFixture();
    expect(f.run("check-production-path").stderr).toContain("GitLab 还没搬到");
    expect(f.run("move-production-path", "--apply").status).toBe(0);
    writeFileSync(join(f.state, "new-accounts"), JSON.stringify({ users: 11, new_ids: [101] }));
    const ok = f.run("check-production-path");
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("抽样 2 个成员的 sub：和搬家前一致");
    expect(ok.stdout).toContain("GitLab 账号：搬家前 10 个，现在 11 个；搬家后新增 1 个，其中不是同步建的成员号 0 个");
    expect(f.clients("production")).toEqual([`${OLD}${CB}`, `${NEW}${CB}`]);

    writeFileSync(join(f.state, "new-accounts"), JSON.stringify({ users: 12, new_ids: [101, 102] }));
    const stray = f.run("check-production-path");
    expect(stray.status).toBe(1);
    expect(stray.stderr).toContain("搬家后多出不是成员号的 GitLab 账号 [102]");

    writeFileSync(join(f.state, "new-accounts"), JSON.stringify({ users: 10, new_ids: [] }));
    writeFileSync(join(f.state, "digest"), "digest-2");
    const changed = f.run("check-production-path");
    expect(changed.status).toBe(1);
    expect(changed.stderr).toContain("抽样的 2 个成员里有人的 sub 和搬家前对不上");
    expect(changed.stdout + changed.stderr).not.toMatch(/acct-a|acct-b/);
  });

  it("verify-accounts 在搬过地址之后再比一次基线：sub 摘要变了或多出不是成员号的账号就失败", () => {
    const f = pathFixture();
    const before = f.run("verify-accounts");
    expect(before.status, before.stderr).toBe(0);
    expect(before.stdout).not.toContain("抽样");
    expect(f.run("move-production-path", "--apply").status).toBe(0);
    const ok = f.run("verify-accounts");
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("抽样 2 个成员的 sub：和搬家前一致");
    writeFileSync(join(f.state, "new-accounts"), JSON.stringify({ users: 11, new_ids: [103] }));
    const stray = f.run("verify-accounts");
    expect(stray.status).toBe(1);
    expect(stray.stderr).toContain("[103]");
  });

  it("finish 去掉旧回调并再备份一次；没搬之前拒绝", () => {
    const f = pathFixture();
    expect(f.run("finish-production-path", "--apply").status).toBe(1);
    expect(f.run("move-production-path", "--apply").status).toBe(0);
    const dry = f.run("finish-production-path");
    expect(dry.status, dry.stderr).toBe(0);
    expect(f.clients("production")).toHaveLength(2);
    const done = f.run("finish-production-path", "--apply");
    expect(done.status, done.stderr).toBe(0);
    expect(f.clients("production")).toEqual([`${NEW}${CB}`]);
    expect(f.clients("preview")).toEqual([`${OLD}${CB}`]);
    expect(f.called().match(/systemctl start gitlab-backup\.service/g)).toHaveLength(2);
  });

  it("rollback 先补回旧回调，再恢复原 compose 与 gitlab.rb 并重建，健康后去掉新回调", () => {
    const f = pathFixture();
    const before = f.rb();
    expect(f.run("move-production-path", "--apply").status).toBe(0);
    expect(f.run("finish-production-path", "--apply").status).toBe(0);
    expect(f.clients("production")).toEqual([`${NEW}${CB}`]);
    const start = f.called().length;
    const back = f.run("rollback-production-path", "--apply");
    expect(back.status, back.stderr).toBe(0);
    const calls = f.called().slice(start);
    const order = ["add-redirect", "docker compose", "remove-redirect"].map(item => calls.indexOf(item));
    expect(order.every(index => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(f.compose()).toBe(f.original);
    expect(f.rb()).toBe(before);
    expect(readFileSync(join(f.state, "running-url"), "utf8").trim()).toBe(OLD);
    expect(f.clients("production")).toEqual([`${OLD}${CB}`]);
  });
});

describe("cutover.sh preview-sso（#335，正式与预发布一一对应）", () => {
  const previewDiscovery = JSON.stringify({ issuer: `${PREVIEW}/oidc` });

  it("缺省只演算；--apply 在预发布库登记 gitlab_preview，只写预发布实例的配置目录后 reconfigure，正式不动、secret 不打印", () => {
    const f = fixture({ discovery: previewDiscovery });
    const pre = join(f.dir, "preview-gitlab-config");
    const dry = f.run("preview-sso", "--preview-origin", PREVIEW);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain(`将登记，回调 ${PREVIEW}/gitlab/users/auth/openid_connect/callback`);
    expect(dry.stdout).toContain("演算");
    expect(f.called()).not.toMatch(/client add|reconfigure/);
    expect(readdirSync(pre)).toEqual([]);

    const applied = f.run("preview-sso", "--preview-origin", PREVIEW, "--apply");
    expect(applied.status, applied.stderr).toBe(0);
    expect(f.called()).toContain(`exec yzgc-preview-server node app/server/dist/cli/oidc.js client add --name GitLab --client-id gitlab_preview --redirect-uri ${PREVIEW}/gitlab/users/auth/openid_connect/callback`);
    expect(f.called()).toContain("exec gitlab-preview gitlab-ctl reconfigure");
    expect(f.called()).not.toMatch(/exec yzgc-production-server .*client add|exec gitlab gitlab-ctl/);
    expect(readFileSync(join(pre, "yzgc-oidc-secret"), "utf8")).toBe("brand-new-secret");
    expect(statSync(join(pre, "yzgc-oidc-secret")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(pre, "yzgc-oidc-issuer"), "utf8")).toBe(`${PREVIEW}/oidc\n`);
    expect(readFileSync(join(pre, "yzgc-gitlab-url"), "utf8")).toBe(`${PREVIEW}/gitlab\n`);
    const rb = readFileSync(join(pre, "yzgc-oidc.rb"), "utf8");
    expect(rb).toContain("identifier: 'gitlab_preview',");
    expect(rb).not.toContain("identifier: 'gitlab',");
    // 正式实例的配置一个文件都没多
    expect(existsSync(join(f.config, "yzgc-oidc-issuer"))).toBe(false);
    expect(applied.stdout + applied.stderr).not.toContain("brand-new-secret");
  });

  it("前置不满足时什么都不写：发现文档不是预发布签发者、模板地址不是本环境的 /gitlab", () => {
    const wrongIssuer = fixture();
    const r1 = wrongIssuer.run("preview-sso", "--preview-origin", PREVIEW, "--apply");
    expect(r1.status).toBe(1);
    expect(r1.stderr).toContain("issuer 不是");

    const wrongUrl = fixture({ discovery: previewDiscovery });
    writeFileSync(join(wrongUrl.dir, "preview-template.env"), `PUBLIC_ORIGIN=${PREVIEW}\nGITLAB_URL=${PROD}/gitlab\n`);
    const r2 = wrongUrl.run("preview-sso", "--preview-origin", PREVIEW, "--apply");
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain(`不是 ${PREVIEW}/gitlab`);

    for (const f of [wrongIssuer, wrongUrl]) {
      expect(f.called()).not.toMatch(/client add|reconfigure/);
      expect(readdirSync(join(f.dir, "preview-gitlab-config"))).toEqual([]);
    }
  });
});
