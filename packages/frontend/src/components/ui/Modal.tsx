import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** 关闭按钮;确认类弹窗可关掉(用底部按钮) */
  closeable?: boolean;
}

/** 弹窗:portal 渲染、Esc/点遮罩关闭、打开时聚焦便于键盘操作 */
export function Modal({ open, onClose, title, children, closeable = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeable) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeable, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (closeable && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          {closeable && (
            <IconButton label="关闭" size="sm" onClick={onClose}>
              <X size={15} />
            </IconButton>
          )}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
