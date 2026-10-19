import { defineConfig, devices } from '@playwright/test';
import { BASE_PATH } from './scripts/site.ts';

const PORT = 4173;
// Set E2E_BASE_URL (e.g. https://joshuafitzmorris.github.io/decant/) to test a deployed site instead of a local build.
const deployed = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 60_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: deployed ?? `http://localhost:${PORT}${BASE_PATH}`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // Google Chrome rather than bundled Chromium: it ships the H.264 and AAC codecs that WebCodecs needs.
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    // Safari's engine. Run it on macOS, where it uses the same media and image frameworks as Safari.
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: deployed
    ? undefined
    : {
        command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}${BASE_PATH}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
