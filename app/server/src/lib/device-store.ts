import { createHash, randomBytes, randomInt } from "node:crypto";
import type Database from "better-sqlite3";

/**
 * RFC 8628 设备授权（#262，为 `geek login` 预留）：`device_grants` 是全部状态，`users.id` 是绑定后的 account_id。
 * 只有这个模块读写这张表；路由只调函数，不写 SQL。明文 device_code 与 access_token 从不入库，库里只有 sha256。
 */

/** 发码有效期 10 分钟、默认轮询间隔 5 秒（RFC 8628 §3.2 的建议值）。 */
export const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
export const DEVICE_INTERVAL_S = 5;
/** slow_down 一次加 5 秒（RFC 8628 §3.5）。 */
export const SLOW_DOWN_STEP_S = 5;
/** 命令行令牌 30 天。 */
export const DEVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 发码时顺手清掉一天前就过期、也没有未过期令牌的旧行。 */
export const DEVICE_RETENTION_MS = 24 * 60 * 60 * 1000;

/** user_code 的字符集去掉了易混的 0/O、1/I、8/B 等（RFC 8628 §6.1），8 位显示成 XXXX-XXXX。 */
export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const USER_CODE_LENGTH = 8;
/**
 * 只有登记过的公开客户端能发码：client_id 不是密钥，真正的授权在用户点确认时给出。
 * #277：`forum`/`apply`/`competition`/`repo` 是命令行按业务分组申请的 scope，粗粒度把令牌限制在它
 * 申请过的分类里（middleware/bearer-auth.ts 的 SCOPE_BY_PREFIX）；节点级的权限判定仍然交给
 * requirePermission/requireWriter，scope 不重复判断业务规则。
 */
export const DEVICE_CLIENTS = {
  "geek-cli": { name: "极客班命令行", scopes: ["openid", "profile", "forum", "apply", "competition", "repo"] as const },
} satisfies Record<string, { name: string; scopes: readonly string[] }>;
export type DeviceClientId = keyof typeof DEVICE_CLIENTS;
export const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
export const DEFAULT_SCOPE = "openid profile";

export type DeviceStatus = "pending" | "approved" | "denied" | "consumed";
export type DeviceViewStatus = DeviceStatus | "expired";
export type DeviceGrantRow = {
  id: string;
  device_code_hash: string;
  user_code: string;
  client_id: string;
  scope: string;
  status: DeviceStatus;
  account_id: string | null;
  interval_s: number;
  created_at: number;
  expires_at: number;
  last_poll_at: number | null;
  decided_at: number | null;
  token_hash: string | null;
  token_expires_at: number | null;
};
export type DeviceView = {
  user_code: string;
  client_id: string;
  client_name: string;
  scope: string;
  status: DeviceViewStatus;
  expires_at: number;
};
export type DevicePollResult =
  | { kind: "token"; accessToken: string; expiresIn: number; scope: string; accountId: string }
  | { kind: "error"; error: "invalid_grant" | "invalid_client" | "expired_token" | "access_denied" | "authorization_pending" | "slow_down" };
export type DeviceDecision =
  | { ok: true; clientId: string; scope: string }
  | { ok: false };
export type DeviceProfile = { status: string; login: string | null; avatar_url: string | null; github_user_id: string | null };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
/** 每位的取值由 randomInt 均匀产生，避免 ord % 20 的偏差。 */
function newUserCode(): string {
  let code = "";
  for (let i = 0; i < USER_CODE_LENGTH; i += 1) code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  return code;
}

/** 对外显示形式：XXXX-XXXX。 */
export const displayUserCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** 用户输入对大小写、连字符和空格不敏感；不是 8 位合法字符时返回 null（按不存在处理）。 */
export function normalizeUserCode(input: string | undefined): string | null {
  if (typeof input !== "string") return null;
  const code = input.replace(/[\s-]/g, "").toUpperCase();
  return code.length === USER_CODE_LENGTH && [...code].every(char => USER_CODE_ALPHABET.includes(char)) ? code : null;
}

/**
 * 申请时的 scope：空格分隔、只认 `id` 里登记的公开值，去重并按出现顺序写回；不传或传空串给默认值。
 * 含未知值时整单拒绝，不悄悄丢掉那一段。
 */
export function normalizeScope(clientId: string, input: string | undefined): string | null {
  const client = DEVICE_CLIENTS[clientId as DeviceClientId];
  if (!client) return null;
  const requested = (input ?? "").split(/\s+/).filter(Boolean);
  if (requested.length === 0) return DEFAULT_SCOPE;
  if (!requested.every(scope => (client.scopes as readonly string[]).includes(scope))) return null;
  return [...new Set(requested)].join(" ");
}

/** 过期按时间现算：status 列只存四个真实状态，`expired` 不是一次写入。 */
function statusAt(row: DeviceGrantRow, now: number): DeviceViewStatus {
  if (row.status === "pending" || row.status === "approved") return row.expires_at <= now ? "expired" : row.status;
  return row.status;
}

export type DeviceStoreDeps = { clock?: () => number };

export function createDeviceStore(db: Database.Database, deps: DeviceStoreDeps = {}): DeviceStore {
  const clock = deps.clock ?? Date.now;
  const insertGrant = db.prepare(`INSERT INTO device_grants(id, device_code_hash, user_code, client_id, scope, status, account_id, interval_s, created_at, expires_at)
    VALUES(?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?)`);
  const selectByDeviceHash = db.prepare("SELECT * FROM device_grants WHERE device_code_hash = ?");
  const selectByUserCode = db.prepare("SELECT * FROM device_grants WHERE user_code = ?");
  const selectByTokenHash = db.prepare("SELECT * FROM device_grants WHERE token_hash = ?");
  const userCodeExists = db.prepare("SELECT 1 AS n FROM device_grants WHERE user_code = ?");
  const deleteStale = db.prepare("DELETE FROM device_grants WHERE expires_at < ? AND (token_expires_at IS NULL OR token_expires_at <= ?)");
  const touchPoll = db.prepare("UPDATE device_grants SET last_poll_at = ? WHERE id = ?");
  const raiseInterval = db.prepare("UPDATE device_grants SET interval_s = ? WHERE id = ?");
  const approve = db.prepare("UPDATE device_grants SET status = 'approved', account_id = ?, decided_at = ? WHERE id = ? AND status = 'pending' AND expires_at > ?");
  const deny = db.prepare("UPDATE device_grants SET status = 'denied', decided_at = ? WHERE id = ? AND status = 'pending' AND expires_at > ?");
  const consume = db.prepare("UPDATE device_grants SET status = 'consumed', token_hash = ?, token_expires_at = ? WHERE id = ?");
  // 撤销（#277 POST /auth/device/revoke）：只改已兑换令牌的到期时间，不加状态值——authenticate() 本来就按
  // token_expires_at 判断，撤销和自然过期走同一条判定，不用再教它认一个新状态。只对 consumed 的行生效，
  // 撤销一个从没兑换过令牌的授权没有意义（也没有 token_hash 可匹配）。
  const revokeByTokenHash = db.prepare("UPDATE device_grants SET token_expires_at = ? WHERE token_hash = ? AND status = 'consumed' AND token_expires_at > ?");
  // 改密码、重设密码（#332）：同一个账号已经兑换出去的令牌一起到期，只动还没到期的那些。
  const revokeByAccount = db.prepare("UPDATE device_grants SET token_expires_at = ? WHERE account_id = ? AND status = 'consumed' AND token_expires_at > ?");
  // 已批准、还没兑换成令牌的授权（#332）：改密码前就能批准，所以也要过期；poll() 按 expires_at 判断，回 expired_token。
  const expireApprovedByAccount = db.prepare("UPDATE device_grants SET expires_at = ? WHERE account_id = ? AND status = 'approved' AND expires_at > ?");
  // 身份表由 lib/identity-store.ts 写；这里只读登录名和头像给 userinfo，不碰会话与账号状态机。
  // 没有绑定 GitHub 的账号（邮箱、Google 注册）用账号自己的 yz_ 登录名
  const selectProfile = db.prepare(`SELECT u.status AS status, COALESCE(i.login, u.handle) AS login, i.avatar_url AS avatar_url, i.provider_uid AS github_user_id
    FROM users u LEFT JOIN identities i ON i.user_id = u.id AND i.provider = 'github' WHERE u.id = ?`);

  const rowByUserCode = (input: string | undefined) => {
    const code = normalizeUserCode(input);
    return code ? (selectByUserCode.get(code) as DeviceGrantRow | undefined) ?? null : null;
  };
  const profileOf = (accountId: string | null) =>
    accountId ? (selectProfile.get(accountId) as DeviceProfile | undefined) ?? null : null;

  /** 发码：user_code 唯一（冲突重试），顺手清旧行；device_code 只返回给客户端，库里存哈希。 */
  function createGrant(input: { clientId: string; scope: string }) {
    const now = clock();
    deleteStale.run(now - DEVICE_RETENTION_MS, now);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const userCode = newUserCode();
      if (userCodeExists.get(userCode)) continue;
      // RFC 8628 §3.1 的 device_code：32 字节随机数的 base64url；库里只存它的哈希。
      const deviceCode = randomBytes(32).toString("base64url");
      const expiresAt = now + DEVICE_CODE_TTL_MS;
      insertGrant.run(randomBytes(16).toString("base64url"), sha256(deviceCode), userCode, input.clientId, input.scope, DEVICE_INTERVAL_S, now, expiresAt);
      return { deviceCode, userCode, expiresAt, interval: DEVICE_INTERVAL_S };
    }
    throw new Error("device user_code space exhausted");
  }

  /** GET 详情：查看不改变状态，也不续期。 */
  function describe(userCode: string | undefined): DeviceView | null {
    const row = rowByUserCode(userCode);
    if (!row) return null;
    const now = clock();
    return {
      user_code: displayUserCode(row.user_code),
      client_id: row.client_id,
      client_name: DEVICE_CLIENTS[row.client_id as DeviceClientId]?.name ?? row.client_id,
      scope: row.scope,
      status: statusAt(row, now),
      expires_at: row.expires_at,
    };
  }

  /** 用户确认或拒绝：只有 pending 且未过期的行能决定；deny 不记 account_id，审计里已带操作者。 */
  function decide(input: { userCode: string | undefined; accountId: string; decision: "approve" | "deny" }): DeviceDecision | null {
    const row = rowByUserCode(input.userCode);
    if (!row) return null;
    const now = clock();
    if (row.status !== "pending" || row.expires_at <= now) return { ok: false };
    // 条件带在 UPDATE 上：两次并发的确认只有一次能改到行，第二次按非 pending 处理。
    const changed = input.decision === "approve"
      ? approve.run(input.accountId, now, row.id, now).changes
      : deny.run(now, row.id, now).changes;
    if (changed !== 1) return { ok: false };
    return { ok: true, clientId: row.client_id, scope: row.scope };
  }

  /**
   * 命令行轮询。顺序就是 RFC 8628 §3.5 的判定顺序：已换过 token 的 invalid_grant 优先于过期，
   * 拒绝的 access_denied 优先于过期；pending 才判 slow_down，approved 直接发一次性令牌。
   */
  function poll(input: { deviceCode: string | undefined; clientId: string | undefined }): DevicePollResult {
    if (!input.deviceCode) return { kind: "error", error: "invalid_grant" };
    return db.transaction((): DevicePollResult => {
      const row = (selectByDeviceHash.get(sha256(input.deviceCode!)) as DeviceGrantRow | undefined) ?? null;
      if (!row) return { kind: "error", error: "invalid_grant" };
      if (row.client_id !== input.clientId) return { kind: "error", error: "invalid_client" };
      if (row.status === "consumed") return { kind: "error", error: "invalid_grant" };
      if (row.status === "denied") return { kind: "error", error: "access_denied" };
      const now = clock();
      if (row.expires_at <= now) return { kind: "error", error: "expired_token" };
      if (row.status === "pending") {
        if (row.last_poll_at !== null && now - row.last_poll_at < row.interval_s * 1000) {
          raiseInterval.run(row.interval_s + SLOW_DOWN_STEP_S, row.id);
          return { kind: "error", error: "slow_down" };
        }
        touchPoll.run(now, row.id);
        return { kind: "error", error: "authorization_pending" };
      }
      const profile = profileOf(row.account_id);
      if (!row.account_id || profile?.status !== "active") return { kind: "error", error: "access_denied" };
      // 命令行令牌：`gk_` 前缀让它在日志、环境变量里一眼能认出来；明文只回这一次。
      const accessToken = `gk_${randomBytes(32).toString("base64url")}`;
      consume.run(sha256(accessToken), now + DEVICE_TOKEN_TTL_MS, row.id);
      return { kind: "token", accessToken, expiresIn: DEVICE_TOKEN_TTL_MS / 1000, scope: row.scope, accountId: row.account_id };
    }).immediate();
  }

  /**
   * userinfo 与 #277 的 Bearer 中间件共用：令牌有效、未过期且账号仍是 active 才返回资料；否则一律 null
   * （路由回 401）。`userId` 只在账号绑定过 GitHub 时才有值，给 middleware/bearer-auth.ts 挂 req.session
   * 用（论坛按账号认人，GitHub id 只是方便老用户的论坛内部号自动续用，见 routes/forum-api/viewer.ts）。
   */
  function authenticate(token: string | undefined) {
    if (!token) return null;
    const row = (selectByTokenHash.get(sha256(token)) as DeviceGrantRow | undefined) ?? null;
    if (!row || row.status !== "consumed" || row.token_expires_at === null || row.token_expires_at <= clock()) return null;
    const profile = profileOf(row.account_id);
    if (!row.account_id || profile?.status !== "active") return null;
    const userId = profile.github_user_id !== null ? Number(profile.github_user_id) : null;
    return { accountId: row.account_id, scope: row.scope, login: profile.login ?? "", avatarUrl: profile.avatar_url, userId };
  }

  /** #277 `POST /auth/device/revoke`：令牌不存在或本来就无效时也回 true（幂等），不回答「这个令牌是否存在过」。 */
  function revoke(token: string | undefined): boolean {
    if (!token) return false;
    return revokeByTokenHash.run(clock(), sha256(token), clock()).changes === 1;
  }

  /**
   * #332 改密码、重设密码时吊销这个账号的命令行授权，在调用方的事务里执行（lib/account-revoke.ts）：
   * 已兑换的令牌和 `revoke()` 一样只改 token_expires_at，authenticate() 按同一个时间判断；已批准、还没兑换的设备授权改成现在过期。
   * 返回两类各自真正改到的行数。
   */
  function revokeAccountTokens(accountId: string): { tokens: number; grants: number } {
    const now = clock();
    return {
      tokens: revokeByAccount.run(now, accountId, now).changes,
      grants: expireApprovedByAccount.run(now, accountId, now).changes,
    };
  }

  return { createGrant, describe, decide, poll, authenticate, revoke, revokeAccountTokens };
}

export type DeviceStore = {
  createGrant: (input: { clientId: string; scope: string }) => { deviceCode: string; userCode: string; expiresAt: number; interval: number };
  describe: (userCode: string | undefined) => DeviceView | null;
  decide: (input: { userCode: string | undefined; accountId: string; decision: "approve" | "deny" }) => DeviceDecision | null;
  poll: (input: { deviceCode: string | undefined; clientId: string | undefined }) => DevicePollResult;
  authenticate: (token: string | undefined) => { accountId: string; scope: string; login: string; avatarUrl: string | null; userId: number | null } | null;
  revoke: (token: string | undefined) => boolean;
  revokeAccountTokens: (accountId: string) => { tokens: number; grants: number };
};
