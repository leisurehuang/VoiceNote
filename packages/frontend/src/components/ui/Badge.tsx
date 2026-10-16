import type { ReactNode } from 'react';
import { cn } from '../../cn';

interface Props {
  tone?: 'ok' | 'warn' | 'danger' | 'accent' | 'neutral';
  children: ReactNode;
}

/** 徽章:引擎就绪、使用中、负责人/时限等小标签 */
export function Badge({ tone = 'neutral', children }: Props) {
  return <span className={cn('badge', `badge-${tone}`)}>{children}</span>;
}
