import type Database from "better-sqlite3";
import sharp from "sharp";
import { processAccountAvatar } from "./account-avatar.js";

/**
 * GitHub 头像与像素图识别（#343）。GitHub 给没设头像的人自动生成一张像素图（identicon）：420×420 的 PNG，#F0F0F0 底色加一种
 * 前景色、5×5 左右对称的方块。它不算这个人的头像，统一头像遇到它就用 NANO 默认头像（lib/avatars.ts）。
 *
 * 结论按 GitHub 头像地址记在 `github_avatar_checks`，网站只读表，不在请求里下载图片：后台每 10 分钟查一次还没结论、
 * 或结论超过 7 天的地址（GitHub 换头像时地址不变，所以要定期重看），GitLab 同步要传一张还没结论的头像时当场查一次。
 * 真头像顺手按账号头像的规格（lib/account-avatar.ts，512 WebP）在 account_avatars 存一份，网站显示这份同源副本：
 * 比赛页的 sandbox CSP 只放行同源图片，GitHub 地址在那里显示不出来。还没结论（或转不出副本）时照常显示 GitHub 地址。
 */
export const GITHUB_AVATAR_BASE = "https://avatars.githubusercontent.com/";
export const GITHUB_AVATAR_CHECK_INTERVAL_MS = 10 * 60 * 1000;
export const GITHUB_AVATAR_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
/** 下载来做识别的图最大多少字节；GitHub 头像原图远小于它，超过的按「不是像素图」处理，不解码。 */
const CHECK_BYTES_MAX = 2 * 1024 * 1024;
const IDENTICON_SIZE = 420;
const IDENTICON_BACKGROUND = 0xf0f0f0;
/** 底色加前景色两种颜色占全图的比例下限；真实照片有成千上万种颜色。 */
const IDENTICON_TWO_COLOR_SHARE = 0.97;

export type GithubAvatarVerdict = "real" | "identicon";
/** 一个地址的识别结论；`hash` 是真头像在 account_avatars 里那份副本，像素图或转不出副本时为空。 */
export type GithubAvatarCheck = { verdict: GithubAvatarVerdict; hash: string | null };
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type CheckLogger = { info(details: Record<string, unknown>, message: string): void; error(details: Record<string, unknown>, message: string): void };

/** 下载 GitHub 头像失败的原因，和 GitLab 同步原有的错误码一致：连不上、不是 200、不是图片。 */
export class GithubAvatarError extends Error {
  constructor(readonly code: string) { super(code); this.name = "GithubAvatarError"; }
}

/** 一个 GitHub 身份的头像地址：登录时记下的地址是 GitHub 头像域名下的就用它，没记下（或不是）的按 GitHub 数字 id 拼。 */
export function githubAvatarUrl(github: { id: number | string; avatar_url: string | null }): string {
  return github.avatar_url?.startsWith(GITHUB_AVATAR_BASE) ? github.avatar_url : `${GITHUB_AVATAR_BASE}u/${github.id}`;
}

/** 匿名下载一张 GitHub 头像（不跟随跳转、15 秒超时）。只下载 GitHub 头像域名下的地址。 */
export async function downloadGithubAvatar(fetchImpl: FetchLike, url: string): Promise<{ type: string; data: ArrayBuffer }> {
  if (!url.startsWith(GITHUB_AVATAR_BASE)) throw new GithubAvatarError("github_avatar_not_github");
  let res: Response;
  let data: ArrayBuffer;
  try {
    res = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    data = res.ok ? await res.arrayBuffer() : new ArrayBuffer(0);
  } catch {
    throw new GithubAvatarError("github_avatar_unreachable");
  }
  if (!res.ok) throw new GithubAvatarError(`github_avatar_${res.status}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (!type.startsWith("image/")) throw new GithubAvatarError("github_avatar_not_image");
  return { type, data };
}

/** 是不是 GitHub 自动生成的像素图：420×420，出现最多的两种颜色占 97% 以上，其中一种是 #F0F0F0。解不开的图不算。 */
export async function isGithubIdenticon(input: Uint8Array): Promise<boolean> {
  if (input.byteLength > CHECK_BYTES_MAX) return false;
  try {
    const image = sharp(input, { limitInputPixels: 4096 * 4096, animated: false, failOn: "error" });
    const { width, height } = await image.metadata();
    if (width !== IDENTICON_SIZE || height !== IDENTICON_SIZE) return false;
    const { data, info } = await image.removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) return false;
    const counts = new Map<number, number>();
    for (let i = 0; i < data.length; i += 3) {
      const color = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    const share = top.reduce((sum, [, count]) => sum + count, 0) / (info.width * info.height);
    return share > IDENTICON_TWO_COLOR_SHARE && top.some(([color]) => color === IDENTICON_BACKGROUND);
  } catch {
    return false;
  }
}

export function createGithubAvatarChecks(db: Database.Database, deps: { fetch?: FetchLike; clock?: () => number } = {}) {
  const clock = deps.clock ?? Date.now;
  const fetchImpl = deps.fetch ?? fetch;
  const selectVerdicts = db.prepare("SELECT url, verdict, avatar_hash FROM github_avatar_checks WHERE url IN (SELECT value FROM json_each(?))");
  const selectHash = db.prepare("SELECT avatar_hash FROM github_avatar_checks WHERE url = ?");
  const upsert = db.prepare(`INSERT INTO github_avatar_checks(url, verdict, avatar_hash, checked_at) VALUES(?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET verdict = excluded.verdict, avatar_hash = excluded.avatar_hash, checked_at = excluded.checked_at`);
  const insertCopy = db.prepare("INSERT OR IGNORE INTO account_avatars(hash, data, mime, created_at) VALUES (?, ?, 'image/webp', ?)");
  // 换下来的旧副本：站内上传和别的 GitHub 头像都没在用才删（和 account-profiles.ts 的 clearAvatar 同一个口径）
  const deleteCopy = db.prepare(`DELETE FROM account_avatars WHERE hash = ? AND NOT EXISTS (SELECT 1 FROM account_profiles WHERE avatar_hash = ?)
    AND NOT EXISTS (SELECT 1 FROM github_avatar_checks WHERE avatar_hash = ?)`);
  // 统一头像用到的 GitHub 头像：账号绑定的 GitHub 身份（和 lib/avatars.ts 的取法一样），以及还没对上账号的旧论坛成员记下的地址；
  // 上传了头像的人用不到 GitHub 头像，不下载
  const selectGithub = db.prepare(`SELECT g.provider_uid AS id, g.avatar_url AS avatar_url FROM identities g JOIN users u ON u.id = g.user_id
    WHERE g.provider = 'github' AND g.login IS NOT NULL AND g.login <> '' AND u.status <> 'merged'
      AND NOT EXISTS (SELECT 1 FROM account_profiles p WHERE p.account_id = u.id AND p.avatar_hash IS NOT NULL)`);
  const selectLegacyForum = db.prepare(`SELECT DISTINCT github_avatar_url AS url FROM forum_users
    WHERE kind = 'member' AND account_id IS NULL AND avatar_hash IS NULL AND github_avatar_url LIKE 'https://avatars.githubusercontent.com/%'`);
  const selectChecked = db.prepare("SELECT url, checked_at FROM github_avatar_checks");

  function verdicts(urls: string[]): Map<string, GithubAvatarCheck> {
    if (!urls.length) return new Map();
    const rows = selectVerdicts.all(JSON.stringify([...new Set(urls)])) as { url: string; verdict: GithubAvatarVerdict; avatar_hash: string | null }[];
    return new Map(rows.map(row => [row.url, { verdict: row.verdict, hash: row.avatar_hash }]));
  }

  /** 下载、识别、记下结论（真头像连同副本）；下载失败抛 GithubAvatarError，什么也不记，下次再查。 */
  async function check(url: string): Promise<GithubAvatarVerdict> {
    const { data } = await downloadGithubAvatar(fetchImpl, url);
    const bytes = Buffer.from(data);
    const verdict: GithubAvatarVerdict = await isGithubIdenticon(bytes) ? "identicon" : "real";
    const copy = verdict === "real" ? await processAccountAvatar(bytes).catch(() => null) : null;
    const now = clock();
    db.transaction(() => {
      const previous = (selectHash.get(url) as { avatar_hash: string | null } | undefined)?.avatar_hash ?? null;
      if (copy) insertCopy.run(copy.hash, copy.data, now);
      upsert.run(url, verdict, copy?.hash ?? null, now);
      if (previous && previous !== copy?.hash) deleteCopy.run(previous, previous, previous);
    })();
    return verdict;
  }

  /** 要查的地址：没有结论的在前，其后是结论超过 7 天的。 */
  function pending(): string[] {
    const urls = new Set([
      ...(selectGithub.all() as { id: string; avatar_url: string | null }[]).map(row => githubAvatarUrl(row)),
      ...(selectLegacyForum.all() as { url: string }[]).map(row => row.url),
    ]);
    const checked = new Map((selectChecked.all() as { url: string; checked_at: number }[]).map(row => [row.url, row.checked_at]));
    const staleBefore = clock() - GITHUB_AVATAR_RECHECK_MS;
    const missing = [...urls].filter(url => !checked.has(url));
    const stale = [...urls].filter(url => checked.has(url) && checked.get(url)! < staleBefore);
    return [...missing, ...stale];
  }

  let running: Promise<{ checked: number; identicons: number; failed: number }> | null = null;
  let stopping = false;
  /** 查一轮：一个一个下载，失败的跳过（下一轮再查）；上一轮没跑完时返回同一个结果。 */
  function runOnce(): Promise<{ checked: number; identicons: number; failed: number }> {
    if (running) return running;
    running = (async () => {
      const summary = { checked: 0, identicons: 0, failed: 0 };
      for (const url of pending()) {
        if (stopping) break;
        try {
          if (await check(url) === "identicon") summary.identicons++;
          summary.checked++;
        } catch {
          summary.failed++;
        }
      }
      return summary;
    })().finally(() => { running = null; });
    return running;
  }

  let timer: NodeJS.Timeout | null = null;
  /** 启动时查一轮，之后每 10 分钟一轮；日志只记个数，不记地址。 */
  function start(log: CheckLogger): void {
    if (timer) return;
    stopping = false;
    const tick = () => {
      runOnce().then(summary => {
        if (summary.checked || summary.failed) log.info(summary, "github avatar check");
      }, error => log.error({ error: error instanceof Error ? error.message : String(error) }, "github avatar check failed"));
    };
    tick();
    timer = setInterval(tick, GITHUB_AVATAR_CHECK_INTERVAL_MS);
    timer.unref();
  }

  async function stop(): Promise<void> {
    stopping = true;
    if (timer) clearInterval(timer);
    timer = null;
    await running?.catch(() => undefined);
  }

  return { verdicts, check, pending, runOnce, start, stop };
}
export type GithubAvatarChecks = ReturnType<typeof createGithubAvatarChecks>;
