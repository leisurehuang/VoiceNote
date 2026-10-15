/**
 * 听写录音窗口的预加载脚本：主进程 ⇆ 录音页面 的 IPC 桥。
 * 页面只依赖本桥收发指令，不直接触碰 electron 内部对象。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recorder', {
  // 主进程 → 页面
  onStart: (cb) => ipcRenderer.on('recorder-start', () => cb()),
  onStop: (cb) => ipcRenderer.on('recorder-stop', () => cb()),
  // 页面 → 主进程
  /** 发送一批 16kHz Int16 PCM 样本（typed array，structured clone 传输）。 */
  sendChunk: (samples) => ipcRenderer.send('recorder-audio-chunk', samples),
  /** 发送当前音量电平（0..1）。 */
  sendLevel: (level) => ipcRenderer.send('recorder-level', level),
  /** 录音已停止（track 已关，保证此后不再有音频块）。 */
  stopped: () => ipcRenderer.send('recorder-stopped'),
  /** 启动失败（麦克风权限/设备错误），参数为可展示信息。 */
  micError: (message) => ipcRenderer.send('recorder-error', message),
});
