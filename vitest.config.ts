import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./web/shared", import.meta.url)),
      "react": fileURLToPath(new URL("./web/node_modules/react", import.meta.url)),
      "react-dom": fileURLToPath(new URL("./web/node_modules/react-dom", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
    testTimeout: 20000,
    hookTimeout: 20000,
    maxWorkers: 2,
    minWorkers: 1,
  },
});
