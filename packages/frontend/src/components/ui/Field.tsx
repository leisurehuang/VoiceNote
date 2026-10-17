import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../cn';

interface FieldProps {
  label: string;
  help?: string;
  error?: string;
  children: ReactNode;
  /** 传给控件的 id,点击标签聚焦 */
  htmlFor?: string;
}

/** 表单字段容器:标签 + 控件 + help/error 说明。error 存在时隐藏 help。 */
export function Field({ label, help, error, children, htmlFor }: FieldProps) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="field-msg field-msg-err">{error}</span>
      ) : help ? (
        <span className="field-msg">{help}</span>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement>;
export function Input({ className, ...rest }: InputProps) {
  return <input className={cn('input', className)} {...rest} />;
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
export function Textarea({ className, ...rest }: TextareaProps) {
  return <textarea className={cn('input', 'textarea', className)} {...rest} />;
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;
export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <select className={cn('input', 'select', className)} {...rest}>
      {children}
    </select>
  );
}
