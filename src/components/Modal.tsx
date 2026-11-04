import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Remember the last focused element outside any dialog: autoFocus inside the dialog runs before our effect.
let lastOutside: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest('[role="dialog"]')) lastOutside = t;
  });
}

export function Modal({ open, onClose, title, children }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose; // keep the key listener stable even when callers pass inline arrows
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const opener = lastOutside;
    const appRoot = document.getElementById('root') as (HTMLElement & { inert?: boolean }) | null;
    if (appRoot) appRoot.inert = true; // background is neither focusable nor readable while the dialog is open

    const raf = requestAnimationFrame(() => {
      const el = dialog.current;
      if (el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !dialog.current) return;
      const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.current.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !dialog.current.contains(active))) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      if (appRoot) appRoot.inert = false;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[3px]" onClick={onClose} />
          <motion.div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="relative w-full max-w-md rounded-2xl border border-line bg-card p-5 shadow-2xl outline-none"
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id={titleId} className="text-base font-semibold tracking-tight">{title}</h2>
              <button onClick={onClose} className="rounded-md p-1 text-muted-fg transition-colors hover:bg-frame hover:text-fg" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
