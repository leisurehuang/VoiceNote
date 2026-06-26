import { config } from '../config.js';

export interface SummarizeOptions {
  /** 覆盖默认 system prompt（重新摘要时自定义）。 */
  systemPrompt?: string;
  /** 覆盖默认模型。 */
  model?: string;
  /** 流式回调：每收到一个 token 片段就触发，用于 SSE 实时推送。 */
  onToken?: (delta: string) => void;
}

export interface SummarizeResult {
  text: string;
  model: string;
}

interface ChatChoice {
  delta?: { content?: string };
  message?: { content?: string };
}

/** 调 OpenAI 兼容的 /chat/completions（默认本地 Ollama）。可流式可非流式。 */
export async function summarize(transcript: string, opts: SummarizeOptions = {}): Promise<SummarizeResult> {
  const model = opts.model ?? config.llm.model;
  const systemPrompt = opts.systemPrompt ?? config.llm.summarySystemPrompt;
  const url = `${config.llm.baseUrl}/chat/completions`;
  const stream = !!opts.onToken;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript },
        ],
        temperature: 0.3,
        stream,
      }),
    });
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    throw new Error(
      `无法连接摘要 LLM（${url}）。请确认已运行 \`ollama serve\` 且模型 ${model} 已 pull。原因：${cause}`,
    );
  }

  if (!res.ok) {
    throw new Error(`摘要 LLM 返回 ${res.status}：${(await res.text()).slice(0, 300)}`);
  }

  if (stream && res.body) {
    let text = '';
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]' || data.length === 0) continue;
        try {
          const json = JSON.parse(data) as { choices?: ChatChoice[] };
          const delta = json.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            text += delta;
            opts.onToken?.(delta);
          }
        } catch {
          /* 偶发不完整 JSON，跳过 */
        }
      }
    }
    return { text, model };
  }

  const json = (await res.json()) as { choices?: ChatChoice[] };
  const text = json.choices?.[0]?.message?.content ?? '';
  return { text, model };
}
