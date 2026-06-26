#!/usr/bin/env node
// 下载大模型文件（用 Node fetch + Range 断点续传）。用法：
//   node scripts/fetch-model.mjs <url> <dest>
// curl 受限或网络不稳时也能用。
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const url = process.argv[2];
const dest = resolve(process.argv[3]);
if (!url || !dest) {
  console.error('用法: node scripts/fetch-model.mjs <url> <dest>');
  process.exit(2);
}

const MAX_RETRIES = Number(process.env.FETCH_RETRIES ?? 10);
let attempt = 0;
let lastErr = '';
while (attempt < MAX_RETRIES) {
  attempt++;
  const have = existsSync(dest) ? statSync(dest).size : 0;
  const headers = have > 0 ? { Range: `bytes=${have}-` } : {};
  try {
    const res = await fetch(url, { headers, redirect: 'follow' });
    if (res.status === 416) {
      console.log('已完成（服务器确认文件完整）');
      process.exit(0);
    }
    if (!res.ok && res.status !== 206) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const append = res.status === 206 && have > 0;
    const stream = createWriteStream(dest, { flags: append ? 'a' : 'w' });
    const reader = res.body.getReader();
    let written = have;
    let lastLog = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      stream.write(Buffer.from(value));
      written += value.length;
      if (written - lastLog > 4 * 1024 * 1024) {
        process.stdout.write(`\r已下载 ${(written / 1048576).toFixed(1)} MB `);
        lastLog = written;
      }
    }
    await new Promise((r, j) => stream.end((err) => (err ? j(err) : r())));
    process.stdout.write(`\n完成：${dest} (${statSync(dest).size} bytes)\n`);
    process.exit(0);
  } catch (e) {
    lastErr = e instanceof Error ? e.message : String(e);
    process.stdout.write(`\n第 ${attempt} 次失败：${lastErr}，续传重试……\n`);
  }
}
console.error(`放弃：${lastErr}`);
process.exit(1);
