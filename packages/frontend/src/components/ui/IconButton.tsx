import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../cn';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 无障碍名称,同时作为 tooltip */
  label: string;
  children: ReactNode;
  tone?: 'default' | 'danger';
  size?: 'sm' | 'md';
}

/** 图标按钮:正方形、hover 浮起,必须传 label(aria-label + title) */
export function IconButton({
  label,
  children,
  tone = 'default',
  size = 'md',
  className,
  type,
  ...rest
}: Props) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(
        'icon-btn',
        size === 'sm' && 'icon-btn-sm',
        tone === 'danger' && 'icon-btn-danger',
        className,
      )}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}
