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
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /robot-lab-(scene|check|tools|look|sensors|a11y|chain|gripper-ui|gripper|gripper-look|basic)\.spec\.ts$/ },
    // N18 R4.2 (ADR 0002 §7): the robot lab's 3D scene, drawn by software WebGL (SwiftShader) so that it renders the same on every
    // machine, with a GPU or none (a CI runner). The flags are explicit although Playwright adds the second itself. N18 R6.3: its Kiểm tra too;
    // N18 R4.8: its view tools; N18 R4.7: its 3D look; N18 R8: its accessibility; N19 E1-E3: the gripper car's chip, inspector and keys;
    // N19 E10: the gripper lessons themselves; N19 E8: the gripper car's look on its four lessons. demo-basic: the Basic demo's lab.
    {
      name: 'chromium-robot',
      use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
      testMatch: /robot-lab-(scene|check|tools|look|sensors|a11y|chain|gripper-ui|gripper|gripper-look|basic)\.spec\.ts$/,
    },
    // N18 R3.5 (robot plan §5): the robot world must hash the same on every engine. Firefox and WebKit run that one spec; Chromium
    // runs it with everything else. N18 final fix M11: Firefox runs the robot lab's own UI too, in the lesson host's frame (Kiểm tra, the
    // tools, the WebGL fallback to the 2D map). N19 E10: and the gripper lessons' Kiểm tra and their 2D map without WebGL.
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: /(robot-determinism|robot-lab|robot-lab-gripper|robot-webgl-fallback)\.spec\.ts$/ },
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
