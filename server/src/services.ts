import { request } from "undici";
import type { Octokit } from "@octokit/rest";
import type { AppConfig } from "./config.js";
import { createDatabase } from "./lib/db.js";
import { createCrypto } from "./lib/crypto.js";
import { createAuth } from "./lib/auth.js";
import { createGithub } from "./lib/github.js";
import { createCache } from "./lib/cache.js";
import { createPublicSubmission } from "./middleware/pow.js";
import { createTurnstile } from "./middleware/turnstile.js";

export type ServiceOverrides = { httpRequest?: typeof request; octokitFactory?: (token: string) => Octokit };
/** Composition root. Only this module owns dependencies and database lifetimes. */
export function createServices(config: AppConfig, overrides: ServiceOverrides = {}) {
  const crypto = createCrypto(config.encryptionKey);
  const storage = createDatabase(config.dbPath);
  return {
    config, storage, crypto,
    auth: createAuth(storage.db, crypto, config, overrides.httpRequest),
    github: createGithub(overrides.octokitFactory), cache: createCache(),
    publicSubmission: createPublicSubmission(config.powDifficulty),
    turnstile: createTurnstile(config, overrides.httpRequest),
    close() { storage.db.close(); },
  };
}
export type AppServices = ReturnType<typeof createServices>;
declare module "fastify" { interface FastifyInstance { services: AppServices } }
