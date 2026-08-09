/**
 * electron-builder afterPack 钩子
 * 在打包完成后执行，用于处理平台特定的资源处理
 */

const fs = require('fs');
const path = require('path');

exports.default = async function (context) {
  const { appOutDir, electronPlatformName, arch } = context;

  console.log('==> afterPack hook');
  console.log('    platform:', electronPlatformName);
  console.log('    arch:', arch);
  console.log('    outDir:', appOutDir);

  // 设置可执行权限（Unix-like 系统）
  if (electronPlatformName === 'darwin' || electronPlatformName === 'linux') {
    const binaries = ['whisper-cli', 'ffmpeg', 'ffprobe', 'ollama'];

    for (const bin of binaries) {
      const binPath = path.join(appOutDir, 'resources', 'bin', bin);
      if (fs.existsSync(binPath)) {
        fs.chmodSync(binPath, 0o755);
        console.log(`    chmod +x ${bin}`);
      }
    }
  }

  // Windows 平台特定处理
  if (electronPlatformName === 'win32') {
    // 可以在这里添加 Windows 特定处理
  }

  // Linux 平台特定处理
  if (electronPlatformName === 'linux') {
    // AppImage 特定处理
  }

  console.log('==> afterPack complete');
};
