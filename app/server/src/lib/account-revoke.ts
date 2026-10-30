import type { FastifyRequest } from "fastify";
import type { RecordActivityInput } from "./activity.js";

/**
 * 改密码、重设密码后吊销账号的登录凭据（#332）：本站其它会话（`keepSid` 留下当前这次，PENTEST-20261029 finding 14）、
 * geek 命令行令牌（gk_，device_grants，连同还没兑换的设备授权）、对外授权（oauth_grants 与 oidc_payloads）。
 * 三张表各由它的模块读写，这里只把它们按同一个口径串起来，`routes/identity/account.ts` 与 `email.ts` 共用，免得两边各写一份。
 * 必须在密码写入的同一个事务里调用（identity-store 的 `setPassword` / `resetPassword` 的 `afterWrite`）：任何一步抛错，
 * 密码、新会话、验证码占用一起回滚，不会出现「密码换了、令牌还有效」的半截状态。操作记录 `auth.credentials_revoked` 也在这里写。
 */
type Revocable = {
  auth: { revokeAccountSessions(accountId: string, keepSid: string | null): number };
  device: { revokeAccountTokens(accountId: string): { tokens: number; grants: number } };
  oidcStore: { revokeAccountGrants(accountId: string): number };
  activity: { recordActivity(req: FastifyRequest, input: RecordActivityInput): void };
};

export function revokeAccountCredentials(services: Revocable, req: FastifyRequest, accountId: string, keepSid: string | null): void {
  const sessions = services.auth.revokeAccountSessions(accountId, keepSid);
  const { tokens, grants } = services.device.revokeAccountTokens(accountId);
  const oidcGrants = services.oidcStore.revokeAccountGrants(accountId);
  services.activity.recordActivity(req, {
    action: "auth.credentials_revoked",
    surface: "portal",
    outcome: "ok",
    meta: { sessions, cli_tokens: tokens, cli_grants: grants, oidc_grants: oidcGrants },
    account_id: accountId,
  });
}
