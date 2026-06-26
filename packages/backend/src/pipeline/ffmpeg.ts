import { config, which } from '../config.js';
import { run } from '../util/exec.js';

/** 外部二进制（ffmpeg / whisper-cli）缺失时抛出，路由层据此返回 503。 */
export class DependencyMissingError extends Error {
  readonly dep: string;
  constructor(dep: string) {
    super(`依赖缺失：${dep}（请运行 npm run setup）`);
    this.name = 'DependencyMissingError';
    this.dep = dep;
  }
}

/** 用 ffprobe 读时长（毫秒），读不到返回 0。 */
export async function probeDurationMs(file: string): Promise<number> {
  const bin = config.ffprobeBin ?? which('ffprobe');
  if (!bin) return 0;
  try {
    const res = await run(bin, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file,
    ]);
    const s = parseFloat(res.stdout.trim());
    return Number.isFinite(s) ? Math.round(s * 1000) : 0;
  } catch {
    return 0;
  }
}

/**
 * 把任意音频（浏览器录的 webm/opus、Safari 的 mp4、mp3、m4a 等）
 * 转成 whisper.cpp 要求的 16kHz 单声道 PCM WAV。
 */
export async function convertToWav(input: string, output: string): Promise<{ durationMs: number }> {
  const bin = config.ffmpegBin ?? which('ffmpeg');
  if (!bin) throw new DependencyMissingError('ffmpeg');
  await run(bin, [
    '-y',
    '-i', input,
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'pcm_s16le',
    output,
  ]);
  const durationMs = await probeDurationMs(output);
  return { durationMs };
}
