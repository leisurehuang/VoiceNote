#!/usr/bin/env bash
# 安装 Voice Notes 依赖：whisper-cpp / ffmpeg / whisper 模型 / Ollama 摘要模型。
# 支持 macOS 和 Linux 多平台
set -euo pipefail

MODEL_DIR="${WHISPER_MODEL_DIR:-$HOME/.voice-notes-models}"
MODEL_NAME="${WHISPER_MODEL_NAME:-ggml-large-v3-turbo.bin}"
MODEL_URL_BASE="${WHISPER_MODEL_URL_BASE:-https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main}"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:7b-instruct}"

# 检测操作系统
detect_os() {
    case "$(uname -s)" in
        Darwin)
            echo "macos"
            ;;
        Linux)
            echo "linux"
            ;;
        *)
            echo "unknown"
            ;;
    esac
}

# 检测 Linux 发行版
detect_linux_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        echo "$ID"
    else
        echo "unknown"
    fi
}

# macOS: 使用 Homebrew 安装
install_deps_macos() {
    echo "==> [1/5] 使用 Homebrew 安装依赖"
    brew install whisper-cpp ffmpeg
    WHISPER_PREFIX="$(brew --prefix whisper-cpp)"
    echo "    whisper-cli: $WHISPER_PREFIX/bin/whisper-cli"
    
    # macOS 不需要额外配置 whisper-cli 路径，config.ts 会自动处理
    WHISPER_CLI_PATH="${WHISPER_PREFIX}/bin/whisper-cli"
}

# Linux: 安装依赖并编译 whisper.cpp
install_deps_linux() {
    echo "==> [1/5] 安装系统依赖"
    local distro=$(detect_linux_distro)
    
    case "$distro" in
        ubuntu|debian|linuxmint)
            sudo apt-get update
            sudo apt-get install -y ffmpeg build-essential cmake git ca-certificates curl
            ;;
        centos|rhel)
            sudo yum install -y epel-release || true
            sudo yum install -y ffmpeg gcc gcc-c++ cmake git ca-certificates curl
            ;;
        fedora)
            sudo dnf install -y ffmpeg gcc gcc-c++ cmake git ca-certificates curl
            ;;
        arch|manjaro)
            sudo pacman -Syu --noconfirm ffmpeg base-devel cmake git ca-certificates curl
            ;;
        *)
            echo "警告: 无法识别的发行版 $distro，请手动安装 ffmpeg, build-essential, cmake, git"
            ;;
    esac
    
    # 编译安装 whisper.cpp
    echo "==> [2/5] 编译安装 whisper.cpp"
    install_whisper_cpp_linux
}

# Linux: 编译安装 whisper.cpp
install_whisper_cpp_linux() {
    local temp_dir=$(mktemp -d)
    cd "$temp_dir"
    
    # 尝试多个 Git 镜像源
    local whisper_repos=(
        "https://github.com/ggml-org/whisper.cpp.git"
        "https://gitee.com/mirrors/whisper.cpp.git"
        "https://gitcode.net/mirrors/ggerganov/whisper.cpp.git"
    )
    
    local clone_success=0
    for repo in "${whisper_repos[@]}"; do
        echo "    尝试从 $repo 克隆..."
        if git clone --depth 1 "$repo" whisper.cpp 2>/dev/null; then
            clone_success=1
            break
        fi
    done
    
    if [ $clone_success -ne 1 ]; then
        echo "    尝试下载 release 版本..."
        download_whisper_release "$temp_dir"
    fi
    
    cd whisper.cpp
    cmake -B build -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release
    cmake --build build -j"$(nproc)"
    
    # 安装到用户目录
    mkdir -p "$MODEL_DIR/bin"
    cp build/bin/whisper-cli "$MODEL_DIR/bin/whisper-cli"
    
    cd /
    rm -rf "$temp_dir"
    
    WHISPER_CLI_PATH="$MODEL_DIR/bin/whisper-cli"
    echo "    whisper-cli 已安装到: $WHISPER_CLI_PATH"
}

# 下载 whisper.cpp release 作为备选方案
download_whisper_release() {
    local temp_dir="$1"
    local release_urls=(
        "https://github.com/ggml-org/whisper.cpp/archive/refs/heads/master.tar.gz"
        "https://ghproxy.com/https://github.com/ggml-org/whisper.cpp/archive/refs/heads/master.tar.gz"
    )
    
    for url in "${release_urls[@]}"; do
        echo "    尝试从 $url 下载..."
        if curl -L --fail -o "$temp_dir/whispercpp.tar.gz" "$url" 2>/dev/null; then
            cd "$temp_dir"
            tar xzf whispercpp.tar.gz
            mv whisper.cpp-* whisper.cpp
            rm whispercpp.tar.gz
            return 0
        fi
    done
    
    echo "错误: 无法获取 whisper.cpp 源码"
    return 1
}

# 通用: 下载 whisper 模型
download_model() {
    local os="$1"
    local step="$2"
    
    echo "==> [$step] 下载 whisper 模型 ($MODEL_NAME)"
    mkdir -p "$MODEL_DIR"
    MODEL_FILE="$MODEL_DIR/$MODEL_NAME"
    
    if [[ -f "$MODEL_FILE" ]]; then
        echo "    已存在，跳过"
    else
        echo "    从 $MODEL_URL_BASE 下载（支持断点续传）……"
        # 先试镜像，失败回退官方源
        if ! curl -L --fail -C - --retry 5 --retry-delay 3 -o "$MODEL_FILE" \
              "$MODEL_URL_BASE/$MODEL_NAME"; then
            echo "    镜像失败，尝试 huggingface.co 官方源……"
            curl -L --fail -C - --retry 5 --retry-delay 3 -o "$MODEL_FILE" \
              "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL_NAME"
        fi
    fi
    echo "    模型: $MODEL_FILE"
}

# 通用: 安装/检查 Ollama
setup_ollama() {
    local os="$1"
    local step="$2"
    
    echo "==> [$step] 安装/检查 Ollama"
    if ! command -v ollama &> /dev/null; then
        echo "    安装 Ollama..."
        if [ "$os" = "macos" ]; then
            # macOS: 检查是否有 Homebrew
            if command -v brew &> /dev/null; then
                brew install ollama || true
            fi
        fi
        # 如果还是没有，使用官方安装脚本
        if ! command -v ollama &> /dev/null; then
            curl -fsSL https://ollama.com/install.sh | sh
        fi
    else
        echo "    Ollama 已安装"
    fi
    
    # 启动 Ollama 服务
    if ! pgrep -x ollama >/dev/null 2>&1; then
        echo "    启动 ollama serve（后台）……"
        nohup ollama serve >/tmp/ollama.log 2>&1 &
        sleep 4
    fi
    
    # 拉取模型
    local next_step="$(($step + 1))"
    echo "==> [$next_step] 拉取 Ollama 摘要模型 ($OLLAMA_MODEL)"
    ollama pull "$OLLAMA_MODEL"
}

# 创建/更新 .env 文件
setup_env() {
    local os="$1"
    local step="$2"
    
    echo "==> [$step] 配置环境"
    if [ ! -f .env ]; then
        echo "    创建 .env 文件"
        cp .env.example .env
    fi
    
    # 更新 whisper-cli 路径（仅 Linux 需要）
    if [ "$os" = "linux" ] && [ -n "${WHISPER_CLI_PATH:-}" ]; then
        if grep -q "^# WHISPER_CLI=" .env; then
            sed -i.bak "s|^# WHISPER_CLI=.*|WHISPER_CLI=$WHISPER_CLI_PATH|" .env && rm -f .env.bak
        elif ! grep -q "^WHISPER_CLI=" .env; then
            echo "WHISPER_CLI=$WHISPER_CLI_PATH" >> .env
        fi
    fi
    
    # 更新模型路径
    if grep -q "^# WHISPER_MODEL=" .env; then
        sed -i.bak "s|^# WHISPER_MODEL=.*|WHISPER_MODEL=$MODEL_FILE|" .env && rm -f .env.bak
    elif ! grep -q "^WHISPER_MODEL=" .env; then
        echo "WHISPER_MODEL=$MODEL_FILE" >> .env
    fi
}

# 主函数
main() {
    local OS=$(detect_os)
    echo "=== Voice Notes 环境设置 ==="
    echo "检测到操作系统: $OS"
    echo ""
    
    WHISPER_CLI_PATH=""
    
    if [ "$OS" = "macos" ]; then
        install_deps_macos
        download_model "macos" 2
        setup_ollama "macos" 3
        setup_env "macos" 5
        local total_steps=5
    elif [ "$OS" = "linux" ]; then
        install_deps_linux
        download_model "linux" 3
        setup_ollama "linux" 4
        setup_env "linux" 6
        local total_steps=6
    else
        echo "错误: 不支持的操作系统"
        exit 1
    fi
    
    echo "==> [$total_steps] 完成"
    cat <<EOF

依赖就绪。现在：
  npm install
  npm run dev                # 前端 http://localhost:5173  后端 :3000

模型档位（改 .env 的 WHISPER_MODEL 即可切换，重新跑本脚本时设 WHISPER_MODEL_NAME）：
  ggml-large-v3-turbo.bin   ~1.5GB  默认，质量接近 large、速度快（推荐）
  ggml-large-v3.bin         ~3.0GB  中文最好，更慢更占内存
  ggml-small.bin            ~466MB  最快，嘈杂环境偏弱
EOF
}

main
