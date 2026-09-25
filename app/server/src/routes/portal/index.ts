import type { FastifyInstance } from "fastify";
import { registerContracts } from "../../lib/http-contracts.js";
import { portalContracts } from "./contracts.js";
import r0 from "./join.js";
import r1 from "./docs.js";
import r2 from "./feedback.js";
import r3 from "./apply.js";
import r4 from "./org.js";
export default async function portalRoutes(app: FastifyInstance) {
  registerContracts(app, portalContracts);
  await app.register(r0);
  await app.register(r1);
  await app.register(r2);
  await app.register(r3);
  await app.register(r4);
}
