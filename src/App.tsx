import { useCallback, useEffect, useRef, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { removeAccount, useNow, useTheme, useUsage } from './lib/api';
import type { Account, RangeKey } from './lib/types';
import { Aurora } from './components/Aurora';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { StatRow } from './components/StatRow';
import { TrendCard } from './components/TrendCard';
import { ResetTimeline } from './components/ResetTimeline';
import { AccountCard } from './components/AccountCard';
import { LimitTable } from './components/LimitTable';
import { DailyUsage } from './components/DailyUsage';
import { AddAccountDialog } from './components/AddAccountDialog';
import { Modal } from './components/Modal';

export default function App() {
  const { data, loading, error, lastLoad, refresh } = useUsage();
  const now = useNow(1000);
  const { dark, toggle } = useTheme();

  const [selected, setSelected] = useState('all');
  const [range, setRange] = useState<RangeKey>('24h');
  const [addOpen, setAddOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [toRemove, setToRemove] = useState<Account | null>(null);

  const accounts = data?.accounts ?? [];
  const visible = selected === 'all' ? accounts : accounts.filter((a) => a.id === selected);
  const tick = data?.serverTime ?? 0;

  // fall back to the overview if the selected account disappears
  useEffect(() => {
    if (selected !== 'all' && data && !accounts.some((a) => a.id === selected)) setSelected('all');
  }, [data, accounts, selected]);

  // refresh a few seconds after a window resets
  const resetSeen = useRef(new Set<string>());
  useEffect(() => {
    for (const a of accounts) {
      for (const w of a.windows ?? []) {
        if (!w.resetsAt) continue;
        const id = a.id + w.resetsAt;
        if (new Date(w.resetsAt).getTime() < now && !resetSeen.current.has(id)) {
          resetSeen.current.add(id);
          setTimeout(() => void refresh(true), 4000);
        }
      }
    }
  }, [now, accounts, refresh]);

  // ⌘K / Ctrl+K focuses the account search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMenuOpen(true);
        // two sidebars exist (desktop + mobile drawer): focus whichever one is visible
        setTimeout(() => {
          const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-account-search]'));
          inputs.find((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().right > 0)?.focus();
        }, 60);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const select = useCallback((id: string) => { setSelected(id); setMenuOpen(false); }, []);

  const confirmRemove = async () => {
    if (!toRemove) return;
    await removeAccount(toRemove.id);
    setToRemove(null);
    void refresh(true);
  };

  const crumb = selected === 'all' ? 'All accounts' : accounts.find((a) => a.id === selected)?.name ?? 'Account';

  const sidebar = (
    <Sidebar
      accounts={accounts} selected={selected} onSelect={select} onAdd={() => { setAddOpen(true); setMenuOpen(false); }}
      search={search} onSearch={setSearch} lastLoad={lastLoad} now={now} mock={!!data?.mock}
    />
  );

  return (
    <div className="relative flex h-full">
      <Aurora />

      {/* desktop sidebar */}
      <aside className="relative z-10 hidden w-[256px] shrink-0 border-r border-line lg:block">{sidebar}</aside>

      {/* mobile sidebar */}
      <div className={`fixed inset-0 z-40 lg:hidden ${menuOpen ? '' : 'pointer-events-none'}`}>
        <div className={`absolute inset-0 bg-black/40 transition-opacity ${menuOpen ? 'opacity-100' : 'opacity-0'}`} onClick={() => setMenuOpen(false)} />
        <aside className={`absolute inset-y-0 left-0 w-[272px] border-r border-line transition-transform duration-300 ease-out-expo ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          {sidebar}
        </aside>
      </div>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-y-auto">
        <Header crumb={crumb} dark={dark} loading={loading} onToggleTheme={toggle} onRefresh={() => void refresh(true)} onMenu={() => setMenuOpen(true)} />

        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 pt-7 pb-14 sm:px-6">
          <div className="animate-rise mb-6">
            <h1 className="shiny text-[28px] leading-tight font-semibold tracking-tight">Your Claude limits</h1>
            <p className="mt-1 text-sm text-muted-fg">
              Live usage across {accounts.length || 'your'} account{accounts.length === 1 ? '' : 's'}, including what you use on your phone and other computers.
            </p>
          </div>

          {error && (
            <div className="animate-rise mb-5 flex items-center gap-3 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
              <WifiOff className="size-4 text-bad" />
              The dashboard server isn’t reachable ({error}). Is <code className="rounded bg-frame px-1">npm run dev</code> still running?
            </div>
          )}

          {!data && !error && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-[178px] animate-pulse rounded-xl border border-line bg-frame" />)}
            </div>
          )}

          {data && (
            <div className="flex flex-col gap-4">
              <StatRow accounts={visible} now={now} tick={tick} />

              <div className="grid gap-4 xl:grid-cols-3">
                <div className="min-w-0 xl:col-span-2">
                  <TrendCard accounts={accounts} preferredId={selected} tick={tick} range={range} onRange={setRange} />
                </div>
                <ResetTimeline accounts={visible} now={now} />
              </div>

              <div className="mt-2 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold tracking-tight">Accounts</h2>
                <button onClick={() => setAddOpen(true)} className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-accent/50">
                  + Add account
                </button>
              </div>
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))]">
                {visible.map((a, i) => (
                  <AccountCard key={a.id} account={a} now={now} delay={i * 80} onRemove={setToRemove} />
                ))}
              </div>
              {visible.length === 0 && (
                <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-muted-fg">
                  No accounts yet. Use “Add account” to start.
                </div>
              )}

              <LimitTable accounts={visible} now={now} />

              <DailyUsage />
            </div>
          )}

          <p className="mt-8 text-xs leading-relaxed text-subtle-fg">
            Numbers come from Anthropic’s own account totals through an unofficial endpoint, so they can change without notice.
            Logins are read locally and never leave your machine.
          </p>
        </main>
      </div>

      <AddAccountDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => void refresh(true)} />

      <Modal open={!!toRemove} onClose={() => setToRemove(null)} title="Remove account?">
        <p className="text-sm text-muted-fg">
          “{toRemove?.name}” will disappear from this dashboard and its saved history stops growing. Its login and files are not touched.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setToRemove(null)} className="rounded-lg border border-line px-3.5 py-2 text-sm transition-colors hover:bg-frame">Cancel</button>
          <button onClick={() => void confirmRemove()} className="rounded-lg bg-bad px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">Remove</button>
        </div>
      </Modal>
    </div>
  );
}
