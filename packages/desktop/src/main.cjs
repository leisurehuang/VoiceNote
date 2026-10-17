// Electron 主进程：启动 Ollama sidecar（打包态）+ fork 后端 + 打开原生窗口。
// dev 模式复用系统 brew 装的 whisper/ffmpeg/ollama；打包态用 app 内自带的 resources。
// 启动不下载任何模型、不阻塞：缺什么由前端横幅引导到 设置 → 模型 里下载。
// 另含：全局听写（dictation/manager.cjs）、系统托盘常驻（关窗不退出）。
const {
  app,
  BrowserWindow,
  shell,
  Menu,
  dialog,
  Tray,
  nativeImage,
  ipcMain,
  session,
} = require('electron');
const { fork, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { initAutoUpdater, checkForUpdates: checkAutoUpdates } = require('./autoUpdater.cjs');
const dictation = require('./dictation/manager.cjs');

// 隐藏录音窗口无用户手势也要能跑 AudioContext（听写录音依赖）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const BACKEND_PORT = 3100;
const OLLAMA_PORT = 11435; // 避开系统常占的 11434
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct';
const VER = app.getVersion();
// Windows 上的自带二进制带 .exe 后缀
const EXE = process.platform === 'win32' ? '.exe' : '';
// 自动检查更新：默认查 GitHub 仓库的最新 release（发布带 tag 的 release 即触发；无 release 静默跳过）。
// 也可用 VOICE_NOTES_UPDATE_URL 覆盖成自托管的清单 JSON（{version,url,note?}）。
const UPDATE_URL =
  process.env.VOICE_NOTES_UPDATE_URL ||
  'https://api.github.com/repos/leisurehuang/VoiceNote/releases/latest';

// 注意：app.isPackaged 在「代码放在 Resources/app 文件夹（非 app.asar）」时为 false，不可靠。
// 改用是否存在自带 resources 目录来判断打包态。
const isPackaged = fs.existsSync(path.join(process.resourcesPath, 'vn', 'bin', 'ollama' + EXE));
const projectRoot = isPackaged ? null : path.resolve(app.getAppPath(), '..', '..');

let ollamaProc = null;
let backendProc = null;
let win = null;
let ollamaModelsDir = null;
let tray = null;
let isQuitting = false; // 真 quit（托盘退出/菜单退出）时才允许窗口 close 销毁

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
  const bin = resPath('bin', 'ollama' + EXE);
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
  // 不阻塞启动：模型未下载时用户在设置里拉取，health 横幅自会提示
  try {
    await waitUrl(`http://127.0.0.1:${OLLAMA_PORT}/api/tags`, 20000);
  } catch {
    logf('ollama 启动探测超时（不阻塞主流程，稍后 health 会提示）');
  }
}

async function startBackend() {
  const backendFile = resPath('app', 'backend.cjs');
  logf('backend.cjs: ' + backendFile + ' exists=' + fs.existsSync(backendFile));
  /** @type {Record<string, string | undefined>} */
  const env = {
    ...process.env,
    PORT: String(BACKEND_PORT),
    DATA_DIR: path.join(app.getPath('userData'), 'data'),
  };
  if (isPackaged) {
    env.FRONTEND_DIST = resPath('app', 'frontend-dist');
    env.WHISPER_CLI = resPath('bin', 'whisper-cli' + EXE);
    env.WHISPER_MODEL = resPath('models', 'ggml-large-v3-turbo.bin');
    env.FFMPEG = resPath('bin', 'ffmpeg' + EXE);
    env.FFPROBE = resPath('bin', 'ffprobe' + EXE);
    // whisper 模型下载/缓存目录（用户可写）；新包不内置模型，首次在设置里下载
    env.VOICE_NOTES_MODELS_DIR = path.join(app.getPath('userData'), 'voice-notes-models');
    // 随包分发的只读模型目录（新包为空/不存在，仅作展示与回退）
    env.VOICE_NOTES_BUNDLED_MODELS_DIR = resPath('models');
    env.OLLAMA_BASE_URL = `http://127.0.0.1:${OLLAMA_PORT}/v1`;
    env.OLLAMA_MODEL = OLLAMA_MODEL;
  } else {
    env.FRONTEND_DIST = path.join(projectRoot, 'packages', 'frontend', 'dist');
    // Linux 开发模式：使用系统已安装的工具
    if (process.platform === 'linux') {
      // 尝试找到 whisper-cli
      let whisperCli = process.env.WHISPER_CLI;
      if (!whisperCli) {
        const userWhisper = path.join(
          process.env.HOME || '',
          '.voice-notes-models',
          'bin',
          'whisper-cli',
        );
        if (fs.existsSync(userWhisper)) {
          whisperCli = userWhisper;
        }
      }
      if (whisperCli) env.WHISPER_CLI = whisperCli;

      // 尝试找到 whisper 模型
      let whisperModel = process.env.WHISPER_MODEL;
      if (!whisperModel) {
        const userModel = path.join(
          process.env.HOME || '',
          '.voice-notes-models',
          'ggml-large-v3-turbo.bin',
        );
        if (fs.existsSync(userModel)) {
          whisperModel = userModel;
        }
      }
      if (whisperModel) env.WHISPER_MODEL = whisperModel;

      // ffmpeg 和 ffprobe 默认在 PATH 中
    }
  }
  backendProc = fork(backendFile, [], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  backendProc.stdout?.on('data', (d) => process.stdout.write('[backend] ' + d));
  backendProc.stderr?.on('data', (d) => process.stderr.write('[backend] ' + d));
  await waitUrl(`${BACKEND_URL}/api/health`, 30000);
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  const windowOpts = {
    width: 1080,
    height: 740,
    minWidth: 760,
    minHeight: 480,
    title: 'Voice Notes',
    backgroundColor: '#1d1d20',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      // 添加预加载脚本以安全地暴露 API
      preload: path.join(__dirname, 'preload.cjs'),
    },
  };
  if (isMac) {
    // macOS 原生标题栏：隐藏标准标题栏、保留交通灯并内嵌
    windowOpts.titleBarStyle = 'hiddenInset';
    windowOpts.trafficLightPosition = { x: 15, y: 17 };
    windowOpts.vibrancy = 'under-window';
    windowOpts.visualEffectState = 'active';
  }
  win = new BrowserWindow(windowOpts);
  win.loadURL(BACKEND_URL);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(BACKEND_URL) || url.startsWith('http://127.0.0.1:'))
      return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  // 托盘常驻：关闭主窗口 = 隐藏（听写快捷键继续可用），托盘菜单/退出才真正关闭
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    win = null;
  });

  // 初始化自动更新（使用 electron-updater）
  initAutoUpdater(win);
}

/** 系统托盘：显示主窗口 / 开始听写 / 退出。 */
function createTray() {
  const iconFile = process.platform === 'darwin' ? 'tray-16.png' : 'tray-32.png';
  const icon = nativeImage.createFromPath(path.join(__dirname, 'dictation', 'assets', iconFile));
  tray = new Tray(icon); // 文件缺失时为空图标，托盘仍可用（菜单驱动）
  tray.setToolTip('Voice Notes · 语音笔记与全局听写');
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMainWindow() },
    { label: '开始 / 停止听写', click: () => dictation.toggle() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  // macOS：点托盘图标切换主窗口显隐（右键弹菜单）
  if (process.platform === 'darwin') {
    tray.on('click', () => {
      if (win && win.isVisible()) win.hide();
      else showMainWindow();
    });
  }
}

function showMainWindow() {
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
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

/** 检查更新（默认查 GitHub releases/latest）；有新版弹窗带「前往下载」。
 * 返回 {found, version?, error?} 供设置页「检查更新」按钮回显（菜单/启动调用忽略返回值）。 */
async function checkForUpdate() {
  try {
    const r = await fetch(UPDATE_URL, {
      headers: { 'User-Agent': 'VoiceNotes-Updater', Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 404) {
      logf('更新检查：远端暂无 release（' + UPDATE_URL + '）');
      return { found: false };
    }
    if (!r.ok) {
      logf('更新检查：源返回 ' + r.status);
      return { found: false, error: '更新源返回 ' + r.status };
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
      return { found: false, error: '更新源无版本信息' };
    }
    if (cmpVer(remoteVer, VER) > 0) {
      // 选下载地址：按当前平台挑对应安装包（mac→dmg / win→NSIS exe 非 portable / linux→AppImage），否则 release 页
      let url = j.url;
      if (!url && Array.isArray(j.assets)) {
        const names = j.assets.map((a) => a.name || '');
        const pickName = () => {
          if (process.platform === 'darwin') {
            const dmgs = names.filter((n) => /\.dmg$/i.test(n));
            return dmgs.find((n) => !/slim/i.test(n)) || dmgs[0];
          }
          if (process.platform === 'win32') {
            const exes = names.filter((n) => /\.exe$/i.test(n) && !/portable/i.test(n));
            return exes[0] || names.find((n) => /\.exe$/i.test(n));
          }
          return names.find((n) => /\.AppImage$/i.test(n));
        };
        const name = pickName();
        const asset = name && j.assets.find((a) => a.name === name);
        url = asset && asset.browser_download_url;
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
      return { found: true, version: remoteVer };
    } else {
      logf('更新检查：已是最新 ' + VER + '（远端 ' + remoteVer + '）');
      return { found: false };
    }
  } catch (e) {
    logf('更新检查失败：' + (e && e.message ? e.message : e));
    return { found: false, error: e && e.message ? e.message : String(e) };
  }
}

// 设置页「检查更新」入口：mac 走这条原生弹窗路径（未签名装不了应用内更新，见 buildMenu 注释）；
// win/linux 设置页走 electron-updater（'check-for-updates'，结果经事件推给 UpdateBanner）。
ipcMain.handle('check-for-update-dialog', () => checkForUpdate());

function buildMenu() {
  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const tpl = [
    {
      label: 'Voice Notes',
      submenu: [
        // mac 应用未签名（electron-builder identity: null）：Squirrel.Mac 拒装未签名更新，
        // electron-updater 的下载后安装走不通 → mac 走「弹窗 + 前往下载」；win/linux 走应用内更新
        {
          label: '检查更新…',
          click: () => void (process.platform === 'darwin' ? checkForUpdate() : checkAutoUpdates()),
        },
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
    showMainWindow();
  });

  /** 麦克风权限：只放行自家页面（主窗口的后端源 + 听写隐藏录音窗的 file:// 页）。 */
  function setupPermissions() {
    const isOwnPage = (url) =>
      typeof url === 'string' && (url.startsWith(BACKEND_URL) || url.startsWith('file://'));
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      if (permission === 'media' && isOwnPage(wc.getURL())) return cb(true);
      cb(false);
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission, requestingUrl) => {
      return permission === 'media' && isOwnPage(requestingUrl || (wc && wc.getURL()));
    });
  }

  app.whenReady().then(async () => {
    buildMenu();
    setupPermissions();
    logf('app ready v' + VER + ' isPackaged=' + isPackaged);
    try {
      // 模型下载不再阻塞启动：ollama 后台起，主窗口立即可用；
      // 缺模型时由页面顶部横幅引导到 设置 → 模型 下载
      await startOllama();
      await startBackend();
      createWindow();
      createTray();
      // 全局听写：注册快捷键 + 预热录音窗口（backend 就绪后）
      dictation.init({ backendUrl: BACKEND_URL, log: logf });
      ipcMain.on('dictation-settings-changed', () => void dictation.reloadShortcuts());
      logf('window opened');
      void checkForUpdate(); // 非阻塞
    } catch (e) {
      logf('启动失败：' + (e && e.stack ? e.stack : e));
      dialog.showErrorBox(
        'Voice Notes 启动失败',
        (e && e.message ? e.message : e) + '\n\n请检查 app 内依赖是否完整。',
      );
      createWindow();
    }
  });

  app.on('window-all-closed', () => {
    // 主窗口 close 被拦截为 hide，正常不会走到这里；仅异常兜底
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    // macOS Dock 点击：窗口被隐藏时重新显示
    if (!win) createWindow();
    else showMainWindow();
  });
  app.on('before-quit', () => {
    isQuitting = true;
    dictation.destroy();
    killChild(backendProc);
    killChild(ollamaProc);
  });
}
