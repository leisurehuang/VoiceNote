import { detectOutputLanguage, languageByCode } from '../packages/backend/src/pipeline/outputLanguage.js';
import { applyTermCorrections, shouldUseEnglishPrompt } from '../packages/backend/src/pipeline/dictation.js';

let fail = 0;
function eq(actual: unknown, expected: unknown, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log('  ✓', name);
  else { fail++; console.error('  ✗', name, '\n    期望', e, '\n    实际', a); }
}

// —— 翻译口令 ——
eq(detectOutputLanguage('今天天气不错，用英文')?.language.code, 'en', '句尾口令：用英文');
eq(detectOutputLanguage('今天天气不错，用英文')?.text, '今天天气不错', '句尾口令剥正文');
eq(detectOutputLanguage('用英文 你好世界很棒')?.language.code, 'en', '句首口令（空格分隔）');
eq(detectOutputLanguage('用英文说一段话关于天气') , null, '「用英文说」无停顿 → 非口令');
eq(detectOutputLanguage('翻译成日语，谢谢，这段话很好')?.language.code, 'ja', '句首「翻译成日语」');
eq(detectOutputLanguage('请帮我翻译成日语，这段话'), null, '句中口令不命中（仅认句首/句尾）');
eq(detectOutputLanguage('hello world English.'), null, '句尾 English 后无正文 → 不算');
eq(detectOutputLanguage('这个方案不要用英文'), null, '否定词保护');
eq(detectOutputLanguage('我在学习英文'), null, '词尾「英文」误命中保护');
eq(detectOutputLanguage('English. hello world this is a test')?.language.code, 'en', '句首 English + 标点');
eq(detectOutputLanguage('English is important'), null, '句首 English 无标点 → 非口令');
eq(detectOutputLanguage('明天开会讨论预算吧，用韩语')?.language.code, 'ko', '句尾口令（剥语气词前）');
eq(detectOutputLanguage('用英文'), null, '正文不足 3 字 → 不算');
eq(detectOutputLanguage('今天讨论预算') , null, '无口令');
eq(languageByCode('fr')?.label, '法文', 'languageByCode');

// —— 术语纠错 ——
eq(
  applyTermCorrections('同义千问很好用', [{ target: '通义千问', variants: ['同义千问', '通译千问'] }]),
  '通义千问很好用',
  '中文纠错',
);
eq(
  applyTermCorrections('the Claude Code is great', [{ target: 'Claude Code', variants: ['Clode Code', 'Cloud Code'] }]),
  'the Claude Code is great',
  '英文整词纠错',
);
eq(
  applyTermCorrections('use Clode Codec now', [{ target: 'Claude Code', variants: ['Clode Code'] }]),
  'use Clode Codec now',
  '英文边界保护（后邻字母）',
);
eq(
  applyTermCorrections('Clodex 和 Claude', [{ target: 'Claude', variants: ['cloude'] }]),
  'Clodex 和 Claude',
  '前邻字母保护',
);
eq(
  applyTermCorrections('apple and Apple', [{ target: 'Apple', variants: ['apple'] }]),
  'Apple and Apple',
  '大小写统一为正写',
);
eq(
  applyTermCorrections('通义千问，同义千问', [{ target: '通义千问', variants: ['同义千问', '同义千问模型'] }]),
  '通义千问，通义千问',
  '长变体优先且互不重叠',
);
eq(applyTermCorrections('没有变化', [{ target: 'X', variants: [] }]), '没有变化', '空变体安全');

// —— 语言检测 ——
eq(shouldUseEnglishPrompt('你好世界'), false, '纯中文→中文 prompt');
eq(shouldUseEnglishPrompt('hello world'), true, '纯英文→英文 prompt');
eq(shouldUseEnglishPrompt('这个 the best 东西'), true, '中英混说→英文 prompt');
eq(shouldUseEnglishPrompt('看这个東西好不好'), false, '纯中文（繁体）→中文 prompt');


// —— 追加：真实 ASR 输出形态（句尾带标点）——
eq(detectOutputLanguage('今天晚上一起吃饭吧,用英文。')?.language.code, 'en', '句尾口令带句号（真实 ASR 形态）');
eq(detectOutputLanguage('明天开会讨论预算。') , null, '普通句号不算口令');
eq(detectOutputLanguage('翻译成日语。这句话很重要')?.language.code, 'ja', '句首口令带标点');
eq(detectOutputLanguage('Please reply to this question, in English.')?.language.code, 'en', '拉丁句尾口令（标点分隔）');
eq(detectOutputLanguage('I am learning English.'), null, '英文正文以 English 结尾不误报');

if (fail) { console.error(`\n${fail} 项失败`); process.exit(1); }
console.log('\n全部通过');
