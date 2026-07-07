import { existsSync, unlinkSync } from 'node:fs';
import { config, which } from '../config.js';
import type { TranscriptSegment } from '../store/sessionStore.js';
import { run } from '../util/exec.js';
import { DependencyMissingError } from './ffmpeg.js';

// sherpa-onnx 引擎封装：说话人分离（pyannote 分段 + 3D-Speaker 嵌入聚类）+ Paraformer 中文 ASR。
// 与 whisper.ts 同构（spawn CLI），但 diarization 跑完才出段，ASR 走「按 speaker 段切片逐段转写」。
// 注：ASR CLI 的确切参数/输出格式以实测为准（动代码前先跑一次 --help + 样例 wav）。

interface DiarTurn {
  speaker: number;
  startMs: number;
  endMs: number;
}

/** 解析 diarization stdout 一行：`0.000 -- 2.530 speaker_00`。 */
export function parseSherpaLine(line: string): DiarTurn | null {
  const m = line.match(/^([\d.]+)\s*--\s*([\d.]+)\s+speaker_(\d+)/);
  if (!m) return null;
  const startMs = Math.round(Number(m[1]) * 1000);
  const endMs = Math.round(Number(m[2]) * 1000);
  const speaker = Number(m[3]);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(speaker)) return null;
  return { speaker, startMs, endMs };
}

/** 解析 stderr 进度行：`progress 12.50%` → 0.125。 */
export function parseProgress(line: string): number | null {
  const m = line.match(/^progress\s+([\d.]+)%/);
  if (!m) return null;
  const v = Number(m[1]) / 100;
  return Number.isFinite(v) ? v : null;
}

/** 检查 sherpa-onnx 二进制 + 模型是否就绪；缺任一抛 DependencyMissingError。 */
export function checkSherpaDeps(): void {
  const s = config.sherpa;
  if (!existsSync(s.diarizationCli)) throw new DependencyMissingError('sherpa-onnx-offline-speaker-diarization');
  if (!existsSync(s.asrCli)) throw new DependencyMissingError('sherpa-onnx-offline（ASR 二进制）');
  if (!existsSync(s.segmentationModel)) throw new DependencyMissingError('sherpa 分段模型（pyannote）');
  if (!existsSync(s.embeddingModel)) throw new DependencyMissingError('sherpa 说话人嵌入模型（3D-Speaker）');
  if (!existsSync(s.asrModel)) throw new DependencyMissingError('sherpa ASR 模型（Paraformer）');
  if (!existsSync(s.asrTokens)) throw new DependencyMissingError('sherpa ASR tokens.txt');
}

/** 跑说话人分离 CLI，返回按开始时间排序的 speaker 段（无文本）。进度从 stderr 解析推送。 */
async function runDiarization(wavPath: string, onProgress?: (ratio: number) => void): Promise<DiarTurn[]> {
  const s = config.sherpa;
  const args = [
    `--segmentation.pyannote-model=${s.segmentationModel}`,
    `--embedding.model=${s.embeddingModel}`,
    // diarization CLI 无全局 --num-threads，需分别给分段/嵌入两路
    `--segmentation.num-threads=${s.threads}`,
    `--embedding.num-threads=${s.threads}`,
  ];
  if (s.numSpeakers && s.numSpeakers > 0) {
    args.push(`--clustering.num-clusters=${s.numSpeakers}`);
  } else {
    args.push(`--clustering.cluster-threshold=${s.clusterThreshold}`);
  }
  args.push(wavPath);

  const res = await run(s.diarizationCli, args, {
    onStderr: (line) => {
      const p = parseProgress(line);
      if (p != null) onProgress?.(p);
    },
  });
  const turns: DiarTurn[] = [];
  for (const line of res.stdout.split('\n')) {
    const t = parseSherpaLine(line);
    if (t) turns.push(t);
  }
  turns.sort((a, b) => a.startMs - b.startMs);
  return turns;
}

/** ffmpeg 按 [startMs, endMs] 切出 16kHz 单声道 wav 切片（供逐段 ASR）。 */
async function sliceWav(src: string, startMs: number, endMs: number, outPath: string): Promise<void> {
  const bin = config.ffmpegBin ?? which('ffmpeg');
  if (!bin) throw new DependencyMissingError('ffmpeg');
  const startSec = (startMs / 1000).toFixed(3);
  const durSec = Math.max(0, (endMs - startMs) / 1000).toFixed(3);
  await run(bin, ['-y', '-ss', startSec, '-i', src, '-t', durSec, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outPath]);
}

/**
 * 对一个 wav 跑 Paraformer ASR，返回纯文本。
 * 实测 stdout：先是一堆 debug（config dump / "Started" / "Done!"），然后一行 JSON 结果：
 *   {"text": "...", "timestamps": [...], "tokens": [...], ...}
 * Paraformer greedy_search 不出词级时间戳（timestamps 为空），故只取 text。
 */
async function runAsr(wavPath: string): Promise<string> {
  const s = config.sherpa;
  const args = [
    `--paraformer=${s.asrModel}`,
    `--tokens=${s.asrTokens}`,
    `--num-threads=${s.threads}`,
    '--decoding-method=greedy_search',
    wavPath,
  ];
  const res = await run(s.asrCli, args);
  // 实测：sherpa-onnx-offline 把 config dump 和结果 JSON 都打到 stderr（stdout 为空）。
  // 在 stderr 里找 {"text": ...} 行；Paraformer greedy_search 不出词级时间戳。
  for (const line of res.stderr.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{') && trimmed.includes('"text"')) {
      try {
        const obj = JSON.parse(trimmed) as { text?: unknown };
        if (typeof obj.text === 'string') return obj.text;
      } catch {
        /* 非合法 JSON，继续找下一行 */
      }
    }
  }
  return '';
}

/**
 * 批处理/finalize 入口：diarization 切出 speaker 段 → 逐段 ffmpeg 切片 + Paraformer ASR。
 * 段天然带 speaker（切片即 speaker 段），无需时间重叠合并。进度由 diarization 的 stderr 驱动。
 */
export async function transcribeWithDiarization(
  wavPath: string,
  opts: { onSegment?: (seg: TranscriptSegment) => void; onProgress?: (ratio: number) => void } = {},
): Promise<TranscriptSegment[]> {
  checkSherpaDeps();
  const turns = await runDiarization(wavPath, opts.onProgress);
  if (!turns.length) return [];

  const segments: TranscriptSegment[] = [];
  for (const turn of turns) {
    const segWav = `${wavPath}.spk-${turn.speaker}-${turn.startMs}.wav`;
    try {
      await sliceWav(wavPath, turn.startMs, turn.endMs, segWav);
      const text = (await runAsr(segWav)).trim();
      if (text) {
        const seg: TranscriptSegment = {
          text,
          startMs: turn.startMs,
          endMs: turn.endMs,
          speaker: turn.speaker,
        };
        segments.push(seg);
        opts.onSegment?.(seg);
      }
    } finally {
      try {
        unlinkSync(segWav);
      } catch {
        /* ignore */
      }
    }
  }
  // sherpa 聚类编号可能不从 0 起、不连续（如 speaker_01, speaker_03），重映射成连续 0-based
  const idMap = new Map<number, number>();
  let nextId = 0;
  for (const seg of segments) {
    if (seg.speaker != null) {
      const mapped = idMap.get(seg.speaker);
      if (mapped == null) {
        idMap.set(seg.speaker, nextId);
        seg.speaker = nextId;
        nextId++;
      } else {
        seg.speaker = mapped;
      }
    }
  }
  return segments;
}

/**
 * 实时单句转写：只跑 Paraformer ASR（不做 diarization，speaker 在 finalize 阶段回填）。
 * Paraformer 整段返回纯文本无内部时间戳；用 opts.durationMs 补 endMs（调用方传单句时长）。
 */
export async function transcribeASROnly(
  wavPath: string,
  opts: { durationMs?: number } = {},
): Promise<TranscriptSegment[]> {
  checkSherpaDeps();
  const text = (await runAsr(wavPath)).trim();
  if (!text) return [];
  return [{ text, startMs: 0, endMs: opts.durationMs ?? 0 }];
}
