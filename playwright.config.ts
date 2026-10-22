import { defineConfig } from "@playwright/test";

try {
  process.loadEnvFile(".env.local");
} catch {
  // In CI the variables come from the environment.
}

// End-to-end tests run against a deployed app (production by default).
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY to create and
// remove throwaway test users; load them with --env-file=.env.local.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  expect: { timeout: 45_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://cprocurement.dev",
    channel: "chromium", // full Chromium in headless mode
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 45_000,
    navigationTimeout: 90_000,
  },
});
