import { useState } from 'react';
import { exportMarkdownText, exportMarkdownUrl } from '../api/client';

export function ExportBar({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      const md = await exportMarkdownText(id);
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板被拒绝时忽略 */
    }
  }

  return (
    <div className="export-bar">
      <button className="ghost" onClick={copy}>
        {copied ? '已复制 ✓' : '复制 Markdown'}
      </button>
      <a className="ghost" href={exportMarkdownUrl(id)} download>
        下载 .md
      </a>
    </div>
  );
}
