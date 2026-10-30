import { addVitePlugin, defineNuxtModule } from 'nuxt/kit'
import { productionSecurityNotice, securityNoticeMeta } from '../../../scripts/security-notice.mjs'

export default defineNuxtModule({
  meta: { name: 'yzgc-production-security-notice' },
  setup(_options, nuxt) {
    // 即使开发终端继承了正式环境变量，也不在开发服务器注入。
    if (nuxt.options.dev)
      return

    nuxt.options.app.head.meta ??= []
    nuxt.options.app.head.meta.push(...securityNoticeMeta())
    addVitePlugin(productionSecurityNotice())
  },
})
