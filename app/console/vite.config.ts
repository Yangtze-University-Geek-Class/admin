import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";

/**
 * 产物布局与 app/web 的约定一致：入口页在 `sites/console/index.html`，带哈希的 JS/CSS 在
 * `console-assets/`，与官网的 `/assets/` 不重名。web 镜像把整个 dist 叠进 nginx 根目录，
 * 服务端与 nginx 按路径把 /console、/admin、/signin 回落到这个入口（见 docs/services/console/README.md）。
 */
export const CONSOLE_ENTRY = "sites/console/index.html";

function emitEntryUnderSites(): Plugin {
  return {
    name: "yzgc-console-entry-path",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const html = bundle["index.html"];
      if (!html) this.error("控制台入口 index.html 没有生成");
      html.fileName = CONSOLE_ENTRY;
    },
  };
}

export default defineConfig({
  base: "/",
  // 公共静态文件（favicon、logo）只由官网镜像提供；控制台自己的图片经 import 进 console-assets。
  publicDir: false,
  plugins: [
    vue(),
    UnoCSS(),
    emitEntryUnderSites(),
  ],
  server: {
    host: "127.0.0.1",
    port: 5186,
    strictPort: true,
    // 核心只接受 PUBLIC_ORIGIN（本机是官网的 5173）发来的写请求；控制台开发时在 5186，
    // 代理把 Origin 换成 5173，与线上同域时一致，否则本机的保存、审核和退出都会被 403。
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", headers: { origin: "http://127.0.0.1:5173" } },
      "/auth": { target: "http://127.0.0.1:3000", headers: { origin: "http://127.0.0.1:5173" } },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "console-assets",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
