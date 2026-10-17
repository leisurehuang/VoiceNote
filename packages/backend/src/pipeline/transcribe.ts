import { config } from '../config.js';
import type { TranscriptSegment } from '../store/sessionStore.js';
import { transcribe as transcribeWhisper, transcribeWavFile as whisperWavFile } from './whisper.js';
import { transcribeWithDiarization, transcribeASROnly } from './sherpa.js';
import { transcribeCloudApi } from './cloudAsr.js';

export interface TranscribeOpts {
  onSegment?: (seg: TranscriptSegment) => void;
  /** sherpa 专用：diarization stderr 的 progress 0..1。whisper 无此回调（走 stdout 流式估算）。 */
  onProgress?: (ratio: number) => void;
}

/**
 * 批处理转写分发：按当前激活引擎选 whisper / sherpa / 云端 API。
 * - whisper：边跑边经 onSegment 流式推送段（无 speaker）。
 * - sherpa：diarization + 逐段 ASR，跑完批量出带 speaker 段；进度经 onProgress。
 * - api：整段上传云端，返回单段文本（无时间戳/说话人）。
 */
export async function transcribeWithEngine(
  wavPath: string,
  opts: TranscribeOpts = {},
): Promise<TranscriptSegment[]> {
  if (config.transcription.engine === 'sherpa') {
    return transcribeWithDiarization(wavPath, opts);
  }
  if (config.transcription.engine === 'api') {
    return transcribeCloudApi(wavPath, opts);
  }
  return transcribeWhisper(wavPath, opts.onSegment);
}

/**
 * 实时单句转写分发（云端引擎为逐句 HTTP 调用，串行队列限流；均不出 speaker）。
 * - whisper：返回句内多段时间戳段。
 * - sherpa / api：整段返回单句文本，endMs 用 durationMs 补。
 */
export async function transcribeUtteranceWithEngine(
  wavPath: string,
  opts: { language?: string; durationMs?: number } = {},
): Promise<TranscriptSegment[]> {
  if (config.transcription.engine === 'sherpa') {
    return transcribeASROnly(wavPath, { durationMs: opts.durationMs });
  }
  if (config.transcription.engine === 'api') {
    return transcribeCloudApi(wavPath);
  }
  return whisperWavFile(wavPath, { language: opts.language });
}

/**
 * 把逐字稿段拼成喂给 LLM 的文本：任一段有 speaker 时按说话人标注（说话人A：…），否则纯文本拼接。
 * 原始 speaker id 可能因聚类不连续，按首次出现顺序重映射成连续字母（A/B/C…），便于人读与模型理解。
 */
export function transcriptForLLM(segments: TranscriptSegment[]): string {
  if (!segments.some((s) => s.speaker != null)) {
    return segments.map((s) => s.text).join('\n');
  }
  const labelMap = new Map<number, string>();
  let next = 0;
  const label = (spk: number): string => {
    let l = labelMap.get(spk);
    if (l == null) {
      l = String.fromCharCode(65 + next++);
      labelMap.set(spk, l);
    }
    return l;
  };
  return segments
    .map((s) => (s.speaker != null ? `说话人${label(s.speaker)}：${s.text}` : s.text))
    .join('\n');
}
