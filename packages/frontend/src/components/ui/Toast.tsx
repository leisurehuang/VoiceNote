import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck, CircleX } from 'lucide-react';
import { cn } from '../../cn';

interface ToastItem {
  id: number;
  text: string;
  tone: 'ok' | 'err';
}

let items: ToastItem[] = [];
let listeners: Array<(t: ToastItem[]) => void> = [];
let seq = 0;

function emit() {
  for (const l of listeners) l([...items]);
}

/** 轻量操作反馈:toast('已保存') / toastError('保存失败')。右下角 2.5s 自散,最多同屏 3 条。 */
export function toast(text: string, tone: 'ok' | 'err' = 'ok') {
  const id = ++seq;
  items = [...items, { id, text, tone }].slice(-3);
  emit();
  setTimeout(() => {
    items = items.filter((i) => i.id !== id);
    emit();
  }, 2500);
}

export function toastError(text: string) {
  toast(text, 'err');
}

/** 全局挂载一次(挂在 App 根部)。 */
export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>([]);
  useEffect(() => {
    listeners.push(setList);
    return () => {
      listeners = listeners.filter((l) => l !== setList);
    };
  }, []);
  return createPortal(
    <div className="toast-host" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={cn('toast', t.tone === 'err' && 'toast-err')}>
          {t.tone === 'err' ? <CircleX size={14} aria-hidden /> : <CircleCheck size={14} aria-hidden />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}
