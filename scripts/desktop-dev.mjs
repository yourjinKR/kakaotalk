import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitePath = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const electronPath = require('electron');
const frontendUrl = 'http://127.0.0.1:5173';
let shuttingDown = false;
let electron;

const vite = spawn(process.execPath, [vitePath, '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});

function stop(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  electron?.kill();
  vite.kill();
  process.exitCode = exitCode;
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
vite.on('error', (error) => {
  console.error(error.message);
  stop(1);
});
vite.on('exit', (code) => {
  if (!shuttingDown) stop(code || 1);
});

async function waitForFrontend() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !shuttingDown) {
    try {
      const response = await fetch(frontendUrl, { signal: AbortSignal.timeout(700) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // Vite is still binding its local port.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Vite 개발 서버를 시작하지 못했습니다. 5173 포트 사용 여부를 확인해 주세요.');
}

try {
  await waitForFrontend();
  if (!shuttingDown) {
    const environment = { ...process.env, KATALK_DEV_URL: frontendUrl, KATALK_PORT: '3001' };
    delete environment.ELECTRON_RUN_AS_NODE;
    electron = spawn(electronPath, [root], { cwd: root, env: environment, stdio: 'inherit', windowsHide: true });
    electron.on('error', (error) => {
      console.error(error.message);
      stop(1);
    });
    electron.on('exit', (code) => stop(code || 0));
  }
} catch (error) {
  console.error(error.message);
  stop(1);
}
