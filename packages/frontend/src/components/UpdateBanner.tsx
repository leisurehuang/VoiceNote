import { useState, useEffect } from 'react';
import { CircleCheck, Download, Package, Search, TriangleAlert } from 'lucide-react';
import { Button } from './ui/Button';
import { ProgressBar } from './ui/ProgressBar';

interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // 检测是否在 Electron 环境中
    const isElectron = !!(window as any).electron;
    if (!isElectron) return;

    const electronAPI = (window as any).electron;
    if (!electronAPI) return;

    // 监听更新事件
    const handleUpdateAvailable = (info: UpdateInfo) => {
      setUpdateInfo(info);
      setStatus('available');
    };

    const handleDownloadProgress = (prog: DownloadProgress) => {
      setProgress(prog);
      setStatus('downloading');
    };

    const handleUpdateDownloaded = (info: UpdateInfo) => {
      setUpdateInfo(info);
      setStatus('downloaded');
    };

    const handleUpdateNotAvailable = () => {
      setStatus('idle');
      setUpdateInfo(null);
    };

    const handleUpdateError = (err: { message: string }) => {
      setErrorMessage(err.message);
      setStatus('error');
    };

    // 注册事件监听
    electronAPI.onUpdateAvailable?.(handleUpdateAvailable);
    electronAPI.onDownloadProgress?.(handleDownloadProgress);
    electronAPI.onUpdateDownloaded?.(handleUpdateDownloaded);
    electronAPI.onUpdateNotAvailable?.(handleUpdateNotAvailable);
    electronAPI.onUpdateError?.(handleUpdateError);

    return () => {
      // 清理监听器
      electronAPI.removeUpdateAvailable?.(handleUpdateAvailable);
      electronAPI.removeDownloadProgress?.(handleDownloadProgress);
      electronAPI.removeUpdateDownloaded?.(handleUpdateDownloaded);
      electronAPI.removeUpdateNotAvailable?.(handleUpdateNotAvailable);
      electronAPI.removeUpdateError?.(handleUpdateError);
    };
  }, []);

  // 手动检查更新
  async function checkForUpdates() {
    const electronAPI = (window as any).electron;
    if (!electronAPI?.checkForUpdates) return;

    setStatus('checking');
    try {
      await electronAPI.checkForUpdates();
    } catch (err) {
      setErrorMessage((err as Error).message);
      setStatus('error');
    }
  }

  // 下载更新
  async function downloadUpdate() {
    const electronAPI = (window as any).electron;
    if (!electronAPI?.downloadUpdate) return;

    try {
      await electronAPI.downloadUpdate();
    } catch (err) {
      setErrorMessage((err as Error).message);
      setStatus('error');
    }
  }

  // 安装更新并重启
  async function installUpdate() {
    const electronAPI = (window as any).electron;
    if (!electronAPI?.installUpdate) return;

    try {
      await electronAPI.installUpdate();
    } catch (err) {
      setErrorMessage((err as Error).message);
      setStatus('error');
    }
  }

  // 跳过当前版本
  async function skipVersion() {
    const electronAPI = (window as any).electron;
    if (!electronAPI?.skipVersion) return;

    try {
      await electronAPI.skipVersion(updateInfo?.version || '');
      setStatus('idle');
      setUpdateInfo(null);
    } catch (err) {
      console.error('跳过版本失败:', err);
    }
  }

  if (status === 'idle') return null;

  return (
    <div className={`alert update-banner ${status}`}>
      {status === 'checking' && (
        <div className="update-checking">
          <Search size={16} aria-hidden />
          <span>正在检查更新...</span>
        </div>
      )}

      {status === 'available' && updateInfo && (
        <div className="update-available">
          <div className="update-header">
            <Package size={18} aria-hidden />
            <span className="update-title">发现新版本 {updateInfo.version}</span>
          </div>
          {updateInfo.releaseNotes && (
            <div className="update-notes">{updateInfo.releaseNotes}</div>
          )}
          <div className="update-actions">
            <Button variant="primary" onClick={downloadUpdate}>
              立即更新
            </Button>
            <Button variant="ghost" onClick={skipVersion}>
              跳过此版本
            </Button>
          </div>
        </div>
      )}

      {status === 'downloading' && progress && (
        <div className="update-downloading">
          <div className="update-header">
            <Download size={18} aria-hidden />
            <span className="update-title">正在下载更新...</span>
          </div>
          <div className="update-progress">
            <ProgressBar value={progress.percent / 100} tone="warn" />
            <div className="progress-text">
              {progress.percent}% ({(progress.transferred / 1024 / 1024).toFixed(1)} MB / {(progress.total / 1024 / 1024).toFixed(1)} MB)
            </div>
          </div>
        </div>
      )}

      {status === 'downloaded' && (
        <div className="update-downloaded">
          <div className="update-header">
            <CircleCheck size={18} aria-hidden />
            <span className="update-title">更新已准备就绪</span>
          </div>
          <div className="update-actions">
            <Button variant="primary" onClick={installUpdate}>
              重启并安装
            </Button>
            <Button variant="ghost" onClick={skipVersion}>
              稍后提醒
            </Button>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="update-error">
          <div className="update-header">
            <TriangleAlert size={18} aria-hidden />
            <span className="update-title">更新失败</span>
          </div>
          {errorMessage && <div className="error-message">{errorMessage}</div>}
          <div className="update-actions">
            <Button variant="ghost" onClick={checkForUpdates}>
              重新检查
            </Button>
            <Button variant="ghost" onClick={skipVersion}>
              关闭
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
