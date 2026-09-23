import type { FastifyInstance } from "fastify";
import { registerContracts } from "../../lib/http-contracts.js";
import { consoleContracts } from "./contracts.js";
import me from "./me.js";
import catalogue from "./catalogue.js";
import departments from "./departments.js";
import assignments from "./assignments.js";
import applications from "./applications.js";
import feedback from "./feedback.js";
import audit from "./audit.js";

/** 极客班控制台 `/api/console/*`：组织固定为 CONSOLE_ORG，授权按能力判定。不导入 routes/admin。 */
export default async function consoleRoutes(app: FastifyInstance) {
  registerContracts(app, consoleContracts);
  await app.register(me);
  await app.register(catalogue);
  await app.register(departments);
  await app.register(assignments);
  await app.register(applications);
  await app.register(feedback);
  await app.register(audit);
}
