import type { AccountClaims, IdentityStore } from "./identity-store.js";
import type { Avatar, Avatars } from "./avatars.js";
import { publicProfile } from "./public-profile.js";

/**
 * 对外看到的极客班账号（#270；#274 改成读统一资料 account_profiles，取代论坛自己的资料）：账号信息
 * （lib/identity-store.ts）加上统一资料（用户名、显示名、简介、上传的头像）。对外授权（OIDC userinfo）按它
 * 发声明，GitLab 同步按它建号、填资料。统一资料归 lib/account-profiles.ts，这里只读。
 */
export type DirectoryProfile = { username: string; displayName: string; bio: string; avatarHash: string | null };
export type DirectoryAccount = AccountClaims & {
  name: string;
  /** 统一头像（#343，lib/avatars.ts）：上传的头像、GitHub 头像（像素图不算）或 NANO 默认头像；GitLab 同步传的就是它 */
  avatar: Avatar;
  /** 统一头像的完整地址（站内的路径前面补上本环境的 origin），不会是 null */
  picture: string;
  profile: DirectoryProfile | null;
};
/** 对外授权的声明：只给是成员的账号。 */
export type OidcAccount = { accountId: string; login: string; username: string; name: string; picture: string | null; email: string | null };

export function createAccountDirectory(deps: {
  identity: Pick<IdentityStore, "getAccountClaims" | "listAccountsForSync">;
  profiles: { get(accountId: string): { username: string; display_name: string; bio: string; avatar_url: string | null } };
  avatars: Pick<Avatars, "ofAccounts">;
  publicOrigin: string;
}) {
  type ProfileRow = ReturnType<typeof deps.profiles.get>;
  const withProfile = (claims: AccountClaims, row: ProfileRow, avatar: Avatar): DirectoryAccount => {
    // avatar_url 是 `/api/identity/avatar/<hash>.webp` 这样的路径，截出 hash 部分留在资料里。
    const visible = publicProfile(row, { login: claims.login, avatarUrl: avatar.url });
    const avatarHash = row.avatar_url ? row.avatar_url.replace(/^\/api\/identity\/avatar\//, "").replace(/\.webp$/, "") : null;
    const profile: DirectoryProfile = { username: row.username, displayName: row.display_name, bio: row.bio, avatarHash };
    const picture = avatar.url.startsWith("/") ? `${deps.publicOrigin}${avatar.url}` : avatar.url;
    return { ...claims, name: visible.display_name, avatar, picture, profile };
  };

  // account_profiles.get() 会兜底建档（ensure()），头像在建好资料行之后再算：没有资料行的旧账号会用论坛上传的头像
  // （lib/avatars.ts），先算就会这一轮是论坛的、下一轮是资料行的，GitLab 同步跟着多传一次。
  function account(accountId: string): DirectoryAccount | null {
    const claims = deps.identity.getAccountClaims(accountId);
    if (!claims) return null;
    const row = deps.profiles.get(accountId);
    return withProfile(claims, row, deps.avatars.ofAccounts([accountId]).get(accountId)!);
  }

  /** 发给下游的声明；停用的、不是成员的账号为 null，授权与换令牌都会失败。 */
  function oidcAccount(accountId: string): OidcAccount | null {
    const found = account(accountId);
    if (!found || !found.member) return null;
    return { accountId: found.account_id, login: found.login, username: found.profile?.username ?? found.login, name: found.name, picture: found.picture, email: found.email };
  }

  function listForSync(): DirectoryAccount[] {
    const accounts = deps.identity.listAccountsForSync();
    const rows = accounts.map(claims => deps.profiles.get(claims.account_id));
    const avatars = deps.avatars.ofAccounts(accounts.map(claims => claims.account_id));
    return accounts.map((claims, index) => withProfile(claims, rows[index]!, avatars.get(claims.account_id)!));
  }

  return { account, oidcAccount, listForSync };
}
export type AccountDirectory = ReturnType<typeof createAccountDirectory>;
