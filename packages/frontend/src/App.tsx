import { useCallback, useEffect, useState } from 'react';
import type { HealthStatus, SessionMeta } from './api/types';
import { deleteSession, getHealth, listSessions, processSession } from './api/client';
import { Sidebar } from './components/Sidebar';
import { Recorder } from './components/Recorder';
import { Uploader } from './components/Uploader';
import { RealtimeView } from './components/RealtimeView';
import { ProgressView } from './components/ProgressView';
import { SessionDetail } from './components/SessionDetail';
import { SettingsView } from './components/SettingsView';

type View =
  | { name: 'new' }
  | { name: 'processing'; id: string }
  | { name: 'detail'; id: string }
  | { name: 'settings' };

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
    setView((v) => (v.name !== 'new' && v.name !== 'settings' && v.id === id ? { name: 'new' } : v));
    refresh();
  }

  const activeId = view.name === 'new' || view.name === 'settings' ? null : view.id;
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
          : sessions.find((s) => s.id === view.id)?.title || '会话';

  return (
    <div className="shell">
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
        onSettings={() => {
          if (!busy) setView({ name: 'settings' });
        }}
        onDelete={onDelete}
      />

      <main className="main">
        <header className="titlebar">
          <span className="titlebar-title">{title}</span>
        </header>

        <div className="main-scroll">
          {view.name === 'new' && (
            <div className="content">
              <div className="segmented">
                <button
                  className={tab === 'record' ? 'seg active' : 'seg'}
                  onClick={() => setTab('record')}
                  disabled={busy}
                  title={busy ? '录音/整理中，无法切换' : undefined}
                >
                  🎙 录音
                </button>
                <button
                  className={tab === 'realtime' ? 'seg active' : 'seg'}
                  onClick={() => setTab('realtime')}
                  disabled={busy}
                  title={busy ? '录音/整理中，无法切换' : undefined}
                >
                  ⚡ 实时
                </button>
                <button
                  className={tab === 'upload' ? 'seg active' : 'seg'}
                  onClick={() => setTab('upload')}
                  disabled={busy}
                  title={busy ? '录音/整理中，无法切换' : undefined}
                >
                  📁 上传
                </button>
              </div>
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
              {health && !health.ok && <DependencyNote health={health} />}
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

          {view.name === 'settings' && <SettingsView onBack={() => setView({ name: 'new' })} />}
        </div>
      </main>
    </div>
  );
}

function DependencyNote({ health }: { health: HealthStatus }) {
  const missing: string[] = [];
  if (!health.ffmpeg) missing.push('ffmpeg');
  if (!health.whisperCli) missing.push('whisper-cli');
  if (!health.whisperModel) missing.push('whisper 模型');
  if (!health.ollama) missing.push('Ollama');
  return (
    <div className="alert warn">
      缺少依赖：{missing.join('、')}。开发模式请运行 <code>npm run setup</code>；桌面版请确认资源完整。
    </div>
  );
}
