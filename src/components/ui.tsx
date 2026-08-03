import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { formatCurrency } from '@/domain/money';
import type { ShipmentStatus } from '@/domain/types';

export function Card({
  title,
  actions,
  children,
  flush,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-header">
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </div>
      )}
      <div className={flush ? 'card-body flush' : 'card-body'}>{children}</div>
    </section>
  );
}

export function Tile({
  label,
  value,
  hint,
  tone,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'positive' | 'negative';
  accent?: boolean;
}) {
  return (
    <div className={accent ? 'tile accent' : 'tile'}>
      <div className="label">{label}</div>
      <div className={tone ? `value ${tone}` : 'value'}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Money({ amount, colour }: { amount: number; colour?: boolean }) {
  const tone = !colour ? '' : amount < 0 ? 'value negative' : amount > 0 ? 'value positive' : '';
  return <span className={tone}>{formatCurrency(amount)}</span>;
}

export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {help && <span className="help">{help}</span>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  narrow,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  narrow?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={narrow ? 'modal narrow' : 'modal'} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

export function Banner({
  tone = 'info',
  children,
  style,
}: {
  tone?: 'info' | 'warning' | 'error';
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className={`banner ${tone}`} style={style}>
      {children}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-screen">
      <div>
        <div className="spinner" />
        {label}
      </div>
    </div>
  );
}

/** Colour-codes the shipment workflow so 'Agency Paid' (the only earning state) stands out. */
export function StatusBadge({ status }: { status: ShipmentStatus }) {
  const tone: Record<ShipmentStatus, string> = {
    Assigned: 'neutral',
    'In Transit': 'info',
    Delivered: 'info',
    Completed: 'warn',
    Billed: 'warn',
    Claim: 'danger',
    Dissolved: 'neutral',
    TONU: 'warn',
    'Customer Paid': 'warn',
    'Issue / Dispute': 'danger',
    'Agency Paid': 'success',
  };
  return <span className={`badge ${tone[status]}`}>{status}</span>;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      narrow
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{message}</p>
    </Modal>
  );
}
