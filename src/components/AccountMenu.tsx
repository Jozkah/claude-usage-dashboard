import { useEffect, useRef } from 'react';
import type { Account } from '../lib/types';
import { menuIndex } from '../lib/keyboard';

export interface MenuAction { label: string; run: () => void }

interface Props {
  account: Account;
  x: number;
  y: number;
  actions: MenuAction[];
  /** Shown when there is nothing to run for this account. */
  emptyHint: string;
  onClose: () => void;
}

/** Account action menu: roving focus with arrows/Home/End, Escape closes and returns focus to the opener. */
export function AccountMenu({ account, x, y, actions, emptyHint, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    (root.current?.querySelector<HTMLElement>('[role="menuitem"]') ?? root.current)?.focus();
    const close = () => closeRef.current();
    window.addEventListener('click', close);
    return () => {
      window.removeEventListener('click', close);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Tab') { onClose(); return; }
    const next = menuIndex(e.key, i, items.length);
    if (next !== null) { e.preventDefault(); items[next]?.focus(); }
  };

  return (
    <div
      ref={root}
      role="menu"
      tabIndex={-1}
      aria-label={`${account.name} account actions`}
      className="fixed z-50 max-h-[calc(100vh-16px)] w-64 overflow-y-auto rounded-xl border border-line bg-card p-3 text-sm shadow-2xl outline-none"
      style={{ left: Math.max(8, Math.min(x, window.innerWidth - 272)), top: Math.max(8, Math.min(y, window.innerHeight - 330)) }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKey}
    >
      <div className="font-medium">{account.name}</div>
      <p className="mt-1 text-xs text-muted-fg">Claude Desktop login is separate. Open its profile menu, log out, then sign in to this account.</p>
      {actions.map((a) => (
        <button key={a.label} role="menuitem" tabIndex={-1} className="mt-2 w-full rounded-lg bg-frame px-3 py-2 text-left text-xs hover:bg-accent/20 focus-visible:bg-accent/20" onClick={a.run}>
          {a.label}
        </button>
      ))}
      {actions.length === 0 && <p className="mt-3 text-xs text-muted-fg">{emptyHint}</p>}
    </div>
  );
}
