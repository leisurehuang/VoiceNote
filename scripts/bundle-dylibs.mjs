#!/usr/bin/env node
// 通用动态库收拢器（替代 dylibbundler）。
// 用法：node bundle-dylibs.mjs <srcBinary> <destBinary> <libsDir>
// 把 src 拷到 dest，递归收拢它依赖的所有非系统 dylib 到 libsDir，改写引用为 @rpath/<name>，
// 给主二进制加 @loader_path/libs 的 rpath，并逐个 ad-hoc 重签（arm64 上 install_name_tool
// 改过的二进制不重签会被内核 kill）。
// 关键：依赖解析用【原始 src 位置】的 @loader_path/@rpath（拷贝后的相对路径已失效）。
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const src = resolve(process.argv[2]);
const dest = resolve(process.argv[3]);
const libsDir = resolve(process.argv[4]);
if (!src || !dest || !libsDir) {
  console.error('用法: node bundle-dylibs.mjs <srcBinary> <destBinary> <libsDir>');
  process.exit(2);
}
mkdirSync(libsDir, { recursive: true });
if (existsSync(dest)) rmSync(dest, { force: true }); // 清掉可能被 codesign 改成只读的旧文件
copyFileSync(src, dest);

const im = (args) => {
  try {
    execFileSync('install_name_tool', args, { stdio: 'ignore' });
  } catch {
    /* 个别 -change/-add_rpath 无匹配或已存在会非零，忽略 */
  }
};

function rpathsOf(file) {
  let out;
  try {
    out = execFileSync('otool', ['-l', file]).toString();
  } catch {
    return [];
  }
  const res = [];
  const ls = out.split('\n');
  for (let i = 0; i < ls.length; i++) {
    if (!ls[i].includes('LC_RPATH')) continue;
    for (let j = 1; j <= 3; j++) {
      const m = ls[i + j] && ls[i + j].match(/path\s+(.+?)\s+\(/);
      if (m) {
        res.push(m[1].trim());
        break;
      }
    }
  }
  return res;
}

/** 读取 file（原始位置）的依赖：{ref, src}，@loader_path/@rpath 用原始目录解析。 */
function depsOf(file) {
  const out = execFileSync('otool', ['-L', file]).toString();
  const lines = out.split('\n').slice(1);
  const rps = rpathsOf(file).map((rp) =>
    rp.replace('@loader_path', dirname(file)).replace('@executable_path', dirname(file)),
  );
  const res = [];
  for (const ln of lines) {
    const m = ln.match(/^\s*(\S+)/);
    if (!m) continue;
    const ref = m[1];
    if (ref.startsWith('/opt/homebrew') || ref.startsWith('/usr/local')) {
      res.push({ ref, src: ref });
    } else if (ref.startsWith('@rpath/')) {
      const name = ref.slice('@rpath/'.length);
      for (const rp of rps) {
        const c = join(rp, name);
        if (existsSync(c)) {
          res.push({ ref, src: c });
          break;
        }
      }
    } else if (ref.startsWith('@loader_path/')) {
      const c = join(dirname(file), ref.slice('@loader_path/'.length));
      if (existsSync(c)) res.push({ ref, src: c });
    }
  }
  return res;
}

const toSign = new Set([dest]);
const done = new Set();
const queue = [{ src, dest }];
let copied = 0;

while (queue.length) {
  const { src: f, dest: g } = queue.shift();
  if (done.has(f)) continue;
  done.add(f);
  for (const { ref, src: depSrc } of depsOf(f)) {
    const name = basename(depSrc);
    const depDest = join(libsDir, name);
    if (!existsSync(depDest)) {
      copyFileSync(depSrc, depDest);
      copied++;
      console.log('  + ' + name);
    }
    if (ref !== `@rpath/${name}`) im(['-change', ref, `@rpath/${name}`, g]); // 改 dest 副本的引用
    im(['-id', `@rpath/${name}`, depDest]);
    toSign.add(depDest);
    queue.push({ src: depSrc, dest: depDest });
  }
}

im(['-add_rpath', '@loader_path/libs', dest]); // 主二进制：运行时 @rpath → 同级 libs/

// ad-hoc 重签：先签库，最后签主二进制
const order = [...toSign].sort((a) => (a === dest ? 1 : -1));
for (const f of order) {
  try {
    execFileSync('codesign', ['--force', '--sign', '-', f], { stdio: 'ignore' });
  } catch {
    console.error('  codesign 失败: ' + f);
  }
}
console.log(`done: 收拢 ${copied} 个动态库`);
