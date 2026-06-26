import { useState } from 'react';
import { renderMarkdown } from '../api/markdown';

interface Props {
  summary: string | null;
  summarizing: boolean;
  onResummarize: (customPrompt?: string) => void;
}

export function SummaryView({ summary, summarizing, onResummarize }: Props) {
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState('');

  return (
    <div className="summary-wrap">
      {summarizing ? (
        <p className="muted">重新生成摘要中…</p>
      ) : summary ? (
        <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }} />
      ) : (
        <p className="muted">（无摘要）</p>
      )}

      <div className="summary-actions">
        <button className="ghost" onClick={() => setEditing((v) => !v)} disabled={summarizing}>
          {editing ? '收起' : '重新生成 / 自定义'}
        </button>
      </div>

      {editing && (
        <div className="prompt-edit">
          <textarea
            placeholder="留空用默认提示重新生成；或输入额外要求，如「只提取待办，用表格」「200 字以内」"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
          />
          <button onClick={() => onResummarize(prompt.trim() || undefined)} disabled={summarizing}>
            生成
          </button>
        </div>
      )}
    </div>
  );
}
