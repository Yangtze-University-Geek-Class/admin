import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENV_FILES, PER_ENVIRONMENT_KEYS, checkEnvFiles, checkHardcodedOrigins, checkRepository, countOrigins, isScanned, parseEnv,
} from "../../scripts/check-env-isolation.mjs";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const origins = { production: "https://yangtzeu.work", preview: "https://prev.yangtzeu.work" };
const real = () => ({ production: read(ENV_FILES.production), preview: read(ENV_FILES.preview), dev: read(ENV_FILES.dev) });
const rules = (findings: { rule: string }[]) => findings.map(f => f.rule);

describe("三份 env 模板的隔离", () => {
  it("仓库里的三份模板和代码登记现在是通过的", () => {
    expect(checkRepository(root)).toEqual([]);
  });

  it("把预发布域名写进正式模板会失败", () => {
    const files = real();
    files.production = files.production.replace("TRUST_PROXY=2", "TRUST_PROXY=2\nGITLAB_ISSUER=https://prev.yangtzeu.work/oidc");
    const findings = checkEnvFiles(files, origins);
    expect(rules(findings)).toContain("foreign");
    expect(findings.find(f => f.rule === "foreign")?.file).toBe(ENV_FILES.production);
  });

  it("把正式域名写进预发布模板会失败，说明文字里提到别的环境不算", () => {
    const files = real();
    files.preview += "\n# 正式是 https://yangtzeu.work\n";
    expect(rules(checkEnvFiles(files, origins))).not.toContain("foreign");
    files.preview = files.preview.replace("MAIL_REPLY_TO=", "MAIL_REPLY_TO=\nWEB_MIRROR=https://yangtzeu.work");
    expect(rules(checkEnvFiles(files, origins))).toContain("foreign");
  });

  it("共用的 cdn、git 子域名不算别的环境", () => {
    expect(countOrigins("https://cdn.yangtzeu.work/x https://git.yangtzeu.work/y https://github.yangtzeu.work")).toEqual({ production: 0, preview: 0 });
    expect(countOrigins("https://yangtzeu.work/x https://prev.yangtzeu.work/y")).toEqual({ production: 1, preview: 1 });
  });

  it("三份键集不一致会失败", () => {
    const files = real();
    files.dev = files.dev.replace(/^GITLAB_GROUP=.*$/m, "");
    const findings = checkEnvFiles(files, origins);
    expect(findings.find(f => f.rule === "keys")?.message).toContain("GITLAB_GROUP");
  });

  it("正式和预发布除登记的键以外值必须相同", () => {
    const files = real();
    files.preview = files.preview.replace("POW_DIFFICULTY=3", "POW_DIFFICULTY=1");
    const findings = checkEnvFiles(files, origins);
    expect(findings.find(f => f.rule === "parity")?.message).toContain("POW_DIFFICULTY");
    for (const key of PER_ENVIRONMENT_KEYS) expect(parseEnv(real().production).values.has(key)).toBe(true);
  });

  it.each(['GITLAB_URL', 'GITLAB_STACK_ROOT', 'GITLAB_HTTP_BIND', 'GITLAB_DOCKER_SUBNET', 'GITLAB_DOCKER_GATEWAY'])('拒绝两个实例复用 %s', key => {
    const files = real();
    const production = parseEnv(files.production).values.get(key)!;
    files.preview = files.preview.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${production}`);
    expect(checkEnvFiles(files, origins).some(finding => finding.rule === 'gitlab_isolation' && finding.message.includes(key))).toBe(true);
  });

  it("名字像密钥的键必须留空，本机必须不外发不同步", () => {
    const files = real();
    files.dev = files.dev.replace("OIDC_JWKS=", "OIDC_JWKS=abcdef").replace("GITLAB_SYNC=off", "GITLAB_SYNC=on").replace("MAIL_RECIPIENTS=allowlist", "MAIL_RECIPIENTS=all");
    const findings = checkEnvFiles(files, origins);
    expect(findings.filter(f => f.rule === "secret").map(f => f.message).join()).toContain("OIDC_JWKS");
    expect(findings.filter(f => f.rule === "dev_safety")).toHaveLength(2);
  });

  it("本机模板只指向回环", () => {
    const files = real();
    files.dev = files.dev.replace("PUBLIC_ORIGIN=http://127.0.0.1:5173", "PUBLIC_ORIGIN=https://yangtzeu.work");
    expect(rules(checkEnvFiles(files, origins))).toEqual(expect.arrayContaining(["foreign", "identity"]));
  });

  it("缺少文件、重复定义的键会报出来", () => {
    expect(rules(checkEnvFiles({ production: "A=1", preview: "A=1" } as never, origins))).toContain("missing");
    const files = real();
    files.preview += "\nPORT=3001\n";
    expect(rules(checkEnvFiles(files, origins))).toContain("syntax");
  });
});

describe("代码里写死的环境域名", () => {
  const entry = (extra = {}) => ({ file: "a/b.ts", max: 1, reason: "说明性注释，不参与运行", ...extra });
  const file = (text: string, path = "a/b.ts") => ({ path, text });

  it("没有登记的文件出现域名会失败", () => {
    expect(rules(checkHardcodedOrigins([file("const o = 'https://prev.yangtzeu.work'")], []))).toEqual(["hardcoded"]);
  });

  it("登记过的文件不能超过次数上限", () => {
    expect(checkHardcodedOrigins([file("https://yangtzeu.work")], [entry()])).toEqual([]);
    expect(rules(checkHardcodedOrigins([file("https://yangtzeu.work https://yangtzeu.work")], [entry()]))).toEqual(["hardcoded"]);
  });

  it("only 限定的文件里出现另一个环境的域名会失败", () => {
    const e = entry({ only: "preview", max: 2 });
    expect(checkHardcodedOrigins([file("https://prev.yangtzeu.work")], [e])).toEqual([]);
    expect(rules(checkHardcodedOrigins([file("https://prev.yangtzeu.work https://yangtzeu.work")], [e]))).toEqual(["cross_environment"]);
  });

  it("登记了却已经没有域名的文件要从登记里删掉", () => {
    expect(rules(checkHardcodedOrigins([file("没有域名")], [entry()]))).toEqual(["stale_exception"]);
  });

  it("登记项必须写理由、次数和合法的 only", () => {
    expect(rules(checkHardcodedOrigins([], [{ file: "x", max: 0, reason: "原因原因原因原因" } as never]))).toEqual(["exception"]);
    expect(rules(checkHardcodedOrigins([file("https://yangtzeu.work")], [entry({ reason: "短" })]))).toContain("exception");
    expect(rules(checkHardcodedOrigins([file("https://yangtzeu.work")], [entry({ only: "dev" })]))).toContain("exception");
  });

  it("文档、测试、执行记录和锁文件不在扫描范围，部署片段在", () => {
    for (const path of ["docs/ops/DEPLOY.md", "notes/2026-10-28/x.md", "tests/tooling/a.test.ts", "app/forum/tests/a.test.ts", "pnpm-lock.yaml", "deploy/env/.env.preview", "README.md"]) {
      expect(isScanned(path)).toBe(false);
    }
    for (const path of ["deploy/gitlab/gitlab-oidc.rb", "deploy/nginx/production.conf", ".github/workflows/deploy-production.yml", "app/server/src/lib/mail/mailer.ts", "scripts/deploy-manual.mjs"]) {
      expect(isScanned(path)).toBe(true);
    }
  });

  it("GitLab 登录片段不含任何环境域名，签发者读宿主文件", () => {
    const snippet = read("deploy/gitlab/gitlab-oidc.rb");
    expect(countOrigins(snippet)).toEqual({ production: 0, preview: 0 });
    expect(snippet).toContain("File.read('/etc/gitlab/yzgc-oidc-issuer')");
  });
});
