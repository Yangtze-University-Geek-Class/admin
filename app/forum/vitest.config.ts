import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { STATIC_CDN_BASE } from '../../tests/static-cdn-fixture'

const app = fileURLToPath(new URL('./app', import.meta.url))

export default defineConfig({
  // 构建参数 STATIC_CDN_BASE 在测试里的取值（生产由 nuxt.config.ts 注入）：与环境文件派生的开关值相同。
  define: { 'import.meta.env.GEEK_STATIC_CDN_BASE': JSON.stringify(STATIC_CDN_BASE) },
  resolve: {
    alias: {
      '~': app,
      '@': app,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
