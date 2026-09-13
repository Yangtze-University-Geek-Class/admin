import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5179",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --filter @yzgc/web exec vite --host 127.0.0.1 --port 5179 --strictPort",
    url: "http://127.0.0.1:5179/sites/portal/",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
