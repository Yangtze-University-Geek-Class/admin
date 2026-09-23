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

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-09-11',
  runtimeConfig: {
    geekForumContentDir,
    public: { siteDeployment, contentSource, siteName },
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
