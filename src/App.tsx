import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Hourglass, WifiOff, X } from 'lucide-react';
import { openClaude, removeAccount, shareLocalChats, syncAllAccounts, startAccountLogin, syncCodeSetup, syncDesktopChats, syncDesktopLabels, useNow, useUsage } from './lib/api';
import { useTheme } from './lib/theme';
import { useAlerts, useNotifyPref } from './lib/alerts';
import { useEffectsPref } from './lib/effects';
import { trapTab } from './lib/keyboard';
import type { Account, RangeKey } from './lib/types';
import { Aurora } from './components/Aurora';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { StatRow } from './components/StatRow';
import { TrendCard } from './components/TrendCard';
import { ResetTimeline } from './components/ResetTimeline';
import { AccountCard } from './components/AccountCard';
import { AccountMenu, type MenuAction } from './components/AccountMenu';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LimitTable } from './components/LimitTable';
import { DailyUsage } from './components/DailyUsage';
import { Ago } from './components/Countdown';
import { SyncSetupDialog } from './components/SyncSetupDialog';
import { AddAccountDialog } from './components/AddAccountDialog';
import { Modal } from './components/Modal';

type WithInert = HTMLElement & { inert?: boolean };

export default function App() {
  const { data, loading, error, stalled, lastLoad, refresh, restart } = useUsage();
  // coarse clock for sorting and reset detection; per-second countdown text lives in <Countdown> leaves
  const now = useNow(30_000);
  const { dark, toggle } = useTheme();
  const notify = useNotifyPref();
  const effects = useEffectsPref();

  const [selected, setSelected] = useState('all');
  const [range, setRange] = useState<RangeKey>('24h');
  const [addOpen, setAddOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchReq, setSearchReq] = useState(0);
  const [search, setSearch] = useState('');
  const [toRemove, setToRemove] = useState<Account | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [removing, setRemoving] = useState(false);
  const [contextAccount, setContextAccount] = useState<{ account: Account; x: number; y: number } | null>(null);
  const [setup, setSetup] = useState<{ open: boolean; sourceId: string; targetId: string }>({ open: false, sourceId: '', targetId: '' });
  const [notice, setNotice] = useState<string | null>(null);
  const drawer = useRef<HTMLElement>(null);

  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const visible = selected === 'all' ? accounts : accounts.filter((a) => a.id === selected);
  // history only changes when a new reading is recorded, not on every poll
  const tick = useMemo(() => accounts.reduce((m, a) => Math.max(m, a.fetchedAt || 0), 0), [accounts]);

  useAlerts(accounts, notify.enabled);

  // pause animations while the tab is hidden
  useEffect(() => {
    const sync = () => document.documentElement.classList.toggle('page-hidden', document.hidden);
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  // status banner: auto-dismiss after a while
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 12_000);
    return () => clearTimeout(id);
  }, [notice]);

  const openMenuAt = useCallback((account: Account, x: number, y: number) => setContextAccount({ account, x, y }), []);

  const openAccountMenu = (account: Account, e: MouseEvent) => {
    e.preventDefault();
    openMenuAt(account, e.clientX, e.clientY);
  };

  const openMenuFromButton = (account: Account, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect();
    openMenuAt(account, r.right - 256, r.bottom + 4);
  };

  const runAction = async (fn: () => Promise<string>, fallback: string) => {
    setContextAccount(null);
    try { setNotice(await fn()); }
    catch (err) { setNotice(err instanceof Error ? err.message : fallback); }
  };

  const menuActions = (target: Account): MenuAction[] => {
    const out: MenuAction[] = [
      { label: `Open Claude Code as ${target.name}`, run: () => void runAction(() => openClaude(target.id, 'code', target.name), 'Could not open Claude Code.') },
      { label: `Open Claude Desktop as ${target.name}`, run: () => void runAction(() => openClaude(target.id, 'desktop', target.name), 'Could not open Claude Desktop.') },
    ];
    // source for chat sharing: the 'personal' account when present, otherwise any other account
    const source = accounts.find((a) => a.id === 'personal' && a.id !== target.id) ?? accounts.find((a) => a.id !== target.id);
    if (!source) return out;
    out.push(
      { label: 'Sync all accounts (chats, skills, plugins)', run: () => void runAction(syncAllAccounts, 'Could not sync the accounts.') },
      { label: `Share ${source.name} CLI chats with ${target.name}`, run: () => void runAction(() => shareLocalChats(source.id, target.id, target.name), 'Could not share local chats.') },
      { label: 'Sync local Desktop chats across profiles', run: () => void runAction(syncDesktopChats, 'Could not sync Desktop sessions.') },
      { label: 'Sync Desktop chat names and groups', run: () => void runAction(syncDesktopLabels, 'Could not sync Desktop names and groups.') },
    );
    const from = accounts.find((a) => a.id === 'personal' && a.id !== target.id) ?? source;
    out.push({ label: 'Copy local Code plugins and skills…', run: () => { setContextAccount(null); setSetup({ open: true, sourceId: from.id, targetId: target.id }); } });
    return out;
  };

  const signInForUsage = useCallback(async (account: Account) => {
    await startAccountLogin(account.id);
    setNotice(`Claude Code sign-in opened for ${account.name}. Finish sign-in there; usage will refresh automatically.`);
  }, []);

  // fall back to the overview if the selected account disappears
  useEffect(() => {
    if (selected !== 'all' && data && !accounts.some((a) => a.id === selected)) setSelected('all');
  }, [data, accounts, selected]);

  // refresh a few seconds after a window resets
  const resetSeen = useRef(new Set<string>());
  const resetTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const present = new Set<string>();
    for (const a of accounts) {
      for (const w of a.windows ?? []) {
        if (!w.resetsAt) continue;
        const id = a.id + '|' + w.resetsAt;
        present.add(id);
        const at = new Date(w.resetsAt).getTime();
        if (!a.stale && at < now && now - at < 60000 && !resetSeen.current.has(id)) {
          resetSeen.current.add(id);
          const timer = setTimeout(() => { resetTimers.current.delete(timer); void refresh(true); }, 4000);
          resetTimers.current.add(timer);
        }
      }
    }
    for (const id of resetSeen.current) if (!present.has(id)) resetSeen.current.delete(id); // prune
  }, [now, accounts, refresh]);
  useEffect(() => {
    const timers = resetTimers.current;
    return () => { timers.forEach(clearTimeout); timers.clear(); };
  }, []);

  // ⌘K / Ctrl+K focuses the account search (opening the drawer only on narrow screens)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (!matchMedia('(min-width: 1024px)').matches) setMenuOpen(true);
        setSearchReq((n) => n + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // mobile drawer: hidden from tab order and screen readers while closed
  useEffect(() => {
    if (drawer.current) (drawer.current as WithInert).inert = !menuOpen;
  }, [menuOpen]);

  // focus the visible search field after ⌘K or when the drawer opens; give focus back on close
  const searchSeen = useRef(0);
  useEffect(() => {
    const requested = searchReq !== searchSeen.current;
    searchSeen.current = searchReq;
    if (!menuOpen && !requested) return;
    const opener = document.activeElement as HTMLElement | null;
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-account-search]'));
    inputs.find((el) => el.getClientRects().length > 0 && !el.closest('[inert]'))?.focus(); // the visible copy, not the hidden or inert one
    return () => {
      if (!menuOpen) return;
      // Safari does not focus a button on click, so fall back to the Menu button itself
      const back = opener && opener !== document.body ? opener : document.querySelector<HTMLElement>('button[aria-controls="mobile-sidebar"]');
      if (back && document.contains(back)) back.focus();
    };
  }, [menuOpen, searchReq]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
      else trapTab(e, drawer.current); // Tab / Shift+Tab wrap inside the open drawer
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const select = useCallback((id: string) => { setSelected(id); setMenuOpen(false); setNotice(null); }, []);
  const closeAdd = useCallback(() => setAddOpen(false), []);
  const onAdded = useCallback(() => void refresh(true), [refresh]);
  const closeRemove = useCallback(() => { setToRemove(null); setRemoveError(''); }, []);
  const closeContext = useCallback(() => setContextAccount(null), []);
  const closeSetup = useCallback(() => setSetup((s) => ({ ...s, open: false })), []);
  const runSetup = useCallback((sourceId: string, targetId: string) => {
    const name = accounts.find((a) => a.id === targetId)?.name;
    setSetup((s) => ({ ...s, open: false }));
    void runAction(() => syncCodeSetup(sourceId, targetId, name), 'Could not sync local Claude Code setup.');
  }, [accounts]);

  const confirmRemove = async () => {
    if (!toRemove || removing) return;
    setRemoving(true);
    setRemoveError('');
    try {
      await removeAccount(toRemove.id);
      closeRemove();
      void refresh(true);
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : 'Could not remove the account.');
    } finally {
      setRemoving(false);
    }
  };

  const crumb = selected === 'all' ? 'All accounts' : accounts.find((a) => a.id === selected)?.name ?? 'Account';

  const sidebar = (
    <Sidebar
      accounts={accounts} selected={selected} onSelect={select} onAdd={() => { setAddOpen(true); setMenuOpen(false); }}
      search={search} onSearch={setSearch} lastLoad={lastLoad} mock={!!data?.mock}
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
        <aside
          id="mobile-sidebar"
          ref={drawer}
          role="dialog"
          aria-label="Accounts"
          aria-modal={menuOpen}
          className={`absolute inset-y-0 left-0 w-[272px] border-r border-line transition-transform duration-300 ease-out-expo ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          {sidebar}
        </aside>
      </div>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-y-auto">
        <Header
          crumb={crumb} dark={dark} loading={loading} onToggleTheme={toggle} onRefresh={() => void refresh(true)}
          onMenu={() => setMenuOpen(true)} menuOpen={menuOpen} notify={notify} effects={effects}
        />

        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 pt-7 pb-14 sm:px-6">
          <div className="animate-rise mb-6">
            <h1 className="shiny text-[28px] leading-tight font-semibold tracking-tight">Your Claude limits</h1>
            <p className="mt-1 text-sm text-muted-fg">
              Live usage across {accounts.length || 'your'} account{accounts.length === 1 ? '' : 's'}, including what you use on your phone and other computers.
            </p>
          </div>

          {error && (
            <div role="alert" className="animate-rise mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
              <WifiOff className="size-4 shrink-0 text-bad" />
              <span className="min-w-0 flex-1">
                The dashboard server isn’t reachable ({error}).
                {data && lastLoad ? <> Showing the last reading from <Ago since={lastLoad} />.</> : null}
              </span>
              <button onClick={() => void refresh(true)} className="rounded-lg border border-line bg-card px-3 py-1 text-xs font-medium transition-colors hover:border-accent/50">Retry</button>
            </div>
          )}

          {stalled && !error && (
            <div role="status" className="animate-rise mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
              <Hourglass className="size-4 shrink-0 text-warn" />
              <span className="min-w-0 flex-1">
                The dashboard server is slow to answer.{data && lastLoad ? <> Showing the last reading from <Ago since={lastLoad} />.</> : ' Still waiting for the first reading.'}
              </span>
              <button onClick={restart} className="rounded-lg border border-line bg-card px-3 py-1 text-xs font-medium transition-colors hover:border-accent/50">Cancel and retry</button>
            </div>
          )}

          {notice && (
            <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-line bg-card px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">{notice}</span>
              <button onClick={() => setNotice(null)} aria-label="Dismiss message" className="rounded-md p-0.5 text-muted-fg transition-colors hover:bg-frame hover:text-fg"><X className="size-4" /></button>
            </div>
          )}

          {!data && !error && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-[178px] animate-pulse rounded-xl border border-line bg-frame" />)}
            </div>
          )}

          {data && (
            <div className="flex flex-col gap-4">
              <ErrorBoundary label="Summary cards"><StatRow accounts={visible} now={now} tick={tick} /></ErrorBoundary>

              <div className="grid gap-4 xl:grid-cols-3">
                <div className="min-w-0 xl:col-span-2">
                  <ErrorBoundary label="Usage trend"><TrendCard accounts={accounts} preferredId={selected} tick={tick} range={range} onRange={setRange} /></ErrorBoundary>
                </div>
                <ErrorBoundary label="Upcoming resets"><ResetTimeline accounts={accounts} now={now} /></ErrorBoundary>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold tracking-tight">Accounts</h2>
                <button onClick={() => setAddOpen(true)} className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-accent/50">
                  + Add account
                </button>
              </div>
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))]">
                {visible.map((a, i) => (
                  <ErrorBoundary key={a.id} label={a.name}>
                    <AccountCard
                      account={a} now={now} delay={i * 80} onRemove={setToRemove} onLogin={signInForUsage}
                      onContextMenu={(e) => openAccountMenu(a, e)} onMenu={(el) => openMenuFromButton(a, el)} onLongPress={(x, y) => openMenuAt(a, x, y)}
                    />
                  </ErrorBoundary>
                ))}
              </div>
              {visible.length === 0 && (
                <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-muted-fg">
                  No accounts yet. Use “Add account” to start.
                </div>
              )}

              <ErrorBoundary label="Limit monitor"><LimitTable accounts={visible} now={now} /></ErrorBoundary>

              <ErrorBoundary label="Daily usage"><DailyUsage /></ErrorBoundary>
            </div>
          )}

          <p className="mt-8 text-xs leading-relaxed text-subtle-fg">
            Numbers come from Anthropic’s own account totals through an unofficial endpoint, so they can change without notice.
            Logins are read locally and never leave your machine.
          </p>
        </main>
      </div>

      <AddAccountDialog open={addOpen} onClose={closeAdd} onAdded={onAdded} />
      {contextAccount && (
        <AccountMenu
          account={contextAccount.account}
          x={contextAccount.x}
          y={contextAccount.y}
          actions={menuActions(contextAccount.account)}
          emptyHint="Add a second account to share chats or sync Desktop data between accounts."
          onClose={closeContext}
        />
      )}

      <SyncSetupDialog open={setup.open} accounts={accounts} defaultSourceId={setup.sourceId} defaultTargetId={setup.targetId} onClose={closeSetup} onRun={runSetup} />

      <Modal open={!!toRemove} onClose={closeRemove} title="Remove account?">
        <p className="text-sm text-muted-fg">
          “{toRemove?.name}” will disappear from this dashboard and its saved history stops growing. Its login and files are not touched.
        </p>
        {removeError && <p role="alert" className="mt-3 text-[13px] text-bad">{removeError}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={closeRemove} className="rounded-lg border border-line px-3.5 py-2 text-sm transition-colors hover:bg-frame">Cancel</button>
          <button disabled={removing} onClick={() => void confirmRemove()} className="rounded-lg bg-bad px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60">
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
