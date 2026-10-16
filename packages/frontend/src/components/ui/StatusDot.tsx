import { cn } from '../../cn';

/** 会话状态点:done 绿 / running 琥珀呼吸 / error 红 / 其他(queued/uploaded)灰空心 */
export function StatusDot({ status }: { status: string }) {
  return <span className={cn('status-dot', `st-${status}`)} aria-hidden />;
}
