#!/usr/bin/env node
/**
 * 听写接口冒烟测试（需后端在跑，默认 http://127.0.0.1:3000）：
 *   node scripts/smoke-dictation.mjs
 *
 * 1. 保存当前 settings → 临时把 dictation.polish 关掉（避免依赖 LLM）
 * 2. POST 1s 静音 PCM → 断言 silent 处理
 * 3. 历史 GET / DELETE
 * 4. 恢复 settings
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
let failed = 0;

function ok(cond, name, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed++;
    console.error(`  ✗ ${name} ${extra}`);
  }
}

async function main() {
  console.log(`听写冒烟测试 → ${BASE}`);

  const health = await (await fetch(`${BASE}/api/health`)).json();
  if (health.transcriptionEngine === 'api' && !health.asrApiOk) {
    console.error('  ✗ 云端转写引擎未就绪（asrApi 未配置/不可达），先在设置里配好再跑');
    process.exit(1);
  }
  if (health.transcriptionEngine !== 'api' && !(health.whisperCli && health.whisperModel)) {
    console.error('  ✗ 本地转写引擎未就绪（whisper-cli/模型缺失），先 npm run setup');
    process.exit(1);
  }

  const original = await (await fetch(`${BASE}/api/settings`)).json();
  // 关润色，避免测试依赖 LLM
  await fetch(`${BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...original,
      dictation: { ...original.dictation, polish: false, enabled: false },
    }),
  });

  try {
    // 1s 静音：16000 样本 Int16LE
    const pcm = Buffer.alloc(16000 * 2, 0);
    const res = await fetch(`${BASE}/api/dictation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: pcm,
    });
    const j = await res.json();
    ok(res.status === 200, 'POST /api/dictation 200');
    ok(typeof j.transcript === 'string', '返回 transcript 字段');
    ok(typeof j.text === 'string', '返回 text 字段');
    ok(typeof j.durationMs === 'number' && j.durationMs >= 950, `durationMs≈1000（实际 ${j.durationMs}）`);
    ok(j.silent === true || j.transcript === '', '静音 → silent/空文本');

    // 太短的录音要 400
    const short = await fetch(`${BASE}/api/dictation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.alloc(1600), // 50ms
    });
    ok(short.status === 400, '过短录音返回 400');

    // 历史（静音不落历史；接口可用即可）
    const hist = await (await fetch(`${BASE}/api/dictation/history?limit=10`)).json();
    ok(Array.isArray(hist.entries), 'GET /api/dictation/history');
    const del = await fetch(`${BASE}/api/dictation/history`);
    ok(del.status === 200, 'DELETE /api/dictation/history（清空）');

    // settings 里 dictation 默认字段齐全
    const s2 = await (await fetch(`${BASE}/api/settings`)).json();
    ok(
      s2.dictation && s2.dictation.shortcut && Array.isArray(s2.dictation.termCorrections),
      'settings.dictation 字段齐全',
    );
  } finally {
    // 恢复原 settings
    await fetch(`${BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(original),
    });
    console.log('  · settings 已恢复');
  }

  if (failed) {
    console.error(`\n${failed} 项失败`);
    process.exit(1);
  }
  console.log('\n全部通过');
}

main().catch((e) => {
  console.error('冒烟测试异常：', e);
  process.exit(1);
});
