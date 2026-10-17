import { cn } from '../../cn';

interface SkeletonProps {
  w?: number | string;
  h?: number;
  r?: number;
  className?: string;
}

/** 骨架块:加载占位。组合出页面级骨架见下方导出。 */
export function Skeleton({ w, h = 12, r = 6, className }: SkeletonProps) {
  return (
    <span
      className={cn('skeleton', className)}
      style={{ width: w, height: h, borderRadius: r }}
      aria-hidden
    />
  );
}

/** 详情页骨架:大标题 + 段落 */
export function DetailSkeleton() {
  return (
    <div className="skeleton-group">
      <Skeleton w="60%" h={24} r={8} />
      <Skeleton w="35%" h={12} />
      <div className="skeleton-paras">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} w={`${92 - (i % 3) * 12}%`} h={12} />
        ))}
      </div>
    </div>
  );
}

/** 列表骨架 */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-group">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row">
          <Skeleton w={8} h={8} r={4} />
          <Skeleton w={`${70 - (i % 3) * 10}%`} h={12} />
        </div>
      ))}
    </div>
  );
}

/** 设置页骨架:三张卡 */
export function SettingsSkeleton() {
  return (
    <div className="skeleton-group">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="skeleton-card">
          <Skeleton w="28%" h={14} />
          <Skeleton w="82%" h={12} />
          <Skeleton w="64%" h={12} />
        </div>
      ))}
    </div>
  );
}
