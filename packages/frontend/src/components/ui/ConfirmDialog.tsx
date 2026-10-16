import type { ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onClose: () => void;
  /** 确认执行中的 loading 态 */
  loading?: boolean;
}

/** 统一确认弹窗:替代散落的自制 Modal 与原生 confirm() */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  tone = 'danger',
  onConfirm,
  onClose,
  loading,
}: Props) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {message && <p className="modal-msg">{message}</p>}
      <div className="modal-actions">
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          {cancelText}
        </Button>
        <Button variant={tone} loading={loading} onClick={onConfirm}>
          {confirmText}
        </Button>
      </div>
    </Modal>
  );
}
