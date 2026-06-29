import { useEffect, useState } from 'react';
import type { HealthStatus, SessionMeta } from '../api/types';
import { SessionList } from './SessionList';
import { searchSessions } from '../api/client';

interface Props {
  sessions: SessionMeta[];
  activeId: string | null;
  health: HealthStatus | null;
  disabled?: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onSettings: () => void;
  onDelete: (id: string) => void;
}

export function Sidebar({ sessions, activeId, health, disabled = false, onNew, onOpen, onSettings, onDelete }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SessionMeta[] | null>(null);

  // 搜索：300ms 防抖；空关键词回退到全量列表
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      searchSessions(q).then(setResults).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const shown = results ?? sessions;

  return (
    <aside className="sidebar">
      {/* 顶部拖拽区（让出交通灯位置） + 应用名 */}
      <div className="sidebar-grip">
        <span className="grip-title">Voice Notes</span>
      </div>

      <div className="sidebar-body">
        <div className="sidebar-top">
          <button
            className={'new-btn' + (activeId === null ? ' is-active' : '')}
            onClick={onNew}
            disabled={disabled}
            title="新建会话"
          >
            <span className="new-btn-plus">＋</span>
            <span>新建</span>
          </button>

          <div className="search-box">
            <input
              type="search"
              placeholder="搜索标题 / 摘要 / 逐字稿…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="搜索会话"
            />
          </div>
        </div>

        <div className="sidebar-list">
          <div className="nav-label">历史</div>
          <SessionList sessions={shown} activeId={activeId} onOpen={onOpen} onDelete={onDelete} />
        </div>
        <button className="settings-btn" onClick={onSettings} disabled={disabled} title="模型配置">
          ⚙ 设置
        </button>
      </div>

      <div className="sidebar-foot">
        {health && !health.ok ? (
          <span className="foot-warn" title="部分依赖未就绪">
            ⚠ 依赖未就绪
          </span>
        ) : (
          <span className="foot-ok" title="所有依赖就绪">
            ● 就绪
          </span>
        )}
      </div>
    </aside>
  );
}
