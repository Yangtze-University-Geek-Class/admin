import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// CDN 镜像（#309）：Garage 是单节点单副本，Arch 每天拉一份只读镜像。这里用假 rclone 跑完整的 run / watch，
// 不连任何真实主机，验证“核验不通过就失败、失败不覆盖上次成功时间、过期会报警”。
const root = process.cwd();
const script = join(root, "deploy/remote/cdn-mirror.sh");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const hasJq = spawnSync("jq", ["--version"]).status === 0;

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

type Stub = { remote?: Record<string, { count: number; bytes: number }>; local?: Record<string, { count: number; bytes: number }>; syncRc?: number; checkRc?: number; failRemoteSizeCall?: number };

function fixture(stub: Stub = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cdn-mirror-"));
  dirs.push(dir);
  const bin = join(dir, "bin");
  const state = join(dir, "state");
  mkdirSync(bin);
  mkdirSync(state);
  writeFileSync(join(state, "remote.json"), JSON.stringify(stub.remote ?? {}));
  writeFileSync(join(state, "local.json"), JSON.stringify(stub.local ?? {}));
  writeFileSync(join(state, "sync-rc"), String(stub.syncRc ?? 0));
  writeFileSync(join(state, "check-rc"), String(stub.checkRc ?? 0));
  writeFileSync(join(state, "fail-remote-size-call"), String(stub.failRemoteSizeCall ?? 0));
  writeFileSync(join(state, "remote-size-calls"), "0");
  // 假 rclone：size 读 remote/local 表，sync/check 返回预设退出码；假 flock 永远拿到锁
  writeFileSync(join(bin, "rclone"), `#!/usr/bin/env bash
state="${state}"
sub="$1"; shift
target=""
for a in "$@"; do case "$a" in -*) ;; *) [[ -z "$target" ]] && target="$a" ;; esac; done
case "$sub" in
  size) case "$target" in CDN:*) f=remote ;; *) f=local ;; esac
        if [[ "$f" == remote ]]; then n=$(( $(cat "$state/remote-size-calls") + 1 )); echo "$n" > "$state/remote-size-calls"; [[ "$n" == "$(cat "$state/fail-remote-size-call")" ]] && exit 1; fi
        name="\${target#CDN:}"; name="\${name##*/}"
        jq -c --arg n "$name" '.[$n] // {count:0,bytes:0}' "$state/$f.json" ;;
  sync) exit "$(cat "$state/sync-rc")" ;;
  check) echo "ERROR : x: sizes differ" >&2; exit "$(cat "$state/check-rc")" ;;
  *) exit 2 ;;
esac
`, { mode: 0o755 });
  writeFileSync(join(bin, "flock"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  const mirror = join(dir, "mirror");
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: dir,
    CDN_MIRROR_ENV: join(dir, "absent-env"),
    CDN_MIRROR_ROOT: mirror,
    CDN_MIRROR_BUCKETS: "alpha beta",
    CDN_MIRROR_ACCESS_KEY_ID: "GKtestid",
    CDN_MIRROR_SECRET_ACCESS_KEY: "testsecret",
    CDN_MIRROR_MIN_FREE_GIB: "0",
  };
  const run = (mode: string, extra: Record<string, string> = {}) => spawnSync("bash", [script, mode], { env: { ...env, ...extra }, encoding: "utf8" });
  const status = () => JSON.parse(readFileSync(join(mirror, "status.json"), "utf8"));
  return { dir, mirror, run, status, state };
}

const same = { alpha: { count: 3, bytes: 30 }, beta: { count: 1, bytes: 5 } };

describe.skipIf(!hasJq)("cdn-mirror.sh run", () => {
  it("两个桶都核验一致时记成功，写出对象数和字节数，并清掉旧的 ALERT", () => {
    const f = fixture({ remote: same, local: same });
    mkdirSync(f.mirror, { recursive: true });
    writeFileSync(join(f.mirror, "ALERT"), "old");
    const result = f.run("run");
    expect(result.status, result.stderr).toBe(0);
    const status = f.status();
    expect(status.ok).toBe(true);
    expect(status.last_success_at).toBe(status.finished_at);
    expect(status.buckets).toEqual({ alpha: { objects: 3, bytes: 30, verified: true }, beta: { objects: 1, bytes: 5, verified: true } });
    expect(existsSync(join(f.mirror, "ALERT"))).toBe(false);
  });

  it("二次核验时读不到大小：这个桶记失败，后面的桶照常同步，status 不停留在上次的成功", () => {
    // alpha 第一次对不上才会走二次核验：源桶的第 3 次 size 调用就是二次核验里的那一次
    const f = fixture({ remote: same, local: { alpha: { count: 3, bytes: 29 }, beta: same.beta }, failRemoteSizeCall: 3 });
    mkdirSync(f.mirror, { recursive: true });
    writeFileSync(join(f.mirror, "status.json"), JSON.stringify({ ok: true, last_success_at: "2026-10-27T00:00:00Z", buckets: {} }));
    const result = f.run("run");
    expect(result.status).toBe(1);
    const status = f.status();
    expect(status.ok).toBe(false);
    expect(status.error).toContain("alpha");
    expect(status.buckets.beta).toEqual({ objects: 1, bytes: 5, verified: true });
    expect(status.last_success_at).toBe("2026-10-27T00:00:00Z");
  });

  it("镜像与源桶字节数对不上就失败，并保留上一次成功的时间", () => {
    const f = fixture({ remote: same, local: { alpha: { count: 3, bytes: 29 }, beta: same.beta } });
    mkdirSync(f.mirror, { recursive: true });
    writeFileSync(join(f.mirror, "status.json"), JSON.stringify({ ok: true, last_success_at: "2026-10-27T18:20:00Z", buckets: {} }));
    const result = f.run("run");
    expect(result.status).toBe(1);
    const status = f.status();
    expect(status.ok).toBe(false);
    expect(status.error).toContain("alpha: 核验失败");
    expect(status.last_success_at).toBe("2026-10-27T18:20:00Z");
    expect(status.buckets.beta.verified).toBe(true);
  });

  it("逐对象核验失败、同步失败、读不到源桶，各自记到对应的桶", () => {
    expect(fixture({ remote: same, local: same, checkRc: 1 }).run("run").status).toBe(1);
    const sync = fixture({ remote: same, local: same, syncRc: 1 });
    expect(sync.run("run").status).toBe(1);
    expect(sync.status().error).toContain("同步失败");
  });

  it("源桶读成空而镜像里有内容时拒绝同步", () => {
    const f = fixture({ remote: { alpha: { count: 0, bytes: 0 }, beta: same.beta }, local: same });
    mkdirSync(join(f.mirror, "current/alpha"), { recursive: true });
    writeFileSync(join(f.mirror, "current/alpha/kept.txt"), "x");
    const result = f.run("run");
    expect(result.status).toBe(1);
    expect(f.status().error).toContain("源桶读成空但镜像非空，拒绝同步");
    expect(readFileSync(join(f.mirror, "current/alpha/kept.txt"), "utf8")).toBe("x");
  });

  it("缺少密钥或桶名不合法时直接退出，不写成功", () => {
    const f = fixture({ remote: same, local: same });
    expect(f.run("run", { CDN_MIRROR_SECRET_ACCESS_KEY: "" }).status).not.toBe(0);
    expect(f.run("run", { CDN_MIRROR_BUCKETS: "../etc" }).status).not.toBe(0);
    expect(existsSync(join(f.mirror, "status.json"))).toBe(false);
  });

  it("磁盘余量低于阈值时停止并记失败", () => {
    const f = fixture({ remote: same, local: same });
    const result = f.run("run", { CDN_MIRROR_MIN_FREE_GIB: "99999999" });
    expect(result.status).not.toBe(0);
    expect(f.status().error).toContain("低于");
  });

  it("只清理 trash 下过期的整次运行目录，镜像本体不动", () => {
    const f = fixture({ remote: same, local: same });
    const old = join(f.mirror, "trash/20260101T000000Z/alpha");
    const fresh = join(f.mirror, "trash/20261028T000000Z/alpha");
    for (const path of [old, fresh, join(f.mirror, "current/alpha")]) mkdirSync(path, { recursive: true });
    writeFileSync(join(f.mirror, "current/alpha/a.txt"), "a");
    writeFileSync(join(fresh, "gone.txt"), "g");
    spawnSync("touch", ["-t", "202601010000", join(f.mirror, "trash/20260101T000000Z")]);
    expect(f.run("run").status).toBe(0);
    expect(readdirSync(join(f.mirror, "trash"))).toEqual(["20261028T000000Z"]);
    expect(existsSync(join(f.mirror, "current/alpha/a.txt"))).toBe(true);
  });
});

describe.skipIf(!hasJq)("cdn-mirror.sh watch", () => {
  const writeStatus = (f: ReturnType<typeof fixture>, status: object) => {
    mkdirSync(f.mirror, { recursive: true });
    writeFileSync(join(f.mirror, "status.json"), JSON.stringify(status));
  };
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString().replace(/\.\d+Z$/, "Z");

  it("从未运行过报警", () => {
    const f = fixture();
    const result = f.run("watch");
    expect(result.status).toBe(1);
    expect(readFileSync(join(f.mirror, "ALERT"), "utf8")).toContain("从未运行过");
  });

  it("最近一次失败、成功时间过期都报警；新鲜成功则清掉 ALERT", () => {
    const f = fixture();
    writeStatus(f, { ok: false, error: "alpha: 同步失败", last_success_at: hoursAgo(1) });
    expect(f.run("watch").status).toBe(1);
    expect(readFileSync(join(f.mirror, "ALERT"), "utf8")).toContain("alpha: 同步失败");

    writeStatus(f, { ok: true, error: "", last_success_at: hoursAgo(40) });
    expect(f.run("watch").status).toBe(1);
    expect(readFileSync(join(f.mirror, "ALERT"), "utf8")).toContain("40 小时没有成功同步");

    writeStatus(f, { ok: true, error: "", last_success_at: hoursAgo(5) });
    expect(f.run("watch").status).toBe(0);
    expect(existsSync(join(f.mirror, "ALERT"))).toBe(false);
  });

  it("阈值可调，缺少 last_success_at 也报警", () => {
    const f = fixture();
    writeStatus(f, { ok: true, error: "", last_success_at: hoursAgo(5) });
    expect(f.run("watch", { CDN_MIRROR_MAX_AGE_HOURS: "2" }).status).toBe(1);
    writeStatus(f, { ok: true, error: "" });
    expect(f.run("watch").status).toBe(1);
  });
});

describe("镜像脚本与 systemd 单元的合同", () => {
  const sh = read("deploy/remote/cdn-mirror.sh");

  it("同步一律带 --backup-dir，不使用会直接丢数据的命令，不写死密钥", () => {
    expect(sh).toMatch(/rclone sync [^\n]*--backup-dir/);
    expect(sh.match(/rclone sync/g)).toHaveLength(2);
    expect(sh.match(/--backup-dir/g)).toHaveLength(2);
    expect(sh).not.toMatch(/rclone (delete|purge|deletefile|move|copy)\b/);
    expect(sh).not.toMatch(/\b(GK[0-9a-f]{20,}|AKIA[0-9A-Z]{16})\b/);
    expect(sh).toContain("flock -n 200");
    expect(sh).toContain("RCLONE_CONFIG_CDN_USE_ACCEPT_ENCODING_GZIP=false");
  });

  it("端点默认走 cdn 共用域名，不含任何环境域名", () => {
    expect(sh).toContain("https://cdn.yangtzeu.work");
    expect(sh).not.toMatch(/prev\.yangtzeu\.work|https:\/\/yangtzeu\.work/);
  });

  it("单元文件指向安装路径和脚本子命令，定时在凌晨且早于 GitLab 备份", () => {
    const service = read("deploy/remote/systemd/cdn-mirror.service");
    expect(service).toContain("EnvironmentFile=/etc/cdn-mirror/env");
    expect(service).toContain("ExecStart=/bin/bash /opt/yzgc/tools/cdn-mirror.sh run");
    expect(service).toContain("Type=oneshot");
    expect(service).toContain("BindReadOnlyPaths=-/etc/cdn-mirror/hosts:/etc/hosts");
    expect(service).toContain("Environment=GODEBUG=netdns=go");
    expect(read("deploy/remote/systemd/cdn-mirror.timer")).toContain("OnCalendar=*-*-* 02:20:00 Asia/Shanghai");
    expect(read("deploy/gitlab/gitlab-backup.timer")).toContain("03:30:00");
    expect(read("deploy/remote/systemd/cdn-mirror-watch.service")).toContain("cdn-mirror.sh watch");
    expect(read("deploy/remote/systemd/cdn-mirror-watch.timer")).toMatch(/OnUnitActiveSec=1h/);
  });

  it("站点编排单元用 Wants 依赖 egress，隧道抖动不会停掉容器", () => {
    const compose = read("deploy/remote/systemd/yzgc-compose@.service");
    expect(compose).toMatch(/^Wants=yzgc-egress\.service$/m);
    expect(compose).not.toMatch(/^Requires=.*yzgc-egress/m);
    const watchdog = read("deploy/remote/systemd/hk-tunnel-watchdog.service.d/tolerate-loss.conf");
    expect(watchdog).toContain("ping -c3");
    expect(watchdog).toContain("10\\.66\\.0\\.2");
  });
});
