import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

function findChromiumExecutable() {
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
  const entries = fs.readdirSync(cacheDir);
  const chromiumDirs = entries
    .filter((name) => name.startsWith('chromium-') && !name.includes('headless_shell'))
    .sort((a, b) => Number(b.replace('chromium-', '')) - Number(a.replace('chromium-', '')));
  for (const dir of chromiumDirs) {
    const candidate = path.join(cacheDir, dir, platformDir, binaryName);
    if (fs.existsSync(candidate)) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

const exe = findChromiumExecutable();
const base = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

async function run(viewport, label) {
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const cc = results.violations.filter((v) => v.id === 'color-contrast');
  console.log(
    `\n===== ${label} (${viewport ? viewport.width + 'x' + viewport.height : 'desktop'}) =====`,
  );
  if (cc.length === 0) {
    console.log('NO color-contrast violations');
  }
  for (const v of cc) {
    console.log(`\nViolation: ${v.id} (${v.impact}) - ${v.nodes.length} node(s)`);
    for (const node of v.nodes) {
      const d = node.any?.find((c) => c.data)?.data ?? node.all?.find((c) => c.data)?.data;
      const fg = d?.fgColor ?? '?';
      const bg = d?.bgColor ?? '?';
      const ratio = d?.contrastRatio ?? '?';
      console.log(`  fg=${fg} bg=${bg} ratio=${ratio}`);
      console.log(`  html=${node.html?.slice(0, 220)}`);
    }
  }
  await browser.close();
}

await run(undefined, 'desktop');
await run({ width: 393, height: 800 }, 'mobile');
