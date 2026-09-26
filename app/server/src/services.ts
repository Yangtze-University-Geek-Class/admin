import { request } from "undici";
import type { Octokit } from "@octokit/rest";
import type { AppConfig } from "./config.js";
import { createDatabase } from "./lib/db.js";
import { createCrypto } from "./lib/crypto.js";
import { createAuth } from "./lib/auth.js";
import { createGithub } from "./lib/github.js";
import { createCache } from "./lib/cache.js";
import { createRoleStore } from "./lib/role-store.js";
import { createAccess } from "./lib/access.js";
import { createFeedbackStore } from "./lib/feedback-store.js";
import { loadForumContent } from "./lib/forum-content.js";
import { createForumStore } from "./lib/forum-store.js";
import { createPublicSubmission } from "./middleware/pow.js";
import { createTurnstile } from "./middleware/turnstile.js";

export type ServiceOverrides = { httpRequest?: typeof request; octokitFactory?: (token: string) => Octokit };
/** Composition root. Only this module owns dependencies and database lifetimes. */
export function createServices(config: AppConfig, overrides: ServiceOverrides = {}) {
  const crypto = createCrypto(config.encryptionKey);
  const storage = createDatabase(config.dbPath);
  const github = createGithub(overrides.octokitFactory);
  const cache = createCache();
  const roles = createRoleStore(storage.db);
  // 论坛内容读不出来就让启动失败，不带着半份论坛上线；失败前先关掉刚打开的库。
  const forum = (() => {
    try {
      // 有称号但没打开过论坛的成员也不能被游客冒名：登录名从控制台的称号指派里取。
      const store = createForumStore(storage.db, loadForumContent(config.forumContentDir), {
        orgLogins: () => roles.listAssignments().map(row => row.github_login),
      });
      store.seed();
      return store;
    } catch (error) {
      storage.db.close();
      throw error;
    }
  })();
  return {
    config, storage, crypto,
    auth: createAuth(storage.db, crypto, config, overrides.httpRequest),
    github, cache, roles,
    access: createAccess({ consoleOrg: config.consoleOrg, getOrgRole: github.getOrgRole, cached: cache.cached, roles }),
    feedback: createFeedbackStore(storage.db),
    forum,
    publicSubmission: createPublicSubmission(config.powDifficulty),
    turnstile: createTurnstile(config, overrides.httpRequest),
    close() { storage.db.close(); },
  };
}
export type AppServices = ReturnType<typeof createServices>;
declare module "fastify" { interface FastifyInstance { services: AppServices } }
