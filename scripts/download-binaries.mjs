#!/usr/bin/env node
/**
 * 下载跨平台二进制文件
 * 用法: node scripts/download-binaries.mjs <platform>
 * 平台: windows | linux | macos
 */

import https from 'node:https';
import http from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const platform = process.argv[2]?.toLowerCase();
if (!platform || !['windows', 'linux', 'macos'].includes(platform)) {
  console.error('用法: node scripts/download-binaries.mjs <windows|linux|macos>');
  process.exit(1);
}

console.log(`==> 下载 ${platform} 平台二进制文件`);

// 目标目录
const binDir = join(ROOT, 'resources', 'bin');
mkdirSync(binDir, { recursive: true });

// 二进制来源配置
const SOURCES = {
  windows: {
    ffmpeg: {
      url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
      extract: 'zip',
    },
    whisper: {
      // 需要从 CI 构建产物获取
      url: null,  // 待配置
      extract: 'zip',
    },
    ollama: {
      url: 'https://ollama.com/download/ollama-windows-amd64.zip',
      extract: 'zip',
    },
  },
  linux: {
    ffmpeg: {
      url: 'https://github.com/gyan-dev/ffmpeg-linux-builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz',
      extract: 'tar.xz',
    },
    whisper: {
      // 需要从 CI 构建产物获取
      url: null,
      extract: 'tar.gz',
    },
    ollama: {
      url: 'https://ollama.com/download/ollama-linux-amd64',
      extract: 'binary',
    },
  },
  macos: {
    ffmpeg: {
      url: null,  // 使用 brew
      extract: null,
    },
    whisper: {
      url: null,  // 使用 brew
      extract: null,
    },
    ollama: {
      url: 'https://ollama.com/download/ollama-darwin-arm64',
      extract: 'binary',
    },
  },
};

/**
 * 下载文件
 */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = writeFileSync(dest, '');

    protocol.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // 重定向
        return download(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        reject(new Error(`下载失败: ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * 主下载流程
 */
async function downloadBinaries() {
  const sources = SOURCES[platform];

  for (const [name, config] of Object.entries(sources)) {
    if (!config.url) {
      console.log(`  ⏭️  跳过 ${name}（使用其他方式获取）`);
      continue;
    }

    console.log(`  📥 下载 ${name}...`);
    try {
      // TODO: 实现下载和解压逻辑
      console.log(`     从 ${config.url}`);
      console.log(`     格式: ${config.extract}`);
      console.log(`     ⚠️  下载和解压功能待实现`);
    } catch (err) {
      console.error(`  ✗ ${name} 下载失败:`, err.message);
    }
  }

  console.log('==> 下载完成');
  console.log('提示: whisper.cpp 需要从 CI 构建产物获取');
}

downloadBinaries().catch(console.error);
