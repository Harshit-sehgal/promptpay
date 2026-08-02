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

    const FOCUSABLE_SELECTOR =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const trapTab = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (e.shiftKey) {
        if (current === first || !dialogRef.current.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else if (current === last || !dialogRef.current.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trapTab);
    return () => {
      document.removeEventListener('keydown', trapTab);
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
