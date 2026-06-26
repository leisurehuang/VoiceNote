// 生产模式冒烟：后端单进程托管前端 + API。验证 / 返回页面、health 全绿、导出 .md 可用。
const BASE = 'http://localhost:3000';

async function main() {
  // 等服务起
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) break;
    } catch {
      await new Promise((x) => setTimeout(x, 400));
    }
  }

  const index = await (await fetch(`${BASE}/`)).text();
  console.log('GET /         ->', index.includes('<div id="root">') ? '✓ 返回前端 index.html' : '✗ 非 SPA 页面');

  const health = await (await fetch(`${BASE}/api/health`)).json();
  console.log('GET /api/health ->', JSON.stringify(health));

  const list = await (await fetch(`${BASE}/api/sessions`)).json();
  console.log('GET /api/sessions -> 会话数', list.length);
  if (list.length) {
    const id = list[0].id;
    const md = await (await fetch(`${BASE}/api/sessions/${id}/export.md`)).text();
    console.log(`GET /api/sessions/${id}/export.md -> ${md.length} 字符`);
    console.log('---- 导出预览（前 300 字）----');
    console.log(md.slice(0, 300));
  }
}

main().catch((e) => {
  console.error('VERIFY FAIL:', e);
  process.exit(1);
});
