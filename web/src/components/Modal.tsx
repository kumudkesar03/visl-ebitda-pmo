import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icons';

/**
 * Modal dialog.
 *
 * Escape closes; clicking the backdrop does NOT. These dialogs carry
 * half-entered financial figures, and losing a month of typed actuals to a
 * stray click beside the panel is exactly the kind of small betrayal that
 * teaches people to keep working in Excel instead.
 */
export function Modal({ title, subtitle, children, footer, onClose, wide }: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <div className="grow">
            <h2>{title}</h2>
            {subtitle && <div className="small muted" style={{ marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation for an action that cannot be undone from the UI. */
export function ConfirmModal({ title, message, confirmLabel = 'Confirm', tone = 'danger', onConfirm, onClose, busy }: {
  title: string; message: ReactNode; confirmLabel?: string;
  tone?: 'danger' | 'primary'; onConfirm: () => void; onClose: () => void; busy?: boolean;
}) {
  return (
    <Modal title={title} onClose={onClose} footer={
      <>
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className={`btn btn-${tone}`} onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </>
    }>
      <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{message}</div>
    </Modal>
  );
}
