import { useEffect, useState } from 'react';
import { Button } from './ui/Button';

/**
 * 设置页底部「检查更新」入口（仅桌面端显示按钮；Web 部署只显示版本号）。
 * win/linux 走 electron-updater（发现新版本由顶部 UpdateBanner 接管下载/安装）；
 * mac 未签名走不了应用内安装，走原生弹窗「前往下载」（与菜单「检查更新…」同路径）。
 */
export function UpdateCheck() {
  const electron = window.electron;
  const [status, setStatus] = useState<'idle' | 'checking' | 'latest' | 'available' | 'error'>('idle');
  const [newVersion, setNewVersion] = useState('');
  const [error, setError] = useState('');

  // electron-updater 路径的结果经事件推送（win/linux；菜单/横幅触发的检查同样回填到这里）
  useEffect(() => {
    if (!electron) return;
    const onAvailable = (info: { version: string }) => {
      setNewVersion(info.version);
      setStatus('available');
    };
    const onNotAvailable = () => setStatus('latest');
    const onError = (err: { message: string }) => {
      setError(err.message);
      setStatus('error');
    };
    const offAvailable = electron.onUpdateAvailable(onAvailable);
    const offNotAvailable = electron.onUpdateNotAvailable(onNotAvailable);
    const offError = electron.onUpdateError(onError);
    return () => {
      offAvailable();
      offNotAvailable();
      offError();
    };
  }, [electron]);

  async function check() {
    if (!electron || status === 'checking') return;
    setStatus('checking');
    setError('');
    if (electron.platform === 'darwin') {
      // mac：原生弹窗路径，结论直接在返回值里
      const r = await electron.checkForUpdateDialog();
      if (r.found) {
        setNewVersion(r.version ?? '');
        setStatus('available');
      } else if (r.error) {
        setError(r.error);
        setStatus('error');
      } else {
        setStatus('latest');
      }
      return;
    }
    // win/linux：electron-updater，结论经上面的事件回填
    const r = await electron.checkForUpdates();
    if (!r.success) {
      setError(r.error || '检查失败');
      setStatus('error');
    }
  }

  if (!electron) {
    return <p className="muted settings-version">Voice Notes v{__APP_VERSION__}</p>;
  }

  return (
    <div className="settings-version settings-update">
      <span className="muted">Voice Notes v{__APP_VERSION__}</span>
      <Button variant="ghost" size="sm" loading={status === 'checking'} onClick={check}>
        检查更新
      </Button>
      {status === 'latest' && <span className="muted">已是最新版本</span>}
      {status === 'available' && (
        <span className="muted">{newVersion ? `发现新版本 v${newVersion}` : '发现新版本'}</span>
      )}
      {status === 'error' && <span className="muted">检查失败：{error}</span>}
    </div>
  );
}
