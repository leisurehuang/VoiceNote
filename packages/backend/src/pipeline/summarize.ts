import { config } from '../config.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatChoice {
  delta?: { content?: string };
  message?: { content?: string };
}

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

/** OpenAI 兼容 /chat/completions 的核心调用，可流式可非流式。 */
async function postChat(
  messages: ChatMessage[],
  opts: { model: string; stream: boolean; onToken?: (delta: string) => void },
): Promise<string> {
  const url = `${config.llm.baseUrl}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature: 0.3,
        stream: opts.stream,
      }),
    });
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    throw new Error(
      `无法连接摘要 LLM（${url}）。请确认已运行 \`ollama serve\` 且模型 ${opts.model} 已 pull。原因：${cause}`,
    );
  }

  if (!res.ok) {
    throw new Error(`摘要 LLM 返回 ${res.status}：${(await res.text()).slice(0, 300)}`);
  }

  if (opts.stream && res.body) {
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
        if (!data || data === '[DONE]') continue;
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
    return text;
  }

  const json = (await res.json()) as { choices?: ChatChoice[] };
  return json.choices?.[0]?.message?.content ?? '';
}

/** 生成结构化中文摘要。 */
export async function summarize(transcript: string, opts: SummarizeOptions = {}): Promise<SummarizeResult> {
  const model = opts.model ?? config.llm.model;
  const systemPrompt = opts.systemPrompt ?? config.llm.summarySystemPrompt;
  const text = await postChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: transcript },
    ],
    { model, stream: !!opts.onToken, onToken: opts.onToken },
  );
  return { text, model };
}

const TITLE_SYSTEM =
  '你擅长给内容起标题。根据用户提供的会议转写文本，生成一个简短的中文标题。' +
  '要求：不超过 18 个字；概括核心主题或关键事项；只输出标题文本本身；' +
  '不要书名号或引号；不要以句号结尾；不要解释或任何多余内容。';

/** 根据转写内容生成简短标题（用于替换默认「未命名」）。 */
export async function generateTitle(transcript: string, model?: string): Promise<string> {
  const m = model ?? config.llm.model;
  const raw = (
    await postChat(
      [
        { role: 'system', content: TITLE_SYSTEM },
        { role: 'user', content: transcript.slice(0, 2000) },
      ],
      { model: m, stream: false },
    )
  ).trim();

  const firstLine = raw
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean);
  const cleaned = (firstLine ?? raw)
    .replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 40) || '未命名';
}
