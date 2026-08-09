/**
 * Auto-Update 模块
 * 使用 electron-updater 实现跨平台自动更新
 */

const { autoUpdater } = require('electron-updater');
const { dialog, shell } = require('electron');
const log = require('electron-log');

// 配置日志
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

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

  // 监听更新事件
  autoUpdater.on('checking-for-update', () => {
    log.info('检查更新中...');
  });

  autoUpdater.on('update-available', (info) => {
    log.info('发现新版本:', info.version);
    // 通知用户有更新可用
    if (mainWindow) {
      mainWindow.webContents.send('update-available', {
        version: info.version,
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
};
