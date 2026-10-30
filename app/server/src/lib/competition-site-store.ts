// 比赛官网托管（#278，CONTRACT-278 §1）：站点包版本、发布与回滚、按 slug 读文件、预览链接。
//
// 版本行在 competition_site_versions，发布状态在 competition_sites；文件在数据卷 `<root>/<competition_id>/<version_id>/`。
// 校验不通过的包只留一条 rejected 版本和逐条原因，不落任何文件。先解到同目录下的临时目录再改名，读的一方不会看到半个版本。
// 只接普通参数和 `now`；授权、操作记录与「只有 internal 比赛能传」由调用方（控制台路由）判断。
//
// 对象存储开启时（#360），发布前把版本里的静态资源（HTML 之外）写到公开桶的 `contest-sites/<比赛>/<文件>`，
// 同一个比赛的键每次发布覆盖，上一版多出来的文件删掉；HTML 仍由服务端回。`<root>/<比赛>/cdn.json` 记着桶里现在是哪一版的文件：
// 版本对不上（同步中、同步失败、没有同步过）时服务端照常同源回文件，所以桶里的内容和在线版本不一致时不会重定向过去。
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type Database from "better-sqlite3";
import { createObjectStorage, type ObjectStorage } from "./object-storage.js";
import { checkSitePackage, siteContentType, sitePathProblem } from "./site-package.js";

/** 上对象存储的扩展名：站点静态资源里的 js、css、图片与字体（site-package 允许的 woff2）。 */
const CDN_EXTENSIONS = new Set(["js", "mjs", "css", "svg", "png", "jpg", "jpeg", "webp", "avif", "ico", "woff2", "mp3", "ogg"]);
const extensionOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");
export const SITE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,31}$/;
/** 预览链接的有效期：控制台点开后一小时内能看，过期后从控制台重新打开。 */
export const PREVIEW_TTL_MS = 60 * 60_000;

export type SiteVersionRow = {
  id: string; competition_id: string; version: string; size: number; files: number; sha256: string;
  uploaded_by: string; created_at: number; status: "passed" | "rejected"; report: string;
};
export type SiteVersion = Omit<SiteVersionRow, "report"> & { report: string[] };
export type SiteState = { slug: string | null; live_version_id: string | null; versions: SiteVersion[] };
export type SiteError = "version_not_found" | "version_rejected" | "slug_required" | "bad_slug" | "slug_taken" | "slug_locked" | "not_published";
export const SITE_ERRORS: Record<SiteError, { status: number; message: string }> = {
  version_not_found: { status: 404, message: "这个版本不存在" },
  version_rejected: { status: 409, message: "没有通过校验的版本不能发布" },
  slug_required: { status: 400, message: "第一次发布要填官网地址（slug）" },
  bad_slug: { status: 400, message: "官网地址只能用小写字母、数字和连字符，3–32 位，以字母或数字开头" },
  slug_taken: { status: 409, message: "这个官网地址已经被别的比赛用了" },
  slug_locked: { status: 409, message: "官网地址发布后不能再改" },
  not_published: { status: 404, message: "这场比赛的官网还没有发布" },
};
type SiteRow = { competition_id: string; slug: string; live_version_id: string | null; updated_at: number; updated_by: string | null };
/** 桶里现在的文件：`version` 是这些文件对应的在线版本，同步中或失败时为 null；`files` 是桶里实际有的相对路径。 */
type CdnState = { version: string | null; files: string[] };
export type SiteFileHit = { kind: "file"; data: Buffer; contentType: string } | { kind: "redirect"; location: string } | { kind: "missing" };

const toVersion = (row: SiteVersionRow): SiteVersion => {
  let report: string[] = [];
  try { report = JSON.parse(row.report) as string[]; } catch { report = []; }
  return { ...row, report: Array.isArray(report) ? report : [] };
};
const sign = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 32);

export function createCompetitionSiteStore(db: Database.Database, deps: { root: string; secret: string; objectStorage?: ObjectStorage }) {
  const root = resolve(deps.root);
  const storage = deps.objectStorage ?? createObjectStorage(null);
  const selectVersions = db.prepare("SELECT * FROM competition_site_versions WHERE competition_id = ? ORDER BY created_at DESC, rowid DESC");
  const selectVersion = db.prepare("SELECT * FROM competition_site_versions WHERE competition_id = ? AND id = ?");
  const insertVersion = db.prepare(`INSERT INTO competition_site_versions(id, competition_id, version, size, files, sha256, uploaded_by, created_at, status, report)
    VALUES(@id, @competition_id, @version, @size, @files, @sha256, @uploaded_by, @created_at, @status, @report)`);
  const selectSite = db.prepare("SELECT * FROM competition_sites WHERE competition_id = ?");
  const selectSiteBySlug = db.prepare("SELECT * FROM competition_sites WHERE slug = ?");
  const insertSite = db.prepare("INSERT INTO competition_sites(competition_id, slug, live_version_id, updated_at, updated_by) VALUES(?, ?, ?, ?, ?)");
  const setLive = db.prepare("UPDATE competition_sites SET live_version_id = ?, updated_at = ?, updated_by = ? WHERE competition_id = ?");

  const versionDir = (competitionId: string, versionId: string) => join(root, competitionId, versionId);
  const cdnStatePath = (competitionId: string) => join(root, competitionId, "cdn.json");
  const objectKey = (competitionId: string, path: string) => `contest-sites/${competitionId}/${path}`;

  function readCdnState(competitionId: string): CdnState {
    try {
      const parsed = JSON.parse(readFileSync(cdnStatePath(competitionId), "utf8")) as Partial<CdnState>;
      return { version: typeof parsed.version === "string" ? parsed.version : null, files: Array.isArray(parsed.files) ? parsed.files.filter(file => typeof file === "string") : [] };
    } catch {
      return { version: null, files: [] };
    }
  }

  function writeCdnState(competitionId: string, state: CdnState): void {
    const target = cdnStatePath(competitionId);
    const staging = `${target}.tmp`;
    writeFileSync(staging, JSON.stringify(state));
    renameSync(staging, target);
  }

  /** 版本里要上桶的文件：js、css、图片与字体（不含 HTML 和 yzgc-site.json，它们仍由服务端回），相对路径，按字典序。 */
  function assetFiles(competitionId: string, versionId: string): string[] {
    const base = versionDir(competitionId, versionId);
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && CDN_EXTENSIONS.has(extensionOf(entry.name))) found.push(relative(base, full).split(sep).join("/"));
      }
    };
    walk(base);
    return found.sort();
  }

  function state(competitionId: string): SiteState {
    const site = selectSite.get(competitionId) as SiteRow | undefined;
    return {
      slug: site?.slug ?? null,
      live_version_id: site?.live_version_id ?? null,
      versions: (selectVersions.all(competitionId) as SiteVersionRow[]).map(toVersion),
    };
  }

  function site(competitionId: string): SiteRow | null {
    return (selectSite.get(competitionId) as SiteRow | undefined) ?? null;
  }

  /** 校验并保存一个站点包，返回版本行（通过或拒绝都有一行）。 */
  function upload(competitionId: string, zip: Buffer, actorAccountId: string, now: number): SiteVersion {
    const checked = checkSitePackage(zip, competitionId);
    const id = randomUUID();
    if (checked.ok) {
      const target = versionDir(competitionId, id);
      const staging = join(root, competitionId, `.staging-${id}`);
      rmSync(staging, { recursive: true, force: true });
      try {
        for (const file of checked.files) {
          const path = join(staging, file.path);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, file.data);
        }
        renameSync(staging, target);
      } catch (error) {
        rmSync(staging, { recursive: true, force: true });
        throw error;
      }
    }
    const row: SiteVersionRow = {
      id, competition_id: competitionId,
      version: checked.manifest?.version ?? "",
      size: checked.size, files: checked.ok ? checked.files.length : 0, sha256: checked.sha256,
      uploaded_by: actorAccountId, created_at: now,
      status: checked.ok ? "passed" : "rejected",
      report: JSON.stringify(checked.ok ? [`通过：${checked.files.length} 个文件，解压后 ${checked.totalBytes} 字节`] : checked.report),
    };
    try {
      insertVersion.run(row);
    } catch (error) {
      if (checked.ok) rmSync(versionDir(competitionId, id), { recursive: true, force: true });
      throw error;
    }
    return toVersion(row);
  }

  /** 发布前的校验（不写库）：版本存在且通过、slug 符合规则且没被占用。调用方先用它，再同步对象存储，最后才写库。 */
  function checkPublish(competitionId: string, versionId: string, slug: string | undefined): SiteError | null {
    const version = selectVersion.get(competitionId, versionId) as SiteVersionRow | undefined;
    if (!version) return "version_not_found";
    if (version.status !== "passed") return "version_rejected";
    const current = site(competitionId);
    if (current) {
      if (slug !== undefined && slug !== current.slug) return "slug_locked";
    } else {
      if (slug === undefined) return "slug_required";
      if (!SITE_SLUG_PATTERN.test(slug)) return "bad_slug";
      if (selectSiteBySlug.get(slug)) return "slug_taken";
    }
    return null;
  }

  /**
   * 把版本的静态资源同步到公开桶：先标成「同步中」，上传全部文件，删掉上一版多出来的，最后记下新版本。
   * 任何一步失败都抛错，状态停在「同步中」，服务端照常同源回文件；下一次发布会把这次没删干净的补上。
   */
  async function mirrorToStorage(competitionId: string, versionId: string): Promise<void> {
    if (!storage.enabled) return;
    const dir = versionDir(competitionId, versionId);
    const files = assetFiles(competitionId, versionId);
    const previous = readCdnState(competitionId).files;
    writeCdnState(competitionId, { version: null, files: [...new Set([...previous, ...files])] });
    for (const path of files) await storage.put(objectKey(competitionId, path), readFileSync(join(dir, path)), siteContentType(path));
    for (const path of previous) if (!files.includes(path)) await storage.remove(objectKey(competitionId, path));
    writeCdnState(competitionId, { version: versionId, files });
  }

  /** 资源文件的公开地址：只有桶里的版本就是这个在线版本、且文件确实在桶里时才给；HTML 与别的文件都为 null（同源回）。 */
  function assetUrl(competitionId: string, versionId: string, rawPath: string): string | null {
    if (!storage.enabled || !rawPath || rawPath.endsWith("/")) return null;
    const cdn = readCdnState(competitionId);
    if (cdn.version !== versionId || !cdn.files.includes(rawPath)) return null;
    return storage.publicUrl(objectKey(competitionId, rawPath));
  }

  /** CSP 里要放行的桶前缀（`<公开地址前缀>contest-sites/`）；对象存储没开启时为 null。 */
  const cdnPrefix = (): string | null => {
    const prefix = storage.publicPrefix();
    return prefix ? `${prefix}contest-sites/` : null;
  };

  /** 发布或回滚到某个通过校验的版本；第一次发布定下 slug，之后不能改。调用方要先 checkPublish 再 mirrorToStorage。 */
  function publish(competitionId: string, versionId: string, slug: string | undefined, actorAccountId: string, now: number):
    { ok: true; value: SiteState } | { ok: false; error: SiteError } {
    const error = checkPublish(competitionId, versionId, slug);
    if (error) return { ok: false, error };
    if (site(competitionId)) setLive.run(versionId, now, actorAccountId, competitionId);
    else insertSite.run(competitionId, slug, versionId, now, actorAccountId);
    return { ok: true, value: state(competitionId) };
  }

  /** 下线：版本与 slug 都保留，之后发布任一版本就恢复。 */
  function unpublish(competitionId: string, actorAccountId: string, now: number): { ok: true; value: SiteState } | { ok: false; error: SiteError } {
    const current = site(competitionId);
    if (!current || !current.live_version_id) return { ok: false, error: "not_published" };
    setLive.run(null, now, actorAccountId, competitionId);
    return { ok: true, value: state(competitionId) };
  }

  /** slug 对应的比赛与在线版本；没有或没发布为 null（调用方再看比赛是否下线、是否 internal）。 */
  function live(slug: string): { competition_id: string; version_id: string } | null {
    const row = selectSiteBySlug.get(slug) as SiteRow | undefined;
    return row?.live_version_id ? { competition_id: row.competition_id, version_id: row.live_version_id } : null;
  }

  /** 预览地址里的比赛：先按 slug 找，没定 slug 的比赛用比赛 id。 */
  function competitionForPreview(slugOrId: string): string | null {
    const row = selectSiteBySlug.get(slugOrId) as SiteRow | undefined;
    if (row) return row.competition_id;
    return slugOrId;
  }

  function passedVersion(competitionId: string, versionId: string): boolean {
    const version = selectVersion.get(competitionId, versionId) as SiteVersionRow | undefined;
    return version?.status === "passed";
  }

  /**
   * 读版本目录里的一个文件：空路径或以 / 结尾回 index.html；没有扩展名、但有同名目录的跳到带 / 的地址；
   * 路径不合规、越出版本目录或不存在都当不存在。
   */
  function readSiteFile(competitionId: string, versionId: string, rawPath: string): SiteFileHit {
    const base = versionDir(competitionId, versionId);
    const path = rawPath === "" || rawPath.endsWith("/") ? `${rawPath}index.html` : rawPath;
    if (sitePathProblem(path)) {
      const asDirectory = `${rawPath}/index.html`;
      if (!rawPath.includes(".") && !sitePathProblem(asDirectory) && existsSync(join(base, asDirectory))) {
        return { kind: "redirect", location: `${rawPath.slice(rawPath.lastIndexOf("/") + 1)}/` };
      }
      return { kind: "missing" };
    }
    const full = resolve(base, path);
    if (!full.startsWith(`${base}${sep}`)) return { kind: "missing" };
    try {
      if (!statSync(full).isFile()) return { kind: "missing" };
      return { kind: "file", data: readFileSync(full), contentType: siteContentType(path) };
    } catch {
      return { kind: "missing" };
    }
  }

  /** 删比赛时连同所有版本的文件一起删（表行由外键级联删掉）。 */
  function removeFiles(competitionId: string): void {
    if (!competitionId || competitionId.includes("/") || competitionId.includes("..")) return;
    rmSync(join(root, competitionId), { recursive: true, force: true });
  }

  /** 预览地址里替代版本 id 的那一段：`<version_id>.<到期秒>.<签名>`，签名覆盖比赛、版本和到期时间。 */
  function previewToken(competitionId: string, versionId: string, now: number): string {
    const exp = Math.floor((now + PREVIEW_TTL_MS) / 1000);
    return `${versionId}.${exp}.${sign(deps.secret, `site-preview:${competitionId}:${versionId}:${exp}`)}`;
  }

  function verifyPreviewToken(competitionId: string, token: string, now: number): string | null {
    const match = /^([0-9a-f-]{36})\.([0-9]{9,12})\.([A-Za-z0-9_-]{32})$/.exec(token);
    if (!match) return null;
    const [, versionId, exp, signature] = match;
    if (Number(exp) * 1000 < now) return null;
    const expected = Buffer.from(sign(deps.secret, `site-preview:${competitionId}:${versionId}:${exp}`));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return versionId;
  }

  return { root, state, site, upload, checkPublish, mirrorToStorage, assetUrl, cdnPrefix, publish, unpublish, live, competitionForPreview, passedVersion, readSiteFile, removeFiles, previewToken, verifyPreviewToken };
}
export type CompetitionSiteStore = ReturnType<typeof createCompetitionSiteStore>;
