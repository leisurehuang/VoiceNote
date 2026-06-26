// Electron 主进程：启动 Ollama sidecar（打包态）+ fork 后端 + 打开原生窗口。
// dev 模式复用系统 brew 装的 whisper/ffmpeg/ollama；打包态全部用 app 内自带的 resources。
const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const { fork, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

// 调试日志：写到 userData/main.log（open 启动时看不到 stdout）
let LOG_PATH = null;
function logf(msg) {
  try {
    if (!LOG_PATH) LOG_PATH = path.join(app.getPath('userData'), 'main.log');
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    /* ignore */
  }
  console.log(msg);
}

const BACKEND_PORT = 3100;
const OLLAMA_PORT = 11435; // 避开系统常占的 11434
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct';

// 注意：app.isPackaged 在「代码放在 Resources/app 文件夹（非 app.asar）」时为 false，不可靠。
// 改用是否存在自带 resources 目录来判断打包态。
const isPackaged = fs.existsSync(path.join(process.resourcesPath, 'vn', 'bin', 'ollama'));
const projectRoot = isPackaged ? null : path.resolve(app.getAppPath(), '..', '..');

let ollamaProc = null;
let backendProc = null;
let win = null;

/** 打包态：process.resourcesPath/vn/... ；dev：<root>/resources/... */
function resPath(...p) {
  return isPackaged
    ? path.join(process.resourcesPath, 'vn', ...p)
    : path.join(projectRoot, 'resources', ...p);
}

/** 轮询 URL 直到 2xx/3xx/4xx 或超时（用于等 sidecar/后端就绪）。 */
function waitUrl(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (r) => {
        r.resume();
        if (r.statusCode < 500) resolve();
        else later();
      });
      req.on('error', later);
      req.setTimeout(1500, () => {
        req.destroy();
        later();
      });
    };
    const later = () => {
      if (Date.now() - start > timeoutMs) reject(new Error('等待超时：' + url));
      else setTimeout(tick, 400);
    };
    tick();
  });
}

async function startOllama() {
  if (!isPackaged) return; // dev：用系统 ollama（默认 11434）
  const bin = resPath('bin', 'ollama');
  logf('ollama bin: ' + bin + ' exists=' + fs.existsSync(bin));
  ollamaProc = spawn(resPath('bin', 'ollama'), ['serve'], {
    env: {
      ...process.env,
      OLLAMA_HOST: `127.0.0.1:${OLLAMA_PORT}`,
      OLLAMA_MODELS: resPath('ollama-models'),
      OLLAMA_KEEP_ALIVE: '30m',
      OLLAMA_ORIGINS: '*',
    },
    stdio: 'ignore',
  });
  ollamaProc.on('error', (e) => console.error('[ollama]', e.message));
  await waitUrl(`http://127.0.0.1:${OLLAMA_PORT}/api/tags`, 90000);
}

async function startBackend() {
  const backendFile = resPath('app', 'backend.cjs');
  logf('backend.cjs: ' + backendFile + ' exists=' + fs.existsSync(backendFile));
  const env = {
    ...process.env,
    PORT: String(BACKEND_PORT),
    DATA_DIR: path.join(app.getPath('userData'), 'data'),
  };
  if (isPackaged) {
    env.FRONTEND_DIST = resPath('app', 'frontend-dist');
    env.WHISPER_CLI = resPath('bin', 'whisper-cli');
    env.WHISPER_MODEL = resPath('models', 'ggml-large-v3-turbo.bin');
    env.FFMPEG = resPath('bin', 'ffmpeg');
    env.FFPROBE = resPath('bin', 'ffprobe');
    env.OLLAMA_BASE_URL = `http://127.0.0.1:${OLLAMA_PORT}/v1`;
    env.OLLAMA_MODEL = OLLAMA_MODEL;
  } else {
    env.FRONTEND_DIST = path.join(projectRoot, 'packages', 'frontend', 'dist');
  }
  backendProc = fork(resPath('app', 'backend.cjs'), [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  backendProc.stdout?.on('data', (d) => process.stdout.write('[backend] ' + d));
  backendProc.stderr?.on('data', (d) => process.stderr.write('[backend] ' + d));
  await waitUrl(`${BACKEND_URL}/api/health`, 30000);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 720,
    minHeight: 500,
    title: 'Voice Notes',
    backgroundColor: '#0f1115',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadURL(BACKEND_URL);
  // 外部链接在系统浏览器打开，不在窗口内跳转
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1:') || url.startsWith(BACKEND_URL)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => {
    win = null;
  });
}

function killChild(p) {
  if (!p) return;
  try {
    p.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      p.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }, 1500);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    logf('app ready, isPackaged=' + isPackaged);
    try {
      logf('startOllama…');
      await startOllama();
      logf('startBackend…');
      await startBackend();
      logf('createWindow…');
      createWindow();
      logf('window opened');
    } catch (e) {
      logf('启动失败：' + (e && e.stack ? e.stack : e));
      dialog.showErrorBox('Voice Notes 启动失败', (e && e.message ? e.message : e) + '\n\n请检查 app 内依赖是否完整。');
      createWindow(); // 仍开窗，前端会显示依赖缺失横幅
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (!win) createWindow();
  });
  app.on('before-quit', () => {
    killChild(backendProc);
    killChild(ollamaProc);
  });
}
