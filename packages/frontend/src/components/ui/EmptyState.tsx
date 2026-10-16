import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
}

/** 空状态:图标 + 标题 + 提示 + 可选动作(如「新建会话」按钮) */
export function EmptyState({ icon: Icon, title, hint, action }: Props) {
  return (
    <div className="empty-state">
      {Icon && <Icon size={26} strokeWidth={1.75} className="empty-icon" aria-hidden />}
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}
