import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 60_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/decant/`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // Google Chrome rather than bundled Chromium: it ships the H.264 and AAC codecs that WebCodecs needs.
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/decant/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
