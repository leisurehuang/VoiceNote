import { useState } from 'react';
import type { SessionMeta } from '../api/types';
import { fmtDate, fmtMs } from '../format';

const STATUS_LABEL: Record<string, string> = {
  uploaded: '已上传',
  converting: '转码中',
  transcribing: '转写中',
  summarizing: '摘要中',
  done: '完成',
  error: '出错',
};

export function SessionList({
  sessions,
  onOpen,
  onDelete,
}: {
  sessions: SessionMeta[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [pending, setPending] = useState<SessionMeta | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!sessions.length) return <p className="muted">还没有会话，录一段或上传一个试试。</p>;

  async function confirmDelete() {
    if (!pending) return;
    setDeleting(true);
    try {
      await onDelete(pending.id);
    } finally {
      setDeleting(false);
      setPending(null);
    }
  }

  return (
    <>
      <ul className="session-list">
        {sessions.map((s) => (
          <li key={s.id}>
            <button className="row" onClick={() => onOpen(s.id)}>
              <span className={`badge ${s.status}`}>{STATUS_LABEL[s.status] ?? s.status}</span>
              <span className="title">{s.title || '未命名'}</span>
              <span className="muted meta">
                {fmtDate(s.createdAt)}
                {s.durationMs ? ` · ${fmtMs(s.durationMs)}` : ''}
              </span>
            </button>
            <button
              className="ghost del"
              title="删除"
              onClick={() => setPending(s)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      {pending && (
        <div
          className="modal-backdrop"
          onClick={() => !deleting && setPending(null)}
          role="presentation"
        >
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>删除会话？</h3>
            <p>
              确认删除「<b>{pending.title || '未命名'}</b>」？其录音、逐字稿和摘要将被永久删除，无法恢复。
            </p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setPending(null)} disabled={deleting}>
                取消
              </button>
              <button className="danger" onClick={confirmDelete} disabled={deleting}>
                {deleting ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
