/**
 * 听写浮窗（底部胶囊，不抢焦点）：窗口生命周期 + 状态推送 + 终态短闪。
 * 状态由 manager 经 overlaySet 推给 overlay.html 渲染。
 */
const { BrowserWindow, screen } = require('electron');
const path = require('node:path');

const OVERLAY_W = 380;
const OVERLAY_H = 78;

let overlayWin = null;
let overlayState = { phase: 'hidden' };
let hideTimer = null;

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

/** 当前状态快照（manager 做增量更新时用）。 */
function overlayGet() {
  return overlayState;
}

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

function destroyOverlay() {
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
  overlayWin = null;
}

module.exports = { showOverlay, overlaySet, overlayGet, overlayFlash, destroyOverlay };
