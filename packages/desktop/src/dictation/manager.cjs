/**
 * 听写管理器（主进程侧）：全局快捷键 → 隐藏窗口录音 → 流式上传边录边转写 → 润色 → 粘贴到光标 → 浮窗反馈。
 *
 * 状态机：idle → recording → processing → idle；录音中 Esc（临时注册）取消。
 * 窗口：recorder（隐藏，采集音频）、overlay（底部胶囊浮窗，不抢焦点）。
 *
 * 长听写：录音期间按 ~1s 一块把 PCM 流式发给后端（VAD 切句逐句转写），
 * 结束时只等尾句与润色，时长不再受一次性上传体积限制。
 */
const { BrowserWindow, Notification, globalShortcut, ipcMain, screen, shell } = require('electron');
const path = require('node:path');
const { deliverText } = require('./paster.cjs');

const OVERLAY_W = 380;
const OVERLAY_H = 78;
const MAX_RECORD_MS = 60 * 60 * 1000; // 最长 1 小时自动结束（流式转写，无短上限必要，仅防忘关）
const START_TIMEOUT_MS = 8000;
const CHUNK_TIMEOUT_MS = 30000;
const FINISH_TIMEOUT_MS = 600000; // 收尾要排空剩余转写 + 润色，长录音给足 10 分钟
/** 每 ~1s（16000 采样）攒一块上传：32KB/块，VAD 粒度足够。 */
const CHUNK_SAMPLES = 16000;

let backendUrl = 'http://127.0.0.1:3100';
let log = () => {};

// 状态
let phase = 'idle'; // idle | recording | processing
let startedAt = 0;
let autoStopTimer = null;
let elapsedTimer = null;
let recorderReady = null;
let pendingUpload = null; // finish 后等录音页停止回执：{ durationMs, samples }

// 流式上传
let stream = null; // { id, ready, chain, failed, chars }
let pendingChunks = []; // 待上传的 PCM 块
let pendingSamples = 0;
let recSamples = 0; // 本次录音总采样数

// 窗口
let recorderWin = null;
let overlayWin = null;
let overlayState = { phase: 'hidden' };

// 快捷键
let mainAcc = null; // 已注册的听写主快捷键
let cancelAcc = null; // 录音中临时注册的取消键
let dictationSettings = null; // 最近一次拉到的听写配置

function ensureRecorder() {
  if (recorderWin && !recorderWin.isDestroyed()) return recorderWin;
  recorderWin = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'recorder-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  recorderWin.on('closed', () => {
    recorderWin = null;
    recorderReady = null;
  });
  recorderReady = recorderWin.loadFile(path.join(__dirname, 'recorder.html')).catch((e) => {
    log('recorder.html 加载失败：' + (e && e.message ? e.message : e));
  });
  return recorderWin;
}

function ensureOverlay() {
  if (overlayWin && !overlayWin.isDestroyed()) return overlayWin;
  overlayWin = new BrowserWindow({
    width: OVERLAY_W,
    height: OVERLAY_H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.on('closed', () => {
    overlayWin = null;
  });
  overlayWin.loadFile(path.join(__dirname, 'overlay.html')).catch(() => {});
  return overlayWin;
}

/** 在光标所在屏底部居中显示浮窗（不激活、不抢焦点）。 */
function showOverlay() {
  const w = ensureOverlay();
  try {
    const cursor = screen.getCursorScreenPoint();
    const wa = screen.getDisplayNearestPoint(cursor).workArea;
    const x = Math.round(wa.x + (wa.width - OVERLAY_W) / 2);
    const y = Math.round(wa.y + wa.height - OVERLAY_H - 72);
    w.setPosition(x, y, false);
  } catch {
    /* 定位失败用默认位置 */
  }
  if (!w.isVisible()) w.showInactive();
}

function overlaySet(s) {
  overlayState = s;
  const w = overlayWin;
  if (w && !w.isDestroyed()) {
    try {
      w.webContents.send('overlay-state', s);
    } catch {
      /* ignore */
    }
  }
}

let hideTimer = null;
/** 短暂展示终态后隐藏浮窗。 */
function overlayFlash(s, ms) {
  showOverlay();
  overlaySet(s);
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.hide();
    hideTimer = null;
  }, ms);
}

function registerCancelShortcut() {
  const acc = dictationSettings?.cancelShortcut || 'Escape';
  try {
    if (globalShortcut.isRegistered(acc)) return;
    if (globalShortcut.register(acc, () => cancel())) cancelAcc = acc;
  } catch {
    /* 取消键注册失败不阻断录音 */
  }
}

function unregisterCancelShortcut() {
  if (cancelAcc) {
    try {
      globalShortcut.unregister(cancelAcc);
    } catch {
      /* ignore */
    }
    cancelAcc = null;
  }
}

function clearTimers() {
  if (autoStopTimer) {
    clearTimeout(autoStopTimer);
    autoStopTimer = null;
  }
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

// ———————————————— 流式上传 ————————————————

/** 创建听写流；失败（后端不可达等）直接取消本次录音并提示。 */
function openStream() {
  const s = { id: null, ready: null, chain: Promise.resolve(), failed: null, chars: 0 };
  s.ready = (async () => {
    const res = await fetch(`${backendUrl}/api/dictation/stream/start`, {
      method: 'POST',
      signal: AbortSignal.timeout(START_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`后端返回 ${res.status}`);
    const r = await res.json();
    s.id = r.streamId;
  })().catch((e) => {
    s.failed = e;
    if (phase === 'recording') {
      log('听写流创建失败：' + (e && e.message ? e.message : e));
      cancel();
      overlayFlash({ phase: 'error', message: '无法连接听写服务：' + (e && e.message ? e.message : e) }, 3500);
    }
  });
  return s;
}

function concatSamples(arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Int16Array(n);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/** 把攒到的 PCM 块串行上传（保持顺序，VAD 依赖时序）。 */
function flushPending(s) {
  if (!pendingChunks.length) return;
  const pcm = concatSamples(pendingChunks);
  pendingChunks = [];
  pendingSamples = 0;
  if (!s || s.failed) return;
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  s.chain = s.chain
    .then(async () => {
      await s.ready;
      if (s.failed || s.id == null) return;
      const res = await fetch(`${backendUrl}/api/dictation/stream/${s.id}/chunk`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: bytes,
        signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
      });
      if (!res.ok) {
        const r = await res.json().catch(() => ({}));
        throw new Error(r.error || `后端返回 ${res.status}`);
      }
      const r = await res.json();
      if (typeof r.chars === 'number' && r.chars > 0) {
        s.chars = r.chars;
        if (phase === 'recording') overlaySet({ ...overlayState, chars: r.chars });
      }
    })
    .catch((e) => {
      if (s.failed) return;
      s.failed = e;
      log('听写流上传失败：' + (e && e.message ? e.message : e));
      if (phase === 'recording') {
        cancel();
        overlayFlash({ phase: 'error', message: '上传中断：' + (e && e.message ? e.message : e) }, 3500);
      }
    });
}

/** 取消服务端流状态（尽力而为；失败靠 TTL 兜底）。 */
function cancelServerStream(s) {
  if (!s || s.failed) return;
  void s.ready.then(() => {
    if (s.failed || s.id == null) return;
    fetch(`${backendUrl}/api/dictation/stream/${s.id}/cancel`, {
      method: 'POST',
      signal: AbortSignal.timeout(4000),
    }).catch(() => {});
  });
}

/** 丢弃本地与与服务端的流状态。 */
function discardStream() {
  const s = stream;
  stream = null;
  pendingChunks = [];
  pendingSamples = 0;
  cancelServerStream(s);
}

// ———————————————— 状态机 ————————————————

function begin() {
  ensureRecorder();
  showOverlay();
  overlaySet({ phase: 'recording', level: 0, elapsed: 0, chars: 0 });
  pendingChunks = [];
  pendingSamples = 0;
  recSamples = 0;
  startedAt = Date.now();
  phase = 'recording';
  registerCancelShortcut();
  stream = openStream();
  elapsedTimer = setInterval(() => {
    if (phase === 'recording') {
      overlaySet({ ...overlayState, elapsed: Math.floor((Date.now() - startedAt) / 1000) });
    }
  }, 1000);
  // 等页面就绪后再发开始（首次启动极快按键的竞态兜底）
  Promise.resolve(recorderReady).then(() => {
    if (phase === 'recording' && recorderWin && !recorderWin.isDestroyed()) {
      recorderWin.webContents.send('recorder-start');
    }
  });
  if (autoStopTimer) clearTimeout(autoStopTimer);
  autoStopTimer = setTimeout(() => {
    log('听写达到最长 1 小时，自动结束');
    finish();
  }, MAX_RECORD_MS);
}

function cancel() {
  if (phase !== 'recording') return;
  phase = 'idle';
  unregisterCancelShortcut();
  clearTimers();
  if (recorderWin && !recorderWin.isDestroyed()) recorderWin.webContents.send('recorder-stop');
  recSamples = 0;
  discardStream();
  overlayFlash({ phase: 'cancel' }, 900);
}

/** 快捷键再按一次：结束录音并出字。等录音页停止回执后收尾（余量音频先到齐）。 */
function finish() {
  if (phase !== 'recording') return;
  phase = 'processing';
  unregisterCancelShortcut();
  clearTimers();
  showOverlay();
  overlaySet({ phase: 'processing' });
  const durationMs = Date.now() - startedAt;
  const samples = recSamples;
  if (recorderWin && !recorderWin.isDestroyed()) recorderWin.webContents.send('recorder-stop');
  // 页面崩溃/未就绪时 1.5s 兜底直接收尾
  const fallbackTimer = setTimeout(() => {
    if (pendingUpload) {
      const p = pendingUpload;
      pendingUpload = null;
      void finalizeStream(p.durationMs, p.samples);
    }
  }, 1500);
  pendingUpload = { durationMs, samples, fallbackTimer };
}

/** 收尾：尾块上传 → 排空队列 → finish 出稿 → 粘贴。 */
async function finalizeStream(durationMs, samples) {
  try {
    if (!samples) {
      phase = 'idle';
      discardStream();
      overlayFlash({ phase: 'error', message: durationMs < 800 ? '按得太快，没录到音频' : '未采集到音频（检查麦克风权限）' }, 2500);
      return;
    }
    if (durationMs < 350) {
      phase = 'idle';
      discardStream();
      overlayFlash({ phase: 'error', message: '录音太短' }, 1500);
      return;
    }
    const s = stream;
    stream = null;
    if (!s) throw new Error('听写流不可用');
    flushPending(s); // 停止前攒的尾块也要转写
    await s.ready;
    await s.chain;
    if (s.failed) throw s.failed;
    const res = await fetch(`${backendUrl}/api/dictation/stream/${s.id}/finish`, {
      method: 'POST',
      signal: AbortSignal.timeout(FINISH_TIMEOUT_MS),
    });
    const r = (await res.json().catch(() => ({}))) || {};
    if (!res.ok) throw new Error(r.error || `后端返回 ${res.status}`);
    phase = 'idle';

    if (r.silent || !r.text) {
      overlayFlash({ phase: 'done', message: '未识别到语音' }, 1600);
      return;
    }
    const d = await deliverText(r.text);
    if (d.pasted) {
      const note = r.polishError ? '已输入（AI 整理失败，用的是识别原文）' : '已输入';
      overlayFlash({ phase: 'done', message: note }, 1400);
    } else {
      overlayFlash({ phase: 'copied', message: d.message, needAx: d.reason === 'ax' }, d.reason === 'ax' ? 8000 : 3000);
    }
  } catch (e) {
    phase = 'idle';
    cancelServerStream(stream);
    stream = null;
    log('听写失败：' + (e && e.message ? e.message : e));
    overlayFlash({ phase: 'error', message: (e && e.message ? e.message : String(e)).slice(0, 80) }, 3500);
  }
}

/** 快捷键入口：切换录音。 */
function toggle() {
  if (phase === 'idle') begin();
  else if (phase === 'recording') finish();
  /* processing 中忽略 */
}

/** 从后端拉取听写配置并（重）注册全局快捷键。 */
async function reloadShortcuts() {
  let d = null;
  try {
    const res = await fetch(`${backendUrl}/api/settings`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const s = await res.json();
      d = s.dictation || null;
    }
  } catch (e) {
    log('拉取听写配置失败：' + (e && e.message ? e.message : e));
    return;
  }
  dictationSettings = d;
  if (mainAcc) {
    try {
      globalShortcut.unregister(mainAcc);
    } catch {
      /* ignore */
    }
    mainAcc = null;
  }
  if (!d || !d.enabled) return;
  const acc = d.shortcut || 'Ctrl+Alt+D';
  const okRegistered = globalShortcut.register(acc, toggle);
  if (okRegistered) {
    mainAcc = acc;
    log('听写快捷键已注册：' + acc);
  } else {
    const msg = `全局快捷键 ${acc} 注册失败（可能被其他应用占用），请在 设置 → 语音输入 中更换`;
    log(msg);
    try {
      new Notification({ title: 'Voice Notes 语音输入', body: msg }).show();
    } catch {
      /* ignore */
    }
  }
}

/** 初始化 IPC 与录音窗口；在 backend 就绪后调用。 */
function init(opts) {
  backendUrl = opts.backendUrl || backendUrl;
  log = opts.log || log;

  ensureRecorder(); // 提前预热，首次按快捷键即可录音

  // —— 录音页 IPC ——
  ipcMain.on('recorder-audio-chunk', (_e, samples) => {
    // processing 也收：录音页停止时补发的余量音频，收尾冲块时一并上传
    if ((phase === 'recording' || phase === 'processing') && stream && samples && samples.length) {
      const arr = new Int16Array(samples.buffer, samples.byteOffset, samples.length);
      recSamples += arr.length;
      pendingChunks.push(arr);
      pendingSamples += arr.length;
      if (pendingSamples >= CHUNK_SAMPLES) flushPending(stream);
    }
  });
  ipcMain.on('recorder-level', (_e, level) => {
    if (phase === 'recording') overlaySet({ ...overlayState, phase: 'recording', level });
  });
  ipcMain.on('recorder-stopped', () => {
    if (pendingUpload) {
      // finish() 的正常路径：余量音频已随 stop 一起发到，开始收尾
      const p = pendingUpload;
      pendingUpload = null;
      clearTimeout(p.fallbackTimer);
      void finalizeStream(p.durationMs, p.samples);
    }
    // 无 pendingUpload = cancel 路径或异常停止，丢弃即可
  });
  ipcMain.on('recorder-error', (_e, message) => {
    if (phase === 'recording' || phase === 'processing') {
      phase = 'idle';
      unregisterCancelShortcut();
      clearTimers();
      pendingUpload = null;
      discardStream();
    }
    log('录音失败：' + message);
    overlayFlash({ phase: 'error', message }, 4000);
  });

  // —— 浮窗 IPC ——
  ipcMain.on('dictation-cancel-requested', () => cancel());
  ipcMain.on('dictation-open-ax-settings', () => {
    shell
      .openExternal('x-app.apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
      .catch(() => {});
  });

  void reloadShortcuts();
}

function destroy() {
  unregisterCancelShortcut();
  if (mainAcc) {
    try {
      globalShortcut.unregister(mainAcc);
    } catch {
      /* ignore */
    }
    mainAcc = null;
  }
  if (recorderWin && !recorderWin.isDestroyed()) recorderWin.destroy();
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
}

module.exports = { init, toggle, reloadShortcuts, destroy };
