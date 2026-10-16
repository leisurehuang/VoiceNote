import { useCallback, useEffect, useState } from 'react';
import { AudioLines, Mic, Upload } from 'lucide-react';
import type { HealthStatus, SessionMeta } from './api/types';
import { deleteSession, getHealth, listSessions, processSession } from './api/client';
import { Sidebar } from './components/Sidebar';
import { Recorder } from './components/Recorder';
import { Uploader } from './components/Uploader';
import { RealtimeView } from './components/RealtimeView';
import { ProgressView } from './components/ProgressView';
import { SessionDetail } from './components/SessionDetail';
import { SettingsView } from './components/SettingsView';
import { DictationView } from './components/DictationView';
import { UpdateBanner } from './components/UpdateBanner';
import { Segmented } from './components/ui/Segmented';
import { Button } from './components/ui/Button';
import { ToastHost } from './components/ui/Toast';

type View =
  | { name: 'new' }
  | { name: 'processing'; id: string }
  | { name: 'detail'; id: string }
  | { name: 'settings' }
  | { name: 'dictation' };

export function App() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [view, setView] = useState<View>({ name: 'new' });
  const [tab, setTab] = useState<'record' | 'realtime' | 'upload'>('record');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSessions(await listSessions());
    } catch {
      /* 后端未起 */
    }
    try {
      setHealth(await getHealth());
    } catch {
      /* 忽略 */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onCreated(id: string) {
    try {
      await processSession(id);
    } catch {
      /* 进入进度视图观察 */
    }
    setView({ name: 'processing', id });
    refresh();
  }

  async function onDelete(id: string) {
    await deleteSession(id);
    setView((v) => (v.name !== 'new' && v.name !== 'settings' && v.name !== 'dictation' && v.id === id ? { name: 'new' } : v));
    refresh();
  }

  const activeId =
    view.name === 'new' || view.name === 'settings' || view.name === 'dictation' ? null : view.id;
  const openSettings = () => {
    if (!busy) setView({ name: 'settings' });
  };
  const openDictation = () => {
    if (!busy) setView({ name: 'dictation' });
  };
  const title =
    view.name === 'new'
      ? tab === 'record'
        ? '录音'
        : tab === 'realtime'
          ? '实时转写'
          : '上传音频'
      : view.name === 'processing'
        ? '处理中'
        : view.name === 'settings'
          ? '设置'
          : view.name === 'dictation'
            ? '语音输入'
            : sessions.find((s) => s.id === view.id)?.title || '会话';

  return (
    <div className="shell">
      <ToastHost />
      <UpdateBanner />
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        health={health}
        disabled={busy}
        onNew={() => {
          if (!busy) setView({ name: 'new' });
        }}
        onOpen={(id) => {
          if (!busy) setView({ name: 'detail', id });
        }}
        onSettings={openSettings}
        onDictation={openDictation}
        onDelete={onDelete}
      />

      <main className="main">
        <header className="titlebar">
          <span className="titlebar-title">{title}</span>
        </header>

        <div className="main-scroll">
          {view.name === 'new' && (
            <div className="content">
              <Segmented
                options={[
                  { value: 'record', label: '录音', icon: Mic },
                  { value: 'realtime', label: '实时', icon: AudioLines },
                  { value: 'upload', label: '上传', icon: Upload },
                ]}
                value={tab}
                onChange={setTab}
                disabled={busy}
                lockedHint="录音/整理中，无法切换"
              />
              {tab === 'record' && <Recorder onCreated={onCreated} onBusyChange={setBusy} />}
              {tab === 'realtime' && (
                <RealtimeView
                  onBusyChange={setBusy}
                  onDone={(id) => {
                    setView({ name: 'detail', id });
                    refresh();
                  }}
                />
              )}
              {tab === 'upload' && <Uploader onCreated={onCreated} />}
              {health && !health.ok && <DependencyNote health={health} onSettings={openSettings} />}
            </div>
          )}

          {view.name === 'processing' && (
            <ProgressView
              id={view.id}
              onDone={() => {
                const doneId = view.id;
                setView({ name: 'detail', id: doneId });
                refresh();
              }}
            />
          )}

          {view.name === 'detail' && <SessionDetail id={view.id} />}

          {view.name === 'settings' && <SettingsView />}

          {view.name === 'dictation' && (
            <div className="content">
              <DictationView />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function DependencyNote({ health, onSettings }: { health: HealthStatus; onSettings: () => void }) {
  const missing: string[] = [];
  if (!health.ffmpeg) missing.push('ffmpeg');
  if (health.transcriptionEngine === 'sherpa') {
    if (!health.sherpa.ok) missing.push('sherpa 二进制与模型（scripts/fetch-sherpa.sh）');
  } else if (health.transcriptionEngine === 'api') {
    if (!health.asrApiConfigured) missing.push('云端转写 API 配置（Base URL / Key / 模型）');
    else if (!health.asrApiOk) missing.push('云端转写 API 不可达（检查地址/密钥）');
  } else {
    if (!health.whisperCli) missing.push('whisper-cli');
    if (!health.whisperModel) missing.push('转写模型（录音转写前需下载）');
  }
  if (!health.ollama) missing.push('Ollama');
  else if (!health.llmModelOk) missing.push('摘要模型（首次需下载）');
  return (
    <div className="alert warn">
      <div>还差这几步就能完整使用：{missing.join('、')}。应用可正常打开，模型在设置页下载后即时生效。</div>
      <div style={{ marginTop: 8 }}>
        <Button variant="primary" onClick={onSettings}>
          前往设置下载/配置模型
        </Button>
      </div>
    </div>
  );
}
