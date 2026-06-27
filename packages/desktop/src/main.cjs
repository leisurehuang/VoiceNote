// Electron 主进程：启动 Ollama sidecar（打包态）+ fork 后端 + 打开原生窗口。
// dev 模式复用系统 brew 装的 whisper/ffmpeg/ollama；打包态用 app 内自带的 resources。
// 瘦身版：若自带 qwen 缺失，首次启动用自带 ollama pull 到用户可写目录（带 splash 进度）。
const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const { fork, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const BACKEND_PORT = 3100;
const OLLAMA_PORT = 11435; // 避开系统常占的 11434
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct';
const VER = app.getVersion();
// 自动检查更新：默认查 GitHub 仓库的最新 release（发布带 tag 的 release 即触发；无 release 静默跳过）。
// 也可用 VOICE_NOTES_UPDATE_URL 覆盖成自托管的清单 JSON（{version,url,note?}）。
const UPDATE_URL =
  process.env.VOICE_NOTES_UPDATE_URL ||
  'https://api.github.com/repos/leisurehuang/VoiceNote/releases/latest';

// 注意：app.isPackaged 在「代码放在 Resources/app 文件夹（非 app.asar）」时为 false，不可靠。
// 改用是否存在自带 resources 目录来判断打包态。
const isPackaged = fs.existsSync(path.join(process.resourcesPath, 'vn', 'bin', 'ollama'));
const projectRoot = isPackaged ? null : path.resolve(app.getAppPath(), '..', '..');

let ollamaProc = null;
let backendProc = null;
let win = null;
let ollamaModelsDir = null;

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

function resPath(...p) {
  return isPackaged
    ? path.join(process.resourcesPath, 'vn', ...p)
    : path.join(projectRoot, 'resources', ...p);
}

/** qwen manifest 在自带目录里 → 完整版（只读）；否则用用户可写目录（瘦身版首跑拉取）。 */
function resolveOllamaModelsDir() {
  if (ollamaModelsDir) return ollamaModelsDir;
  const bundled = resPath('ollama-models');
  const tagRel = `manifests/registry.ollama.ai/library/${OLLAMA_MODEL.replace(':', '/')}`;
  if (fs.existsSync(path.join(bundled, tagRel))) {
    ollamaModelsDir = bundled;
  } else {
    ollamaModelsDir = path.join(app.getPath('userData'), 'ollama-models');
    fs.mkdirSync(ollamaModelsDir, { recursive: true });
  }
  logf('ollamaModelsDir=' + ollamaModelsDir);
  return ollamaModelsDir;
}

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
  if (!isPackaged) return; // dev：用系统 ollama
  const bin = resPath('bin', 'ollama');
  logf('ollama bin: ' + bin + ' exists=' + fs.existsSync(bin));
  ollamaProc = spawn(bin, ['serve'], {
    env: {
      ...process.env,
      OLLAMA_HOST: `127.0.0.1:${OLLAMA_PORT}`,
      OLLAMA_MODELS: resolveOllamaModelsDir(),
      OLLAMA_KEEP_ALIVE: '30m',
      OLLAMA_ORIGINS: '*',
    },
    stdio: 'ignore',
  });
  ollamaProc.on('error', (e) => logf('ollama spawn error: ' + e.message));
  await waitUrl(`http://127.0.0.1:${OLLAMA_PORT}/api/tags`, 90000);
}

function createSplash(text) {
  const w = new BrowserWindow({
    width: 460, height: 280, frame: false, resizable: false, center: true,
    backgroundColor: '#0f1115', webPreferences: { contextIsolation: true, sandbox: true },
  });
  const body = `<body style="margin:0;background:#0f1115;color:#e6e8ee;font-family:-apple-system,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh"><div style="font-size:44px;margin-bottom:14px">🎙️</div><div style="font-size:14px;color:#9aa3b2">首次使用：正在下载摘要模型（约 4.7GB，仅这一次）</div><div id="p" style="font-size:26px;margin-top:12px">${text}</div></body>`;
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(body));
  return w;
}

/** 瘦身版：自带 qwen 缺失时，拉取到用户目录并显示进度。 */
async function ensureQwenModel() {
  if (!isPackaged) return; // dev：系统 ollama 自行管理
  const tags = await (await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/tags`)).json();
  const has = (tags.models || []).some((m) => m.name === OLLAMA_MODEL);
  if (has) {
    logf('qwen 已就绪，跳过 pull');
    return;
  }
  logf('qwen 缺失，开始 ollama pull ' + OLLAMA_MODEL);
  const splash = createSplash('准备中…');
  await new Promise((resolve) => {
    const p = spawn(resPath('bin', 'ollama'), ['pull', OLLAMA_MODEL], {
      env: {
        ...process.env,
        OLLAMA_HOST: `127.0.0.1:${OLLAMA_PORT}`,
        OLLAMA_MODELS: resolveOllamaModelsDir(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = (d) => {
      const s = d.toString();
      const pct = [...s.matchAll(/(\d+)%/g)].pop();
      if (pct) {
        try {
          splash.webContents.executeJavaScript(`document.getElementById('p').textContent='${pct[1]}%'`);
        } catch {
          /* 窗口可能已关 */
        }
        logf('pull ' + pct[1] + '%'); // 只在有百分比更新时记录，避免刷屏
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (e) => logf('pull error: ' + e.message));
    p.on('close', (code) => {
      logf('pull done code=' + code);
      resolve();
    });
  });
  try {
    splash.close();
  } catch {
    /* ignore */
  }
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
  backendProc = fork(backendFile, [], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
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
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(BACKEND_URL) || url.startsWith('http://127.0.0.1:')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => {
    win = null;
  });
}

function cmpVer(a, b) {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number(pa[i] || 0);
    const y = Number(pb[i] || 0);
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** 启动后非阻塞检查更新。默认查 GitHub releases/latest；有新版弹窗带「前往下载」。 */
async function checkForUpdate() {
  try {
    const r = await fetch(UPDATE_URL, {
      headers: { 'User-Agent': 'VoiceNotes-Updater', Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 404) {
      logf('更新检查：远端暂无 release（' + UPDATE_URL + '）');
      return;
    }
    if (!r.ok) {
      logf('更新检查：源返回 ' + r.status);
      return;
    }
    const j = await r.json();
    // 兼容两种：GitHub release（tag_name + assets）或自定义 {version, url, note}
    const remoteVer = j.tag_name
      ? String(j.tag_name).replace(/^v/i, '')
      : j.version
        ? String(j.version)
        : '';
    if (!remoteVer) {
      logf('更新检查：无版本信息');
      return;
    }
    if (cmpVer(remoteVer, VER) > 0) {
      // 选下载地址：优先「完整版 dmg」资源，否则任意 dmg，再否则 release 页
      let url = j.url;
      if (!url && Array.isArray(j.assets)) {
        const dmgs = j.assets.filter((a) => /\.dmg$/i.test(a.name));
        const pick = dmgs.find((a) => !/slim/i.test(a.name)) || dmgs[0];
        url = pick && pick.browser_download_url;
      }
      url = url || j.html_url;
      const detail = (j.body || j.note || '点击「前往下载」打开下载页。').toString().slice(0, 400);
      const res = await dialog.showMessageBox({
        type: 'info',
        buttons: ['前往下载', '稍后再说'],
        defaultId: 0,
        cancelId: 1,
        title: '发现新版本',
        message: `发现新版本 ${remoteVer}（当前 ${VER}）`,
        detail,
      });
      if (res.response === 0 && url) shell.openExternal(url);
      logf('更新检查：发现新版 ' + remoteVer + ' → ' + url);
    } else {
      logf('更新检查：已是最新 ' + VER + '（远端 ' + remoteVer + '）');
    }
  } catch (e) {
    logf('更新检查失败：' + (e && e.message ? e.message : e));
  }
}

function buildMenu() {
  const tpl = [
    {
      label: 'Voice Notes',
      submenu: [
        { label: '检查更新…', click: () => void checkForUpdate() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
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
    buildMenu();
    logf('app ready v' + VER + ' isPackaged=' + isPackaged);
    try {
      await startOllama();
      await ensureQwenModel(); // 瘦身版首拉 qwen（带 splash）
      await startBackend();
      createWindow();
      logf('window opened');
      void checkForUpdate(); // 非阻塞
    } catch (e) {
      logf('启动失败：' + (e && e.stack ? e.stack : e));
      dialog.showErrorBox('Voice Notes 启动失败', (e && e.message ? e.message : e) + '\n\n请检查 app 内依赖是否完整。');
      createWindow();
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
