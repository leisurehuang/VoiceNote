/**
 * electron-builder afterSign 钩子
 * 在签名完成后执行（预留）
 *
 * 当配置代码签名时，此钩子会在签名后运行
 * 可用于验证签名或执行其他后处理
 */

exports.default = async function (context) {
  const { appOutDir, electronPlatformName } = context;

  console.log('==> afterSign hook');
  console.log('    platform:', electronPlatformName);
  console.log('    outDir:', appOutDir);

  // 预留：代码签名验证逻辑
  // if (electronPlatformName === 'darwin') {
  //   // macOS 签名验证
  // }
  // if (electronPlatformName === 'win32') {
  //   // Windows 签名验证
  // }

  console.log('==> afterSign complete (no-op, signature not configured)');
};
