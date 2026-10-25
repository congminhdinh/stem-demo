import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 5173);
const baseURL = `http://localhost:${port}`;
/** The lesson page that frames the lab in the iframe E2E (S1, e2e/lesson-host.mjs). */
const lessonHostPort = 5190;

export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  use: { baseURL },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // N18 R3.5 (robot plan §5): the robot world must hash the same on every engine. Firefox and WebKit run that one spec; Chromium
    // runs it with everything else.
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: /robot-determinism\.spec\.ts$/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: /robot-determinism\.spec\.ts$/ },
  ],
  webServer: [
    {
      command: `pnpm dev --port ${port} --strictPort`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `node e2e/lesson-host.mjs ${lessonHostPort}`,
      url: `http://localhost:${lessonHostPort}/lesson`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
