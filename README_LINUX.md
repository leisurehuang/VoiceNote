# Voice Notes Linux 运行指南

本项目现已支持在 Linux 上原生运行！以下是详细的使用说明。

## 方式一：Docker 运行（最简单，推荐）

项目已提供完整的 Docker 支持，这是在 Linux 上运行的最快方式：

```bash
# 一键启动
docker compose up -d

# 查看日志
docker compose logs -f

# 查看 Ollama 模型拉取进度
docker compose logs -f ollama-init
```

浏览器访问 `http://localhost:3000` 即可使用。

## 方式二：原生 Linux 运行

### 系统要求

- Node.js 22+
- 支持的发行版：Ubuntu/Debian/CentOS/Fedora/Arch 等主流 Linux 发行版

### 安装步骤

1. **克隆项目（如果还没有）**
   ```bash
   git clone https://github.com/leisurehuang/VoiceNote.git
   cd VoiceNote
   ```

2. **运行 Linux 安装脚本**
   ```bash
   chmod +x scripts/setup-linux.sh
   bash scripts/setup-linux.sh
   ```
   
   该脚本会自动：
   - 检测您的 Linux 发行版
   - 安装系统依赖（ffmpeg、编译工具等）
   - 从源码编译 whisper.cpp
   - 下载 whisper 模型
   - 安装 Ollama 并拉取 qwen2.5:7b-instruct 模型
   - 创建配置好的 .env 文件

3. **安装项目依赖**
   ```bash
   npm install
   ```

4. **运行项目**
   
   开发模式（前端热更新）：
   ```bash
   npm run dev
   ```
   
   生产模式：
   ```bash
   npm run build
   npm start
   ```

5. **访问应用**
   
   开发模式：
   - 前端：http://localhost:5173
   - 后端：http://localhost:3000
   
   生产模式：
   - 应用：http://localhost:3000

### 手动配置（可选）

如果您想手动配置而不是使用安装脚本：

1. **安装系统依赖**
   
   Ubuntu/Debian:
   ```bash
   sudo apt-get update
   sudo apt-get install -y ffmpeg build-essential cmake git curl
   ```
   
   CentOS/RHEL:
   ```bash
   sudo yum install -y epel-release
   sudo yum install -y ffmpeg gcc gcc-c++ cmake git curl
   ```
   
   Fedora:
   ```bash
   sudo dnf install -y ffmpeg gcc gcc-c++ cmake git curl
   ```

2. **编译安装 whisper.cpp**
   ```bash
   git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git
   cd whisper.cpp
   cmake -B build -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release
   cmake --build build -j$(nproc)
   
   # 安装到用户目录
   mkdir -p ~/.voice-notes-models/bin
   cp build/bin/whisper-cli ~/.voice-notes-models/bin/
   ```

3. **下载 whisper 模型**
   ```bash
   mkdir -p ~/.voice-notes-models
   cd ~/.voice-notes-models
   curl -L -o ggml-large-v3-turbo.bin https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
   ```

4. **安装 Ollama**
   ```bash
   curl -fsSL https://ollama.com/install.sh | sh
   ```

5. **启动 Ollama 服务并拉取模型**
   ```bash
   # 启动 Ollama 服务（如果尚未运行）
   ollama serve &
   
   # 拉取模型
   ollama pull qwen2.5:7b-instruct
   ```

6. **配置 .env 文件**
   ```bash
   cp .env.example .env
   ```
   
   编辑 `.env` 文件，设置：
   ```
   WHISPER_CLI=/home/your-user/.voice-notes-models/bin/whisper-cli
   WHISPER_MODEL=/home/your-user/.voice-notes-models/ggml-large-v3-turbo.bin
   ```

### 模型切换

编辑 `.env` 文件中的 `WHISPER_MODEL` 变量即可切换模型：

- `ggml-large-v3-turbo.bin` (~1.5GB) - 默认推荐，平衡质量和速度
- `ggml-large-v3.bin` (~3.0GB) - 中文质量最好
- `ggml-small.bin` (~466MB) - 速度最快

### 故障排除

1. **ffmpeg 未找到**
   - 确认已通过系统包管理器安装 ffmpeg

2. **whisper-cli 未找到**
   - 检查 `.env` 文件中的 `WHISPER_CLI` 路径是否正确
   - 确认文件有执行权限：`chmod +x ~/.voice-notes-models/bin/whisper-cli`

3. **Ollama 连接失败**
   - 确认 Ollama 服务正在运行：`pgrep -x ollama` 或 `systemctl status ollama`
   - 检查 `.env` 文件中的 `OLLAMA_BASE_URL` 配置

4. **权限问题**
   - 确保数据目录有正确的权限：`chmod -R 755 data/`

## Sherpa-onnx 支持（可选）

如果需要使用带说话人分离的 Sherpa-onnx 引擎：

```bash
chmod +x scripts/fetch-sherpa.sh
bash scripts/fetch-sherpa.sh
```

然后在应用的设置页面切换到 Sherpa 引擎。

## GPU 加速

### Ollama GPU 加速

如果您有 NVIDIA GPU 并安装了 nvidia-container-toolkit，可以在 `docker-compose.yml` 中取消注释 Ollama 服务的 GPU 配置。

原生运行时，Ollama 会自动检测并使用 NVIDIA GPU（如果已安装 NVIDIA 驱动）。

### whisper.cpp GPU 加速

当前默认使用 CPU 版本的 whisper.cpp。如需 GPU 加速，需要根据您的硬件重新编译 whisper.cpp 启用相应的后端（CUDA/OpenCL/Metal等）。

## 数据持久化

所有会话数据存储在 `data/` 目录下，包括：
- 原始音频文件
- 转换后的音频
- 转录文本
- 摘要文件

备份或迁移时只需保留 `data/` 目录即可。

## 下一步

- 查看主 [README.md](README.md) 了解功能特性
- 参考 [CONTRIBUTING.md](CONTRIBUTING.md) 参与开发
