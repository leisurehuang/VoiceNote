import { cn } from '../../cn';

interface Props {
  /** 0–1 */
  value: number;
  tone?: 'accent' | 'voice' | 'danger' | 'ok';
  className?: string;
}

/** 统一进度条:替代 .bar / .progress-bar / .model-bar 三套实现 */
export function ProgressBar({ value, tone = 'accent', className }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className={cn('progressbar', `progressbar-${tone}`, className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progressbar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
