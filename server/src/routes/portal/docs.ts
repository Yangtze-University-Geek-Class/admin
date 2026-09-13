import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

import { REPO_ROOT } from "../../config.js";
const DOC_FILES = [
  { id: "readme", label: "项目介绍", file: "docs/public/README.md", lang: "zh" },
  { id: "readme-en", label: "Introduction", file: "docs/public/README.en.md", lang: "en" },
  { id: "usage", label: "使用指南", file: "docs/ops/USAGE.md", lang: "zh" },
  { id: "usage-en", label: "Usage", file: "docs/ops/USAGE.en.md", lang: "en" },
];

export default async function docsRoutes(app: FastifyInstance) {
  app.get("/api/docs", async () => {
    const items = DOC_FILES
      .filter((d) => existsSync(resolve(REPO_ROOT, d.file)))
      .map((d) => ({ id: d.id, label: d.label, lang: d.lang, file: d.file }));
    return { items };
  });

  app.get<{ Params: { id: string } }>("/api/docs/:id", async (req, reply) => {
    const meta = DOC_FILES.find((d) => d.id === req.params.id);
    if (!meta) return reply.code(404).send({ error: "doc not found" });
    const path = resolve(REPO_ROOT, meta.file);
    if (!existsSync(path)) return reply.code(404).send({ error: "doc file missing" });
    const content = await readFile(path, "utf8");
    return { id: meta.id, label: meta.label, lang: meta.lang, file: meta.file, content };
  });
}
