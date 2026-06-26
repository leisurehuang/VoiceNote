// 极简、安全的 Markdown → HTML：先 HTML 转义，再做行级/行内格式化。
// 够渲染 LLM 产出的会议摘要（标题、有序/无序列表、加粗、行内代码、段落）。

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
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

  for (const raw of lines) {
    const line = raw;
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
      out.push(`<li>${inline(m[1] ?? '')}</li>`);
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
  closeLists();
  return out.join('\n');
}
