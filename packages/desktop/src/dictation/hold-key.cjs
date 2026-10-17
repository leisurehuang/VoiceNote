/**
 * 长按单键触发（uiohook 全局键盘事件）。
 * uiohook 是唯一能拿到按键「松开」事件的跨平台方案；事件只监听不拦截，
 * 按键正常透传给焦点应用，因此仅支持单独按下无副作用的键（右侧修饰键 / F 功能键）。
 *
 * 两种触发模式：
 * - ptt    按住说话：按住 ≥300ms 开始录音，松开结束出字
 * - toggle 长按切换：按住 ≥600ms 触发一次，行为与组合键一致
 *
 * 自愈：Windows 上存在上游 bug（初始化 getUserMedia 后钩子静默失效），
 * 用「任意输入事件长时间静默」检测钩子死亡并自动重启。
 */
const { Notification, systemPreferences } = require('electron');

/** 长按判定阈值：按住说话要跟手，长按切换要防误触。 */
const HOLD_THRESHOLD_MS = { ptt: 300, toggle: 600 };
/** 钩子自愈：超过该时长未收到任何输入事件即判定钩子死亡（鼠标移动也算活着）。 */
const HOOK_SILENCE_MS = 60000;
const HOOK_CHECK_INTERVAL_MS = 30000;

let hookMod = undefined; // undefined=未尝试 | false=不可用 | { uIOhook, UiohookKey }
let holdCfg = null; // { key, mode } | null（null=未启用）
let holdKc = null; // 目标键的 uiohook 键码
let holdDownAt = 0; // 0=目标键未按下
let holdTriggered = false; // 已达长按阈值并触发
let holdTimer = null;
let healTimer = null; // 自愈巡检
let lastInputAt = 0; // 最近一次任意输入事件（钩子活性信号）
let handlers = null; // { onPttBegin, onToggle, onPttRelease, onError }
/** @type {(msg: string) => void} */
let log = () => {};

function loadHook() {
  if (hookMod !== undefined) return hookMod;
  try {
    hookMod = require('uiohook-napi');
  } catch (e) {
    hookMod = false;
    log('uiohook-napi 加载失败，长按触发不可用：' + (e && e.message ? e.message : e));
  }
  return hookMod;
}

function resetHoldState() {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  holdDownAt = 0;
  holdTriggered = false;
}

function onHoldKeyDown(e) {
  if (!holdCfg || e.keycode !== holdKc || holdDownAt !== 0) return; // 自动重复忽略
  holdDownAt = Date.now();
  holdTriggered = false;
  holdTimer = setTimeout(() => {
    holdTriggered = true;
    if (!holdCfg) return;
    if (holdCfg.mode === 'ptt') handlers?.onPttBegin?.();
    else handlers?.onToggle?.();
  }, HOLD_THRESHOLD_MS[holdCfg.mode] ?? 600);
}

function onHoldKeyUp(e) {
  if (!holdCfg || e.keycode !== holdKc || holdDownAt === 0) return;
  const wasTriggered = holdTriggered;
  resetHoldState();
  if (!wasTriggered) return; // 未达阈值的轻点：透传，不触发
  if (holdCfg.mode === 'ptt') handlers?.onPttRelease?.(); // 松开结束出字
  // toggle 模式：触发已在阈值时刻完成，松开无事可做
}

/** 任意输入事件都算「钩子活着」的信号（只用于自愈判定）。 */
function onAnyInput() {
  lastInputAt = Date.now();
}

function attach() {
  const h = loadHook();
  if (!h) return false;
  h.uIOhook.on('keydown', onHoldKeyDown);
  h.uIOhook.on('keyup', onHoldKeyUp);
  h.uIOhook.on('input', onAnyInput);
  try {
    h.uIOhook.start();
  } catch (e) {
    detach();
    log('长按监听启动失败：' + (e && e.message ? e.message : e));
    return false;
  }
  return true;
}

function detach() {
  const h = loadHook();
  if (!h) return;
  try {
    h.uIOhook.off('keydown', onHoldKeyDown);
    h.uIOhook.off('keyup', onHoldKeyUp);
    h.uIOhook.off('input', onAnyInput);
    h.uIOhook.stop();
  } catch {
    /* ignore */
  }
}

/** 自愈巡检：钩子静默过久 → 重启（对上游 Windows bug 的兜底）。 */
function checkHeal() {
  if (!holdCfg) return;
  if (Date.now() - lastInputAt < HOOK_SILENCE_MS) return;
  log('长按监听疑似失效（长时间无任何输入事件），重启钩子');
  resetHoldState();
  detach();
  if (attach()) lastInputAt = Date.now();
}

/** 启用/更新长按监听；cfg=null 停用。 */
function setHold(cfg, h) {
  handlers = h || null;
  const mod = loadHook();
  stopHold();
  if (!cfg || !mod) return;
  const kc = mod.UiohookKey[cfg.key];
  if (typeof kc !== 'number') {
    log('未知长按键：' + cfg.key);
    return;
  }
  holdCfg = cfg;
  holdKc = kc;
  if (!attach()) {
    holdCfg = null;
    holdKc = null;
    return;
  }
  lastInputAt = Date.now();
  healTimer = setInterval(checkHeal, HOOK_CHECK_INTERVAL_MS);
  log('长按触发已启用：' + cfg.key + '（' + (cfg.mode === 'ptt' ? '按住说话' : '长按切换') + '）');
  // macOS：CGEventTap 需要辅助功能权限（粘贴功能的 ⌘V 模拟同样依赖）
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
    try {
      new Notification({
        title: 'Voice Notes 语音输入',
        body: '长按触发需要「辅助功能」权限：请在系统设置中允许 Voice Notes 后重启应用。',
      }).show();
    } catch {
      /* ignore */
    }
  }
}

function stopHold() {
  resetHoldState();
  holdCfg = null;
  holdKc = null;
  if (healTimer) {
    clearInterval(healTimer);
    healTimer = null;
  }
  detach();
}

module.exports = { setHold, stopHold };
