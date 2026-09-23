import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireCapability } from "../../middleware/require-capability.js";
import {
  APPLICATION_STATUSES, CAPABILITIES, CAPTAIN_ONLY, CREW_TITLE, DEPARTMENT_ICONS, DOMAINS, IMPLIES, ROLE_BASE, TITLES, TONES,
} from "../../lib/roles.js";

/** 称号、色调、能力清单与默认权限：前端据此渲染，不在浏览器里另存一份。 */
export default async function consoleCatalogueRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);
  app.get("/api/console/catalogue", { preHandler: requireCapability("console.access") }, async () => ({
    titles: Object.values(TITLES).map(({ id, label, tag, icon, tone, rank, description }) => ({ id, label, tag, icon, tone, rank, description })),
    crew: CREW_TITLE,
    tones: TONES,
    capabilities: CAPABILITIES.map(({ id, domain, label, description }) => ({ id, domain, label, description })),
    domains: DOMAINS,
    role_base: ROLE_BASE,
    implies: IMPLIES,
    captain_only: CAPTAIN_ONLY,
    department_icons: DEPARTMENT_ICONS,
    application_statuses: APPLICATION_STATUSES,
  }));
}
