import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const here = fileURLToPath(new URL(".", import.meta.url));

const SITE_NAMES = ["portal", "admin"] as const;

/**
 * 开发态的按端 SPA fallback。
 *
 * 生产由 Fastify 按 host 派发到 dist/sites/<端>/index.html；Vite dev 默认只服务
 * 真实的 HTML 文件，portal/admin 深链接需要回落到各自入口。
 * 这里把 `/sites/<端>/<任意非文件路径>` 一律回落到该端的 index.html，
 * 与生产行为一致。
 */
function devSiteFallback(): Plugin {
  return {
    name: "yzgc-dev-site-fallback",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        (req: IncomingMessage, _res: ServerResponse, next: (err?: unknown) => void) => {
          const path = String(req.url ?? "").split("?")[0];
          if (path === "/sites/forum" || path.startsWith("/sites/forum/") || path === "/forum") {
            _res.statusCode = 302;
            _res.setHeader("Location", "http://127.0.0.1:3456/");
            _res.end();
            return;
          }
          const site = SITE_NAMES.find((s) => path.startsWith(`/sites/${s}/`));
          if (!site) return next();
          // 真实资源（带扩展名）放行，交给 Vite 处理
          if (/\.[a-z0-9]+$/i.test(path)) return next();
          req.url = `/sites/${site}/index.html`;
          next();
        },
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), devSiteFallback()],
  resolve: {
    // 与 tsconfig.json 的 paths 保持一致：@shared/* → web/shared/*
    alias: { "@shared": `${here}shared` },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/auth": "http://127.0.0.1:3000",
      "/healthz": "http://127.0.0.1:3000",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      // portal/admin 的 React 入口；Nuxt 论坛由 modules/forum 单独构建。
      // 因此稳定产出 dist/sites/<端>/index.html，服务端据此按 host 派发。
      input: {
        portal: resolve(here, "sites/portal/index.html"),
        admin: resolve(here, "sites/admin/index.html"),
      },
      output: {
        // 不拆的话这些库会被并进某个端命名的 chunk（Rollup 会挑 `pow` 这种
        // 随机模块名），两端各自重复且每次发版都失效。单独成 vendor 后
        // 两端共用、内容不变则缓存一直有效。
        manualChunks: {
          vendor: [
            "react",
            "react-dom",
            "react-router-dom",
            "@tanstack/react-query",
          ],
          markdown: ["marked", "dompurify", "highlight.js"],
        },
      },
    },
  },
});

