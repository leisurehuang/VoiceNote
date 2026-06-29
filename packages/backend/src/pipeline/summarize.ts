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
  let systemPrompt = opts.systemPrompt ?? config.llm.summarySystemPrompt;
  if (config.whisper.glossary.length) {
    systemPrompt +=
      '\n\n文中可能出现的专有名词（请正确沿用、不要改写）：' + config.whisper.glossary.join('、');
  }
  const text = await postChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: transcript },
    ],
    { model, stream: !!opts.onToken, onToken: opts.onToken },
  );
  return { text, model };
}

export interface IncrementalSummarizeOptions {
  /** 覆盖增量摘要默认模型。 */
  model?: string;
  /** 覆盖增量摘要默认 system prompt。 */
  systemPrompt?: string;
  /** 流式回调：每收到一个 token 片段就触发，经 WebSocket 实时推送。 */
  onToken?: (delta: string) => void;
}

/**
 * 实时增量摘要（滚动更新）：把「上一版摘要 + 自上次以来的新增转写」合并为更新后的完整摘要。
 * 复用 postChat 流式；prevSummary 为空（首版）时按新增文本从头生成。
 */
export async function summarizeIncremental(
  prevSummary: string,
  newText: string,
  opts: IncrementalSummarizeOptions = {},
): Promise<SummarizeResult> {
  const model = opts.model ?? config.llm.incrementalModel;
  const systemPrompt = opts.systemPrompt ?? config.llm.incrementalSummarySystemPrompt;
  const draft = prevSummary.trim() ? prevSummary.trim() : '（暂无）';
  const userContent = `【当前已有草稿】\n${draft}\n\n【本次新增转写文本】\n${newText}`;
  const text = await postChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
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

export interface TodoItem {
  text: string;
  owner?: string;
  due?: string;
}

const TODOS_SYSTEM =
  '你从会议转写中抽取「待办事项」。只输出一个 JSON 数组，不要任何解释、不要 markdown 代码块、不要前后缀文字。' +
  '每个元素形如 {"text":"任务内容","owner":"负责人（可选）","due":"时限（可选）"}。' +
  '没有待办就输出 []。任务表述精炼、忠于原文。';

/** 从转写抽取结构化待办事项（复用 postChat 非流式，容错解析 JSON）。 */
export async function extractTodos(transcript: string, model?: string): Promise<TodoItem[]> {
  const m = model ?? config.llm.model;
  const raw = await postChat(
    [
      { role: 'system', content: TODOS_SYSTEM },
      { role: 'user', content: transcript.slice(0, 6000) },
    ],
    { model: m, stream: false },
  );
  // 容错：提取首个 JSON 数组再解析，模型偶尔会包 markdown 代码块
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0] ?? '[]') as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((it) => it as { text?: unknown; owner?: unknown; due?: unknown })
      .filter((it) => typeof it.text === 'string' && it.text.trim())
      .map((it) => {
        const item: TodoItem = { text: String(it.text).trim() };
        if (typeof it.owner === 'string' && it.owner.trim()) item.owner = it.owner.trim();
        if (typeof it.due === 'string' && it.due.trim()) item.due = it.due.trim();
        return item;
      });
  } catch {
    return [];
  }
}
