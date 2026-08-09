/**
 * electron-builder beforePack 钩子
 * 在打包前执行（预留）
 *
 * 可用于在打包前进行资源准备、验证或修改
 */

exports.default = async function (context) {
  const { appDir, electronPlatformName, arch } = context;

  console.log('==> beforePack hook');
  console.log('    platform:', electronPlatformName);
  console.log('    arch:', arch);
  console.log('    appDir:', appDir);

  // 预留：打包前验证逻辑
  // - 检查必要文件是否存在
  // - 验证前端/后端已构建
  // - 验证二进制文件已下载

  console.log('==> beforePack complete');
};
