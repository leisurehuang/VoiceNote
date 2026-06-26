// M3 冒烟测试：上传音频 → SSE 实时收段 → done → 校验最终逐字稿。
// 用法：node scripts/smoke-m3.mjs /path/to/sample.aiff
import { readFile } from 'node:fs/promises';

const API = process.env.API ?? 'http://localhost:3000/api';
const SAMPLE = process.argv[2];
if (!SAMPLE) {
  console.error('用法: node scripts/smoke-m3.mjs <音频文件>');
  process.exit(2);
}

async function upload(path) {
  const buf = await readFile(path);
  const fd = new FormData();
  fd.append('title', 'M3 转写测试');
  fd.append('sourceKind', 'upload');
  fd.append('audio', new Blob([buf]), 'sample.aiff');
  const r = await fetch(`${API}/sessions`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`上传失败 ${r.status}`);
  return (await r.json()).id;
}

// 流式读 SSE，解析 event/data，收到 done/failed 即结束。
async function watchSSE(id) {
  const res = await fetch(`${API}/sessions/${id}/events`);
  if (!res.ok || !res.body) throw new Error(`SSE 连接失败 ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const segs = [];
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let evt = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) evt = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (evt === 'segment') {
        const obj = JSON.parse(data);
        segs.push(obj.segment.text);
        process.stdout.write(`\r  段[${obj.index}] ${obj.segment.text}   `);
      } else if (evt === 'stage') {
        console.log(`\n[stage] ${data}`);
      } else if (evt === 'meta') {
        const m = JSON.parse(data);
        if (m.status === 'done' || m.status === 'error') console.log(`\n[meta] status=${m.status} progress=${m.progress}`);
      } else if (evt === 'done') {
        console.log('\n[done]');
        return segs;
      } else if (evt === 'failed') {
        console.log('\n[failed]', data);
        return segs;
      }
    }
  }
  return segs;
}

const id = await upload(SAMPLE);
console.log('uploaded id =', id);

const sse = watchSSE(id);
await new Promise((x) => setTimeout(x, 250)); // 等 SSE 连上
await fetch(`${API}/sessions/${id}/process`, { method: 'POST' });
const liveSegs = await sse;
console.log(`SSE 共收到 ${liveSegs.length} 段`);

const detail = await (await fetch(`${API}/sessions/${id}`)).json();
console.log('最终 status =', detail.status, ' 标题 =', detail.title, ' 段数 =', detail.transcript.length, ' durationMs =', detail.durationMs);
console.log('---- 全文 ----');
console.log(detail.transcript.map((s) => s.text).join(''));
console.log('---- 摘要 ----');
console.log(detail.summary ?? '(无)');
