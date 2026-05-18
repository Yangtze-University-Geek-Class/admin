// fastify inject 端到端 HTTP 测试 invite-links DELETE
// 直接复制 invite-links.ts 的 handler 进来（去掉 preHandler 鉴权）
// 单独验证 route + body + DB DELETE + cache invalidation 链条
//
// 用法:
//   cd server && pnpm tsx scripts/test-invite-http.ts
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db.js";
import { encrypt } from "../src/lib/crypto.js";

const TEST_ORG = "test-org-http-delete";
const TEST_USER = "test-user-http";

db.prepare("DELETE FROM invite_links WHERE org = ?").run(TEST_ORG);

const token = randomBytes(18).toString("base64url");
db.prepare(
  "INSERT INTO invite_links(token, org, created_by, created_by_token_encrypted, note, max_uses, current_uses, expires_at, team_slug, disabled, created_at) VALUES(?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?)"
).run(
  token,
  TEST_ORG,
  TEST_USER,
  encrypt("fake-token"),
  null,
  10,
  Date.now() + 86400000,
  null,
  Date.now(),
);
console.log(`[setup] inserted invite_link token=${token}\n`);

const app = Fastify({ logger: false });
await app.register(cookie);

// inline GET + DELETE handler (复刻 invite-links.ts 但跳鉴权)
app.get<{ Params: { org: string } }>("/api/admin/:org/invite-links", async (req) => {
  const { org } = req.params;
  const rows = db.prepare(
    "SELECT token, org, created_by, note, max_uses, current_uses, expires_at, team_slug, disabled, created_at FROM invite_links WHERE org = ? ORDER BY created_at DESC"
  ).all(org);
  return { links: rows };
});

app.delete<{ Params: { org: string; token: string } }>(
  "/api/admin/:org/invite-links/:token",
  async (req, reply) => {
    const { org, token } = req.params;
    const r = db.prepare("DELETE FROM invite_links WHERE token = ? AND org = ?").run(token, org);
    if (r.changes === 0) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  }
);

// 1. GET 列表
const r1 = await app.inject({ method: "GET", url: `/api/admin/${TEST_ORG}/invite-links` });
const list1 = JSON.parse(r1.body);
console.log(`GET  /api/admin/${TEST_ORG}/invite-links → ${r1.statusCode}, count=${list1.links?.length}`);

// 2. DELETE 这个 token
const r2 = await app.inject({ method: "DELETE", url: `/api/admin/${TEST_ORG}/invite-links/${token}` });
console.log(`DEL  /api/admin/${TEST_ORG}/invite-links/${token} → ${r2.statusCode} body=${r2.body}`);

// 3. GET 再次
const r3 = await app.inject({ method: "GET", url: `/api/admin/${TEST_ORG}/invite-links` });
const list3 = JSON.parse(r3.body);
console.log(`GET  /api/admin/${TEST_ORG}/invite-links → ${r3.statusCode}, count=${list3.links?.length}`);

// 4. SQLite 直查
const row = db.prepare("SELECT * FROM invite_links WHERE token = ?").get(token);

// 5. 二次 DELETE
const r4 = await app.inject({ method: "DELETE", url: `/api/admin/${TEST_ORG}/invite-links/${token}` });
console.log(`DEL  again → ${r4.statusCode}, body=${r4.body}`);

console.log(`\n=== 结论 ===`);
console.log(`HTTP DELETE 返 200: ${r2.statusCode === 200 ? "✓" : "❌"}`);
console.log(`SQLite 真删: ${!row ? "✓" : "❌"}`);
console.log(`GET 列表反映删除: ${list3.links.length === list1.links.length - 1 ? "✓" : "❌"}`);
console.log(`二次 DELETE 返 404: ${r4.statusCode === 404 ? "✓" : "❌"}`);

await app.close();
process.exit(0);
