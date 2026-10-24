const { app, BrowserWindow, dialog, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const READY_PREFIX = 'KAKAOTALK_SERVER_READY:';
const STARTUP_TIMEOUT_MS = 20_000;
const ROOT = path.resolve(__dirname, '..');

let mainWindow = null;
let backend = null;
let appOrigin = null;
let quitting = false;
let mayQuit = false;
let stopPromise = null;

function readableError(error) {
  return error instanceof Error ? error.message : String(error);
}

function stopBackend() {
  if (stopPromise) return stopPromise;
  const child = backend;
  backend = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  stopPromise = new Promise((resolve) => {
    let finished = false;
    let forcedTimer;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(forcedTimer);
      resolve();
    };

    child.once('exit', finish);
    // Only terminate the process created by this Electron instance.
    child.kill('SIGTERM');
    forcedTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      finish();
    }, 3_000);
    forcedTimer.unref();
  });
  return stopPromise;
}

function startBackend() {
  const serverEntry = path.join(ROOT, 'server', 'index.js');
  const staticDir = path.join(ROOT, 'dist');
  if (!fs.existsSync(path.join(staticDir, 'index.html'))) {
    throw new Error('화면 빌드가 없습니다. 터미널에서 npm run desktop을 실행해 주세요.');
  }
  if (!fs.existsSync(serverEntry)) {
    throw new Error('서버 파일을 찾을 수 없습니다. 프로젝트 파일을 확인해 주세요.');
  }

  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const child = spawn(process.execPath, [serverEntry], {
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '0',
      STATIC_DIR: staticDir,
      DB_PATH: path.join(app.getPath('userData'), 'kakaotalk.sqlite'),
    },
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend = child;

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutBuffer = '';
    let stderrTail = '';

    const timeout = setTimeout(() => {
      fail(new Error('로컬 서버가 제시간에 시작되지 않았습니다.'));
    }, STARTUP_TIMEOUT_MS);

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-4_000);
    });
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      let newline;
      while ((newline = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (!line.startsWith(READY_PREFIX) || settled) continue;
        try {
          const result = JSON.parse(line.slice(READY_PREFIX.length));
          if (!Number.isInteger(result.port) || result.port < 1 || result.port > 65_535) {
            throw new Error('서버 포트가 올바르지 않습니다.');
          }
          appOrigin = `http://127.0.0.1:${result.port}`;
          settled = true;
          clearTimeout(timeout);
          resolve();
        } catch (error) {
          fail(new Error(`로컬 서버 시작 정보를 읽지 못했습니다. ${readableError(error)}`));
        }
      }
      // Avoid retaining arbitrary stdout if a child writes without line breaks.
      stdoutBuffer = stdoutBuffer.slice(-8_192);
    });
    child.once('error', fail);
    child.once('exit', (code, signal) => {
      if (!settled) {
        const details = stderrTail.trim();
        fail(new Error(`로컬 서버가 종료되었습니다 (${signal || code}).${details ? `\n\n${details}` : ''}`));
      } else if (!quitting) {
        dialog.showErrorBox('서버 연결이 종료되었습니다', '앱을 다시 실행해 주세요. 저장된 대화는 유지됩니다.');
        app.quit();
      }
    });
  });
}

function isAppUrl(url) {
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

function openExternalUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return;
    if (parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      shell.openExternal(parsed.href).catch(() => {});
    }
  } catch {
    // Malformed or custom-scheme links do not leave the application.
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: '나의 톡',
    width: 1_240,
    height: 850,
    minWidth: 920,
    minHeight: 650,
    backgroundColor: '#f7f8fa',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });
  const preventExternalNavigation = (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  };
  mainWindow.webContents.on('will-navigate', preventExternalNavigation);
  mainWindow.webContents.on('will-redirect', preventExternalNavigation);
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(appOrigin);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('before-quit', (event) => {
    if (mayQuit) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    stopBackend().finally(() => {
      mayQuit = true;
      app.quit();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (!mainWindow && appOrigin && !quitting) {
      createWindow().catch((error) => {
        dialog.showErrorBox('화면을 열 수 없습니다', readableError(error));
        app.quit();
      });
    }
  });

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    await startBackend();
    if (!quitting) await createWindow();
  }).catch((error) => {
    if (!quitting) dialog.showErrorBox('앱을 시작할 수 없습니다', readableError(error));
    app.quit();
  });
}
