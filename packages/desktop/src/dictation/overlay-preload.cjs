/**
 * 听写浮窗（状态胶囊）的预加载脚本。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  // 主进程 → 浮窗：{phase:'recording'|'processing'|'done'|'copied'|'error'|'cancel', level?, message?, needAx?}
  onState: (cb) => ipcRenderer.on('overlay-state', (_e, s) => cb(s)),
  // 浮窗 → 主进程
  requestCancel: () => ipcRenderer.send('dictation-cancel-requested'),
  openAxSettings: () => ipcRenderer.send('dictation-open-ax-settings'),
});
