import type { HealthStatus, SessionMeta } from '../api/types';
import { SessionList } from './SessionList';

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
  return (
    <aside className="sidebar">
      {/* 顶部拖拽区（让出交通灯位置） + 应用名 */}
      <div className="sidebar-grip">
        <span className="grip-title">Voice Notes</span>
      </div>

      <div className="sidebar-body">
        <button
          className={'new-btn' + (activeId === null ? ' is-active' : '')}
          onClick={onNew}
          disabled={disabled}
          title="新建会话"
        >
          <span className="new-btn-plus">＋</span>
          <span>新建</span>
        </button>

        <div className="nav-label">历史</div>
        <SessionList sessions={sessions} activeId={activeId} onOpen={onOpen} onDelete={onDelete} />
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
