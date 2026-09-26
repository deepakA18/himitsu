'use client';
import { useEffect, useRef, type ReactNode } from 'react';

export function NoteDialog({
  children,
  busy,
  onClose,
  titleId = 'backup-heading',
  descriptionId = 'backup-description',
  closeLabel = 'Cancel and close private note',
}: {
  titleId?: string;
  descriptionId?: string;
  closeLabel?: string;
  children: ReactNode;
  busy: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    node.showModal();
    document.body.style.overflow = 'hidden';
    node.querySelector<HTMLElement>('h2')?.focus();
    return () => {
      node.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="private-note-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <button
        type="button"
        className="note-dialog-close"
        aria-label={closeLabel}
        disabled={busy}
        onClick={onClose}
      >
        ×
      </button>
      {children}
    </dialog>
  );
}
