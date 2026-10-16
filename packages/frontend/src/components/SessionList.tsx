import { useState } from 'react';
import { AudioLines, SearchX, Trash2 } from 'lucide-react';
import type { SessionMeta } from '../api/types';
import { StatusDot } from './ui/StatusDot';
import { IconButton } from './ui/IconButton';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { EmptyState } from './ui/EmptyState';

const STATUS_LABEL: Record<string, string> = {
  uploaded: '已上传',
  converting: '转码中',
  transcribing: '转写中',
  summarizing: '摘要中',
  done: '完成',
  error: '出错',
};

/** 侧栏行第二行 meta：短日期 + 时长（进行中的会话显示状态）。 */
function rowMeta(s: SessionMeta): string {
  const d = new Date(s.createdAt);
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  if (s.status !== 'done' && s.status !== 'error') return `${md} · ${STATUS_LABEL[s.status] ?? s.status}`;
  const dur = s.durationMs ? ` · ${Math.max(1, Math.round(s.durationMs / 60000))} 分钟` : '';
  return md + dur;
}

export function SessionList({
  sessions,
  activeId,
  onOpen,
  onDelete,
  searching = false,
}: {
  sessions: SessionMeta[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void | Promise<void>;
  /** 搜索无结果与「还没有会话」是两种空态 */
  searching?: boolean;
}) {
  const [pending, setPending] = useState<SessionMeta | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!sessions.length) {
    return searching ? (
      <EmptyState icon={SearchX} title="没有匹配的会话" hint="换个关键词试试" />
    ) : (
      <EmptyState icon={AudioLines} title="还没有会话" hint="录一段、上传音频，或开实时转写" />
    );
  }

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
          <li
            key={s.id}
            className={'row' + (activeId === s.id ? ' selected' : '')}
            role="button"
            tabIndex={0}
            aria-label={`${s.title || '未命名'}（${STATUS_LABEL[s.status] ?? s.status}）`}
            onClick={() => onOpen(s.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen(s.id);
              }
            }}
          >
            <StatusDot status={s.status} />
            <span className="row-main">
              <span className="row-title">{s.title || '未命名'}</span>
              <span className="row-meta">{rowMeta(s)}</span>
            </span>
            <IconButton
              label="删除"
              size="sm"
              tone="danger"
              className="row-del"
              disabled={deleting}
              onClick={(e) => {
                e.stopPropagation();
                setPending(s);
              }}
            >
              <Trash2 size={13} />
            </IconButton>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pending !== null}
        title="删除会话？"
        message={
          pending && (
            <>
              确认删除「<b>{pending.title || '未命名'}</b>」？其录音、逐字稿和摘要将被永久删除，无法恢复。
            </>
          )
        }
        confirmText="确认删除"
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => {
          if (!deleting) setPending(null);
        }}
      />
    </>
  );
}
