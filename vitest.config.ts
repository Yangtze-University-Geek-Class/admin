import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { STATIC_CDN_BASE } from "./tests/static-cdn-fixture";
export default defineConfig({
  // 构建参数 STATIC_CDN_BASE 在测试里的取值（生产由 app/forum/nuxt.config.ts 注入）：与环境文件派生的开关值相同。
  define: { "import.meta.env.GEEK_STATIC_CDN_BASE": JSON.stringify(STATIC_CDN_BASE) },
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./app/web/shared", import.meta.url)),
      "react": fileURLToPath(new URL("./app/web/node_modules/react", import.meta.url)),
      "react-dom": fileURLToPath(new URL("./app/web/node_modules/react-dom", import.meta.url)),
      "react-router-dom": fileURLToPath(new URL("./app/web/node_modules/react-router-dom", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
      include: ["app/server/src/**", "app/console/src/**", "app/web/shared/**", "app/web/sites/**"],
      exclude: ["**/*.d.ts", "**/node_modules/**"],
    },
    maxWorkers: 2,
    minWorkers: 1,
  },
});
