'use client';

import { ReactNode, useEffect, useRef } from 'react';

interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Accessible modal wrapper: Escape closes, focus moves into the dialog on
 * open and is restored to the previously focused element on close, and the
 * dialog is announced as modal to assistive tech. Backdrop click closes.
 */
export default function ModalDialog({
  open,
  onClose,
  labelledBy,
  children,
  className = '',
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`bg-ink-800 border border-ink-600/30 rounded-2xl p-6 max-w-md w-full outline-none ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
