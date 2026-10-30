import type Database from "better-sqlite3";
import { avatarPath } from "./account-profiles.js";
import { avatarPath as forumAvatarPath } from "./forum-store.js";
import { githubAvatarUrl, type GithubAvatarCheck, type GithubAvatarChecks } from "./github-avatars.js";
import { gitlabAvatarIdentifier } from "./gitlab-sync.js";
import { nanoAvatarIndex, nanoAvatarPath } from "./nano-avatar.js";

/**
 * 统一头像（#343）：官网、论坛、控制台、比赛、命令行、OIDC 与 GitLab 同步给同一个人的都是这里算出的同一张，按顺序取：
 * 1. 站内上传的头像（account_profiles.avatar_hash）；还没有统一资料行的旧账号用它在论坛上传的头像（#274 迁移前的旧作者，
 *    读取不替它建资料行，见 tests/server/public-profile-consumers.test.ts），有了资料行就只认资料行；
 * 2. GitHub 头像，GitHub 自动生成的像素图不算（结论见 lib/github-avatars.ts）：识别过的真头像显示站内那份同源副本，
 *    还没结论（或没转出副本）时先显示 GitHub 地址；
 * 3. NANO 默认头像，按这个人在 GitLab 上的主邮箱挑（lib/nano-avatar.ts）。
 * 只读库，不发请求；每个账号都有地址，不会是 null。
 */
export type Avatar =
  | { kind: "upload"; url: string; hash: string }
  /** `source` 是 GitHub 头像地址（GitLab 同步按它判断换没换），`hash` 是站内副本，`checked` 是已经识别过。 */
  | { kind: "github"; url: string; source: string; hash: string | null; checked: boolean }
  | { kind: "nano"; url: string; index: number };

/** 一个人的头像输入：上传的散列、GitHub 头像地址、挑默认头像用的标识。论坛里还没对上账号的旧成员也按它算（lib/forum-store.ts）。 */
export type AvatarInput = { uploadUrl: string | null; uploadHash: string | null; githubUrl: string | null; identifier: string };

type AccountRow = {
  account_id: string; canonical_email: string | null; handle: string | null; profile_id: string | null; avatar_hash: string | null; forum_avatar_hash: string | null;
  github_id: string | null; github_login: string | null; github_avatar_url: string | null; gitlab_username: string | null;
};

export function createAvatars(db: Database.Database, deps: { checks: Pick<GithubAvatarChecks, "verdicts">; sector: () => string | null }) {
  const selectAccounts = db.prepare(`SELECT u.id AS account_id, u.canonical_email AS canonical_email, u.handle AS handle,
      p.account_id AS profile_id, p.avatar_hash AS avatar_hash, fu.avatar_hash AS forum_avatar_hash,
      g.provider_uid AS github_id, g.login AS github_login, g.avatar_url AS github_avatar_url, ga.username AS gitlab_username
    FROM users u
    LEFT JOIN account_profiles p ON p.account_id = u.id
    LEFT JOIN forum_users fu ON fu.account_id = u.id AND fu.kind = 'member'
    LEFT JOIN identities g ON g.user_id = u.id AND g.provider = 'github' AND g.login IS NOT NULL AND g.login <> ''
    LEFT JOIN gitlab_accounts ga ON ga.account_id = u.id
    WHERE u.id IN (SELECT value FROM json_each(?))`);

  function inputOf(row: AccountRow, sector: string | null): AvatarInput {
    // 和 GitLab 同步建号时取用户名的口径一样：GitHub 登录名，否则站内登录名（yz_…）
    const login = row.github_login ?? row.handle ?? `yz_${row.account_id.slice(0, 8).toLowerCase()}`;
    const forumUpload = row.profile_id === null ? row.forum_avatar_hash : null;
    return {
      uploadUrl: row.avatar_hash ? avatarPath(row.avatar_hash) : forumUpload ? forumAvatarPath(forumUpload) : null,
      uploadHash: row.avatar_hash ?? forumUpload,
      githubUrl: row.github_id !== null && row.github_login ? githubAvatarUrl({ id: row.github_id, avatar_url: row.github_avatar_url }) : null,
      identifier: gitlabAvatarIdentifier({ email: row.canonical_email, gitlabUsername: row.gitlab_username, login, sector }),
    };
  }

  /** 按输入取头像；`verdicts` 是这批 GitHub 地址的识别结论。 */
  function pick(input: AvatarInput, verdicts: Map<string, GithubAvatarCheck>): Avatar {
    if (input.uploadUrl) return { kind: "upload", url: input.uploadUrl, hash: input.uploadHash ?? "" };
    const check = input.githubUrl ? verdicts.get(input.githubUrl) : undefined;
    if (input.githubUrl && check?.verdict !== "identicon") {
      const hash = check?.hash ?? null;
      return { kind: "github", url: hash ? avatarPath(hash) : input.githubUrl, source: input.githubUrl, hash, checked: check !== undefined };
    }
    const index = nanoAvatarIndex(input.identifier);
    return { kind: "nano", url: nanoAvatarPath(index), index };
  }

  /** 一批输入一起取（只查一次识别结论）。 */
  function resolveMany<K>(inputs: Map<K, AvatarInput>): Map<K, Avatar> {
    const verdicts = deps.checks.verdicts([...inputs.values()].flatMap(input => input.githubUrl && !input.uploadUrl ? [input.githubUrl] : []));
    return new Map([...inputs].map(([key, input]) => [key, pick(input, verdicts)]));
  }

  /** 一批账号的头像；库里没有的账号 id 按 id 挑一张默认头像。 */
  function ofAccounts(accountIds: string[]): Map<string, Avatar> {
    const ids = [...new Set(accountIds)];
    if (!ids.length) return new Map();
    const sector = deps.sector();
    const rows = new Map((selectAccounts.all(JSON.stringify(ids)) as AccountRow[]).map(row => [row.account_id, row]));
    return resolveMany(new Map(ids.map(id => {
      const row = rows.get(id);
      return [id, row ? inputOf(row, sector) : { uploadUrl: null, uploadHash: null, githubUrl: null, identifier: id }];
    })));
  }

  const ofAccount = (accountId: string): Avatar => ofAccounts([accountId]).get(accountId)!;
  const urlOf = (accountId: string): string => ofAccount(accountId).url;
  const urlsOf = (accountIds: string[]): Map<string, string> => new Map([...ofAccounts(accountIds)].map(([id, avatar]) => [id, avatar.url]));

  return { ofAccounts, ofAccount, urlOf, urlsOf, resolveMany };
}
export type Avatars = ReturnType<typeof createAvatars>;
