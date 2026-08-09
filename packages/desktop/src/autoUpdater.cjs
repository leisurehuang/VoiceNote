/**
 * Auto-Update 模块
 * 使用 electron-updater 实现跨平台自动更新
 */

const { autoUpdater } = require('electron-updater');
const { app, dialog, shell } = require('electron');
const log = require('electron-log');
const path = require('path');
const fs = require('fs');

// 配置日志
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// 跳过的版本存储路径
const skippedVersionsPath = path.join(app.getPath('userData'), 'skipped-versions.json');

/**
 * 读取跳过的版本列表
 */
function getSkippedVersions(): string[] {
  try {
    const data = fs.readFileSync(skippedVersionsPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

/**
 * 保存跳过的版本列表
 */
function saveSkippedVersions(versions: string[]): void {
  try {
    fs.writeFileSync(skippedVersionsPath, JSON.stringify(versions, null, 2));
  } catch (err) {
    log.error('保存跳过版本失败:', err);
  }
}

/**
 * 检查版本是否被跳过
 */
function isVersionSkipped(version: string): boolean {
  const skipped = getSkippedVersions();
  return skipped.includes(version);
}

/**
 * 跳过指定版本
 */
function skipVersion(version: string): void {
  const skipped = getSkippedVersions();
  if (!skipped.includes(version)) {
    skipped.push(version);
    saveSkippedVersions(skipped);
    log.info('已跳过版本:', version);
  }
}

/**
 * 清除跳过的版本（用于测试或用户手动重置）
 */
function clearSkippedVersions(): void {
  try {
    fs.unlinkSync(skippedVersionsPath);
    log.info('已清除所有跳过的版本');
  } catch {
    /* 文件不存在，忽略 */
  }
}

/**
 * 初始化自动更新
 * @param {BrowserWindow} mainWindow - 主窗口
 */
function initAutoUpdater(mainWindow) {
  // 配置更新服务器
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'leisurehuang',
    repo: 'VoiceNote',
  });

  // 自动下载更新（可选）
  autoUpdater.autoDownload = false;

  // 监听更新事件
  autoUpdater.on('checking-for-update', () => {
    log.info('检查更新中...');
  });

  autoUpdater.on('update-available', (info) => {
    const version = info.version;
    // 检查是否被跳过
    if (isVersionSkipped(version)) {
      log.info('版本 ' + version + ' 已被跳过，不提示');
      return;
    }

    log.info('发现新版本:', version);
    // 通知用户有更新可用
    if (mainWindow) {
      mainWindow.webContents.send('update-available', {
        version: version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
      });
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('当前已是最新版本:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update-not-available', {
        version: info.version,
      });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    log.info('下载进度:', progress.percent + '%');
    if (mainWindow) {
      mainWindow.webContents.send('update-download-progress', {
        percent: Math.floor(progress.percent),
        transferred: Math.floor(progress.transferred),
        total: Math.floor(progress.total),
        bytesPerSecond: Math.floor(progress.bytesPerSecond),
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('更新下载完成:', info.version);
    // 通知用户安装更新
    if (mainWindow) {
      dialog
        .showMessageBox(mainWindow, {
          type: 'info',
          buttons: ['立即安装', '稍后'],
          defaultId: 0,
          title: '更新已准备就绪',
          message: `版本 ${info.version} 下载完成`,
          detail: '是否立即安装并重启应用？',
        })
        .then((result) => {
          if (result.response === 0) {
            setImmediate(() => {
              autoUpdater.quitAndInstall();
            });
          }
        });
    }
  });

  autoUpdater.on('error', (err) => {
    log.error('更新错误:', err);
    if (mainWindow) {
      mainWindow.webContents.send('update-error', {
        message: err.message,
      });
    }
  });

  // 处理来自渲染进程的消息
  const { ipcMain } = require('electron');
  ipcMain.handle('check-for-updates', async () => {
    try {
      await autoUpdater.checkForUpdates();
      return { success: true };
    } catch (err) {
      log.error('检查更新失败:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('download-update', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      log.error('下载更新失败:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('install-update', async () => {
    try {
      autoUpdater.quitAndInstall();
      return { success: true };
    } catch (err) {
      log.error('安装更新失败:', err);
      return { success: false, error: err.message };
    }
  });

  // 跳过版本
  ipcMain.handle('skip-version', async (event, version) => {
    try {
      skipVersion(version);
      return { success: true };
    } catch (err) {
      log.error('跳过版本失败:', err);
      return { success: false, error: err.message };
    }
  });

  // 获取跳过的版本列表
  ipcMain.handle('get-skipped-versions', async () => {
    try {
      return { success: true, versions: getSkippedVersions() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 清除跳过的版本
  ipcMain.handle('clear-skipped-versions', async () => {
    try {
      clearSkippedVersions();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

/**
 * 手动检查更新（用于菜单项）
 */
async function checkForUpdates() {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    dialog.showMessageBox({
      type: 'error',
      title: '检查更新失败',
      message: err.message,
    });
  }
}

module.exports = {
  initAutoUpdater,
  checkForUpdates,
  skipVersion,
  clearSkippedVersions,
  getSkippedVersions,
};
