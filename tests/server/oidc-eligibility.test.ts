import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { setExclusiveGroupMembership } from "../../app/server/src/lib/permissions";
import { completeProfile, testApp } from "./helpers";

const ORIGIN = "https://example.test";
const GITLAB = "https://git.eligibility.test";
const CALLBACK = `${GITLAB}/users/auth/openid_connect/callback`;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWKS = JSON.stringify({ keys: [{ ...privateKey.export({ format: "jwk" }), kid: "eligibility-test", use: "sig", alg: "RS256" }] });
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); });

// 只替换外部 GitLab adapter；所有身份、协议、持久化与权限代码都是真实实现。
function syntheticGitlab() {
  type User = { id: number; username: string; email: string; name: string; extern_uid: string; provider: string; state: "active" | "blocked" };
  const users: User[] = [];
  const members = new Map<number, number>();
  const writes: string[] = [];
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  async function fetch(input: string, init: RequestInit = {}) {
    const url = new URL(input);
    expect(url.origin).toBe(GITLAB);
    expect(init.redirect).toBe("error");
    expect(new Headers(init.headers).get("PRIVATE-TOKEN")).toBe("synthetic-eligibility-token");
    const path = url.pathname.replace(/^\/api\/v4/, "");
    const method = init.method ?? "GET";
    if (method !== "GET") writes.push(`${method} ${path}`);
    const body = typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    if (path === "/users" && method === "GET") {
      return json(200, users.filter(user => user.provider === url.searchParams.get("provider") && user.extern_uid === url.searchParams.get("extern_uid")));
    }
    if (path === "/users" && method === "POST") {
      expect(body).toMatchObject({ provider: "openid_connect", skip_confirmation: true, force_random_password: true });
      const user: User = {
        id: users.length + 100, username: String(body.username), email: String(body.email), name: String(body.name),
        extern_uid: String(body.extern_uid), provider: String(body.provider), state: "active",
      };
      users.push(user);
      return json(201, user);
    }
    const accountPath = path.match(/^\/users\/(\d+)(?:\/(emails|block|unblock))?$/);
    if (accountPath) {
      const user = users.find(item => item.id === Number(accountPath[1]));
      if (!user) return json(404, {});
      if (method === "GET" && !accountPath[2]) return json(200, {
        ...user, is_admin: false, bot: false,
        identities: [{ provider: user.provider, extern_uid: user.extern_uid }],
      });
      if (method === "GET" && accountPath[2] === "emails") {
        return json(200, [{ id: user.id * 100, email: user.email, confirmed_at: "2026-10-26T00:00:00Z" }]);
      }
      // 统一头像（#343）：没有 GitHub 的账号也会传一张 NANO 默认头像
      if (method === "PUT" && !accountPath[2] && init.body instanceof FormData && init.body.get("avatar") instanceof Blob) return json(200, user);
      if (method === "POST" && (accountPath[2] === "block" || accountPath[2] === "unblock")) {
        user.state = accountPath[2] === "block" ? "blocked" : "active";
        return json(201, true);
      }
    }
    if (method === "POST" && path === "/groups/geek/members") {
      const id = Number(body.user_id);
      if (members.has(id)) return json(409, {});
      members.set(id, Number(body.access_level));
      return json(201, { id, access_level: body.access_level });
    }
    const membershipPath = path.match(/^\/groups\/geek\/members\/(\d+)$/);
    if (membershipPath && method === "PUT") {
      members.set(Number(membershipPath[1]), Number(body.access_level));
      return json(200, { id: Number(membershipPath[1]), access_level: body.access_level });
    }
    throw new Error(`Unexpected synthetic GitLab operation: ${method} ${path}`);
  }
  return { users, members, writes, fetch };
}

async function setup() {
  const time = { now: Date.now() };
  const gitlab = syntheticGitlab();
  const deny = async () => { throw new Error("Unexpected external request in OIDC eligibility regression"); };
  const context = await testApp({ clock: () => time.now, gitlabFetch: gitlab.fetch, githubProfileFetch: deny }, false, {
    OIDC_JWKS: JWKS, GITLAB_SYNC: "on", GITLAB_URL: GITLAB,
    GITLAB_API_TOKEN: "synthetic-eligibility-token", GITLAB_GROUP: "geek",
  });
  contexts.push(context);
  const { app } = context;
  const { clientSecret } = app.services.oidcStore.registerClient({ name: "Synthetic GitLab", clientId: "gitlab", redirectUris: [CALLBACK] });
  function account(name: string, level = "level.alumni", expiry: number | null = null) {
    const result = app.services.identity.signInWithEmailCode({ email: `${name}@eligibility.test`, claim: () => true });
    if (!result.ok) throw new Error(`Synthetic account refused: ${result.reason}`);
    completeProfile(app, result.accountId);
    setExclusiveGroupMembership(app.services.storage.db, result.accountId, level, time.now, "test", expiry);
    app.services.permissions.bump();
    return { id: result.accountId, sid: result.sid };
  }
  return { ...context, time, gitlab, clientSecret, account };
}

class BrowserCookies {
  private values = new Map<string, { name: string; value: string; path: string }>();
  constructor(sid?: string) { if (sid) this.values.set("sid;/", { name: "sid", value: sid, path: "/" }); }
  store(response: LightMyRequestResponse) {
    const raw = response.headers["set-cookie"];
    for (const line of Array.isArray(raw) ? raw : raw ? [raw] : []) {
      const [pair, ...attributes] = line.split(";").map(part => part.trim());
      const at = pair.indexOf("=");
      const name = pair.slice(0, at), value = pair.slice(at + 1);
      const path = attributes.find(part => /^path=/i.test(part))?.slice(5) ?? "/";
      const key = `${name};${path}`;
      if (!value || attributes.some(part => /^max-age=0$/i.test(part))) this.values.delete(key);
      else this.values.set(key, { name, value, path });
    }
  }
  header(path: string) {
    return [...this.values.values()].filter(cookie => cookie.path === "/" || path === cookie.path || path.startsWith(`${cookie.path}/`))
      .map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
  }
}

async function visit(app: FastifyInstance, cookies: BrowserCookies, address: string, method: "GET" | "POST" = "GET") {
  const url = new URL(address, ORIGIN);
  if (url.origin !== ORIGIN) throw new Error("OIDC test tried to leave the synthetic app");
  const response = await app.inject({
    method, url: url.pathname + url.search,
    headers: { cookie: cookies.header(url.pathname), ...(method === "POST" ? { origin: ORIGIN } : {}) },
  });
  cookies.store(response);
  return response;
}

async function follow(app: FastifyInstance, cookies: BrowserCookies, address: string): Promise<{ callback: URL | null; consent: string | null; signin: boolean }> {
  for (let hops = 0; hops < 10; hops++) {
    const response = await visit(app, cookies, address);
    expect([302, 303]).toContain(response.statusCode);
    const location = response.headers.location!;
    if (location.startsWith(CALLBACK)) return { callback: new URL(location), consent: null, signin: false };
    if (location.startsWith("/authorize?uid=")) return { callback: null, consent: new URL(location, ORIGIN).searchParams.get("uid"), signin: false };
    if (location.startsWith("/signin?")) return { callback: null, consent: null, signin: true };
    address = location;
  }
  throw new Error("OIDC redirect bound exceeded");
}

function authorization() {
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: "gitlab", response_type: "code", redirect_uri: CALLBACK, scope: "openid profile email",
    state: "eligibility-state", nonce: "eligibility-nonce",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
  });
  return { url: `/oidc/auth?${query}`, verifier };
}

async function login(app: FastifyInstance, cookies: BrowserCookies, secret: string) {
  const auth = authorization();
  let result = await follow(app, cookies, auth.url);
  if (result.consent) {
    const details = await visit(app, cookies, `/oidc/interaction/${result.consent}/details`);
    expect(details.statusCode).toBe(200);
    const confirmed = await visit(app, cookies, `/oidc/interaction/${result.consent}/confirm`, "POST");
    expect(confirmed.statusCode).toBe(200);
    result = await follow(app, cookies, confirmed.json().redirect_to);
  }
  expect(result.callback?.searchParams.get("error")).toBeNull();
  const code = result.callback?.searchParams.get("code");
  expect(code).toBeTruthy();
  const response = await app.inject({
    method: "POST", url: "/oidc/token",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`gitlab:${secret}`).toString("base64")}` },
    payload: new URLSearchParams({ grant_type: "authorization_code", redirect_uri: CALLBACK, code: code!, code_verifier: auth.verifier }).toString(),
  });
  expect(response.statusCode).toBe(200);
  const tokens = response.json();
  const claims = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString());
  expect(claims).toMatchObject({ iss: `${ORIGIN}/oidc`, aud: "gitlab", nonce: "eligibility-nonce" });
  return { accessToken: tokens.access_token as string, sub: claims.sub as string };
}

const userinfo = (app: FastifyInstance, token: string) => app.inject({ url: "/oidc/me", headers: { authorization: `Bearer ${token}` } });

describe("real OIDC and synthetic GitLab eligibility integration", () => {
  it("keeps alumni and alumni-owner subjects and provider mappings stable over two login/sync rounds", async () => {
    const { app, time, gitlab, account, clientSecret } = await setup();
    const alumni = account("alumni", "level.alumni", time.now + 2000);
    const owner = account("alumni-owner");
    const onlyOwner = account("registered-owner-only", "level.registered");
    setExclusiveGroupMembership(app.services.storage.db, owner.id, "title.site.owner", time.now, "test", time.now + 1000);
    setExclusiveGroupMembership(app.services.storage.db, onlyOwner.id, "title.site.owner", time.now, "test");
    const browsers = [new BrowserCookies(alumni.sid), new BrowserCookies(owner.sid)];
    const first = [await login(app, browsers[0], clientSecret), await login(app, browsers[1], clientSecret)];
    expect(first[0].sub).not.toBe(first[1].sub);
    expect((await userinfo(app, first[0].accessToken)).statusCode).toBe(200);
    expect((await userinfo(app, first[1].accessToken)).statusCode).toBe(200);
    const firstSync = await app.services.gitlab.reconcile();
    expect(firstSync).toMatchObject({ failed: 0, skipped: null });
    expect(gitlab.users).toHaveLength(2);
    const external = first.map(item => gitlab.users.find(user => user.extern_uid === item.sub)!);
    expect(external.every(user => user.provider === "openid_connect" && user.state === "active")).toBe(true);
    expect(external.map(user => gitlab.members.get(user.id))).toEqual([30, 50]);
    expect(app.services.gitlab.gitlabUserFor(alumni.id)).toMatchObject({ gitlabUserId: external[0].id, state: "active" });
    expect(await app.services.gitlab.accountForGitlabUser(external[1].id)).toBe(owner.id);
    const writes = gitlab.writes.length;
    const second = [await login(app, browsers[0], clientSecret), await login(app, browsers[1], clientSecret)];
    expect(second.map(item => item.sub)).toEqual(first.map(item => item.sub));
    expect((await app.services.gitlab.reconcile()).failed).toBe(0);
    expect(gitlab.users.map(user => user.id).sort()).toEqual(external.map(user => user.id).sort());
    expect(gitlab.writes.length).toBe(writes);

    time.now += 1000;
    expect((await app.services.gitlab.reconcile()).failed).toBe(0);
    expect(external[1].state).toBe("active");
    expect(gitlab.members.get(external[1].id)).toBe(30);
    expect((await userinfo(app, first[1].accessToken)).statusCode).toBe(200);
    time.now += 1000;
    expect((await userinfo(app, first[0].accessToken)).statusCode).toBe(401);
    const expiredAuth = await follow(app, browsers[0], authorization().url);
    expect(expiredAuth.callback?.searchParams.get("error")).toBe("access_denied");
    expect((await app.services.gitlab.reconcile()).failed).toBe(0);
    expect(external[0].state).toBe("blocked");
    expect(external[1].state).toBe("active");
    expect(gitlab.users).toHaveLength(2);
    console.log(JSON.stringify({ oidcRounds: 2, syncStableUsers: 2, initialAccess: [30, 50], expiredOwnerAccess: 30, expiredAlumniUserinfo: 401, expiredAlumniState: external[0].state }));
  });

  it.each(["registered", "owner-only", "expired-member", "expired-alumni"] as const)("denies downstream authorization for %s without changing the local identity", async kind => {
    const { app, time, account } = await setup();
    const level = kind === "expired-member" ? "level.member" : kind === "expired-alumni" ? "level.alumni" : "level.registered";
    const target = account(kind, level, kind.startsWith("expired") ? time.now : null);
    if (kind === "owner-only") setExclusiveGroupMembership(app.services.storage.db, target.id, "title.site.owner", time.now, "test");
    const result = await follow(app, new BrowserCookies(target.sid), authorization().url);
    expect(result.callback?.searchParams.get("error")).toBe("access_denied");
    expect(app.services.identity.getAccountClaims(target.id)).toMatchObject({ account_id: target.id, status: "active", member: false, site_role: null });
  });

  it("revokes issued userinfo tokens and sync access when a member becomes disabled", async () => {
    const { app, account, clientSecret, gitlab } = await setup();
    const target = account("disabled-member", "level.member");
    const cookies = new BrowserCookies(target.sid);
    const token = await login(app, cookies, clientSecret);
    expect((await app.services.gitlab.reconcile()).failed).toBe(0);
    const external = gitlab.users.find(user => user.extern_uid === token.sub)!;
    app.services.storage.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(target.id);
    expect((await userinfo(app, token.accessToken)).statusCode).toBe(401);
    expect((await follow(app, cookies, authorization().url)).signin).toBe(true);
    expect(app.services.identity.signInWithEmailCode({ email: "disabled-member@eligibility.test", claim: () => true })).toMatchObject({ ok: false, reason: "account_disabled" });
    expect((await app.services.gitlab.reconcile()).failed).toBe(0);
    expect(external.state).toBe("blocked");
  });
});
