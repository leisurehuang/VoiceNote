// 极简、安全的 Markdown → HTML：先 HTML 转义，再做行级/行内格式化。
// 渲染 LLM 会议纪要产出：标题、有序/无序列表、任务列表、GFM 表格、
// 围栏代码块、http(s) 链接、加粗、行内代码。不支持嵌套结构（按行处理）。

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 行内格式:行内代码优先「占位保护」,链接仅允许 http(s) 并强制新开页。 */
function inline(s: string): string {
  const codes: string[] = [];
  let t = esc(s).replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  t = t
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // eslint-disable-next-line no-control-regex -- \x00 是行内代码占位符的既定编码
  t = t.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)] ?? '');
  return t;
}

/** 表头行:「| a | b |」 */
const TABLE_HEAD = /^\s*\|(.+)\|\s*$/;

/** 分隔行:「| --- |:---:|」,必须有「|」避免误伤水平线「---」。 */
function isTableSep(line: string): boolean {
  return line.includes('|') && line.includes('-') && /^\s*\|?[\s:|-]+$/.test(line);
}

/** 拆一行表格为单元格(去首尾管道)。 */
function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  let inCode = false;
  let codeLines: string[] = [];
  const closeLists = () => {
    if (inUl) {
      out.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      out.push('</ol>');
      inOl = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fence = line.match(/^\s*```/);

    // 围栏代码块:内部只做转义,不做行内格式化
    if (inCode) {
      if (fence) {
        out.push(`<pre class="md-code"><code>${esc(codeLines.join('\n'))}</code></pre>`);
        inCode = false;
        codeLines = [];
      } else {
        codeLines.push(line);
      }
      continue;
    }
    if (fence) {
      closeLists();
      inCode = true;
      continue;
    }

    // GFM 表格:表头行 + 下一行是分隔行才成立,吃掉整个表体
    const head = line.match(TABLE_HEAD);
    if (head && lines[i + 1] !== undefined && isTableSep(lines[i + 1] ?? '')) {
      closeLists();
      const cols = splitRow(line);
      let j = i + 2;
      const rows: string[][] = [];
      while (j < lines.length && TABLE_HEAD.test(lines[j] ?? '')) {
        rows.push(splitRow(lines[j] ?? ''));
        j++;
      }
      const th = cols.map((c) => `<th>${inline(c)}</th>`).join('');
      const tb = rows
        .map((r) => {
          const tds = cols.map((_, k) => `<td>${inline(r[k] ?? '')}</td>`).join('');
          return `<tr>${tds}</tr>`;
        })
        .join('');
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`);
      i = j - 1;
      continue;
    }

    let m: RegExpMatchArray | null;
    if ((m = line.match(/^###\s+(.*)$/))) {
      closeLists();
      out.push(`<h3>${inline(m[1] ?? '')}</h3>`);
    } else if ((m = line.match(/^##\s+(.*)$/))) {
      closeLists();
      out.push(`<h2>${inline(m[1] ?? '')}</h2>`);
    } else if ((m = line.match(/^#\s+(.*)$/))) {
      closeLists();
      out.push(`<h1>${inline(m[1] ?? '')}</h1>`);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      if (!inUl) {
        closeLists();
        out.push('<ul>');
        inUl = true;
      }
      // 任务列表:「[ ] 待办」/「[x] 已办」
      const task = (m[1] ?? '').match(/^\[( |x|X)\]\s+(.*)$/);
      if (task) {
        const done = (task[1] ?? '').toLowerCase() === 'x';
        out.push(
          `<li class="md-task${done ? ' md-task-done' : ''}"><span class="md-task-box" aria-hidden="true"></span>${inline(task[2] ?? '')}</li>`,
        );
      } else {
        out.push(`<li>${inline(m[1] ?? '')}</li>`);
      }
    } else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
      if (!inOl) {
        closeLists();
        out.push('<ol>');
        inOl = true;
      }
      out.push(`<li>${inline(m[1] ?? '')}</li>`);
    } else if (line.trim() === '') {
      closeLists();
    } else {
      closeLists();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inCode && codeLines.length > 0) {
    out.push(`<pre class="md-code"><code>${esc(codeLines.join('\n'))}</code></pre>`);
  }
  closeLists();
  return out.join('\n');
}
