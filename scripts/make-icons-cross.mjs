#!/usr/bin/env node
// 跨平台图标生成（纯 Node，无依赖、无 sips/iconutil，CI 可跑）：
//   与 make-icon.mjs 同一套话筒绘制逻辑 → 1024 主图 → 面积均值降采样 →
//   输出 icon.png（通用）、icon.ico（Windows，内嵌 PNG 条目）、icons/<n>x<n>.png（Linux）。
// 用法: node scripts/make-icons-cross.mjs [输出目录]（默认 packages/desktop/build）
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? 'packages/desktop/build');
mkdirSync(OUT, { recursive: true });

// ==================== 绘制（与 make-icon.mjs 保持一致）====================
const S = 1024;
const px = Buffer.alloc(S * S * 4);
const set = (x, y, r, g, b, a = 255) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
};
const inRR = (x, y, bx, by, bw, bh, rr) => {
  if (x < bx || x >= bx + bw || y < by || y >= by + bh) return false;
  const ix = Math.max(bx + rr, Math.min(x, bx + bw - rr));
  const iy = Math.max(by + rr, Math.min(y, by + bh - rr));
  const dx = x - ix, dy = y - iy;
  return dx * dx + dy * dy <= rr * rr;
};
const lerp = (a, b, t) => a + (b - a) * t;

for (let y = 0; y < S; y++) {
  const t = y / S;
  const r = Math.round(lerp(90, 47, t));
  const g = Math.round(lerp(155, 111, t));
  const b = Math.round(lerp(255, 208, t));
  for (let x = 0; x < S; x++) if (inRR(x, y, 0, 0, S, S, 210)) set(x, y, r, g, b, 255);
}
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let mic = false;
    if (inRR(x, y, 412, 296, 200, 250, 100)) mic = true;
    if (x >= 497 && x <= 527 && y >= 548 && y <= 692) mic = true;
    if (inRR(x, y, 392, 700, 240, 44, 22)) mic = true;
    const dx = x - 512, dy = y - 426, d2 = dx * dx + dy * dy;
    if (d2 <= 178 * 178 && d2 >= 140 * 140 && y >= 426 && y <= 612) mic = true;
    if (mic) set(x, y, 255, 255, 255, 255);
  }
}

// ==================== PNG 编码（RGBA8 + zlib，与 make-icon.mjs 一致）====================
const crcTab = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTab[n] = c >>> 0;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTab[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type, 'latin1');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const encodePNG = (w, h, rgba) => {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
};

// ==================== 面积均值降采样（逐级 2x2）====================
function downscale2(buf, w) {
  const h = w;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        const i00 = ((2 * y) * 2 * w + 2 * x) * 4 + c;
        const i01 = i00 + 4;
        const i10 = i00 + 2 * w * 4;
        const i11 = i10 + 4;
        // 半透明边缘用 alpha 加权平均，避免白边/黑边
        const a00 = buf[i00 + 3], a01 = buf[i01 + 3], a10 = buf[i10 + 3], a11 = buf[i11 + 3];
        const aSum = a00 + a01 + a10 + a11 || 1;
        const rgb =
          (buf[i00 + c] * a00 + buf[i01 + c] * a01 + buf[i10 + c] * a10 + buf[i11 + c] * a11) / aSum;
        out[(y * w + x) * 4 + c] = c === 3 ? Math.round(aSum / 4) : Math.round(rgb);
      }
    }
  }
  return out;
}

const images = new Map(); // size -> {w, h, rgba}
images.set(S, { w: S, h: S, rgba: px });
for (let size = S / 2; size >= 16; size /= 2) {
  const prev = images.get(size * 2);
  images.set(size, { w: size, h: size, rgba: downscale2(prev.rgba, size) });
}
const pngOf = (size) => {
  const img = images.get(size);
  return encodePNG(img.w, img.h, img.rgba);
};

// ==================== 输出 ====================
writeFileSync(join(OUT, 'icon.png'), pngOf(512));

// ICO 用 BMP(DIB) 条目（非 PNG 压缩），最大化 rcedit / NSIS / 旧版 Explorer 兼容性
const icoSizes = [256, 128, 64, 32, 16];
const dibOf = (size) => {
  const { rgba } = images.get(size);
  // XOR（像素，BGRA，自下而上）
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y; // 自下而上
    for (let x = 0; x < size; x++) {
      const i = (srcY * size + x) * 4;
      const o = (y * size + x) * 4;
      xor[o] = rgba[i + 2]; // B
      xor[o + 1] = rgba[i + 1]; // G
      xor[o + 2] = rgba[i]; // R
      xor[o + 3] = rgba[i + 3]; // A
    }
  }
  // AND 掩码（1bpp，自下而上，行按 4 字节对齐；32bpp 下全 0 = 按 alpha 处理）
  const rowSize = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(rowSize * size);
  const h = Buffer.alloc(40);
  h.writeUInt32LE(40, 0);
  h.writeInt32LE(size, 4);
  h.writeInt32LE(size * 2, 8); // XOR + AND 两倍高
  h.writeUInt16LE(1, 12);
  h.writeUInt16LE(32, 14);
  h.writeUInt32LE(0, 16); // BI_RGB
  h.writeUInt32LE(xor.length + and.length, 20);
  return Buffer.concat([h, xor, and]);
};
const dibs = icoSizes.map(dibOf);
const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2); // type: icon
dir.writeUInt16LE(icoSizes.length, 4);
const entries = [];
let offset = 6 + 16 * icoSizes.length;
icoSizes.forEach((size, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(size >= 256 ? 0 : size, 0);
  e.writeUInt8(size >= 256 ? 0 : size, 1);
  e.writeUInt8(0, 2); // 调色板色数（truecolor 为 0）
  e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(dibs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += dibs[i].length;
  entries.push(e);
});
writeFileSync(join(OUT, 'icon.ico'), Buffer.concat([dir, ...entries, ...dibs]));

mkdirSync(join(OUT, 'icons'), { recursive: true });
for (const size of [512, 256, 128, 64, 32, 16]) {
  writeFileSync(join(OUT, 'icons', `${size}x${size}.png`), pngOf(size));
}

console.log('icons written to', OUT);
for (const f of ['icon.png', 'icon.ico', 'icons/']) {
  console.log('  -', f);
}
