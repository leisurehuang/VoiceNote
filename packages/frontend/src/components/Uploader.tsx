import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { uploadAudio } from '../api/client';

export function Uploader({ onCreated }: { onCreated: (id: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function send(file: File) {
    setError(null);
    setProgress(0);
    try {
      const id = await uploadAudio(file, file.name, { sourceKind: 'upload' }, (r) =>
        setProgress(r),
      );
      setProgress(null);
      onCreated(id);
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : '上传失败');
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void send(f);
    e.target.value = '';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void send(f);
  }

  return (
    <div className="card">
      <h3>📁 上传音频文件</h3>
      {error && <div className="alert err">{error}</div>}
      <div
        className={`dropzone${dragging ? ' drag' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {progress !== null ? (
          <div className="prog">
            <div className="bar">
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span className="muted">上传中 {Math.round(progress * 100)}%</span>
          </div>
        ) : (
          <p>点击选择，或拖入音频文件（mp3 / m4a / wav / webm / aiff …）</p>
        )}
        <input ref={inputRef} type="file" accept="audio/*" onChange={onPick} hidden />
      </div>
    </div>
  );
}
