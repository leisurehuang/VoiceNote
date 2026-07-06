// 说话人调色板 + 标签工具。speaker 是 0-based 整数（仅 sherpa-onnx 引擎产出）。

/** 把说话人编号映射成 HSL 颜色（色相 47° 间隔拉开，便于区分多人）。undefined → 中性灰。 */
export function speakerColor(speaker: number | undefined | null): string {
  if (speaker == null) return 'var(--text-2, #888)';
  return `hsl(${(speaker * 47) % 360}, 65%, 42%)`;
}

/** 0 → 'A'，1 → 'B'；undefined / 越界 → 空串。 */
export function speakerLabel(speaker: number | undefined | null): string {
  if (speaker == null || speaker < 0 || speaker > 25) return '';
  return String.fromCharCode(65 + speaker);
}
