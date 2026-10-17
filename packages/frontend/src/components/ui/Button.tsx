import type { ButtonHTMLAttributes } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../../cn';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  /** 置灰并显示旋转指示,完成后自动恢复 */
  loading?: boolean;
}

/** 统一按钮:variant 语义 = primary 主操作 / secondary 常规 / ghost 次要 / danger 破坏性 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  type,
  ...rest
}: Props) {
  return (
    <button
      type={type ?? 'button'}
      className={cn('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <LoaderCircle size={14} className="btn-spin" aria-hidden />}
      {children}
    </button>
  );
}
