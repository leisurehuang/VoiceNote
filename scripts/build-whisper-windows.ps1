# Windows PowerShell script to build whisper.cpp
# 用途: 在 Windows 上编译 whisper-cli

$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent $PSScriptRoot
$BIN_DIR = Join-Path $ROOT "resources\bin\windows"
$WHISPER_BUILD_DIR = Join-Path $ROOT ".build\whisper"
$WHISPER_REPO = Join-Path $ROOT ".deps\whisper.cpp"

Write-Host "==> 准备在 Windows 上编译 whisper.cpp" -ForegroundColor Green

# 创建目录
New-Item -ItemType Directory -Force -Path $BIN_DIR | Out-Null
New-Item -ItemType Directory -Force -Path $WHISPER_BUILD_DIR | Out-Null

# 克隆仓库（如不存在）
if (-not (Test-Path $WHISPER_REPO)) {
    Write-Host "  克隆 whisper.cpp..." -ForegroundColor Yellow
    git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git $WHISPER_REPO
}

# 检查 CMake
try {
    $null = cmake --version
} catch {
    Write-Host "  错误: 需要安装 CMake" -ForegroundColor Red
    Write-Host "  下载: https://cmake.org/download/" -ForegroundColor Yellow
    exit 1
}

# 检查 Visual Studio 构建工具
try {
    $null = cl 2>&1
} catch {
    Write-Host "  警告: 可能需要安装 Visual Studio Build Tools" -ForegroundColor Yellow
    Write-Host "  下载: https://visualstudio.microsoft.com/downloads/" -ForegroundColor Yellow
}

# 编译
Write-Host "  编译中..." -ForegroundColor Yellow
Push-Location $WHISPER_BUILD_DIR

cmake $WHISPER_REPO `
    -DBUILD_SHARED_LIBS=OFF `
    -DWHISPER_BUILD_SERVER=OFF `
    -DWHISPER_BUILD_TESTS=OFF `
    -DCMAKE_BUILD_TYPE=Release

cmake --build . --config Release

Pop-Location

# 复制二进制
$WHISPER_BIN = Join-Path $WHISPER_BUILD_DIR "bin\Release\whisper-cli.exe"
if (Test-Path $WHISPER_BIN) {
    Copy-Item $WHISPER_BIN $BIN_DIR -Force
    Write-Host "  ✓ whisper-cli.exe" -ForegroundColor Green
} else {
    # 尝试其他可能的路径
    $WHISPER_BIN = Join-Path $WHISPER_BUILD_DIR "bin\whisper-cli.exe"
    if (Test-Path $WHISPER_BIN) {
        Copy-Item $WHISPER_BIN $BIN_DIR -Force
        Write-Host "  ✓ whisper-cli.exe" -ForegroundColor Green
    } else {
        Write-Host "  ✗ 未找到编译后的 whisper-cli.exe" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "==> whisper.cpp 编译完成" -ForegroundColor Green
