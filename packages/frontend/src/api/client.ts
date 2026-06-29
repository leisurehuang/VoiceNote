import type { HealthStatus, SessionDetail, SessionMeta, Settings, TranscriptSegment, TodoItem, WhisperModelsResult, LlmModelsResult } from './types';

const API = '/api';

interface UploadOpts {
  title?: string;
  sourceKind: 'record' | 'upload';
}

/** 上传音频建会话；可选上传进度回调（用 XHR 实现，fetch 不支持上传进度）。 */
export function uploadAudio(
  blob: Blob,
  filename: string,
  opts: UploadOpts,
  onProgress?: (ratio: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/sessions`);
    const fd = new FormData();
    fd.append('title', opts.title ?? '');
    fd.append('sourceKind', opts.sourceKind);
    fd.append('audio', blob, filename);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
    }
    xhr.onload = () => {
      if (xhr.status === 201) resolve((JSON.parse(xhr.responseText) as { id: string }).id);
      else reject(new Error(`上传失败 ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('上传网络错误'));
    xhr.send(fd);
  });
}

export const listSessions = async (): Promise<SessionMeta[]> =>
  (await (await fetch(`${API}/sessions`)).json()) as SessionMeta[];

export const searchSessions = async (q: string): Promise<SessionMeta[]> =>
  (await (await fetch(`${API}/search?q=${encodeURIComponent(q)}`)).json()) as SessionMeta[];

export const getSession = async (id: string): Promise<SessionDetail> =>
  (await (await fetch(`${API}/sessions/${id}`)).json()) as SessionDetail;

export const processSession = (id: string): Promise<Response> =>
  fetch(`${API}/sessions/${id}/process`, { method: 'POST' });

export const resummarize = (
  id: string,
  body?: { systemPrompt?: string; model?: string },
): Promise<Response> =>
  fetch(`${API}/sessions/${id}/resummarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

export const updateSummary = (id: string, summary: string): Promise<Response> =>
  fetch(`${API}/sessions/${id}/summary`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary }),
  });

export const updateTranscript = (id: string, segments: TranscriptSegment[]): Promise<Response> =>
  fetch(`${API}/sessions/${id}/transcript`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments }),
  });

export const extractTodos = async (id: string): Promise<TodoItem[]> => {
  const r = await fetch(`${API}/sessions/${id}/todos`, { method: 'POST' });
  const j = (await r.json()) as { todos?: TodoItem[]; error?: string };
  if (!r.ok) throw new Error(j.error ?? '抽取待办失败');
  return j.todos ?? [];
};

export const getTodos = async (id: string): Promise<TodoItem[]> =>
  ((await (await fetch(`${API}/sessions/${id}/todos`)).json()) as { todos: TodoItem[] }).todos ?? [];

export const deleteSession = (id: string): Promise<Response> =>
  fetch(`${API}/sessions/${id}`, { method: 'DELETE' });

export const exportMarkdownUrl = (id: string): string => `${API}/sessions/${id}/export.md`;
export const audioUrl = (id: string): string => `${API}/sessions/${id}/audio`;
export const sourceUrl = (id: string): string => `${API}/sessions/${id}/source`;

export const getSettings = async (): Promise<Settings> =>
  (await (await fetch(`${API}/settings`)).json()) as Settings;

export const updateSettings = async (body: Settings): Promise<Settings> =>
  (await (await fetch(`${API}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })).json()) as Settings;

export const testConnection = async (body: {
  baseUrl: string;
  apiKey: string;
}): Promise<{ ok: boolean; error?: string }> =>
  (await (
    await fetch(`${API}/settings/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json()) as { ok: boolean; error?: string };
export const exportMarkdownText = (id: string): Promise<string> =>
  fetch(exportMarkdownUrl(id)).then((r) => r.text());

export const getHealth = async (): Promise<HealthStatus> =>
  (await (await fetch(`${API}/health`)).json()) as HealthStatus;

// ---------- 模型管理 ----------
export const listWhisperModels = async (): Promise<WhisperModelsResult> =>
  (await (await fetch(`${API}/models/whisper`)).json()) as WhisperModelsResult;
/** whisper 下载是 SSE 流，返回 URL 供组件 new EventSource。 */
export const whisperDownloadUrl = (name: string): string =>
  `${API}/models/whisper/download?name=${encodeURIComponent(name)}`;
export const setWhisperActive = (name: string): Promise<Response> =>
  fetch(`${API}/models/whisper/active`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
export const deleteWhisperModel = (name: string): Promise<Response> =>
  fetch(`${API}/models/whisper/${encodeURIComponent(name)}`, { method: 'DELETE' });

export const listLlmModels = async (): Promise<LlmModelsResult> =>
  (await (await fetch(`${API}/models/llm`)).json()) as LlmModelsResult;
/** ollama pull 也是 SSE 流。 */
export const llmPullUrl = (name: string): string =>
  `${API}/models/llm/pull?name=${encodeURIComponent(name)}`;
export const setLlmActive = (name: string): Promise<Response> =>
  fetch(`${API}/models/llm/active`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
export const deleteLlmModel = (name: string): Promise<Response> =>
  fetch(`${API}/models/llm/${encodeURIComponent(name)}`, { method: 'DELETE' });
