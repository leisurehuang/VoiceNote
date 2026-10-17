import type { LucideIcon } from 'lucide-react';
import { cn } from '../../cn';

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
  icon?: LucideIcon;
}

interface Props<V extends string> {
  options: SegmentedOption<V>[];
  value: V;
  onChange: (v: V) => void;
  disabled?: boolean;
  /** 非选中项悬停提示(如 busy 锁原因) */
  lockedHint?: string;
  className?: string;
}

/** 分段控件:tab 切换的统一外观,支持图标。 */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  disabled,
  lockedHint,
  className,
}: Props<V>) {
  return (
    <div className={cn('segmented', className)} role="tablist">
      {options.map((o) => {
        const Icon = o.icon;
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={cn('seg', active && 'active')}
            onClick={() => onChange(o.value)}
            disabled={disabled}
            title={disabled && lockedHint ? lockedHint : undefined}
          >
            {Icon && <Icon size={14} aria-hidden />}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
