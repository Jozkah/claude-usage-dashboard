import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Hourglass, Plus, WifiOff, X } from 'lucide-react';
import { openClaude, removeAccount, setTeamSeat, shareLocalChats, syncAllAccounts, startAccountLogin, syncCodeSetup, syncDesktopChats, syncDesktopLabels, useNow, useUsage } from './lib/api';
import { useTheme } from './lib/theme';
import { useAlerts, useNotifyPref } from './lib/alerts';
import { useEffectsPref } from './lib/effects';
import type { Account, RangeKey } from './lib/types';
import { headroom } from './lib/format';
import { Header } from './components/Header';
import { TrendCard } from './components/TrendCard';
import { ResetTimeline } from './components/ResetTimeline';
import { AccountRow } from './components/AccountRow';
import { PooledLimits } from './components/PooledLimits';
import { LazySection } from './components/LazySection';
import { useScrollRestore } from './lib/scroll';
import { AccountMenu, type MenuAction } from './components/AccountMenu';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LimitTable } from './components/LimitTable';
import { DailyUsage } from './components/DailyUsage';
import { Ago } from './components/Countdown';
import { SyncSetupDialog } from './components/SyncSetupDialog';
import { AddAccountDialog } from './components/AddAccountDialog';
import { Modal } from './components/Modal';

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
  const [toRemove, setToRemove] = useState<Account | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [removing, setRemoving] = useState(false);
  const [contextAccount, setContextAccount] = useState<{ account: Account; x: number; y: number } | null>(null);
  const [setup, setSetup] = useState<{ open: boolean; sourceId: string; targetId: string }>({ open: false, sourceId: '', targetId: '' });
  const [notice, setNotice] = useState<string | null>(null);

  useScrollRestore(!!data);
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
    if (target.provider) {
      const product = target.provider === 'grok' ? 'Grok' : target.provider === 'cursor' ? 'Cursor' : target.provider === 'opencode' ? 'OpenCode' : 'Codex';
      if (target.provider === 'cursor') return [];
      return [{ label: `Open ${product} as ${target.name}`, run: () => void runAction(() => openClaude(target.id, 'code', target.name, product), `Could not open ${product}.`) }];
    }
    const claude = accounts.filter((a) => !a.provider);
    const out: MenuAction[] = [
      { label: `Open Claude Code as ${target.name}`, run: () => void runAction(() => openClaude(target.id, 'code', target.name), 'Could not open Claude Code.') },
      { label: `Open Claude Desktop as ${target.name}`, run: () => void runAction(() => openClaude(target.id, 'desktop', target.name), 'Could not open Claude Desktop.') },
    ];
    if (/^Team\b/i.test(target.plan ?? '')) {
      for (const seat of ['standard', 'premium'] as const) {
        out.push({ label: `Mark seat ${seat === 'standard' ? 'Standard' : 'Premium'}`, run: () => void runAction(async () => {
          const message = await setTeamSeat(target.id, seat);
          await refresh(true);
          return message;
        }, 'Could not save Team seat.') });
      }
      if (target.seatTier) out.push({ label: 'Clear seat label', run: () => void runAction(async () => {
        const message = await setTeamSeat(target.id, null);
        await refresh(true);
        return message;
      }, 'Could not clear Team seat.') });
    }
    // source for chat sharing: the 'personal' account when present, otherwise any other account
    const source = claude.find((a) => a.id === 'personal' && a.id !== target.id) ?? claude.find((a) => a.id !== target.id);
    if (!source) return out;
    out.push(
      { label: 'Sync all accounts (chats, skills, plugins)', run: () => void runAction(syncAllAccounts, 'Could not sync the accounts.') },
      { label: `Share ${source.name} CLI chats with ${target.name}`, run: () => void runAction(() => shareLocalChats(source.id, target.id, target.name), 'Could not share local chats.') },
      { label: 'Sync local Desktop chats across profiles', run: () => void runAction(syncDesktopChats, 'Could not sync Desktop sessions.') },
      { label: 'Sync Desktop chat names and groups', run: () => void runAction(syncDesktopLabels, 'Could not sync Desktop names and groups.') },
    );
    const from = claude.find((a) => a.id === 'personal' && a.id !== target.id) ?? source;
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
        if (!a.stale && at > Date.now() - 60000 && at - Date.now() < 8 * 864e5 && !resetSeen.current.has(id)) {
          resetSeen.current.add(id);
          const timer = setTimeout(() => { resetTimers.current.delete(timer); void refresh(true); }, Math.max(0, at - Date.now() + 4000));
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

  const select = useCallback((id: string) => { setSelected(id); setNotice(null); }, []);
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

  const ok = accounts.filter((a) => a.status === 'ok' && a.windows?.length);
  const best = ok.length > 1 ? [...ok].sort((a, b) => headroom(b) - headroom(a))[0] : undefined;
  const headline = best ? `Most room: ${best.name}` : 'Usage limits';
  const hint = `${accounts.length || 'Your'} account${accounts.length === 1 ? '' : 's'} across Claude Code and Codex. Bars show what is left; the tick is even pacing.`;
  const pick = (id: string) => { select(id); document.getElementById('accounts')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };

  return (
    <div className="relative min-h-full overflow-x-hidden">
      <Header dark={dark} loading={loading} onToggleTheme={toggle} onRefresh={() => void refresh(true)} notify={notify} effects={effects} />

      <main className="relative z-10 mx-auto w-full max-w-[1040px] px-4 pt-8 pb-24 sm:px-5">
        <header className="animate-rise">
          <h1 className="text-[26px] leading-tight font-bold tracking-[-0.03em]">{headline}</h1>
          <p className="mt-1.5 max-w-[60ch] text-[14px] leading-relaxed text-muted-fg text-pretty">{hint}</p>
        </header>

        <div className="mt-7 flex flex-col gap-4">
          {error && (
            <div role="alert" className="animate-rise flex flex-wrap items-center gap-3 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
              <WifiOff className="size-4 shrink-0 text-bad" />
              <span className="min-w-0 flex-1">
                The dashboard server isn’t reachable ({error}).
                {data && lastLoad ? <> Showing the last reading from <Ago since={lastLoad} />.</> : null}
              </span>
              <button onClick={() => void refresh(true)} className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold transition-transform active:scale-[0.96]">Retry</button>
            </div>
          )}

          {stalled && !error && (
            <div role="status" className="animate-rise flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
              <Hourglass className="size-4 shrink-0 text-warn" />
              <span className="min-w-0 flex-1">
                The dashboard server is slow to answer.{data && lastLoad ? <> Showing the last reading from <Ago since={lastLoad} />.</> : ' Still waiting for the first reading.'}
              </span>
              <button onClick={restart} className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold transition-transform active:scale-[0.96]">Cancel and retry</button>
            </div>
          )}

          {notice && (
            <div role="status" className="flex items-start gap-3 rounded-xl border border-line bg-card px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">{notice}</span>
              <button onClick={() => setNotice(null)} aria-label="Dismiss message" className="rounded-md p-0.5 text-muted-fg transition-colors hover:bg-frame hover:text-fg"><X className="size-4" /></button>
            </div>
          )}

          {!data && !error && (
            <div className="panel overflow-hidden">
              {[0, 1, 2].map((i) => <div key={i} className="h-[118px] animate-pulse border-t border-line bg-frame/50 first:border-t-0" />)}
            </div>
          )}

          {data && (
            <>
              <section id="limits" className="scroll-mt-16">
                <h2 className="mb-3 px-1 text-[18px] font-bold tracking-[-0.02em]">Limits</h2>
                <PooledLimits accounts={accounts} now={now} onPick={pick} />
              </section>

              <section id="accounts" className="mt-8 scroll-mt-16">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
                  <h2 className="text-[18px] font-bold tracking-[-0.02em]">Accounts</h2>
                  <div className="flex items-center gap-2">
                    {accounts.length > 1 && (
                      <div role="group" aria-label="Show accounts" className="flex rounded-lg border border-line bg-frame p-0.5 text-[12.5px]">
                        {[{ id: 'all', name: 'All' }, ...accounts].map((a) => (
                          <button
                            key={a.id} onClick={() => select(a.id)} aria-pressed={selected === a.id}
                            className={`relative max-w-[120px] truncate rounded-md px-2.5 py-1 font-medium transition-[color,background-color] duration-150 after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] ${selected === a.id ? 'bg-card text-fg shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-muted-fg hover:text-fg'}`}
                          >
                            {a.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-semibold transition-[transform,border-color] duration-150 active:scale-[0.96] hover:border-fg/40">
                      <Plus className="size-3.5" /> Add account
                    </button>
                  </div>
                </div>
                <div className="panel overflow-hidden">
                  {visible.map((a) => (
                    <ErrorBoundary key={a.id} label={a.name}>
                      <AccountRow
                        account={a} now={now} best={!!best && best.id === a.id && selected === 'all'} onRemove={setToRemove} onLogin={signInForUsage}
                        onContextMenu={(e) => openAccountMenu(a, e)} onMenu={(el) => openMenuFromButton(a, el)} onLongPress={(x, y) => openMenuAt(a, x, y)}
                      />
                    </ErrorBoundary>
                  ))}
                  {visible.length === 0 && <div className="p-10 text-center text-sm text-muted-fg">No accounts yet. Use “Add account” to start.</div>}
                </div>
              </section>

              <section id="resets" className="mt-10 scroll-mt-16">
                <h2 className="mb-1 px-1 text-[18px] font-bold tracking-[-0.02em]">Resets and trend</h2>
                <p className="mb-4 px-1 text-[13.5px] text-subtle-fg">When each window refills, how fast you are spending it, and the limits behind every account.</p>
                <LazySection minHeight={820}>
                <div className="flex flex-col gap-4">
                  <div className="grid gap-4 lg:grid-cols-5">
                    <div className="min-w-0 lg:col-span-3">
                      <ErrorBoundary label="Usage trend"><TrendCard accounts={accounts} preferredId={selected} tick={tick} range={range} onRange={setRange} /></ErrorBoundary>
                    </div>
                    <div className="min-w-0 lg:col-span-2">
                      <ErrorBoundary label="Upcoming resets"><ResetTimeline accounts={accounts} now={now} /></ErrorBoundary>
                    </div>
                  </div>
                  <ErrorBoundary label="Limit monitor"><LimitTable accounts={visible} now={now} /></ErrorBoundary>
                </div>
                </LazySection>
              </section>

              <section id="usage" className="mt-10 scroll-mt-16">
                <LazySection minHeight={1200}><ErrorBoundary label="Daily usage"><DailyUsage /></ErrorBoundary></LazySection>
              </section>
            </>
          )}
        </div>

        <p className="mt-14 text-center text-xs leading-relaxed text-subtle-fg">
          {data?.mock ? 'Sample data. ' : ''}Numbers come from each provider’s own account totals through unofficial endpoints, so they can change without notice.
          Logins are read locally and never leave your machine.
        </p>
      </main>

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
