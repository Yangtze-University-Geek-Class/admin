import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { request } from "undici";
import type { Octokit } from "@octokit/rest";
import { DEFAULT_CONSOLE_ORG, type AppConfig } from "./config.js";
import { createDatabase } from "./lib/db.js";
import { createCrypto } from "./lib/crypto.js";
import { createAuth } from "./lib/auth.js";
import { createIdentityStore } from "./lib/identity-store.js";
import { createEmailLogin } from "./lib/email-login.js";
import { createInviteCodeStore } from "./lib/invite-codes.js";
import { createGoogle } from "./lib/google.js";
import { createDeviceStore } from "./lib/device-store.js";
import { createGithub } from "./lib/github-http.js";
import { createCache } from "./lib/cache.js";
import { createStickerUrl } from "./lib/sticker-manifest.js";
import { createRoleStore } from "./lib/role-store.js";
import { archiveOldDepartments } from "./lib/migrations/2026-10-yugc-v2.js";
import { createPermissionEngine } from "./lib/permissions.js";
import { createLimits } from "./lib/limits.js";
import { createApplySettings } from "./lib/apply-settings.js";
import { createAccountProfiles } from "./lib/account-profiles.js";
import { createActivityRecorder } from "./lib/activity.js";
import { createAccess } from "./lib/access.js";
import { createFeedbackStore } from "./lib/feedback-store.js";
import { createCompetitionStore } from "./lib/competition-store.js";
import { createCompetitionSignupStore } from "./lib/competition-signup-store.js";
import { createCompetitionScoreStore } from "./lib/competition-score-store.js";
import { createCompetitionRulesStore } from "./lib/competition-rules-store.js";
import { createCompetitionSiteStore } from "./lib/competition-site-store.js";
import { createCompetitionPublic, publicCachePrefix } from "./lib/competition-public.js";
import { createCompetitionTeamPlaza } from "./lib/competition-team-plaza.js";
import { createCompetitionPrizes } from "./lib/competition-prizes.js";
import { createCompetitionCandidates } from "./lib/competition-candidates.js";
import { loadForumContent } from "./lib/forum-content.js";
import { createForumStore } from "./lib/forum-store.js";
import { createMailer } from "./lib/mail/mailer.js";
import { createOidcStore } from "./lib/oidc-store.js";
import { createOidcProvider } from "./lib/oidc-provider.js";
import { createAccountDirectory } from "./lib/account-directory.js";
import { createGitlabSync, type FetchLike as GitlabFetch } from "./lib/gitlab-sync.js";
import type { FetchLike } from "./lib/mail/providers.js";
import { createPublicSubmission, POW_NONCE_TTL_MS } from "./middleware/pow.js";
import { createTurnstile } from "./middleware/turnstile.js";

/**
 * `mailFetch`、`clock`：测试换掉发信商的 HTTP 请求，以及发信队列与会话清理用的时钟，都不连真实时间。
 * `octokitFactory`：测试换掉 GitHub API 客户端；#274 review round 1 删了 lib/github-connection.ts 与
 * `/api/join/:token`（GitHub 组织邀请链接，CONTRACT-274 §8）之后，服务端自己不再用它发真实请求，但保留这个
 * 覆盖点不动——大量既有测试的 `testApp({ octokitFactory })` 调用还在，不属于本轮复核的范围。
 * `gitlabFetch`、`githubProfileFetch`：测试换掉 GitLab 管理接口与建号时读 GitHub 公开资料、头像的请求（lib/gitlab-sync.ts）。
 */
export type ServiceOverrides = {
  httpRequest?: typeof request; octokitFactory?: (token: string) => Octokit; mailFetch?: FetchLike;
  gitlabFetch?: GitlabFetch; githubProfileFetch?: GitlabFetch; clock?: () => number;
};
/** Composition root. Only this module owns dependencies and database lifetimes. */
export function createServices(config: AppConfig, overrides: ServiceOverrides = {}) {
  const crypto = createCrypto(config.encryptionKey);
  const storage = createDatabase(config.dbPath, config.stickerAssetsDir);
  // #274 review round 1：lib/github-connection.ts（控制台接 GitHub App 管理组织）删掉了，github 服务现在
  // 没有生产代码读它；保留这个工厂只是因为 ServiceOverrides.octokitFactory 还有一批既有测试在用，见上面的注释。
  const github = createGithub(overrides.octokitFactory);
  const cache = createCache();
  const roles = createRoleStore(storage.db);
  // #274 迁移步骤 4：挡住的两个条件都已清掉——官网的组织架构窗口在 #275 改读
  // /api/public/departments，论坛的称号徽章在 #276 也改读它了，旧的 GET /api/public/org
  // 随 #276 一起删除（routes/portal/org.ts），没有任何读者再读 `departments.archived`。
  // 这里才能安全地把 createRoleStore() 刚播种（或早已播种过）的四个默认部门标成已归档：
  // 调用放在 createRoleStore() 之后，顺序要对；archiveOldDepartments() 本身是幂等的
  // UPDATE ... WHERE archived = 0，重复调用、重启、库里已经归档过都不会再变。
  archiveOldDepartments(storage.db);
  const auth = createAuth(storage.db, crypto, config, overrides.httpRequest, overrides.clock);
  // #274 SPEC §3.8：防盗刷计数唯一入口；提到 identity 前面建好，注册限额与邀请码猜测锁定
  // （signInWithGithub/signInSecondChannel，#274 review round 1）也要用它。
  const limits = createLimits(storage.db, { clock: overrides.clock });
  const identity = createIdentityStore(storage.db, { createSession: auth.createSession, audit: storage.audit, limits, clock: overrides.clock });
  const device = createDeviceStore(storage.db, { clock: overrides.clock });
  // 邮箱验证码、邀请码与 Google 登录（#262，所有者 2026-10-23）
  const emailLogin = createEmailLogin(storage.db, { sessionSecret: config.sessionSecret, clock: overrides.clock });
  const invites = createInviteCodeStore(storage.db, overrides.clock);
  const google = createGoogle(config.google, config.publicOrigin, overrides.httpRequest, overrides.clock);
  const feedback = createFeedbackStore(storage.db);
  const competitions = createCompetitionStore(storage.db);
  // 报名、组队与积分（#239）：认人用会话里的 account_id，表在 lib/db.ts 里随启动建好。
  const competitionSignups = createCompetitionSignupStore(storage.db, competitions);
  // 年级系数、奖项与 GitLab 项目（#278）：记分时按这里的系数加权，记下的分之后不再重算。
  const competitionRules = createCompetitionRulesStore(storage.db);
  const competitionScores = createCompetitionScoreStore(storage.db, competitions, competitionSignups, competitionRules);
  // 历史数据一次性归一（#129）：把 org 只是大小写不同的旧行改成 DEFAULT_CONSOLE_ORG 的写法，重复启动安全。
  // 改不动就让启动失败，失败前先关掉刚打开的库，与下面论坛、发信的处理一致。
  try {
    feedback.normalizeOrgSpelling(DEFAULT_CONSOLE_ORG);
  } catch (error) {
    storage.db.close();
    throw error;
  }
  const profiles = createAccountProfiles(storage.db, { clock: overrides.clock });
  // 论坛内容读不出来就让启动失败，不带着半份论坛上线；失败前先关掉刚打开的库。
  const forum = (() => {
    try {
      // 没打开过论坛的组织成员也不能被冒名：登录名取控制台的称号指派，加上登录过的人（审计里的 auth.signin 与当前会话）。
      const store = createForumStore(storage.db, loadForumContent(config.forumContentDir), {
        orgLogins: () => [...roles.listAssignments().map(row => row.github_login), ...auth.signedInLogins()],
        // 表情图片地址（#286）：STATIC_CDN_BASE 打开时，仓库内置的表情是 CDN 地址，站长在控制台上传的仍是同源地址。
        stickerUrl: createStickerUrl({ cdnBase: config.staticCdnBase, manifest: storage.stickerManifest }),
        profiles,
        identity,
      });
      store.seed();
      return store;
    } catch (error) {
      storage.db.close();
      throw error;
    }
  })();
  // 发信配置写错（地址格式、MAIL_ASSET_BASE）同样让启动失败；发信循环由 buildApp 的 mailWorker 决定开不开。
  const mail = (() => {
    try {
      return createMailer(storage.db, config.mail, config.publicOrigin, { fetch: overrides.mailFetch, now: overrides.clock });
    } catch (error) {
      storage.db.close();
      throw error;
    }
  })();
  // 对外授权与 GitLab 同步（#270，#274 改成读统一资料 account_profiles）：账号目录把账号和统一资料拼起来；
  // OIDC_JWKS 没设时不开 /oidc（oidc 为 null）。
  const oidcStore = createOidcStore(storage.db, crypto, overrides.clock);
  const directory = createAccountDirectory({ identity, profiles, publicOrigin: config.publicOrigin });
  const oidc = config.oidc
    ? { issuer: config.oidc.issuer, provider: createOidcProvider({ issuer: config.oidc.issuer, jwks: config.oidc.jwks, sessionSecret: config.sessionSecret, store: oidcStore, accounts: directory }) }
    : null;
  const gitlab = createGitlabSync(storage.db, {
    config: config.gitlab, directory, subjects: oidcStore, clients: oidcStore, avatars: profiles, audit: storage.audit,
    fetch: overrides.gitlabFetch, githubFetch: overrides.githubProfileFetch, clock: overrides.clock,
  });
  const permissions = createPermissionEngine(storage.db, overrides.clock);
  // 比赛官网托管（#278）：站点文件放在数据库旁边的 sites/（容器里是数据卷 /data/sites）；内存库（测试）用临时目录，关闭时删掉。
  const memorySites = config.dbPath === ":memory:" ? mkdtempSync(join(tmpdir(), "yzgc-sites-")) : null;
  // #282 一键备份要打包同一份目录，和 competitionSites 的 root 必须是同一个值，所以提成局部变量复用，
  // 并在下面的 services 对象上单独导出（lib/system-backup.ts 不应该重新猜它在哪）。
  const sitesRoot = memorySites ?? resolve(dirname(config.dbPath), "sites");
  const competitionSites = createCompetitionSiteStore(storage.db, { root: sitesRoot, secret: config.sessionSecret });
  const competitionPublic = createCompetitionPublic(storage.db, {
    competitions, signups: competitionSignups, scores: competitionScores, rules: competitionRules, sites: competitionSites,
  });
  // 组队广场（#278 重开）：跨比赛聚合，只读 competitions/competitionSignups，不新开一张表。
  const competitionTeamPlaza = createCompetitionTeamPlaza(storage.db, { competitions, signups: competitionSignups });
  const competitionPrizes = createCompetitionPrizes(storage.db, {
    competitions, scores: competitionScores, signupScoring: id => competitionSignups.settingsOf(id).scoring, rules: competitionRules, crypto,
  });
  // GitLab 贡献收集（#278）：复用 gitlab-sync 的令牌与请求函数，定时器由 buildApp 的 gitlabSync 决定开不开（和账号同步一起）。
  const competitionCandidates = createCompetitionCandidates(storage.db, {
    competitions, signups: competitionSignups, scores: competitionScores, rules: competitionRules, gitlab,
    canReview: accountId => identity.getAccountClaims(accountId)?.status === "active" && permissions.check(accountId, "competition.score.review"),
    audit: storage.audit, onScoresChanged: id => cache.invalidate(publicCachePrefix(id)), clock: overrides.clock,
  });
  return {
    competitions,
    competitionSignups,
    competitionScores,
    competitionRules, competitionSites, competitionPublic, competitionTeamPlaza, competitionPrizes, competitionCandidates,
    config, storage, crypto, sitesRoot,
    auth,
    identity,
    emailLogin, invites, google,
    device,
    github, cache, roles,
    // #274 review round 1（blocker）：access.resolve 不再查 GitHub 组织角色，只传 membership.of；见 lib/access.ts。
    access: createAccess({ roles, membership: { of: identity.membershipOf } }),
    // #274 新权限引擎：和上面的 access（旧 capabilities）并存，中间件/路由逐步切过去，见 lib/permissions.ts。
    permissions,
    // 和别的服务用同一个可注入时钟：require-step-up.ts 判定「刚登录过」要用它比对 session.created_at
    // （由 auth.ts 的 createSession 用这同一个 clock 盖的时间戳），不能各用各的，测试拨慢/拨快时钟时才站得住。
    clock: overrides.clock ?? Date.now,
    profiles,
    // 操作记录唯一写入口（#274 SPEC §3.7）：lib/activity.ts 的 recordActivity，路由自己调用；清理定时器由 buildApp 的 activityCleanup 决定开不开。
    activity: createActivityRecorder(storage.db, overrides.clock),
    limits,
    // 招新总开关（#284）：官网公开配置、投递接口和控制台「投递」页读写的是同一个值。
    applySettings: createApplySettings(storage.db, overrides.clock),
    feedback,
    forum,
    mail,
    oidcStore, directory, oidc, gitlab,
    // PoW 只认一次：nonce 摘要进 `pow.nonce` 桶，记满证明的整个有效时段（PENTEST-20261029 finding 8）
    publicSubmission: createPublicSubmission(config.powDifficulty, {
      consumeNonce: digest => limits.hit({ bucket: "pow.nonce", subject: digest, window: { ms: POW_NONCE_TTL_MS }, max: 1 }).ok,
    }),
    turnstile: createTurnstile(config, overrides.httpRequest),
    close() {
      void mail.stop(); void gitlab.stop(); void competitionCandidates.stop(); auth.stopCleanup(); storage.db.close();
      if (memorySites) rmSync(memorySites, { recursive: true, force: true });
    },
  };
}
export type AppServices = ReturnType<typeof createServices>;
declare module "fastify" { interface FastifyInstance { services: AppServices } }
