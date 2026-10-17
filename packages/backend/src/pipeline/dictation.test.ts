import { describe, expect, it } from 'vitest';
import { applyTermCorrections, shouldUseEnglishPrompt } from './dictation.js';

describe('applyTermCorrections', () => {
  it('纯中文变体做子串替换', () => {
    expect(applyTermCorrections('我用同义千问写了稿', [{ target: '通义千问', variants: ['同义千问'] }])).toBe(
      '我用通义千问写了稿',
    );
  });

  it('长变体优先，单遍扫描不重叠', () => {
    expect(
      applyTermCorrections('译千问和通译千问都在', [{ target: '通义千问', variants: ['译千问', '通译千问'] }]),
    ).toBe('通义千问和通义千问都在');
  });

  it('拉丁变体整词匹配：词内部不打断，独立词命中', () => {
    expect(applyTermCorrections('rapidly development', [{ target: 'REST API', variants: ['rapid'] }])).toBe(
      'rapidly development',
    );
    expect(applyTermCorrections('use rapid now', [{ target: 'REST API', variants: ['rapid'] }])).toBe(
      'use REST API now',
    );
  });

  it('拉丁变体大小写不敏感，命中后统一为正写', () => {
    expect(applyTermCorrections('call Whisper.cpp', [{ target: 'whisper.cpp', variants: ['Whisper.cpp'] }])).toBe(
      'call whisper.cpp',
    );
  });

  it('变体等于正写时跳过；空目标/空变体被忽略', () => {
    expect(applyTermCorrections('abc', [{ target: 'abc', variants: ['abc'] }, { target: '', variants: ['x'] }])).toBe(
      'abc',
    );
    expect(applyTermCorrections('abc', [{ target: 't' }])).toBe('abc');
  });

  it('替换产生的新文本不会被再次扫描', () => {
    // 甲→乙、乙→甲 若反复扫描会死循环；单遍保证收敛（'甲乙' → '乙甲'，各替换一次）
    expect(
      applyTermCorrections('甲乙', [{ target: '乙', variants: ['甲'] }, { target: '甲', variants: ['乙'] }]),
    ).toBe('乙甲');
  });
});

describe('shouldUseEnglishPrompt', () => {
  it('纯中文 → false', () => {
    expect(shouldUseEnglishPrompt('今天天气不错')).toBe(false);
  });
  it('纯拉丁 → true', () => {
    expect(shouldUseEnglishPrompt('hello world')).toBe(true);
  });
  it('中英混说拉丁占比 ≥30% → true', () => {
    expect(shouldUseEnglishPrompt('这个 bug 我 fix 了一下 commit')).toBe(true);
  });
  it('拉丁占比很低 → false', () => {
    expect(shouldUseEnglishPrompt('我用 AI 写了很长很长的一段中文内容')).toBe(false);
  });
  it('无字母 → false', () => {
    expect(shouldUseEnglishPrompt('123，。！')).toBe(false);
  });
});
