/**
 * 听写管理器（主进程侧）：全局快捷键 → 隐藏窗口录音 → 流式上传边录边转写 → 润色 → 粘贴到光标 → 浮窗反馈。
 *
 * 状态机：idle → recording → processing → idle；录音中 Esc（临时注册）取消。
 * 组合键（globalShortcut）与长按单键（hold-key.cjs）两种触发并存。
 * 模块分工：recorder 隐藏窗采集音频、overlay 浮窗反馈、stream-client 流式上传。
 */
const { BrowserWindow, Notification, globalShortcut, ipcMain, shell } = require('electron');
const path = require('node:path');
const { deliverText } = require('./paster.cjs');
const overlay = require('./overlay.cjs');
const hold = require('./hold-key.cjs');
const { createStream } = require('./stream-client.cjs');

const MAX_RECORD_MS = 60 * 60 * 1000; // 最长 1 小时自动结束（流式转写，无短上限必要，仅防忘关）

let backendUrl = 'http://127.0.0.1:3100';
/** @type {(msg: string) => void} */
let log = () => {};

// 状态
let phase = 'idle'; // idle | recording | processing
let startedAt = 0;
let autoStopTimer = null;
let elapsedTimer = null;
let recorderReady = null;
let pendingUpload = null; // finish 后等录音页停止回执：{ durationMs, samples }
let stream = null; // stream-client 流对象（recording 期间存在）
let recSamples = 0; // 本次录音总采样数

// 快捷键
let mainAcc = null; // 已注册的听写主快捷键
let cancelAcc = null; // 录音中临时注册的取消键
let dictationSettings = null; // 最近一次拉到的听写配置

// 窗口
let recorderWin = null;

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

// ———————————————— 状态机 ————————————————

function begin(opts = {}) {
  ensureRecorder();
  overlay.showOverlay();
  overlay.overlaySet({ phase: 'recording', level: 0, elapsed: 0, chars: 0, ptt: !!opts.ptt });
  recSamples = 0;
  startedAt = Date.now();
  phase = 'recording';
  registerCancelShortcut();
  stream = createStream({
    backendUrl,
    log,
    onChars: (chars) => {
      if (phase === 'recording') overlay.overlaySet({ ...overlay.overlayGet(), chars });
    },
    onError: (e) => {
      // 上传链路失败：录音中直接取消并提示；收尾阶段由 finalizeStream 统一报错
      if (phase === 'recording') {
        cancel();
        overlay.overlayFlash(
          { phase: 'error', message: '上传中断：' + (e && e.message ? e.message : e) },
          3500,
        );
      }
    },
  });
  elapsedTimer = setInterval(() => {
    if (phase === 'recording') {
      overlay.overlaySet({
        ...overlay.overlayGet(),
        elapsed: Math.floor((Date.now() - startedAt) / 1000),
      });
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
  stream?.cancel();
  stream = null;
  overlay.overlayFlash({ phase: 'cancel' }, 900);
}

/** 触发结束（快捷键再按 / PTT 松开 / 超时）：等录音页停止回执后收尾（余量音频先到齐）。 */
function finish() {
  if (phase !== 'recording') return;
  phase = 'processing';
  unregisterCancelShortcut();
  clearTimers();
  overlay.showOverlay();
  overlay.overlaySet({ phase: 'processing' });
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
  const s = stream;
  stream = null;
  try {
    if (!samples) {
      phase = 'idle';
      s?.cancel();
      overlay.overlayFlash(
        {
          phase: 'error',
          message: durationMs < 800 ? '按得太快，没录到音频' : '未采集到音频（检查麦克风权限）',
        },
        2500,
      );
      return;
    }
    if (durationMs < 350) {
      phase = 'idle';
      s?.cancel();
      overlay.overlayFlash({ phase: 'error', message: '录音太短' }, 1500);
      return;
    }
    if (!s) throw new Error('听写流不可用');
    const r = await s.finish();
    if (!r.ok) throw new Error(r.body.error || `后端返回 ${r.status}`);
    phase = 'idle';

    if (r.body.silent || !r.body.text) {
      overlay.overlayFlash({ phase: 'done', message: '未识别到语音' }, 1600);
      return;
    }
    const d = await deliverText(r.body.text);
    if (d.pasted) {
      const note = r.body.polishError ? '已输入（AI 整理失败，用的是识别原文）' : '已输入';
      overlay.overlayFlash({ phase: 'done', message: note }, 1400);
    } else {
      overlay.overlayFlash(
        { phase: 'copied', message: d.message, needAx: d.reason === 'ax' },
        d.reason === 'ax' ? 8000 : 3000,
      );
    }
  } catch (e) {
    phase = 'idle';
    s?.cancel(); // finish 失败时尽力清服务端流（TTL 兜底）
    log('听写失败：' + (e && e.message ? e.message : e));
    overlay.overlayFlash(
      { phase: 'error', message: (e && e.message ? e.message : String(e)).slice(0, 80) },
      3500,
    );
  }
}

/** 快捷键入口：切换录音。 */
function toggle() {
  if (phase === 'idle') begin();
  else if (phase === 'recording') finish();
  /* processing 中忽略 */
}

/** 从后端拉取听写配置并（重）注册全局快捷键与长按监听。 */
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
  if (!d || !d.enabled) {
    hold.setHold(null);
    return;
  }
  hold.setHold(
    d.hold && d.hold.enabled
      ? { key: d.hold.key || 'CtrlRight', mode: d.hold.mode === 'toggle' ? 'toggle' : 'ptt' }
      : null,
    {
      onPttBegin: () => {
        if (phase === 'idle') begin({ ptt: true });
      },
      onToggle: () => toggle(),
      onPttRelease: () => finish(),
    },
  );
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
      stream.push(arr);
    }
  });
  ipcMain.on('recorder-level', (_e, level) => {
    if (phase === 'recording')
      overlay.overlaySet({ ...overlay.overlayGet(), phase: 'recording', level });
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
      stream?.cancel();
      stream = null;
    }
    log('录音失败：' + message);
    overlay.overlayFlash({ phase: 'error', message }, 4000);
  });

  // —— 浮窗 IPC ——
  ipcMain.on('dictation-cancel-requested', () => cancel());
  ipcMain.on('dictation-open-ax-settings', () => {
    shell
      .openExternal(
        'x-app.apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      )
      .catch(() => {});
  });

  void reloadShortcuts();
}

function destroy() {
  unregisterCancelShortcut();
  hold.stopHold();
  if (mainAcc) {
    try {
      globalShortcut.unregister(mainAcc);
    } catch {
      /* ignore */
    }
    mainAcc = null;
  }
  if (recorderWin && !recorderWin.isDestroyed()) recorderWin.destroy();
  overlay.destroyOverlay();
}

module.exports = { init, toggle, reloadShortcuts, destroy };
