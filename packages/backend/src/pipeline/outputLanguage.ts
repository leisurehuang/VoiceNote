/**
 * 语音翻译口令检测（听写模式）。
 *
 * 口令由程序规则识别、不交给模型猜：用户在句首或句尾说「用英文」「翻译成日语」等口令，
 * 剥掉口令后把正文交给润色管线并指定目标输出语言。
 *
 * 主要规则：
 * - 只认句首 / 句尾位置；句尾先剥掉语气词（「吧」「好吗」「please」…）再匹配；
 * - 口令前紧跟否定词（「不要」「别」…）不视为口令；
 * - 剥掉口令后正文有效字符不足 3 个则不算（避免整句就是口令本身）；
 * - 英文口令（English / in English）在句首时后面必须跟标点，防止把正文里的英文单词误判成口令。
 */

export interface OutputLanguage {
  code: string;
  /** 中文名（用于 prompt 与 UI 展示）。 */
  label: string;
  /** 触发口令（匹配时忽略首尾空白）。 */
  commands: string[];
}

/** 内置语言与触发词（句首/句尾等价）。 */
export const BUILTIN_LANGUAGES: readonly OutputLanguage[] = [
  {
    code: 'en',
    label: '英文',
    commands: [
      '用英文', '用英语', '翻译成英文', '翻译成英语', '翻成英文', '翻成英语',
      '转成英文', '转英文', '英文输出', '输出英文', '说英文', 'English', 'in English',
    ],
  },
  {
    code: 'ja',
    label: '日文',
    commands: [
      '用日文', '用日语', '翻译成日文', '翻译成日语', '翻成日文', '翻成日语',
      '转成日文', '转日语', '日文输出', '输出日文', '说日语', 'Japanese', 'in Japanese',
    ],
  },
  {
    code: 'ko',
    label: '韩文',
    commands: [
      '用韩文', '用韩语', '翻译成韩文', '翻译成韩语', '翻成韩文', '翻成韩语',
      '转成韩文', '转韩语', '韩文输出', '输出韩文', '说韩语', 'Korean', 'in Korean',
    ],
  },
  {
    code: 'zh',
    label: '中文',
    commands: [
      '用中文', '用汉语', '翻译成中文', '翻译成汉语', '翻成中文', '翻成汉语',
      '转成中文', '转中文', '中文输出', '输出中文', '说中文', 'Chinese', 'in Chinese',
    ],
  },
  { code: 'fr', label: '法文', commands: ['用法文', '用法语', '翻译成法文', '翻译成法语', '翻成法文', '转成法文', 'French', 'in French'] },
  { code: 'de', label: '德文', commands: ['用德文', '用德语', '翻译成德文', '翻译成德语', '翻成德文', '转成德文', 'German', 'in German'] },
  { code: 'es', label: '西班牙文', commands: ['用西班牙文', '用西班牙语', '翻译成西班牙文', '翻译成西班牙语', '翻成西班牙文', '转成西班牙文', 'Spanish', 'in Spanish'] },
];

/** 句尾先剥的语气词与标点（ASR 常在句尾补「。」；可能叠加，循环剥）。 */
const TRAILING_FILLERS = [
  '好吗', '好不好', '行吗', '可以吗', '行不行', '谢谢', '拜托了', '请吧',
  '吧', '呗', '嘛', '啦', 'please', 'pls', 'thanks',
];
const TRAILING_PUNCT = '，。、,.:;；!！?？~～…―—·';

/** 口令前的否定词：紧邻出现则该口令是正文的一部分，不视为指令。 */
const NEGATIONS = ['不要', '不能', '不用', '无须', '无需', '请勿', '别', '莫', 'don\u2019t', "don't", 'dont'];

/** 句首英文口令后必须紧跟的标点（避免「English is …」被误判）。 */
const PUNCTUATION = '，。、,.:;；!！?？·…―—';

export interface DetectedCommand {
  language: OutputLanguage;
  /** 剥掉口令后的正文（保留句尾语气词剥离）。 */
  text: string;
  /** 口令出现在句首还是句尾。 */
  position: 'start' | 'end';
}

function stripTrailingFillers(text: string): string {
  let t = text.trimEnd();
  for (;;) {
    let changed = false;
    // 先剥标点再剥语气词，循环到都不再变化（「吧，用英文。」等组合）
    while (t) {
      const last = t[t.length - 1];
      if (!last || !TRAILING_PUNCT.includes(last)) break;
      t = t.slice(0, -1).trimEnd();
      changed = true;
    }
    for (const f of TRAILING_FILLERS) {
      if (t.toLowerCase().endsWith(f)) {
        t = t.slice(0, -f.length).trimEnd();
        changed = true;
        break;
      }
    }
    if (!changed) return t;
  }
}

/** 有效内容字符数（汉字/字母/数字，忽略标点与空白）。 */
function significantChars(text: string): number {
  let n = 0;
  for (const ch of text) {
    if (/[\p{Script=Han}\p{L}\p{N}]/u.test(ch)) n++;
  }
  return n;
}

/** 去掉首部/尾部的连接标点与空白。 */
const PUNCT_EDGE = /^[，。、,.:;；!！?？~～\s]+|[，。、,.:;；!！?？~～\s]+$/;
function trimEdge(text: string): string {
  return text.replace(PUNCT_EDGE, '').trim();
}

function isLatinCommand(cmd: string): boolean {
  return /^[A-Za-z]/.test(cmd);
}

/** 检测句首口令：文本以某口令开头且满足停顿/标点约束。 */
function detectAtStart(text: string): { language: OutputLanguage; rest: string } | null {
  for (const lang of BUILTIN_LANGUAGES) {
    // 长口令优先（「翻译成英文」先于「用英文」），避免剥不干净
    const cmds = [...lang.commands].sort((a, b) => b.length - a.length);
    for (const cmd of cmds) {
      if (!text.startsWith(cmd)) continue;
      // 否定词紧邻口令之前不存在（句首即起点），但需防「别用英文说中文」这类整句正文：
      // 句首位置无从判断否定，交给「剩余正文≥3字」兜底即可。
      const next = text[cmd.length];
      if (isLatinCommand(cmd)) {
        // 英文口令在句首必须跟标点（「English. 你好」）
        if (!next || !PUNCTUATION.includes(next)) continue;
      } else {
        // 中文口令后须为标点/空白/结束（「用英文 说」→口令；「用英文说」→正文）
        if (next && !PUNCTUATION.includes(next) && !/\s/.test(next)) continue;
      }
      const rest = trimEdge(text.slice(cmd.length));
      if (significantChars(rest) < 3) continue;
      return { language: lang, rest };
    }
  }
  return null;
}

/** 检测句尾口令：先剥语气词/尾标点，再看是否以口令收尾。 */
function detectAtEnd(text: string): { language: OutputLanguage; rest: string } | null {
  const stripped = stripTrailingFillers(text);
  if (!stripped) return null;
  for (const lang of BUILTIN_LANGUAGES) {
    const cmds = [...lang.commands].sort((a, b) => b.length - a.length);
    for (const cmd of cmds) {
      if (!stripped.toLowerCase().endsWith(cmd.toLowerCase())) continue;
      const rest = stripped.slice(0, stripped.length - cmd.length);
      const rtrim = rest.replace(/\s+$/, '');
      const prev = rtrim[rtrim.length - 1];
      // 口令前紧邻否定词 → 正文语义（「翻译不要用英文」）
      if (NEGATIONS.some((n) => rtrim.toLowerCase().endsWith(n.toLowerCase()))) continue;
      if (isLatinCommand(cmd)) {
        // 拉丁口令句尾：去掉紧邻空格后前一字符须是标点
        // （「answer, in English.」✓；「hello world English」✗）
        if (!prev || !PUNCTUATION.includes(prev)) continue;
      }
      const restTrimmed = trimEdge(rtrim);
      if (significantChars(restTrimmed) < 3) continue;
      return { language: lang, rest: restTrimmed };
    }
  }
  return null;
}

/**
 * 从听写识别文本中检测翻译口令；命中则返回目标语言与剥好的正文，未命中返回 null。
 */
export function detectOutputLanguage(text: string): DetectedCommand | null {
  const t = text.trim();
  if (!t) return null;
  // 句尾先检（更常见的口令位置），再检句首
  const atEnd = detectAtEnd(t);
  if (atEnd) return { language: atEnd.language, text: atEnd.rest, position: 'end' };
  const atStart = detectAtStart(t);
  if (atStart) return { language: atStart.language, text: atStart.rest, position: 'start' };
  return null;
}

/** 按代码找内置语言（设置里的固定输出语言用）。 */
export function languageByCode(code: string | undefined | null): OutputLanguage | null {
  if (!code) return null;
  return BUILTIN_LANGUAGES.find((l) => l.code === code) ?? null;
}
