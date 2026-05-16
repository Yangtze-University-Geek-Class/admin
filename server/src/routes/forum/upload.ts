import { mkdirSync, createWriteStream, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { requireForumAuth } from "../../middleware/require-forum-auth.js";

const UPLOAD_DIR = process.env.FORUM_UPLOAD_DIR ?? resolve("./data/forum-uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"]);
const MAX_BYTES = 5 * 1024 * 1024;

export default async function forumUploadRoutes(app: FastifyInstance) {
  if (!app.hasContentTypeParser("multipart/form-data")) {
    const multipart = (await import("@fastify/multipart")).default;
    await app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } });
  }

  app.post(
    "/api/forum/upload",
    { preHandler: requireForumAuth },
    async (req, reply) => {
      const data = await (req as any).file();
      if (!data) return reply.code(400).send({ error: "no_file" });
      const ext = extname(data.filename ?? "").toLowerCase();
      if (!ALLOWED_EXT.has(ext)) return reply.code(415).send({ error: "unsupported_ext" });
      const name = `${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;
      const dest = resolve(UPLOAD_DIR, name);
      await pipeline(data.file, createWriteStream(dest));
      if (data.file.truncated) return reply.code(413).send({ error: "file_too_large" });
      return { ok: true, url: `/forum/u/${name}` };
    },
  );

  app.get("/forum/u/:name", async (req, reply) => {
    const name = (req.params as any).name as string;
    if (name.includes("/") || name.includes("..")) return reply.code(400).send({ error: "bad_name" });
    const p = resolve(UPLOAD_DIR, name);
    if (!existsSync(p)) return reply.code(404).send({ error: "not_found" });
    return reply.sendFile(name, UPLOAD_DIR);
  });
}
