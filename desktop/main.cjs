const { app, BrowserWindow, dialog, Menu } = require('electron');
const { fork } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

let mainWindow;
let backend;
let applicationUrl;
let shuttingDown = false;

app.setName('카톡');
app.setAppUserModelId('local.katalk.desktop');

if (process.env.KATALK_USER_DATA_DIR) {
  const userDataDirectory = path.resolve(process.env.KATALK_USER_DATA_DIR);
  mkdirSync(userDataDirectory, { recursive: true });
  app.setPath('userData', userDataDirectory);
}

function localUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port || parsed.username || parsed.password) {
    throw new Error('앱 서버는 127.0.0.1의 로컬 HTTP 주소여야 합니다.');
  }
  return parsed;
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const root = app.getAppPath();
    let diagnostic = '';
    let settled = false;
    backend = fork(path.join(root, 'server', 'index.mjs'), [], {
      cwd: root,
      execPath: process.execPath,
      execArgv: [],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        HOST: '127.0.0.1',
        PORT: process.env.KATALK_PORT || (process.env.KATALK_DEV_URL ? '3001' : '0'),
        DATA_DIR: process.env.KATALK_DATA_DIR || path.join(app.getPath('userData'), 'data'),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });

    const timer = setTimeout(() => finish(new Error('로컬 채팅 서버를 시작하는 데 시간이 너무 오래 걸립니다.')), 25000);
    const collectOutput = (chunk) => {
      diagnostic = `${diagnostic}${chunk}`.slice(-6000);
    };
    backend.stdout.on('data', collectOutput);
    backend.stderr.on('data', collectOutput);

    function finish(error, url) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        error.message += diagnostic ? `\n\n${diagnostic.slice(-2200)}` : '';
        reject(error);
      } else {
        resolve(url);
      }
    }

    backend.on('message', (message) => {
      if (message?.type !== 'ready') return;
      try {
        finish(null, localUrl(message.url).href);
      } catch (error) {
        finish(error);
      }
    });
    backend.on('error', (error) => finish(error));
    backend.on('exit', (code, signal) => {
      backend = null;
      if (!settled) {
        finish(new Error(`로컬 채팅 서버가 종료되었습니다 (${signal || code}).`));
      } else if (!shuttingDown) {
        dialog.showErrorBox('카톡 서버 연결 종료', '로컬 서버가 종료되었습니다. 앱을 다시 실행해 주세요.');
        app.quit();
      }
    });
  });
}

function stopBackend() {
  const child = backend;
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish();
    }, 2000);
    child.once('exit', finish);
    if (child.connected) {
      child.send({ type: 'shutdown' }, (error) => {
        if (error) child.kill();
      });
    } else {
      child.kill();
    }
  });
}

function createWindow(url) {
  const allowedOrigin = localUrl(url).origin;
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 840,
    minWidth: 860,
    minHeight: 620,
    title: '카톡',
    backgroundColor: '#f6f7f9',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const restrictNavigation = (event, destination) => {
    try {
      if (new URL(destination).origin !== allowedOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  };
  mainWindow.webContents.on('will-navigate', restrictNavigation);
  mainWindow.webContents.on('will-redirect', restrictNavigation);
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow.loadURL(url);
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
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (shuttingDown || !backend) return;
    event.preventDefault();
    shuttingDown = true;
    stopBackend().finally(() => app.quit());
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const backendUrl = await startBackend();
    applicationUrl = process.env.KATALK_DEV_URL ? localUrl(process.env.KATALK_DEV_URL).href : backendUrl;
    await createWindow(applicationUrl);
  }).catch((error) => {
    dialog.showErrorBox('카톡을 시작할 수 없습니다', error.message);
    app.quit();
  });
  app.on('activate', () => {
    if (applicationUrl && BrowserWindow.getAllWindows().length === 0) {
      createWindow(applicationUrl).catch((error) => dialog.showErrorBox('카톡을 열 수 없습니다', error.message));
    }
  });
}
