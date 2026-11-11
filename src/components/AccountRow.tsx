import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { ChevronDown, EllipsisVertical, KeyRound, TriangleAlert, Trash2, WifiOff } from 'lucide-react';
import { ProviderIcon, providerOf } from './ProviderIcon';
import { planClasses } from '../lib/plan';
import type { Account, UsageWindow } from '../lib/types';
import { colorVar, isIdle, levelFor, mainWindows } from '../lib/format';
import { accountReset } from '../lib/reset';
import { useNow } from '../lib/api';
import { LONG_PRESS_MS, movedTooFar } from '../lib/keyboard';
import { Chip } from './Chip';
import { UsageBar } from './UsageBar';
import { Countdown } from './Countdown';

interface Props {
  account: Account;
  now: number;
  best?: boolean;
  onRemove: (a: Account) => void;
  onLogin: (a: Account) => Promise<void>;
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void;
  /** Opens the account action menu from a visible button (keyboard and touch friendly). */
  onMenu?: (anchor: HTMLElement) => void;
  /** Touch long-press on the row (iOS fires no contextmenu event). */
  onLongPress?: (x: number, y: number) => void;
}

const SHORT: Record<string, string> = { five_hour: '5 hour', seven_day: 'Weekly' };
const shortLabel = (w: UsageWindow) => SHORT[w.key] ?? w.label.replace(/ · all models$/i, '');

function ResetCountdown({ at, estimated }: { at: number; estimated: boolean }) {
  const now = useNow(1000);
  if (at <= now) return <>Reset reached, updating usage</>;
  return <>{estimated ? 'Estimated reset in ' : 'Resets in '}<b className="font-semibold text-fg tabular-nums"><Countdown at={at} /></b></>;
}

function Bar({ w, now, account }: { w: UsageWindow; now: number; account: Account }) {
  const reset = accountReset(account, w, now);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[13px]">
        <span>{w.label}</span>
        <span className="tabular-nums text-muted-fg">{w.expired ? 'previous period · ' : ''}{Math.round(w.used)}% used</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-frame">
        <div className="h-full rounded-full" style={{ width: `${w.used}%`, background: colorVar(levelFor(w.used)), transition: 'width 0.5s var(--ease-out-expo)' }} />
      </div>
      {(w.resetsAt || account.stale) && (
        <div className="mt-1 text-[11.5px] text-subtle-fg">
          {reset ? <ResetCountdown at={reset.at} estimated={reset.estimated} /> : account.stale ? 'Reset time unavailable' : 'Awaiting updated reset'}
        </div>
      )}
    </div>
  );
}

function Chats({ a }: { a: Account }) {
  const list = a.sessions ?? [];
  if (!list.length) return <p className="text-[13px] text-subtle-fg">No active chats</p>;
  const shown = list.slice(0, 6);
  return (
    <ul className="flex flex-col gap-1.5">
      {shown.map((s) => (
        <li key={s.id} className="flex min-w-0 items-center gap-2 text-[13px]">
          <span title={s.state === 'paused' ? '5-hour limit reached' : s.state === 'waiting' ? 'Waiting' : 'Working'} className={`block size-[7px] shrink-0 rounded-full ${s.state === 'paused' ? 'bg-bad' : s.state === 'waiting' ? 'bg-warn' : 'bg-good'}`} />
          <span className="min-w-0 flex-1 truncate">{s.name || s.folder || 'Untitled chat'}</span>
          <span className="ml-auto shrink-0 text-[11.5px] text-subtle-fg">{s.state === 'paused' ? 'limit paused' : s.state === 'waiting' ? 'waiting' : 'working'}</span>
        </li>
      ))}
      {list.length > shown.length && <li className="text-[11.5px] text-subtle-fg">+{list.length - shown.length} more</li>}
    </ul>
  );
}

const chatSummary = (a: Account) => {
  const list = a.sessions ?? [];
  const working = list.filter((s) => s.working).length;
  const paused = list.filter((s) => s.state === 'paused').length;
  if (!list.length) return 'No open chats';
  return `${list.length} open chat${list.length === 1 ? '' : 's'}${working ? ` · ${working} working` : ''}${paused ? ` · ${paused} limit paused` : ''}`;
};

/** A ruled row in the accounts ledger. Click it to see chats, extra limits and the folder. */
export function AccountRow({ account: a, now, best = false, onRemove, onLogin, onContextMenu, onMenu, onLongPress }: Props) {
  const [open, setOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const needsLogin = ['no_login', 'expired'].includes(a.authStatus ?? a.status);

  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const cancelPress = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };
  useEffect(() => cancelPress, []);
  const touch = onLongPress ? {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch' || (e.target as HTMLElement).closest('button, a, input, select')) return;
      cancelPress();
      const x = e.clientX, y = e.clientY;
      press.current = { x, y, timer: setTimeout(() => { press.current = null; onLongPress(x, y); }, LONG_PRESS_MS) };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (press.current && movedTooFar(e.clientX - press.current.x, e.clientY - press.current.y)) cancelPress();
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
  } : {};

  const loginButton = needsLogin && (
    <div className="mt-3">
      <button disabled={signingIn} className="rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-fg transition-transform active:scale-[0.96] disabled:opacity-50" onClick={async () => {
        setSigningIn(true);
        setLoginError(null);
        try { await onLogin(a); } catch (error) { setLoginError(error instanceof Error ? error.message : 'Could not start sign-in.'); }
        finally { setSigningIn(false); }
      }}>{signingIn ? 'Opening sign-in…' : 'Sign in for usage'}</button>
      {loginError && <p role="alert" className="mt-2 text-xs text-bad">{loginError}</p>}
    </div>
  );

  const actions = (
    <div className="flex items-center gap-0.5">
      {onMenu && (
        <button
          onClick={(e) => { e.stopPropagation(); onMenu(e.currentTarget); }}
          aria-haspopup="menu" aria-label={`${a.name} actions`} title="Account actions"
          className="relative grid size-8 place-items-center rounded-lg text-subtle-fg transition-colors hover:bg-frame hover:text-fg"
        >
          <EllipsisVertical className="size-4" />
        </button>
      )}
      <button
        onClick={() => onRemove(a)}
        title="Remove from dashboard (does not touch the login)" aria-label={`Remove ${a.name} from dashboard`}
        className="relative grid size-8 place-items-center rounded-lg text-subtle-fg transition-colors hover:bg-bad/10 hover:text-bad"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );

  const badge = (
    <>
      {a.plan && <Chip className={planClasses(a.plan)}>{a.plan}</Chip>}
      {!a.plan && a.planUnknown && <span title="Plan not detected yet, so some limits may be missing until the next live reading"><Chip tone="mute">Plan unknown</Chip></span>}
      {best && <span className="inline-flex items-center rounded-md bg-primary px-1.5 py-0.5 text-[11.5px] font-semibold text-primary-fg">Use next</span>}
    </>
  );

  const broken = a.status !== 'ok' || !a.windows?.length;
  const main = broken ? [] : mainWindows(a);
  const five = main.find((w) => w.key === 'five_hour');
  const week = main.find((w) => w.key === 'seven_day');
  const tanks: [UsageWindow | undefined, string][] | null = main.length === 1 && !five && !week ? [[main[0], shortLabel(main[0])]] : null;
  const rest = broken ? [] : (a.windows ?? []).filter((w) => !main.includes(w));
  const weeklyPending = !broken && /^Team\b/i.test(a.plan ?? '') && !a.windows?.some((w) => w.key === 'seven_day');

  const header = (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-frame"><ProviderIcon provider={providerOf(a)} className="size-[18px]" title={false} /></span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-base font-semibold tracking-tight">
          <span className="truncate">{a.name}</span>{badge}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-[12.5px] text-subtle-fg">
          {broken ? <span className="size-[7px] rounded-full bg-warn" /> : isIdle(a) ? <span className="idle-dot !size-[7px]" title="Idle: nothing used in the current windows" /> : <span className="live-dot !size-[7px]" />}
          <span className="truncate">{chatSummary(a)} · {a.configDir}</span>
        </div>
      </div>
    </div>
  );

  if (broken) {
    const Icon = a.status === 'no_login' || a.status === 'expired' ? KeyRound : a.status === 'error' ? WifiOff : TriangleAlert;
    const message = a.message || (a.status === 'ok' ? 'The server returned no usage windows for this account yet. It will retry on the next poll.' : 'No details were reported. It will retry on the next poll.');
    return (
      <article {...touch} onContextMenu={onContextMenu} className="relative border-t border-line px-5 py-5 first:border-t-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {header}
          {actions}
        </div>
        <div className="mt-4 flex gap-3 rounded-xl bg-warn/10 p-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-warn/15 text-warn"><Icon className="size-4" /></div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">{a.status === 'no_login' ? 'CLI usage login missing' : a.status === 'expired' ? 'Login expired' : 'Can’t read usage'}</div>
            <p className="mt-0.5 text-[13px] text-muted-fg">{message}</p>
            {loginButton}
          </div>
        </div>
        {(a.sessions?.length ?? 0) > 0 && <div className="mt-4"><Chats a={a} /></div>}
      </article>
    );
  }

  const shown: [UsageWindow | undefined, string][] = tanks ?? [[five, '5 hour'], [week, 'Weekly']];
  const bars = shown.filter(([w]) => w) as [UsageWindow, string][];

  return (
    <article {...touch} onContextMenu={onContextMenu} className="relative border-t border-line first:border-t-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-8 gap-y-5 px-5 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]">
        <button
          onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="-m-1 min-w-0 rounded-lg p-1 text-left outline-offset-0"
        >
          {header}
        </button>
        <div className="flex items-center gap-1 md:col-start-3 md:row-start-1">
          {actions}
          <button onClick={() => setOpen((v) => !v)} aria-label={open ? `Hide details for ${a.name}` : `Show details for ${a.name}`} aria-expanded={open} className="grid size-8 place-items-center rounded-lg text-subtle-fg transition-colors hover:bg-frame hover:text-fg">
            <ChevronDown className={`size-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
        <div className="col-span-2 grid min-w-0 gap-5 md:col-span-1 md:col-start-2 md:row-start-1">
          {bars.map(([w, l]) => <UsageBar key={w.key} w={w} label={l} account={a} now={now} />)}
          {!week && weeklyPending && <p className="text-[12.5px] text-subtle-fg">Weekly limit: {needsLogin ? 'sign in to check it' : 'checked with the next usage update'}.</p>}
          {a.stale && <p className="text-[11.5px] leading-relaxed text-subtle-fg">Last read {new Date(a.fetchedAt).toLocaleString()}{a.staleMessage ? ` · ${a.staleMessage}` : ''}</p>}
        </div>
      </div>
      {open && (
        <div className="animate-fade grid gap-5 border-t border-line bg-frame/40 px-5 py-5 md:grid-cols-2">
          <div>
            <div className="mb-2 text-[12px] font-semibold text-muted-fg">Chats</div>
            <Chats a={a} />
          </div>
          <div className="min-w-0">
            {rest.length > 0 && <div className="mb-4 grid gap-3.5">{rest.map((w) => <Bar key={w.key} w={w} now={now} account={a} />)}</div>}
            <div className="text-[12px] font-semibold text-muted-fg">Folder</div>
            <p className="mt-1 truncate text-[12.5px] text-subtle-fg">{a.configDir}</p>
            {loginButton}
          </div>
        </div>
      )}
    </article>
  );
}
