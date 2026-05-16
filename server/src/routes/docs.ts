import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

const here = dirname(fileURLToPath(import.meta.url));
// repo root is two levels up from server/dist/routes
const REPO_ROOT = resolve(here, "../../..");

const DOC_FILES: { id: string; label: string; file: string; lang: "zh" | "en" }[] = [
  { id: "readme",       label: "README",      file: "README.md",              lang: "zh" },
  { id: "readme-en",    label: "README (en)", file: "README.en.md",           lang: "en" },
  { id: "usage",        label: "使用指南",      file: "docs/USAGE.md",          lang: "zh" },
  { id: "usage-en",     label: "Usage (en)",  file: "docs/USAGE.en.md",       lang: "en" },
  { id: "deploy",       label: "部署",          file: "docs/DEPLOY.md",         lang: "zh" },
  { id: "deploy-en",    label: "Deploy (en)", file: "docs/DEPLOY.en.md",      lang: "en" },
  { id: "architecture", label: "架构",          file: "docs/ARCHITECTURE.md",   lang: "zh" },
  { id: "architecture-en", label: "Architecture (en)", file: "docs/ARCHITECTURE.en.md", lang: "en" },
  { id: "security",     label: "安全",          file: "docs/SECURITY.md",       lang: "zh" },
  { id: "security-en",  label: "Security (en)", file: "docs/SECURITY.en.md",   lang: "en" },
];

export default async function docsRoutes(app: FastifyInstance) {
  app.get("/api/docs", async () => {
    const items = DOC_FILES
      .filter((d) => existsSync(resolve(REPO_ROOT, d.file)))
      .map((d) => ({ id: d.id, label: d.label, lang: d.lang }));
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
