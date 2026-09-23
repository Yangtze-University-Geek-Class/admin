import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const here = fileURLToPath(new URL(".", import.meta.url));

const SITE_NAMES = ["portal"] as const;

/** 控制台是独立的 Vue 包（app/console），开发态跑在 5186；这里只负责把入口路径转过去。 */
const CONSOLE_DEV_ORIGIN = "http://127.0.0.1:5186";
const CONSOLE_PATH = /^\/(?:(?:admin|console)(?:\/|$)|signin$)/;

/**
 * 开发态的按端 SPA fallback。
 *
 * 生产由 web 镜像的 nginx（直连时由 Fastify）按路径派发：/admin、/console、/signin 进
 * 控制台（app/console 的 dist/sites/console/index.html），其余进 portal；Vite dev 默认只服务
 * 真实的 HTML 文件，portal 深链接需要回落到入口。
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
          // 论坛是独立工程（app/forum，Nuxt dev server 在 3456），开发态深链接一并转过去
          if (path === "/forum" || path.startsWith("/forum/") || path === "/sites/forum" || path.startsWith("/sites/forum/")) {
            _res.statusCode = 302;
            _res.setHeader("Location", `http://127.0.0.1:3456${path.startsWith("/forum") ? path : "/"}`);
            _res.end();
            return;
          }
          // 控制台（/console、/admin、/signin，以及旧的 /sites/admin/…）由 app/console 的 dev server 提供
          const legacy = path === "/sites/admin" || path.startsWith("/sites/admin/");
          const consolePath = legacy ? path.slice("/sites/admin".length).replace(/^\/?$/, "/console") : path;
          if (CONSOLE_PATH.test(consolePath)) {
            const query = String(req.url ?? "").includes("?") ? `?${String(req.url).split("?").slice(1).join("?")}` : "";
            _res.statusCode = 302;
            _res.setHeader("Location", `${CONSOLE_DEV_ORIGIN}${consolePath}${query}`);
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
    // 与 tsconfig.json 的 paths 保持一致：@shared/* → app/web/shared/*
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
      // portal 的 React 入口；控制台由 app/console（Vue）单独构建，Nuxt 论坛由 app/forum 单独构建。
      // 稳定产出 dist/sites/portal/index.html；控制台产物是 app/console/dist/sites/console/index.html。
      input: {
        portal: resolve(here, "sites/portal/index.html"),
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

