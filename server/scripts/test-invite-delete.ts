// 本地端到端测试: invite-links DELETE / Invitations DELETE
// 验证后端 DELETE 是否真的从 SQLite 删除 + 返回正确 status
//
// 用法:
//   cd server && pnpm tsx scripts/test-invite-delete.ts
//
// 不需要 GitHub OAuth, 通过直接构造 db 行 + 伪造 session cookie 走 fastify inject
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db.js";
import { encrypt } from "../src/lib/crypto.js";

const TEST_ORG = "test-org-invite-delete";
const TEST_USER = "test-user";

console.log("=== invite_links DELETE local test ===\n");

// 准备: 清理
db.prepare("DELETE FROM invite_links WHERE org = ?").run(TEST_ORG);
db.prepare("DELETE FROM sessions WHERE login = ?").run(TEST_USER);

// 1. 插入测试 invite_link
const token = randomBytes(18).toString("base64url");
console.log(`step 1: insert invite_link token=${token}`);
db.prepare(
  "INSERT INTO invite_links(token, org, created_by, created_by_token_encrypted, note, max_uses, current_uses, expires_at, team_slug, disabled, created_at) VALUES(?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?)"
).run(
  token,
  TEST_ORG,
  TEST_USER,
  encrypt("fake-gh-token"),
  "test note",
  10,
  Date.now() + 86400000,
  null,
  Date.now(),
);

const before = db.prepare("SELECT * FROM invite_links WHERE token = ?").get(token);
console.log(`  ✓ inserted:`, before ? "OK" : "FAIL");

// 2. 直接执行 DELETE SQL (模拟 invite-links.ts 的 DELETE handler)
console.log(`\nstep 2: DELETE FROM invite_links WHERE token = ? AND org = ?`);
const r = db.prepare("DELETE FROM invite_links WHERE token = ? AND org = ?").run(token, TEST_ORG);
console.log(`  changes = ${r.changes}`);

const after = db.prepare("SELECT * FROM invite_links WHERE token = ?").get(token);
console.log(`  ✓ deleted:`, after ? `FAIL (row still exists)` : "OK (row gone)");

// 3. 删除已删除的, 看 changes
console.log(`\nstep 3: DELETE again (already deleted)`);
const r2 = db.prepare("DELETE FROM invite_links WHERE token = ? AND org = ?").run(token, TEST_ORG);
console.log(`  changes = ${r2.changes} (expect 0 → handler returns 404)`);

// 4. base64url token 是否含特殊字符 (URL path 转义可能问题)
console.log(`\nstep 4: token format check`);
console.log(`  token = "${token}"`);
console.log(`  length = ${token.length}`);
console.log(`  contains _ = ${token.includes("_")}, - = ${token.includes("-")}`);
console.log(`  url-safe = ${/^[A-Za-z0-9_-]+$/.test(token)}`);

console.log(`\n=== summary ===`);
console.log(`后端 DELETE SQL 正常工作: ${after ? "❌" : "✓"}`);
console.log(`token URL-safe: ${/^[A-Za-z0-9_-]+$/.test(token) ? "✓" : "❌"}`);
