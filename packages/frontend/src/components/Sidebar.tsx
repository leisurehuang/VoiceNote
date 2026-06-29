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
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('vn-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      /* ignore */
    }
    return 'auto';
  });
  const [systemLight, setSystemLight] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches,
  );

  // auto 模式下实时跟随系统主题变化
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: light)');
    const handler = (e: MediaQueryListEvent) => setSystemLight(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const resolved = theme === 'auto' ? (systemLight ? 'light' : 'dark') : theme;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  useEffect(() => {
    try {
      localStorage.setItem('vn-theme', theme);
    } catch {
      /* 无痕模式等，忽略 */
    }
  }, [theme]);

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
        <button
          className="theme-toggle"
          onClick={() => setTheme((t) => (t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto'))}
          title={
            theme === 'auto'
              ? '自动（跟随系统），点击切浅色'
              : theme === 'light'
                ? '浅色，点击切深色'
                : '深色，点击切自动'
          }
        >
          {theme === 'auto' ? '🌗' : theme === 'light' ? '☀️' : '🌙'}
        </button>
      </div>
    </aside>
  );
}
