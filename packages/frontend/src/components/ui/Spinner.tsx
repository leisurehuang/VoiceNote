/** 旋转指示环:按钮等待态、阶段进行中等 */
export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="加载中" />;
}
