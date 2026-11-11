import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { Account } from '../lib/types';
import { menuIndex } from '../lib/keyboard';
import { Chip } from './Chip';
import { planClasses } from '../lib/plan';

export interface MenuAction {
  label: string;
  run: () => void;
  /** Section the action sits in; sections keep their order of first appearance. */
  group?: string;
  icon?: ReactNode;
  /** One short line under the label. */
  hint?: string;
  /** Marks a choice that is currently selected (seat labels). */
  checked?: boolean;
  danger?: boolean;
}

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
  // keep the whole menu on screen: measure it once it is drawn, then slide it up or left if it would run off
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const r = root.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
  }, [x, y, actions.length]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    (root.current?.querySelector<HTMLElement>('[role="menuitem"]') ?? root.current)?.focus();
    const close = () => closeRef.current();
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
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

  const groups: { name: string; items: MenuAction[] }[] = [];
  for (const a of actions) {
    const name = a.group ?? '';
    const g = groups.find((x) => x.name === name);
    if (g) g.items.push(a); else groups.push({ name, items: [a] });
  }

  return (
    <div
      ref={root}
      role="menu"
      tabIndex={-1}
      aria-label={`${account.name} account actions`}
      className="fixed z-50 max-h-[calc(100vh-16px)] w-72 overflow-y-auto rounded-xl border border-line bg-card py-1.5 text-sm shadow-2xl outline-none"
      style={pos}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKey}
    >
      <div className="flex items-center gap-2 px-3.5 pt-1.5 pb-2.5">
        <span className="min-w-0 flex-1 truncate font-semibold">{account.name}</span>
        {account.plan && <Chip className={planClasses(account.plan)}>{account.plan}</Chip>}
      </div>
      {groups.map((g, gi) => (
        <div key={g.name || gi} role="group" aria-label={g.name || undefined} className="border-t border-line py-1">
          {g.name && <div className="px-3.5 pt-1.5 pb-1 text-[11.5px] font-medium text-subtle-fg">{g.name}</div>}
          {g.items.map((a) => (
            <button
              key={a.label} role="menuitem" tabIndex={-1} onClick={a.run}
              className={`group flex w-full items-start gap-2.5 px-3.5 py-2 text-left outline-none transition-colors hover:bg-frame focus-visible:bg-frame ${a.danger ? 'text-bad' : ''}`}
            >
              <span className={`mt-0.5 grid size-4 shrink-0 place-items-center [&>svg]:size-4 ${a.danger ? '' : 'text-muted-fg group-hover:text-fg'}`}>{a.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-snug font-medium">{a.label}</span>
                {a.hint && <span className="mt-0.5 block text-[11.5px] leading-snug text-subtle-fg">{a.hint}</span>}
              </span>
              {a.checked && <Check className="mt-0.5 size-4 shrink-0 text-fg" aria-label="Selected" />}
            </button>
          ))}
        </div>
      ))}
      {actions.length === 0 && <p className="border-t border-line px-3.5 pt-3 pb-2 text-xs text-muted-fg">{emptyHint}</p>}
    </div>
  );
}
