import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(root, 'test-results');
await mkdir(outputRoot, { recursive: true });
const testDirectory = await mkdtemp(path.join(outputRoot, 'desktop-'));
const userDataDirectory = path.join(testDirectory, 'profile');
const environment = {
  ...process.env,
  KATALK_DATA_DIR: path.join(testDirectory, 'data'),
  KATALK_USER_DATA_DIR: userDataDirectory,
  KATALK_PORT: '0',
};
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.KATALK_DEV_URL;

let desktop;
let applicationUrl;
const rendererErrors = [];

async function launch() {
  desktop = await electron.launch({ args: [root], cwd: root, env: environment, timeout: 35000 });
  const window = await desktop.firstWindow({ timeout: 30000 });
  window.setDefaultTimeout(10000);
  window.on('pageerror', (error) => rendererErrors.push(error.message));
  await window.waitForLoadState('domcontentloaded');
  applicationUrl = new URL(window.url()).origin;
  assert.match(applicationUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(await desktop.evaluate(({ app }) => app.getPath('userData')), userDataDirectory);
  return window;
}

async function waitForBackendToStop(url) {
  await expect.poll(async () => {
    try {
      const response = await fetch(`${url}/api/me`, { signal: AbortSignal.timeout(400) });
      await response.body?.cancel();
      return false;
    } catch {
      return true;
    }
  }, { timeout: 7000, message: 'Electron 종료 후 전용 서버도 종료되어야 합니다.' }).toBe(true);
}

async function close() {
  if (!desktop) return;
  const running = desktop;
  const childProcess = running.process();
  desktop = null;
  let timeout;
  try {
    await Promise.race([
      running.close(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Electron did not close in 10 seconds.')), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    if (childProcess.exitCode === null && childProcess.signalCode === null) childProcess.kill();
  }
  await waitForBackendToStop(applicationUrl);
}

try {
  let window = await launch();
  console.log('Desktop launched:', applicationUrl);
  await expect(window.getByRole('heading', { name: '다시 만나서 반가워요' })).toBeVisible();
  const browserWindow = await desktop.browserWindow(window);
  const preferences = await browserWindow.evaluate((nativeWindow) => nativeWindow.webContents.getLastWebPreferences());
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.webSecurity, true);
  assert.deepEqual(await window.evaluate(() => [typeof window.require, typeof window.process]), ['undefined', 'undefined']);
  assert.equal(await window.evaluate(() => window.open('https://example.invalid') === null), true);
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);

  console.log('Renderer isolation and popup restrictions passed.');

  await window.locator('.demo-users').getByRole('button', { name: /김영/ }).click();
  await expect(window.getByRole('navigation', { name: '메인 메뉴' })).toBeVisible();
  await expect(window.getByText('연결됨', { exact: true })).toBeVisible();
  console.log('Demo account logged in.');
  await window.getByRole('button', { name: '채팅', exact: true }).click();
  await window.locator('.chat-row').filter({ has: window.locator('strong', { hasText: '이지윤' }) }).first().click();
  const message = `PC 앱 저장 확인 ${Date.now()}`;
  await window.getByRole('textbox', { name: '메시지 입력' }).fill(message);
  await window.getByRole('button', { name: '메시지 전송' }).click();
  await expect(window.locator('.message-scroller').getByText(message, { exact: true })).toBeVisible();
  await window.screenshot({ path: path.join(testDirectory, 'desktop-chat.png') });
  const initialUrl = window.url();
  const navigationBlocked = browserWindow.evaluate((nativeWindow) => new Promise((resolve) => {
    nativeWindow.webContents.once('will-navigate', (event) => resolve(event.defaultPrevented));
  }));
  await window.evaluate(() => {
    const link = document.createElement('a');
    link.href = 'https://example.invalid';
    document.body.append(link);
    link.click();
    link.remove();
  });
  assert.equal(await navigationBlocked, true);
  assert.equal(window.url(), initialUrl);
  await close();
  console.log('First session saved and shut down.');

  window = await launch();
  await expect(window.getByRole('navigation', { name: '메인 메뉴' })).toBeVisible();
  await window.getByRole('button', { name: '채팅', exact: true }).click();
  await window.locator('.chat-row').filter({ has: window.locator('strong', { hasText: '이지윤' }) }).first().click();
  await expect(window.locator('.message-scroller').getByText(message, { exact: true })).toBeVisible();
  assert.deepEqual(rendererErrors, []);
  await close();
  console.log(`Electron desktop smoke passed: login, send, restart persistence, renderer isolation, navigation restrictions, server cleanup.\nArtifacts: ${testDirectory}`);
} catch (error) {
  if (desktop) {
    await desktop.firstWindow().then((window) => window.screenshot({ path: path.join(testDirectory, 'failure.png') })).catch(() => {});
  }
  console.error(error);
  throw error;
} finally {
  await close();
}
