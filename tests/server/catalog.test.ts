import { expect, it } from "vitest";
import { buildApp, type BuildAppOptions } from "../../app/server/src/app";
import { testConfig } from "./helpers";

it("observes the real root, nested and generated routes without listening or changing responses", async () => {
  const routes: { method: string | string[]; url: string; schema?: unknown }[] = [];
  const config = testConfig({
    NODE_ENV: "test", PUBLIC_ORIGIN: "https://example.test", DB_PATH: ":memory:",
    SESSION_SECRET: "isolated-core-test-secret-at-least-32",
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    OAUTH_CLIENT_ID: "test-client", OAUTH_CLIENT_SECRET: "test-only-placeholder",
  });
  const deny = () => { throw new Error("Unexpected external request"); };
  const options: BuildAppOptions & { observeRoute: (route: typeof routes[number]) => void } = {
    config, staticRoot: false, observeRoute: route => { routes.push(route); },
    overrides: { octokitFactory: deny, httpRequest: deny, mailFetch: deny },
  };
  const app = await buildApp(options);
  try {
    await app.ready();
    const keys = routes.flatMap(route => [route.method].flat().map(method => `${method} ${route.url}`));
    expect(keys).toContain("GET /healthz");
    expect(keys).toContain("PUT /api/forum/me/avatar");
    expect(keys).toContain("POST /api/forum/topics/:topic_id/pin");
    expect(keys).toContain("POST /api/forum/topics/:topic_id/close");
    expect(keys).toContain("HEAD /api/forum/state");
    expect(keys).toContain("OPTIONS /auth/forum/*");
    expect(routes.find(route => route.url === "/api/docs/:id")?.schema).toHaveProperty("params");
    expect(app.server.listening).toBe(false);
    expect((await app.inject("/healthz")).json()).toMatchObject({ ok: true });
    expect((await app.inject("/api/docs")).json().items).toHaveLength(4);
    expect((await app.inject("/api/console/me")).statusCode).toBe(401);
  } finally {
    await app.close();
  }
});
