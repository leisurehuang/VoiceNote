#!/usr/bin/env node
// 生成 Voice Notes 应用图标（话筒造型）→ 用 sips 切各尺寸 → iconutil 打成 icon.icns。
// 纯 Node 画 PNG，无第三方依赖。输出到传入的目录（默认 packages/desktop/build/icon.icns）。
import { deflateSync } from 'node:zlib';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const OUT = resolve(process.argv[2] ?? 'icon.icns');
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

// 背板：圆角方，蓝色渐变
for (let y = 0; y < S; y++) {
  const t = y / S;
  const r = Math.round(lerp(90, 47, t));
  const g = Math.round(lerp(155, 111, t));
  const b = Math.round(lerp(255, 208, t));
  for (let x = 0; x < S; x++) if (inRR(x, y, 0, 0, S, S, 210)) set(x, y, r, g, b, 255);
}
// 白色话筒：头胶囊 + 弧形支架 + 杆 + 底座
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let mic = false;
    if (inRR(x, y, 412, 296, 200, 250, 100)) mic = true; // 头
    if (x >= 497 && x <= 527 && y >= 548 && y <= 692) mic = true; // 杆
    if (inRR(x, y, 392, 700, 240, 44, 22)) mic = true; // 底座
    const dx = x - 512, dy = y - 426, d2 = dx * dx + dy * dy; // 弧形支架
    if (d2 <= 178 * 178 && d2 >= 140 * 140 && y >= 426 && y <= 612) mic = true;
    if (mic) set(x, y, 255, 255, 255, 255);
  }
}

// —— PNG 编码（RGBA8 + zlib）——
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

mkdirSync(dirname(OUT), { recursive: true });
const work = resolve(dirname(OUT), '.iconset-build');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const masterPng = resolve(work, 'master.png');
writeFileSync(masterPng, encodePNG(S, S, px));

const iconset = resolve(work, 'icon.iconset');
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
const sizes = [16, 32, 64, 128, 256, 512, 1024];
for (const sz of sizes) {
  execSync(`sips -z ${sz} ${sz} "${masterPng}" --out "${iconset}" >/dev/null`, { stdio: 'ignore' });
}
// 重命名成 iconutil 要求的命名
const rename = [
  [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'], [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'], [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'], [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
];
for (const [sz, name] of rename) {
  execSync(`sips -z ${sz} ${sz} "${masterPng}" --out "${iconset}/${name}" >/dev/null`, { stdio: 'ignore' });
}
execSync(`iconutil -c icns "${iconset}" -o "${OUT}"`, { stdio: 'ignore' });
rmSync(work, { recursive: true, force: true });
console.log('icon written:', OUT, existsSync(OUT) ? '✓' : '✗');
