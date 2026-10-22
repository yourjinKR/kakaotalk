import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const port = 3101;
const baseURL = `http://127.0.0.1:${port}`;
const dataDirectory = path.resolve('test-results', 'ui-data', `${Date.now()}-${process.pid}`);

export default defineConfig({
  testDir: './tests',
  testMatch: 'ui.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: 'list',
  outputDir: 'test-results/playwright',
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    baseURL,
    viewport: { width: 1440, height: 1000 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server/index.mjs',
    url: `${baseURL}/api/me`,
    env: { HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDirectory },
    reuseExistingServer: false,
    timeout: 30000,
  },
});
