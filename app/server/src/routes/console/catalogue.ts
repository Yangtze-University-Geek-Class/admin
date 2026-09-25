import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireCapability } from "../../middleware/require-capability.js";
import {
  APPLICATION_STATUSES, CAPABILITIES, CAPTAIN_ONLY, CREW_TITLE, DEPARTMENT_ICONS, DOMAINS, IMPLIES, TITLES, TITLE_IDS, TONES,
} from "../../lib/roles.js";

/** 称号（读数据库）、色调、能力清单与各称号的权限包：前端据此渲染，不在浏览器里另存一份。 */
export default async function consoleCatalogueRoutes(app: FastifyInstance) {
  const { roles } = app.services;
  app.addHook("preHandler", requireAuth);
  app.get("/api/console/catalogue", { preHandler: requireCapability("console.access") }, async () => {
    const configs = roles.titleConfigs();
    return {
      titles: TITLE_IDS.map(id => {
        const { label, tag, icon, tone, description } = configs[id];
        return { id, label, tag, icon, tone, rank: TITLES[id].rank, description };
      }),
      crew: CREW_TITLE,
      tones: TONES,
      capabilities: CAPABILITIES.map(({ id, domain, label, description }) => ({ id, domain, label, description })),
      domains: DOMAINS,
      role_base: Object.fromEntries(TITLE_IDS.map(id => [id, configs[id].capabilities])),
      implies: IMPLIES,
      captain_only: CAPTAIN_ONLY,
      department_icons: DEPARTMENT_ICONS,
      application_statuses: APPLICATION_STATUSES,
    };
  });
}
