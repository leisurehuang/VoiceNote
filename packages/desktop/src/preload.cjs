/**
 * Electron 预加载脚本
 * 安全地暴露 API 到渲染进程
 */

const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 到渲染进程
contextBridge.exposeInMainWorld('electron', {
  // ========== 自动更新 API ==========
  // 检查更新
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // 下载更新
  downloadUpdate: () => ipcRenderer.invoke('download-update'),

  // 安装更新
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // 跳过版本
  skipVersion: (version) => ipcRenderer.invoke('skip-version', version),

  // 获取跳过的版本列表
  getSkippedVersions: () => ipcRenderer.invoke('get-skipped-versions'),

  // 清除跳过的版本
  clearSkippedVersions: () => ipcRenderer.invoke('clear-skipped-versions'),

  // ========== 更新事件监听 ==========
  onUpdateAvailable: (callback) => {
    const listener = (event, info) => callback(info);
    ipcRenderer.on('update-available', listener);
    return () => ipcRenderer.removeListener('update-available', listener);
  },

  onDownloadProgress: (callback) => {
    const listener = (event, progress) => callback(progress);
    ipcRenderer.on('update-download-progress', listener);
    return () => ipcRenderer.removeListener('update-download-progress', listener);
  },

  onUpdateDownloaded: (callback) => {
    const listener = (event, info) => callback(info);
    ipcRenderer.on('update-downloaded', listener);
    return () => ipcRenderer.removeListener('update-downloaded', listener);
  },

  onUpdateNotAvailable: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('update-not-available', listener);
    return () => ipcRenderer.removeListener('update-not-available', listener);
  },

  onUpdateError: (callback) => {
    const listener = (event, error) => callback(error);
    ipcRenderer.on('update-error', listener);
    return () => ipcRenderer.removeListener('update-error', listener);
  },

  // ========== 移除监听器 ==========
  removeUpdateAvailable: (callback) => {
    ipcRenderer.removeListener('update-available', callback);
  },

  removeDownloadProgress: (callback) => {
    ipcRenderer.removeListener('update-download-progress', callback);
  },

  removeUpdateDownloaded: (callback) => {
    ipcRenderer.removeListener('update-downloaded', callback);
  },

  removeUpdateNotAvailable: (callback) => {
    ipcRenderer.removeListener('update-not-available', callback);
  },

  removeUpdateError: (callback) => {
    ipcRenderer.removeListener('update-error', callback);
  },
});
