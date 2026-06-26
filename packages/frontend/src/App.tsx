import { useCallback, useEffect, useState } from 'react';
import type { HealthStatus, SessionMeta } from './api/types';
import { deleteSession, getHealth, listSessions, processSession } from './api/client';
import { HealthBanner } from './components/HealthBanner';
import { Recorder } from './components/Recorder';
import { Uploader } from './components/Uploader';
import { ProgressView } from './components/ProgressView';
import { SessionList } from './components/SessionList';
import { SessionDetail } from './components/SessionDetail';

type View = { name: 'home' } | { name: 'processing'; id: string } | { name: 'detail'; id: string };

export function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSessions(await listSessions());
    } catch {
      /* 后端未起，忽略 */
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
      /* 即便触发失败，前端仍可进入进度视图观察状态 */
    }
    setView({ name: 'processing', id });
  }

  async function onDelete(id: string) {
    await deleteSession(id);
    refresh();
  }

  return (
    <div className="app">
      <header>
        <h1>🎙️ Voice Notes</h1>
        <p className="subtitle">语音转笔记 / 会议纪要 · 本地运行</p>
      </header>

      <HealthBanner health={health} />

      {view.name === 'home' && (
        <>
          <Recorder onCreated={onCreated} />
          <Uploader onCreated={onCreated} />
          <div className="card">
            <h3>历史会话</h3>
            <SessionList
              sessions={sessions}
              onOpen={(id) => setView({ name: 'detail', id })}
              onDelete={onDelete}
            />
          </div>
        </>
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

      {view.name === 'detail' && (
        <SessionDetail id={view.id} onBack={() => setView({ name: 'home' })} />
      )}
    </div>
  );
}
