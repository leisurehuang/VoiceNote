/**
 * 听写流式上传客户端：PCM 块串行上传后端 /api/dictation/stream，边录边转写。
 * 块上传严格保序（VAD 依赖时序），失败即置 failed 并回调 onError（由上层决定取消录音）。
 *
 * 生命周期：createStream() 即发起 start → push() 累积并按 ~1s 自动冲块 →
 * finish() 冲尾块 + 排空 + 拉取成稿；cancel() 尽力通知服务端丢弃。
 */
const START_TIMEOUT_MS = 8000;
const CHUNK_TIMEOUT_MS = 30000;
const FINISH_TIMEOUT_MS = 600000; // 收尾要排空剩余转写 + 润色，长录音给足 10 分钟
/** 每 ~1s（16000 采样）攒一块上传：32KB/块。 */
const CHUNK_SAMPLES = 16000;

function concatSamples(arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Int16Array(n);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/**
 * @param {{backendUrl: string, log: Function, onError: Function, onChars: Function}} opts
 *   onError(err) 上传链路失败（start/chunk）；onChars(n) 服务端已识别字数变化
 * @returns 流对象：{ push, finish, cancel }；finish 返回 { ok, status, body }
 */
function createStream(opts) {
  const { backendUrl, log = () => {}, onError, onChars } = opts;
  const s = {
    id: null,
    ready: null, // start 完成 promise（失败不 reject，错误进 failed）
    chain: Promise.resolve(), // 块上传串行链
    failed: null, // 首个错误（Error）
    chars: 0,
    pending: [], // 待上传 PCM 块
    pendingSamples: 0,
  };

  const fail = (e) => {
    if (s.failed) return;
    s.failed = e;
    log('听写流上传失败：' + (e && e.message ? e.message : e));
    onError?.(e);
  };

  s.ready = (async () => {
    try {
      const res = await fetch(`${backendUrl}/api/dictation/stream/start`, {
        method: 'POST',
        signal: AbortSignal.timeout(START_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`后端返回 ${res.status}`);
      const r = await res.json();
      s.id = r.streamId;
    } catch (e) {
      fail(e);
    }
  })();

  /** 把攒到的块串行上传。 */
  s.flush = () => {
    if (!s.pending.length) return;
    if (s.failed) {
      s.pending = [];
      s.pendingSamples = 0;
      return;
    }
    const pcm = concatSamples(s.pending);
    s.pending = [];
    s.pendingSamples = 0;
    const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    s.chain = s.chain
      .then(async () => {
        await s.ready;
        if (s.failed || s.id == null) return;
        const res = await fetch(`${backendUrl}/api/dictation/stream/${s.id}/chunk`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: bytes,
          signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
        });
        if (!res.ok) {
          const r = await res.json().catch(() => ({}));
          throw new Error(r.error || `后端返回 ${res.status}`);
        }
        const r = await res.json();
        if (typeof r.chars === 'number' && r.chars > 0) {
          s.chars = r.chars;
          onChars?.(r.chars);
        }
      })
      .catch(fail);
  };

  /** 累积一块录音 PCM（Int16Array 视图，内部拷贝进 concat，不持有调用方缓冲）。 */
  s.push = (arr) => {
    if (s.failed) return;
    s.pending.push(arr);
    s.pendingSamples += arr.length;
    if (s.pendingSamples >= CHUNK_SAMPLES) s.flush();
  };

  /** 冲尾块 → 排空 → 拉成稿。返回 { ok, status, body }；链路错误直接 throw。 */
  s.finish = async () => {
    s.flush();
    await s.ready;
    await s.chain;
    if (s.failed) throw s.failed;
    const res = await fetch(`${backendUrl}/api/dictation/stream/${s.id}/finish`, {
      method: 'POST',
      signal: AbortSignal.timeout(FINISH_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) || {};
    return { ok: res.ok, status: res.status, body };
  };

  /** 丢弃：清本地状态并尽力通知服务端（失败靠其 TTL 兜底）。 */
  s.cancel = () => {
    s.pending = [];
    s.pendingSamples = 0;
    void s.ready.then(() => {
      if (s.failed || s.id == null) return;
      fetch(`${backendUrl}/api/dictation/stream/${s.id}/cancel`, {
        method: 'POST',
        signal: AbortSignal.timeout(4000),
      }).catch(() => {});
    });
  };

  return s;
}

module.exports = { createStream };
