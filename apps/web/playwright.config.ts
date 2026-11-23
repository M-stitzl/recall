import { defineConfig, devices } from "@playwright/test";

/**
 * E2E-Tests laufen gegen den Produktions-Build und die lokale Supabase-Instanz
 * (`pnpm db:start` im Repo-Root). Der Test-Zugang e2e@recall.test stammt aus supabase/seed.sql.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 90_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // PW_CHANNEL=chrome nutzt das installierte Chrome statt des Playwright-Chromiums.
    channel: process.env.PW_CHANNEL || undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // iPhone-Maße und Touch, aber mit Chromium (kein WebKit-Download nötig).
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
