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
  onDelete: (id: string) => void;
}) {
  if (!sessions.length) return <p className="muted">还没有会话，录一段或上传一个试试。</p>;
  return (
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
            onClick={(e) => {
              e.stopPropagation();
              onDelete(s.id);
            }}
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
