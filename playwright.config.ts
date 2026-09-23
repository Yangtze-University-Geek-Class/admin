import { defineConfig, devices } from "@playwright/test";

/** 官网（app/web，React）与控制台（app/console，Vue + Tuffex）各起一个 dev server，端口与日常开发错开。 */
export const PORTAL_ORIGIN = "http://127.0.0.1:5179";
export const CONSOLE_ORIGIN = "http://127.0.0.1:5189";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: PORTAL_ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @yzgc/web exec vite --host 127.0.0.1 --port 5179 --strictPort",
      url: `${PORTAL_ORIGIN}/sites/portal/`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: "pnpm --filter @yzgc/console exec vite --host 127.0.0.1 --port 5189 --strictPort",
      url: `${CONSOLE_ORIGIN}/console`,
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
