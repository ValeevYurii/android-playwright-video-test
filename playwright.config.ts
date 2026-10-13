import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [
    ['line'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  projects: [
    {
      name: 'unit',
      testMatch: '**/*.unit.spec.ts',
    },
    {
      name: 'mobile',
      testMatch: '**/mobile.spec.ts',
      use: {
        ...devices['Pixel 7'],
        // The recipe clips are H.264 (avc1). Use the installed Google Chrome,
        // because Playwright's bundled Chromium intentionally omits that codec.
        channel: 'chrome',
        locale: 'ru-RU',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
      },
    },
    {
      name: 'android',
      testMatch: '**/android.spec.ts',
    },
  ],
});
