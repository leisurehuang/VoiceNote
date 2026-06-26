// M2 冒烟测试（不依赖 curl）：生成一段静音 WAV，跑通 上传→列表→详情→process→删除。
// 用法：node scripts/smoke-m2.mjs
import { Buffer } from 'node:buffer';

const API = process.env.API ?? 'http://localhost:3000/api';

function makeWav(seconds = 2, rate = 16000) {
  const samples = rate * seconds;
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf; // 样本区全 0 = 静音
}

async function waitServer(msRetry = 500, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${API}/sessions`);
      if (r.ok) return;
    } catch {
      /* server 还没起，继续等 */
    }
    await new Promise((x) => setTimeout(x, msRetry));
  }
  throw new Error('后端未就绪');
}

async function main() {
  await waitServer();
  const wav = makeWav(2);
  const blob = new Blob([wav], { type: 'audio/wav' });
  const fd = new FormData();
  // 字段在文件之前（顺序最稳）
  fd.append('title', '冒烟测试');
  fd.append('sourceKind', 'upload');
  fd.append('audio', blob, 'smoke.wav');

  const r = await fetch(`${API}/sessions`, { method: 'POST', body: fd });
  console.log('POST /sessions ->', r.status);
  if (!r.ok) throw new Error(`上传失败: ${r.status} ${await r.text()}`);
  const { id } = await r.json();
  console.log('  id =', id);

  const list = await (await fetch(`${API}/sessions`)).json();
  console.log('GET /sessions -> 条数', Array.isArray(list) ? list.length : '?');

  const before = (await (await fetch(`${API}/sessions/${id}`)).json());
  console.log('detail before: status=%s title=%s', before.status, before.title);

  const pr = await fetch(`${API}/sessions/${id}/process`, { method: 'POST' });
  console.log('POST /process ->', pr.status, await pr.text());

  // 等流水线跑完（转码或失败）
  for (let i = 0; i < 20; i++) {
    await new Promise((x) => setTimeout(x, 400));
    const d = (await (await fetch(`${API}/sessions/${id}`)).json());
    if (d.status === 'done' || d.status === 'error') {
      console.log('process 结果: status=%s stage=%s durationMs=%s error=%s', d.status, d.stage, d.durationMs, d.error);
      break;
    }
  }

  const del = await fetch(`${API}/sessions/${id}`, { method: 'DELETE' });
  console.log('DELETE ->', del.status, await del.text());
}

main().catch((e) => {
  console.error('SMOKE FAIL:', e);
  process.exit(1);
});
