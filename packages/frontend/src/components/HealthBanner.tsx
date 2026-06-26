import type { HealthStatus } from '../api/types';

export function HealthBanner({ health }: { health: HealthStatus | null }) {
  if (!health || health.ok) return null;
  const missing: string[] = [];
  if (!health.ffmpeg) missing.push('ffmpeg');
  if (!health.whisperCli) missing.push('whisper-cli');
  if (!health.whisperModel) missing.push('whisper 模型');
  if (!health.ollama) missing.push('Ollama');
  return (
    <div className="alert warn">
      ⚠️ 缺少依赖：{missing.join('、')}。在项目根目录运行 <code>npm run setup</code> 安装；
      Ollama 用 <code>ollama serve</code> 启动。
    </div>
  );
}
