import { useEffect, useState } from 'react';
import { BookText, Mic, Sparkles } from 'lucide-react';
import { getSettings, updateSettings } from '../api/client';
import type { Settings } from '../api/types';
import { TranscriptionSettings } from './TranscriptionSettings';
import { LlmSettings } from './LlmSettings';
import { Segmented, type SegmentedOption } from './ui/Segmented';
import { Button } from './ui/Button';
import { SettingsSkeleton } from './ui/Skeleton';
import { toast, toastError } from './ui/Toast';

type Tab = 'transcribe' | 'llm' | 'glossary';

const TABS: SegmentedOption<Tab>[] = [
  { value: 'transcribe', label: '语音转文字', icon: Mic },
  { value: 'llm', label: 'AI 整理', icon: Sparkles },
  { value: 'glossary', label: '术语表', icon: BookText },
];

export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [glossaryDraft, setGlossaryDraft] = useState('');
  const [glossarySaving, setGlossarySaving] = useState(false);
  const [tab, setTab] = useState<Tab>('transcribe');

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((e) => setErr(e instanceof Error ? e.message : '加载失败'));
  }, []);

  // 术语表回显到编辑框（settings 加载 / 变更时同步）
  useEffect(() => {
    if (settings) setGlossaryDraft(settings.glossary?.join('\n') ?? '');
  }, [settings]);

  async function persist(next: Settings): Promise<boolean> {
    try {
      setSettings(await updateSettings(next));
      setErr(null);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
      return false;
    }
  }

  async function saveGlossary() {
    if (!settings || glossarySaving) return;
    setGlossarySaving(true);
    const glossary = glossaryDraft
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    const ok = await persist({ ...settings, glossary });
    setGlossarySaving(false);
    if (ok) toast('术语表已保存');
    else toastError('术语表保存失败');
  }

  return (
    <div className="content settings">
      <section className="block">
        <Segmented options={TABS} value={tab} onChange={setTab} className="settings-tabs" />
        <p className="muted settings-legend">点选类操作（切引擎、设为激活、切模型）即时生效；表单类配置需点「保存」。</p>
        {err && <div className="alert err">{err}</div>}

        {/* 语音转文字：引擎卡片 + 各引擎配置/模型管理 */}
        <div className={tab === 'transcribe' ? '' : 'hidden'}>
          {!settings ? <SettingsSkeleton /> : <TranscriptionSettings settings={settings} persist={persist} />}
        </div>

        {/* AI 整理：LLM 预设 + 本地 Ollama 模型管理 */}
        <div className={tab === 'llm' ? '' : 'hidden'}>
          {!settings ? <SettingsSkeleton /> : <LlmSettings settings={settings} persist={persist} />}
        </div>

        {/* 术语表 */}
        <div className={tab === 'glossary' ? '' : 'hidden'}>
          {!settings ? (
            <SettingsSkeleton />
          ) : (
            <div className="glossary-box">
              <h4 className="block-h">术语表</h4>
              <p className="muted">
                专有名词 / 人名 / 公司名，每行一个。转写与整理时自动偏置，提升识别准确率
                （sherpa 引擎不支持偏置）。
              </p>
              <textarea
                className="glossary-edit"
                value={glossaryDraft}
                onChange={(e) => setGlossaryDraft(e.target.value)}
                rows={8}
                placeholder={'例如：\n鸿蒙\n信创\nPaaS'}
              />
              <div className="rec-controls">
                <Button variant="ghost" loading={glossarySaving} onClick={saveGlossary}>
                  保存术语表
                </Button>
              </div>
            </div>
          )}
        </div>

        <p className="muted settings-version">Voice Notes v{__APP_VERSION__}</p>
      </section>
    </div>
  );
}
