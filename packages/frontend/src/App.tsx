import { useCallback, useEffect, useState } from 'react';
import type { HealthStatus, SessionMeta } from './api/types';
import { deleteSession, getHealth, listSessions, processSession } from './api/client';
import { Sidebar } from './components/Sidebar';
import { Recorder } from './components/Recorder';
import { Uploader } from './components/Uploader';
import { ProgressView } from './components/ProgressView';
import { SessionDetail } from './components/SessionDetail';

type View = { name: 'new' } | { name: 'processing'; id: string } | { name: 'detail'; id: string };

export function App() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [view, setView] = useState<View>({ name: 'new' });
  const [tab, setTab] = useState<'record' | 'upload'>('record');

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
    setView((v) => (v.name !== 'new' && v.id === id ? { name: 'new' } : v));
    refresh();
  }

  const activeId = view.name === 'new' ? null : view.id;
  const title =
    view.name === 'new'
      ? tab === 'record'
        ? '录音'
        : '上传音频'
      : view.name === 'processing'
        ? '处理中'
        : sessions.find((s) => s.id === view.id)?.title || '会话';

  return (
    <div className="shell">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        health={health}
        onNew={() => setView({ name: 'new' })}
        onOpen={(id) => setView({ name: 'detail', id })}
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
                <button className={tab === 'record' ? 'seg active' : 'seg'} onClick={() => setTab('record')}>
                  🎙 录音
                </button>
                <button className={tab === 'upload' ? 'seg active' : 'seg'} onClick={() => setTab('upload')}>
                  📁 上传
                </button>
              </div>
              {tab === 'record' ? (
                <Recorder onCreated={onCreated} />
              ) : (
                <Uploader onCreated={onCreated} />
              )}
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
