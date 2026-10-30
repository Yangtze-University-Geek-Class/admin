import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import deploymentContract from '../../deploy/environments.json'
import { selectContentSource } from './shared/content-source'
import { createDeploymentMetadata } from './shared/deployment'
import { markdownPrerenderRoutes, seedTopicIds } from './shared/forum-markdown'
import { forumCdnURL, staticCdnBase } from '../../scripts/static-cdn-base.mjs'

const siteDeployment = createDeploymentMetadata(
  deploymentContract,
  process.env.GEEK_DEPLOYMENT_ENVIRONMENT,
  process.env.GEEK_RELEASE_VERSION,
  process.env.GEEK_RELEASE_COMMIT,
)

// 内容来源与登录方式都由构建环境决定，规则在 shared/content-source.ts（单测覆盖）：
// - GEEK_FORUM_SOURCE=site：极客班论坛自己的站名与空 bootstrap；分类、标签、用户、话题和正文只从核心
//   的当前 viewer 投影读取。预发布与正式镜像（app/forum/Dockerfile）这样构建：不带示例帖子，也不把
//   content/published 或 public/published 作为可直接下载的 site 内容；上游示例分支运行时不可达。
// - GEEK_FORUM_SOURCE=demo：上游示例种子。scripts/forum.mjs 的 check/generate/verify 默认用它
//   （上游 CDP 验收依赖示例数据），它也压过本机 .env 里可能写着的快照目录。
// - 不设置：GEEK_FORUM_CONTENT_DIR 非空时是本机只读快照（只有 dev 服务器的 /api/local-forum 提供），否则是示例种子。
// 登录方式与内容来源分开：默认是全站统一的 GitHub 登录（部署的镜像、CI 的静态生成、本机真实数据）。
// 只有 scripts/forum.mjs 为上游 CDP 验收和本机示例预览设 GEEK_FORUM_LOGIN=demo，保留原仓的「选择一个身份」；
// 真实数据（快照）和极客班论坛永远走统一登录。
const { contentSource, contentDir: geekForumContentDir, siteName, loginMode } = selectContentSource(process.env)
// Site 的 Markdown 由核心按当前 viewer 动态生成，不能预渲染；示例种子仍保留原来的静态文档合同。
const markdownTopicIds = contentSource === 'site' ? [] : seedTopicIds()
const markdownRoutes = contentSource === 'site' ? [] : markdownPrerenderRoutes(markdownTopicIds)

// 静态资源 CDN 开关（#146，规则在仓库根的 scripts/static-cdn-base.mjs）：STATIC_CDN_BASE 为空时与以前一样同源；
// 非空时 app.cdnURL 指向 CDN 上的 <base>forum/，/forum/_nuxt/ 下的文件改从 CDN 加载，页面与接口仍走源站。
const forumBaseURL = process.env.GEEK_FORUM_BASE_PATH || '/'
const cdnBase = staticCdnBase()

// app.cdnURL 同时决定 Nuxt 的 publicAssetsURL：代码里写的 public/ 文件（如 ForumHeader 的 <img src="/logo.png">）
// 会被改写成 CDN 上的 forum/logo.png。那是不带哈希的固定地址，上传脚本不传它。开关打开时，把代码 import 的
// public/ 文件当成普通构建资源：Vite 给它带上内容哈希放进 _nuxt/，和其它产物一起上传。
// 不经 import 的 public/ 文件不受这个 Vite 插件影响；site 镜像另在 Dockerfile 删除 published/、llms 与话题 Markdown。
const publicDir = fileURLToPath(new URL('./public', import.meta.url))
// 论坛包不直接依赖 vite（pnpm 严格隔离），这里不 import 它的 Plugin 类型，按结构写出 Vite 插件。
function hashPublicImports() {
  return {
    name: 'geek-forum-hash-public-imports',
    enforce: 'pre' as const,
    resolveId(id: string) {
      if (!/^\/[\w./-]+$/.test(id) || id.includes('..')) return null
      const file = `${publicDir}${id}`
      return existsSync(file) && statSync(file).isFile() ? file : null
    },
  }
}

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-09-11',
  runtimeConfig: {
    geekForumContentDir,
    public: { siteDeployment, contentSource, siteName, loginMode, markdownTopicIds },
  },

  // 构建时常量：极客班论坛的构建里，app/stores/forum.ts 的初始状态直接是 siteForumState()，
  // createSeed 与上游示例帖子因此整段不进浏览器产物（镜像构建断言产物里没有示例帖子标题）。
  vite: {
    define: {
      'import.meta.env.GEEK_FORUM_SITE': JSON.stringify(contentSource === 'site'),
      // 表情 CDN 前缀（shared/sticker-url.ts）：开关为空时是空串，同源。
      'import.meta.env.GEEK_STATIC_CDN_BASE': JSON.stringify(cdnBase),
    },
    plugins: cdnBase ? [hashPublicImports()] : [],
    // 不做手动分包（#360）：旧的 tuffex、app 两组会把整个 Tuffex 和全部组件、页面各并成一个分块，入口只要静态依赖其中
    // 任何一个，整块（含没有访问的页面和 Markdown、表格等组件）都在首屏预加载。去掉后由 Rollup 按依赖切分，首屏预加载的 JS
    // 从约 300 KB（gzip）降到约 165 KB；路由仍是 Nuxt 的动态导入，首屏依赖由 HTML 的 modulepreload 并行取回，不再逐层串行（#217）。
  },
  // The editorial layer over the read-only snapshot (categories, tags,
  // polished bodies) lives in ./content and is read by server/utils through
  // `useStorage('assets:content')`.
  // Demo builds prerender their seed documents. Site dev proxies the same
  // paths to core in server/middleware/forum-markdown.ts; site images contain
  // no llms/topic Markdown or published body assets.
  nitro: {
    serverAssets: [{ baseName: 'content', dir: fileURLToPath(new URL('./content', import.meta.url)) }],
    prerender: { routes: markdownRoutes },
    // 本机开发：论坛单独跑在 3456，统一登录的会话在核心后端（127.0.0.1:3000）。cookie 按主机不按端口，
    // 5173 上登录后 127.0.0.1:3456 也带着同一个 sid，这里把 /auth 转给后端，论坛就能读 /auth/me。
    // 线上论坛与核心同域（/forum/ 由 web 容器反代），devProxy 不进静态产物。
    // 核心只接受 PUBLIC_ORIGIN（本机是 5173）发来的写请求；论坛在 3456，退出（POST /auth/signout）
    // 带的 Origin 对不上会被 403，所以开发代理把 Origin 换成 5173，与线上同域时一致。
    // /api/public/departments 是部门与称号的显示信息（管理员在控制台改，#276），app/composables/useOrgTitles.ts 读它。
    // /api/forum 是论坛后端（帖子、回复、资料、头像，stores/forum-server.ts）；写请求同样要过核心的 Origin 校验。
    // /api/identity/profile 存论坛主题（prefs.forum_theme，app/composables/useForumTheme.ts）。
    devProxy: {
      '/auth': { target: 'http://127.0.0.1:3000/auth', changeOrigin: false, headers: { origin: 'http://127.0.0.1:5173' } },
      '/api/public/departments': { target: 'http://127.0.0.1:3000/api/public/departments', changeOrigin: false, headers: { origin: 'http://127.0.0.1:5173' } },
      '/api/forum': { target: 'http://127.0.0.1:3000/api/forum', changeOrigin: false, headers: { origin: 'http://127.0.0.1:5173' } },
      '/api/identity': { target: 'http://127.0.0.1:3000/api/identity', changeOrigin: false, headers: { origin: 'http://127.0.0.1:5173' } },
    },
  },


  // The floating badge sits on top of the page's bottom-right corner, which is
  // where the sidebar footer and the pagination live.
  devtools: { enabled: false },

  // Pure front-end mock: state lives in localStorage and derives from the
  // current time, so SSR output could never match the client. SPA only.
  ssr: false,

  // 开关打开时（#146）关掉 Nuxt 每小时一次的「有没有新版本」检查：它读 _nuxt/builds/latest.json，
  // 这个文件名不带哈希、每次构建内容都变，不上传 CDN（上传只增不改）。旧版本的哈希文件一直留在 CDN 上，
  // 开着的旧页面照样能加载自己的分块，刷新即拿到新版本。同源构建保持 Nuxt 默认。
  ...(cdnBase ? { experimental: { checkOutdatedBuildInterval: false as const } } : {}),

  // `./modules/tuffex-components` is picked up by Nuxt's `modules/` directory scan.
  modules: [
    '@unocss/nuxt',
    '@pinia/nuxt',
    '@nuxtjs/color-mode',
    '@vueuse/nuxt',
    '@nuxt/eslint',
  ],

  // The only stylesheets in the project: a third-party reset and tuffex's full
  // component CSS (which already contains every base token and `.dark` override).
  css: [
    '@unocss/reset/tailwind-compat.css',
    '@talex-touch/tuffex/style.css',
  ],

  colorMode: {
    // `html.dark`, which is the selector tuffex's dark tokens key off.
    classSuffix: '',
    preference: 'system',
    fallback: 'light',
    storageKey: 'tuff-forum:color-mode',
  },

  app: {
    // 论坛挂在环境唯一域名（deploy/env/.env.* 的 PUBLIC_ORIGIN）下的 /forum 路径，
    // 由 web 容器的 nginx 反代。静态产物的资源与路由前缀由 baseURL 决定，
    // 因此镜像构建时必须传 GEEK_FORUM_BASE_PATH=/forum/；本地开发保持站点根。
    baseURL: forumBaseURL,
    // 只在开关打开时设置（#146）；代码引用的 public/ 文件怎么处理见文件开头的 hashPublicImports。
    ...(cdnBase ? { cdnURL: forumCdnURL(cdnBase, forumBaseURL) } : {}),
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      // No static title: app.vue's titleTemplate already falls back to the
      // site name, and a static entry would be wrapped into "name · name".
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },

  typescript: {
    strict: true,
    // `pnpm typecheck` runs vue-tsc; keep the dev server itself fast.
    typeCheck: false,
    // Nuxt's node tsconfig only includes `modules/*` and `nuxt.config.*`; the
    // other root-level configs would otherwise never be type-checked at all.
    nodeTsConfig: {
      include: ['../uno.config.ts', '../vitest.config.ts'],
    },
  },
})
