import type { FastifyInstance } from "fastify";
import forumAuthRoutes from "./auth.js";
import forumCategoriesRoutes from "./categories.js";
import forumThreadsRoutes from "./threads.js";
import forumPostsRoutes from "./posts.js";
import forumUsersRoutes from "./users.js";
import forumUploadRoutes from "./upload.js";
import forumStatsRoutes from "./stats.js";
import forumGroupsRoutes from "./groups.js";

export default async function forumRoutes(app: FastifyInstance) {
  await app.register(forumAuthRoutes);
  await app.register(forumCategoriesRoutes);
  await app.register(forumThreadsRoutes);
  await app.register(forumPostsRoutes);
  await app.register(forumUsersRoutes);
  await app.register(forumUploadRoutes);
  await app.register(forumStatsRoutes);
  await app.register(forumGroupsRoutes);
}
