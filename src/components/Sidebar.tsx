import { LayoutGrid, Plus, Search } from 'lucide-react';
import type { Account } from '../lib/types';
import { colorVar, fmtAgo, headroom, levelFor } from '../lib/format';
import { Chip } from './Chip';

interface Props {
  accounts: Account[];
  selected: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  search: string;
  onSearch: (s: string) => void;
  lastLoad: number;
  now: number;
  mock: boolean;
}

export function Logo({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <path d="M8.5 21a8.5 8.5 0 1 1 15 0" fill="none" stroke="var(--primary-fg)" strokeOpacity=".28" strokeWidth="3" strokeLinecap="round" />
      <path d="M8.5 21a8.5 8.5 0 0 1 9-8.3" fill="none" stroke="var(--primary-fg)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16" cy="21" r="2" fill="var(--primary-fg)" />
    </svg>
  );
}

const item = (active: boolean) =>
  `group flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-[13px] transition-all ${
    active
      ? 'border-line bg-card font-medium text-fg shadow-[0_1px_2px_rgba(0,0,0,0.05)]'
      : 'border-transparent text-muted-fg hover:bg-card/70 hover:text-fg'
  }`;

export function Sidebar({ accounts, selected, onSelect, onAdd, search, onSearch, lastLoad, now, mock }: Props) {
  const q = search.trim().toLowerCase();
  const list = q ? accounts.filter((a) => a.name.toLowerCase().includes(q)) : accounts;

  return (
    <div className="flex h-full w-full flex-col gap-4 bg-bg/80 p-3 backdrop-blur-xl">
      <div className="flex items-center gap-2.5 px-1.5 pt-1">
        <Logo />
        <span className="text-[15px] font-semibold tracking-tight">Claude usage</span>
        {mock && <Chip tone="warn" className="ml-auto">Preview</Chip>}
      </div>

      <label className="flex items-center gap-2 rounded-lg border border-line bg-card px-2.5 py-2 text-[13px] text-muted-fg shadow-[0_1px_2px_rgba(0,0,0,0.03)] focus-within:ring-2 focus-within:ring-accent/40">
        <Search className="size-3.5" />
        <input
          data-account-search
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Find account"
          className="w-full bg-transparent text-fg outline-none placeholder:text-muted-fg"
        />
        <kbd className="rounded border border-line bg-frame px-1.5 py-px text-[10.5px] font-medium">⌘K</kbd>
      </label>

      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <div>
          <div className="px-2 pb-1.5 text-[11px] font-medium tracking-wide text-subtle-fg uppercase">Main</div>
          <button className={item(selected === 'all')} onClick={() => onSelect('all')}>
            <LayoutGrid className="size-4" /> Overview
            <span className="ml-auto text-xs text-subtle-fg">{accounts.length}</span>
          </button>
        </div>

        <div>
          <div className="px-2 pb-1.5 text-[11px] font-medium tracking-wide text-subtle-fg uppercase">Accounts</div>
          <div className="flex flex-col gap-0.5">
            {list.map((a, i) => {
              const ok = a.status === 'ok' && a.windows?.length;
              const left = ok ? headroom(a) : null;
              return (
                <button key={a.id} className={`${item(selected === a.id)} animate-fade`} style={{ animationDelay: `${i * 50}ms` }} onClick={() => onSelect(a.id)}>
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: ok ? colorVar(levelFor(100 - (left ?? 0))) : 'var(--warn)' }}
                  />
                  <span className="truncate">{a.name}</span>
                  <span className="ml-auto text-xs text-subtle-fg tabular-nums">{left != null ? `${Math.round(left)}% left` : 'check'}</span>
                </button>
              );
            })}
            {list.length === 0 && <div className="px-2.5 py-2 text-xs text-subtle-fg">No accounts match.</div>}
            <button onClick={onAdd} className="mt-1 flex w-full items-center gap-2.5 rounded-lg border border-dashed border-line px-2.5 py-2 text-[13px] text-muted-fg transition-colors hover:border-accent/50 hover:text-fg">
              <Plus className="size-4" /> Add account
            </button>
          </div>
        </div>
      </nav>

      <div className="flex items-center gap-2.5 rounded-xl border border-line bg-card p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <span className="live-dot ml-1" />
        <div className="min-w-0 text-xs leading-tight">
          <div className="font-medium">Live · every minute</div>
          <div className="text-subtle-fg">{lastLoad ? `Updated ${fmtAgo(now - lastLoad)}` : 'Connecting…'}</div>
        </div>
      </div>
    </div>
  );
}
