/**
 * Electron API 类型声明
 */

export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

export interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export interface UpdateError {
  message: string;
}

export interface ElectronAPI {
  // 检查更新
  checkForUpdates(): Promise<{ success: boolean; error?: string }>;

  // 下载更新
  downloadUpdate(): Promise<{ success: boolean; error?: string }>;

  // 安装更新
  installUpdate(): Promise<{ success: boolean; error?: string }>;

  // 跳过版本
  skipVersion(version: string): Promise<{ success: boolean; error?: string }>;

  // 获取跳过的版本列表
  getSkippedVersions(): Promise<{ success: boolean; versions?: string[]; error?: string }>;

  // 清除跳过的版本
  clearSkippedVersions(): Promise<{ success: boolean; error?: string }>;

  // 更新事件监听
  onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void;
  onDownloadProgress(callback: (progress: DownloadProgress) => void): () => void;
  onUpdateDownloaded(callback: (info: UpdateInfo) => void): () => void;
  onUpdateNotAvailable(callback: () => void): () => void;
  onUpdateError(callback: (error: UpdateError) => void): () => void;

  // 移除监听器
  removeUpdateAvailable(callback: (info: UpdateInfo) => void): void;
  removeDownloadProgress(callback: (progress: DownloadProgress) => void): void;
  removeUpdateDownloaded(callback: (info: UpdateInfo) => void): void;
  removeUpdateNotAvailable(callback: () => void): void;
  removeUpdateError(callback: (error: UpdateError) => void): void;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}

export {};
