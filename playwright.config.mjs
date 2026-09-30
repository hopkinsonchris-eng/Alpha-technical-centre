// End-to-end harness for the site, the tools and the Hub. Chromium is
// pre-installed in the cloud container; locally `npx playwright install chromium`.
import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const PW = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const executablePath = existsSync(`${PW}/chromium`) ? `${PW}/chromium` : undefined;

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:8010',
    viewport: { width: 1440, height: 900 },
    launchOptions: executablePath ? { executablePath } : {},
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'python3 -m http.server 8010 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8010/index.html',
    reuseExistingServer: true,
    timeout: 15_000,
  },
});
