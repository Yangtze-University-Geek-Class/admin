import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";
import { staticCdnBase } from "../../scripts/static-cdn-base.mjs";
import { productionSecurityNotice } from "../../scripts/security-notice.mjs";

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

const STYLESHEET_REL = /\srel\s*=\s*(["']?)stylesheet\1[\s/>]/i;

/**
 * 把 <head> 里的样式表链接按原顺序挪到 </body> 前，其余标签（图标、模块脚本、modulepreload）原样不动。
 *
 * 首次打开的加载提示（#263，index.html 的 .console-boot）要在入口页一到就画出来；样式表留在 <head> 时，
 * 浏览器要等它下完才开始画（Fast 3G 下约 1.2 秒）。挪到 body 末尾后仍由预加载扫描器并行下载，
 * 模块脚本按 HTML 规范仍等文档里的样式表就绪才执行，所以挂载时样式已经齐了，不会露出没有样式的界面。
 */
export function moveStylesheetsToBodyEnd(html: string): string {
  const headEnd = html.indexOf("</head>");
  const bodyEnd = html.lastIndexOf("</body>");
  if (headEnd < 0 || bodyEnd < headEnd) return html;
  const links: string[] = [];
  const head = html.slice(0, headEnd).replace(/[ \t]*<link\b[^>]*>[ \t]*(?:\r?\n)?/gi, (tag) => {
    if (!STYLESHEET_REL.test(tag)) return tag;
    links.push(tag.trim());
    return "";
  });
  if (!links.length) return html;
  const body = html.slice(headEnd, bodyEnd);
  const indent = /\n([ \t]*)$/.exec(body)?.[1] ?? "";
  const moved = links.map((link) => `\n${indent}  ${link}`).join("");
  return `${head}${body.replace(/\s*$/, "")}${moved}\n${indent}${html.slice(bodyEnd)}`;
}

function stylesheetsAfterBootPlaceholder(): Plugin {
  return {
    name: "yzgc-console-boot-stylesheets",
    apply: "build",
    transformIndexHtml: { order: "post", handler: moveStylesheetsToBodyEnd },
  };
}

/**
 * 静态资源 CDN 开关（#146，scripts/static-cdn-base.mjs）：STATIC_CDN_BASE 为空时同源；
 * 非空时 console-assets/ 下带哈希的文件改从 CDN 加载，入口 HTML 与路由仍走源站（base 不变）。
 */
const cdnBase = staticCdnBase();

export default defineConfig({
  base: "/",
  experimental: cdnBase
    ? { renderBuiltUrl: (filename, { type }) => (type === "asset" ? `${cdnBase}${filename}` : undefined) }
    : undefined,
  // 公共静态文件（favicon、logo）只由官网镜像提供；控制台自己的图片经 import 进 console-assets。
  publicDir: false,
  plugins: [
    vue(),
    UnoCSS(),
    stylesheetsAfterBootPlaceholder(),
    emitEntryUnderSites(),
    productionSecurityNotice(),
  ],
  server: {
    host: "127.0.0.1",
    port: 5186,
    strictPort: true,
    // 核心只接受 PUBLIC_ORIGIN（本机是官网的 5173）发来的写请求；控制台开发时在 5186，
    // 代理把 Origin 换成 5173，与线上同域时一致，否则本机的保存、审核和退出都会被 403。
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", headers: { origin: "http://127.0.0.1:5173" } },
      // 只接 /auth/…：字符串键按前缀匹配，写成 "/auth" 会把同意页 /authorize 也转给核心
      "^/auth/": { target: "http://127.0.0.1:3000", headers: { origin: "http://127.0.0.1:5173" } },
      // 对外授权的同意页（/authorize）读写 /oidc/interaction/*（#270）
      "/oidc": { target: "http://127.0.0.1:3000", headers: { origin: "http://127.0.0.1:5173" } },
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
