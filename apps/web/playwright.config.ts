import fs from 'fs';
import os from 'os';
import path from 'path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for WaitLayer browser E2E tests.
 *
 * Tests run against the built web app (next start) on port 3000.
 * The API must be running on port 4002 for API-dependent tests.
 *
 * Usage:
 *   pnpm --filter waitlayer-web build
 *   pnpm --filter waitlayer-web start &
 *   pnpm --filter waitlayer-web e2e
 */

/**
 * Locate a usable Chromium executable in the Playwright cache.
 * Playwright 1.61+ prefers a lightweight headless-shell binary, but some
 * environments (including this sandbox) only have the full Chromium build
 * cached. Fall back to the full Chromium binary so E2E tests can run locally
 * without requiring a network download of the headless shell.
 */
function findChromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }

  const cacheDir =
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.homedir(), '.cache', 'ms-playwright');
  if (!fs.existsSync(cacheDir)) return undefined;

  const platformDir =
    process.platform === 'win32'
      ? 'chrome-win64'
      : process.platform === 'darwin'
        ? 'chrome-mac'
        : 'chrome-linux64';
  const binaryName = process.platform === 'win32' ? 'chrome.exe' : 'chrome';

  // Look for the newest chromium-XXXX directory that contains the platform binary.
  const entries = fs.readdirSync(cacheDir);
  const chromiumDirs = entries
    .filter((name) => name.startsWith('chromium-') && !name.includes('headless_shell'))
    .sort((a, b) => {
      const aNum = Number(a.replace('chromium-', ''));
      const bNum = Number(b.replace('chromium-', ''));
      return bNum - aNum;
    });

  for (const dir of chromiumDirs) {
    const candidate = path.join(cacheDir, dir, platformDir, binaryName);
    if (fs.existsSync(candidate)) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
      } catch {
        continue;
      }
      return candidate;
    }
  }

  return undefined;
}

const chromiumExecutablePath = findChromiumExecutable();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ...(chromiumExecutablePath
      ? { launchOptions: { executablePath: chromiumExecutablePath } }
      : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
