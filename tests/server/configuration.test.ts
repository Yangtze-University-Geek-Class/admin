import { expect, it } from "vitest";
import { assertSiteHosts, createConfig } from "../../app/server/src/config";

function env() {
  return {
    NODE_ENV: "test", PUBLIC_ORIGIN: "https://admin.example.test", SITE_ORIGIN: "https://example.test",
    FORUM_HOST: "forum.example.test", DB_PATH: ":memory:", FORUM_DB_PATH: ":memory:",
    SESSION_SECRET: "configuration-test-secret-at-least-32", ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
    OAUTH_CLIENT_ID: "test-client", OAUTH_CLIENT_SECRET: "test-secret",
  };
}
it("validates public backend/frontend hosts without reading private environment files", () => {
  const config = createConfig(env());
  const sites = { admin: { host: "admin.example.test" }, portal: { host: "example.test" }, forum: { host: "forum.example.test" } };
  expect(() => assertSiteHosts(config, sites)).not.toThrow();
  expect(() => assertSiteHosts(config, { ...sites, forum: { host: "other.example.test" } })).toThrow("hostname mismatch: forum");
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
  const container = createConfig({ ...env(), HOST: "0.0.0.0", TRUST_PROXY: "true" });
  expect([container.host, container.trustProxy]).toEqual(["0.0.0.0", true]);
  expect(createConfig({ ...env(), TRUST_PROXY: "false" }).trustProxy).toBe(false);
  expect(() => createConfig({ ...env(), HOST: "127.0.0.1:3000" })).toThrow("without a port");
});
