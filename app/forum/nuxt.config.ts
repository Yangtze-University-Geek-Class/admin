import { fileURLToPath } from 'node:url'
import deploymentContract from '../../deploy/environments.json'
import { createDeploymentMetadata } from './shared/deployment'
import { markdownPrerenderRoutes, seedTopicIds } from './shared/forum-markdown'

const siteDeployment = createDeploymentMetadata(
  deploymentContract,
  process.env.GEEK_DEPLOYMENT_ENVIRONMENT,
  process.env.GEEK_RELEASE_VERSION,
  process.env.GEEK_RELEASE_COMMIT,
)

// Set by the root `scripts/forum.mjs` for `start`/`dev` when a private
// 极客班 snapshot directory exists. It switches the pages from the upstream
// demo seed to the read-only archive served by /api/local-forum; it does not
// add authentication or persistence. GEEK_FORUM_SOURCE=demo wins over any
// directory (including one that a local .env might inject), which is how
// check/generate/verify stay on the seed.
const geekForumContentDir = process.env.GEEK_FORUM_SOURCE === 'demo' ? '' : (process.env.GEEK_FORUM_CONTENT_DIR ?? '').trim()
const contentSource = geekForumContentDir ? 'local-snapshot' : 'upstream-seed'
const siteName = geekForumContentDir ? '极客班论坛' : 'Tuff Forum'
// 登录方式与内容来源分开：默认是全站统一的 GitHub 登录（部署的镜像、CI 的静态生成、本机真实数据）。
// 只有 scripts/forum.mjs 为上游 CDP 验收和本机示例预览设 GEEK_FORUM_LOGIN=demo，保留原仓的「选择一个身份」；
// 真实数据（快照）永远走统一登录。
const loginMode = contentSource === 'upstream-seed' && process.env.GEEK_FORUM_LOGIN === 'demo' ? 'demo' : 'site'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-09-11',
  runtimeConfig: {
    geekForumContentDir,
    public: { siteDeployment, contentSource, siteName, loginMode },
  },

  // The editorial layer over the read-only snapshot (categories, tags,
  // polished bodies) lives in ./content and is read by server/utils through
  // `useStorage('assets:content')`.
  // `/llms.txt` and `/t/<id>.md` are answered by server/middleware/forum-markdown.ts;
  // prerendering them makes `nuxt generate` write one file per seed topic,
  // which is all the static image can serve.
  nitro: {
    serverAssets: [{ baseName: 'content', dir: fileURLToPath(new URL('./content', import.meta.url)) }],
    prerender: { routes: markdownPrerenderRoutes(seedTopicIds()) },
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
