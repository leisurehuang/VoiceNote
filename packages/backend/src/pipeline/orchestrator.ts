import * as store from '../store/sessionStore.js';
import { audioPath, sourcePath } from '../store/sessionStore.js';
import { convertToWav, DependencyMissingError } from './ffmpeg.js';
import { transcribe } from './whisper.js';
import { generateTitle, summarize } from './summarize.js';

type Stage = (id: string) => Promise<void>;

/** 阶段 1：ffmpeg 转码 → 16kHz 单声道 wav。 */
async function convertStage(id: string): Promise<void> {
  await store.update(id, { status: 'converting', stage: '转码中（ffmpeg）', progress: 0.02 });
  const { durationMs } = await convertToWav(sourcePath(id), audioPath(id));
  await store.update(id, { durationMs, progress: 0.05 });
  store.emitter(id)?.emit('stage', { stage: 'transcribing' });
}

/** 阶段 2：whisper.cpp 转写，逐段实时广播。 */
async function transcribeStage(id: string): Promise<void> {
  await store.update(id, { status: 'transcribing', stage: '转写中（whisper）', progress: 0.1 });
  // 音频总时长（毫秒）：convertStage 已写入 meta。实时会话或读取失败时为 null/0。
  const durationMs = store.get(id)?.durationMs ?? 0;
  let count = 0;
  let maxEndMs = 0; // 已转写到的最晚时间戳，用于估算进度
  const segments = await transcribe(audioPath(id), (seg) => {
    count++;
    store.emitter(id)?.emit('segment', { index: count, segment: seg });
    // 按真实已转写时长 / 总时长线性估算进度，夹在 [0.1, 0.6) 区间。
    if (seg.endMs > maxEndMs) maxEndMs = seg.endMs;
    if (durationMs > 0) {
      const ratio = Math.min(Math.max(maxEndMs / durationMs, 0), 1);
      const progress = Math.min(0.1 + 0.5 * ratio, 0.6 - Number.EPSILON);
      void store.update(id, { progress });
    }
  });
  store.writeTranscript(id, segments);
  await store.update(id, { progress: 0.6 });
  store.emitter(id)?.emit('stage', { stage: 'summarizing' });
}

/** 阶段 3：LLM 生成摘要，token 实时广播。 */
async function summarizeStage(id: string): Promise<void> {
  const segments = store.readTranscript(id);
  const transcript = segments.map((s) => s.text).join('\n');
  if (!transcript.trim()) {
    await store.update(id, { progress: 0.98 });
    return;
  }
  await store.update(id, { status: 'summarizing', stage: '生成摘要（LLM）', progress: 0.7 });
  const { text, model } = await summarize(transcript, {
    onToken: (delta) => store.emitter(id)?.emit('summary-token', { token: delta }),
  });
  store.writeSummary(id, text, model);

  // 根据内容自动起一个简短标题，替换默认的「未命名」。失败不影响整体流程。
  try {
    const title = await generateTitle(transcript);
    if (title) await store.update(id, { title });
  } catch {
    /* 标题生成失败可忽略 */
  }

  await store.update(id, { progress: 0.98 });
}

const stages: Stage[] = [convertStage, transcribeStage, summarizeStage];

/**
 * 串行跑完整流水线，每步更新 meta 并广播事件。
 * 不抛错——任何阶段失败都捕获并落成 error 态，便于前端展示与重跑。
 */
export async function runPipeline(id: string): Promise<void> {
  if (!store.get(id)) return;
  try {
    for (const stage of stages) {
      await stage(id);
    }
    await store.update(id, { status: 'done', stage: '完成', progress: 1, error: null });
    store.emitter(id)?.emit('done', { id });
  } catch (e) {
    const msg =
      e instanceof DependencyMissingError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e);
    await store.update(id, { status: 'error', stage: '出错', error: msg });
    // 注意：不能用 'error' 事件名——EventEmitter 在无监听时会把 'error' 当致命错误抛出。
    store.emitter(id)?.emit('failed', { id, error: msg });
  }
}
