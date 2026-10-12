import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface Option { value: string; label: string }

interface Props {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  label: string;
  className?: string;
}

/** Themed dropdown (the native one ignores our colors on Windows). Keyboard: arrows, Enter, Esc. */
export function Select({ value, options, onChange, label, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const openMenu = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const pick = (o: Option) => { onChange(o.value); setOpen(false); };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) pick(options[active]); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={root} className={`relative ${className}`} onKeyDown={onKey}>
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs font-medium text-fg outline-none transition-colors hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="truncate">{current?.label ?? '—'}</span>
        <ChevronDown className={`size-3.5 shrink-0 text-muted-fg transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="animate-fade absolute right-0 z-30 mt-1.5 max-h-64 min-w-full overflow-auto rounded-lg border border-line bg-card p-1 shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap ${i === active ? 'bg-frame text-fg' : 'text-muted-fg'} ${o.value === value ? 'font-medium text-fg' : ''}`}
            >
              {o.label}
              {o.value === value && <Check className="size-3.5 text-accent" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
