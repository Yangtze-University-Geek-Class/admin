import { expect, it } from "vitest";
import { createConfig } from "../../app/server/src/config";

function env() {
  return {
    NODE_ENV: "test", PUBLIC_ORIGIN: "https://example.test", DB_PATH: ":memory:", FORUM_DB_PATH: ":memory:",
    SESSION_SECRET: "configuration-test-secret-at-least-32", ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
    OAUTH_CLIENT_ID: "test-client", OAUTH_CLIENT_SECRET: "test-secret",
  };
}
it("keeps exactly one public origin and ignores the retired per-site host variables", () => {
  const config = createConfig({ ...env(), SITE_ORIGIN: "https://other.example.test", ADMIN_HOST: "admin.example.test", PORTAL_HOST: "x.example.test", FORUM_HOST: "y.example.test" });
  expect(config.publicOrigin).toBe("https://example.test");
  expect(config).not.toHaveProperty("siteOrigin");
  expect(config).not.toHaveProperty("siteHosts");
  expect(createConfig({ ...env(), PUBLIC_ORIGIN: "https://example.test/" }).publicOrigin).toBe("https://example.test");
  for (const origin of ["https://example.test/admin", "https://user:pass@example.test", "https://example.test/?q=1", "ftp://example.test"]) {
    expect(() => createConfig({ ...env(), PUBLIC_ORIGIN: origin })).toThrow("plain HTTP(S) origin");
  }
  const { PUBLIC_ORIGIN: _omitted, ...missing } = env();
  expect(() => createConfig(missing)).toThrow("missing env: PUBLIC_ORIGIN");
});
it("rejects invalid runtime credentials, production HTTP and unbounded PoW", () => {
  expect(() => createConfig({ ...env(), ENCRYPTION_KEY: "invalid" })).toThrow("32 bytes");
  expect(() => createConfig({ ...env(), SESSION_SECRET: "short" })).toThrow("32 characters");
  expect(() => createConfig({ ...env(), NODE_ENV: "production", PUBLIC_ORIGIN: "http://localhost:5173" })).toThrow("HTTPS");
  expect(() => createConfig({ ...env(), POW_DIFFICULTY: "99" })).toThrow("0 to 5");
});
it("stays on loopback unless a container deployment asks for another interface", () => {
  const local = createConfig(env());
  expect([local.host, local.trustProxy]).toEqual(["127.0.0.1", "loopback"]);
  // 部署的两层反代（宿主 nginx、web 容器 nginx）写成层数 2，见 deploy/env/.env.<环境>。
  const container = createConfig({ ...env(), HOST: "0.0.0.0", TRUST_PROXY: "2" });
  expect([container.host, container.trustProxy]).toEqual(["0.0.0.0", 2]);
  expect(createConfig({ ...env(), TRUST_PROXY: "1" }).trustProxy).toBe(1);
  expect(createConfig({ ...env(), TRUST_PROXY: "true" }).trustProxy).toBe(true);
  expect(createConfig({ ...env(), TRUST_PROXY: "false" }).trustProxy).toBe(false);
  expect(createConfig({ ...env(), TRUST_PROXY: "0" }).trustProxy).toBe(false);
  expect(createConfig({ ...env(), TRUST_PROXY: "10.0.0.0/8, 127.0.0.1" }).trustProxy).toBe("10.0.0.0/8, 127.0.0.1");
  for (const value of ["-1", "1.5", "11", "+2"]) expect(() => createConfig({ ...env(), TRUST_PROXY: value })).toThrow("TRUST_PROXY");
  expect(() => createConfig({ ...env(), HOST: "127.0.0.1:3000" })).toThrow("without a port");
});
