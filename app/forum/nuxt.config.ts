import { fileURLToPath } from 'node:url'
import deploymentContract from '../../deploy/environments.json'
import { selectContentSource } from './shared/content-source'
import { createDeploymentMetadata } from './shared/deployment'
import { markdownPrerenderRoutes, seedTopicIds } from './shared/forum-markdown'

const siteDeployment = createDeploymentMetadata(
  deploymentContract,
  process.env.GEEK_DEPLOYMENT_ENVIRONMENT,
  process.env.GEEK_RELEASE_VERSION,
  process.env.GEEK_RELEASE_COMMIT,
)

// 内容来源与登录方式都由构建环境决定，规则在 shared/content-source.ts（单测覆盖）：
// - GEEK_FORUM_SOURCE=site：极客班论坛自己的站名、分类和标签（content/curation.json），没有帖子、用户和通知。
//   预发布与正式镜像（app/forum/Dockerfile）这样构建，不带任何示例内容，也不读内容目录。
// - GEEK_FORUM_SOURCE=demo：上游示例种子。scripts/forum.mjs 的 check/generate/verify 默认用它
//   （上游 CDP 验收依赖示例数据），它也压过本机 .env 里可能写着的快照目录。
// - 不设置：GEEK_FORUM_CONTENT_DIR 非空时是本机只读快照（只有 dev 服务器的 /api/local-forum 提供），否则是示例种子。
// 登录方式与内容来源分开：默认是全站统一的 GitHub 登录（部署的镜像、CI 的静态生成、本机真实数据）。
// 只有 scripts/forum.mjs 为上游 CDP 验收和本机示例预览设 GEEK_FORUM_LOGIN=demo，保留原仓的「选择一个身份」；
// 真实数据（快照）和极客班论坛永远走统一登录。
const { contentSource, contentDir: geekForumContentDir, siteName, loginMode } = selectContentSource(process.env)
// 有静态 /t/<id>.md 的话题：示例种子的每个话题；极客班论坛还没有话题，只生成 /llms.txt。
// 页面按这份名单决定要不要输出 alternate 链接（快照模式由 dev 服务器按请求生成，另算）。
const markdownTopicIds = contentSource === 'site' ? [] : seedTopicIds()

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
    define: { 'import.meta.env.GEEK_FORUM_SITE': JSON.stringify(contentSource === 'site') },
  },

  // The editorial layer over the read-only snapshot (categories, tags,
  // polished bodies) lives in ./content and is read by server/utils through
  // `useStorage('assets:content')`.
  // `/llms.txt` and `/t/<id>.md` are answered by server/middleware/forum-markdown.ts;
  // prerendering them makes `nuxt generate` write one file per seed topic
  // (only llms.txt for 极客班论坛, which has no topics yet), which is all the
  // static image can serve.
  nitro: {
    serverAssets: [{ baseName: 'content', dir: fileURLToPath(new URL('./content', import.meta.url)) }],
    prerender: { routes: markdownPrerenderRoutes(markdownTopicIds) },
    // 本机开发：论坛单独跑在 3456，统一登录的会话在核心后端（127.0.0.1:3000）。cookie 按主机不按端口，
    // 5173 上登录后 127.0.0.1:3456 也带着同一个 sid，这里把 /auth 转给后端，论坛就能读 /auth/me。
    // 线上论坛与核心同域（/forum/ 由 web 容器反代），devProxy 不进静态产物。
    // 核心只接受 PUBLIC_ORIGIN（本机是 5173）发来的写请求；论坛在 3456，退出（POST /auth/signout）
    // 带的 Origin 对不上会被 403，所以开发代理把 Origin 换成 5173，与线上同域时一致。
    // /api/public/org 是称号与部门的显示信息（提督在控制台改），app/composables/useOrgTitles.ts 读它。
    devProxy: {
      '/auth': { target: 'http://127.0.0.1:3000/auth', changeOrigin: false, headers: { origin: 'http://127.0.0.1:5173' } },
      '/api/public/org': { target: 'http://127.0.0.1:3000/api/public/org', changeOrigin: false, headers: { origin: 'http://127.0.0.1:5173' } },
    },
  },


  // The floating badge sits on top of the page's bottom-right corner, which is
  // where the sidebar footer and the pagination live.
  devtools: { enabled: false },

  // Pure front-end mock: state lives in localStorage and derives from the
  // current time, so SSR output could never match the client. SPA only.
  ssr: false,

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
    baseURL: process.env.GEEK_FORUM_BASE_PATH || '/',
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
