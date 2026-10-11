import { readFileSync } from 'node:fs';
import { config } from '../config.js';
import type { TranscriptSegment } from '../store/sessionStore.js';

/** 从 16k wav 头部解析时长（writeWav/ffmpeg 产出的标准 44 字节头）。 */
function wavDurationMs(path: string): number {
  try {
    const buf = readFileSync(path);
    if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF') return 0;
    const sampleRate = buf.readUInt32LE(24);
    const byteRate = buf.readUInt32LE(28) || sampleRate * 2;
    // data 块大小在标准头位于 40；非标准头退回用文件大小估算
    const dataSize = buf.toString('latin1', 36, 40) === 'data' ? buf.readUInt32LE(40) : buf.length - 44;
    if (!sampleRate || !dataSize) return 0;
    return Math.round((dataSize / byteRate) * 1000);
  } catch {
    return 0;
  }
}

/**
 * 云端 ASR（OpenAI 兼容 /audio/transcriptions 形态，如硅基流动 FunAudioLLM/SenseVoiceSmall）。
 * 上传 16k wav，返回整段文本（无时间戳/说话人）→ 单段输出，endMs 用 wav 时长补。
 */
export async function transcribeCloudApi(
  wavPath: string,
  opts: { onSegment?: (seg: TranscriptSegment) => void } = {},
): Promise<TranscriptSegment[]> {
  const { baseUrl, apiKey, model } = config.asrApi;
  const url = `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;
  let res: Response;
  try {
    const fd = new FormData();
    fd.append('file', new Blob([readFileSync(wavPath)], { type: 'audio/wav' }), 'audio.wav');
    fd.append('model', model);
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
      signal: AbortSignal.timeout(300_000), // 长音频转写耗时，给足 5 分钟
    });
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    throw new Error(
      `无法连接云端转写服务（${url}）。请检查网络与 设置 → 转写引擎 → 云端 API 的地址/密钥。原因：${cause}`,
    );
  }

  if (!res.ok) {
    throw new Error(`云端转写服务返回 ${res.status}：${(await res.text()).slice(0, 300)}`);
  }

  let text = '';
  try {
    const j = (await res.json()) as { text?: string };
    text = (j.text ?? '').trim();
  } catch {
    throw new Error('云端转写服务返回了无法解析的内容');
  }

  const durationMs = wavDurationMs(wavPath);
  const seg: TranscriptSegment = { text, startMs: 0, endMs: durationMs };
  opts.onSegment?.(seg);
  return text ? [seg] : [];
}
