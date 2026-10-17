import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// config.ts 在模块初始化时读 env —— 先设 DATA_DIR 再动态 import，隔离真实数据目录
const tmp = mkdtempSync(join(tmpdir(), 'vn-settings-'));
process.env.DATA_DIR = tmp;

const { getSettings, saveSettings } = await import('./settingsStore.js');

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('settingsStore', () => {
  it('空配置 → 全默认（含长按触发关闭）', () => {
    const s = getSettings();
    expect(s.dictation.shortcut).toBe('Ctrl+Alt+D');
    expect(s.dictation.hold).toEqual({ enabled: false, key: 'CtrlRight', mode: 'ptt' });
    expect(s.transcriptionEngine).toBe('whisper');
  });

  it('保存 → 读回：dictation.hold 正常往返', () => {
    const s = getSettings();
    s.dictation.hold = { enabled: true, key: 'MetaRight', mode: 'toggle' };
    const saved = saveSettings(s);
    expect(saved.dictation.hold).toEqual({ enabled: true, key: 'MetaRight', mode: 'toggle' });
    expect(getSettings().dictation.hold).toEqual({
      enabled: true,
      key: 'MetaRight',
      mode: 'toggle',
    });
  });

  it('非法值兜底：未知长按键回退 CtrlRight，未知模式回退 ptt', () => {
    const s = getSettings();
    s.dictation.hold = { enabled: true, key: 'Hack', mode: 'weird' as 'ptt' };
    expect(saveSettings(s).dictation.hold).toEqual({
      enabled: true,
      key: 'CtrlRight',
      mode: 'ptt',
    });
  });

  it('historyLimit 夹取到 [50, 5000]；术语纠错清洗空项', () => {
    const s = getSettings();
    s.dictation.historyLimit = 1;
    s.dictation.termCorrections = [
      { target: '  通义千问 ', variants: [' 同义千问', '', '  '] },
      { target: '', variants: ['x'] },
    ];
    const saved = saveSettings(s);
    expect(saved.dictation.historyLimit).toBe(50);
    expect(saved.dictation.termCorrections).toEqual([
      { target: '通义千问', variants: ['同义千问'] },
    ]);
  });

  it('缺字段的预设被拒绝', () => {
    const s = getSettings();
    s.presets = [{ id: 'x', name: 'bad' } as never];
    expect(() => saveSettings(s)).toThrow();
  });
});
