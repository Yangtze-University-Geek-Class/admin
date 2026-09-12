import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
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
      // 三个端各自的入口。产物路径按 HTML 文件解析后的 id 决定，
      // 因此稳定产出 dist/sites/<端>/index.html，服务端据此按 host 派发。
      input: {
        portal: resolve(here, "sites/portal/index.html"),
        forum: resolve(here, "sites/forum/index.html"),
        admin: resolve(here, "sites/admin/index.html"),
      },
      output: {
        // 不拆的话这些库会被并进某个端命名的 chunk（Rollup 会挑 `pow` 这种
        // 随机模块名），三端各自重复且每次发版都失效。单独成 vendor 后
        // 三端共用、内容不变则缓存一直有效。
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

