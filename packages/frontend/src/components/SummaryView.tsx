import { useState } from 'react';
import { renderMarkdown } from '../api/markdown';

interface Props {
  summary: string | null;
  summarizing: boolean;
  onResummarize: (customPrompt?: string) => void;
  /** 保存人工编辑后的摘要正文。提供后出现「编辑正文」入口。 */
  onSaveSummary?: (text: string) => Promise<void>;
}

export function SummaryView({ summary, summarizing, onResummarize, onSaveSummary }: Props) {
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [editingBody, setEditingBody] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  async function saveBody() {
    if (!onSaveSummary) return;
    setSaving(true);
    try {
      await onSaveSummary(draft);
      setEditingBody(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="summary-wrap">
      {summarizing ? (
        <p className="muted">重新生成摘要中…</p>
      ) : editingBody ? (
        <textarea
          className="summary-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={18}
          placeholder="编辑摘要正文（支持 Markdown）…"
        />
      ) : summary ? (
        <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }} />
      ) : (
        <p className="muted">（无摘要）</p>
      )}

      <div className="summary-actions">
        {editingBody ? (
          <>
            <button className="big" onClick={saveBody} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button className="ghost" onClick={() => setEditingBody(false)} disabled={saving}>
              取消
            </button>
          </>
        ) : (
          <>
            {onSaveSummary && (
              <button
                onClick={() => {
                  setDraft(summary ?? '');
                  setEditingBody(true);
                }}
                disabled={summarizing}
              >
                编辑正文
              </button>
            )}
            <button className="ghost" onClick={() => setEditing((v) => !v)} disabled={summarizing}>
              {editing ? '收起' : '重新生成 / 自定义'}
            </button>
          </>
        )}
      </div>

      {editing && !editingBody && (
        <div className="prompt-edit">
          <textarea
            placeholder="留空用默认提示重新生成；或输入额外要求，如「只提取待办，用表格」「200 字以内」"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
          />
          <button className="big" onClick={() => onResummarize(prompt.trim() || undefined)} disabled={summarizing}>
            生成
          </button>
        </div>
      )}
    </div>
  );
}
