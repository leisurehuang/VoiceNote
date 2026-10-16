import { exportMarkdownText, exportMarkdownUrl } from '../api/client';
import { Button } from './ui/Button';
import { toast, toastError } from './ui/Toast';

export function ExportBar({ id }: { id: string }) {
  async function copy() {
    try {
      const md = await exportMarkdownText(id);
      await navigator.clipboard.writeText(md);
      toast('已复制到剪贴板');
    } catch {
      toastError('复制失败，请检查剪贴板权限');
    }
  }

  return (
    <div className="export-bar">
      <Button variant="ghost" onClick={copy}>
        复制 Markdown
      </Button>
      <a className="ghost" href={exportMarkdownUrl(id)} download>
        下载 .md
      </a>
    </div>
  );
}
