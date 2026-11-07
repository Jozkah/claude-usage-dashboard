import { ProviderIcon, providerOf } from './ProviderIcon';
import { planClasses } from '../lib/plan';
import { EllipsisVertical, KeyRound, TriangleAlert, Trash2, WifiOff } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useState } from 'react';
import type { Account, UsageWindow } from '../lib/types';
import { colorVar, elapsedFraction, fmtClock, isIdle, levelFor, mainWindows, paceFor } from '../lib/format';
import { accountReset } from '../lib/reset';
import { useNow } from '../lib/api';
import { Chip } from './Chip';
import { Countdown } from './Countdown';
import { FrameCard } from './FrameCard';
import { Ring } from './Ring';

interface Props {
  account: Account;
  now: number;
  delay: number;
  onRemove: (a: Account) => void;
  onLogin: (a: Account) => Promise<void>;
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void;
  /** Opens the account action menu from a visible button (keyboard and touch friendly). */
  onMenu?: (anchor: HTMLElement) => void;
  /** Touch long-press on the card (iOS fires no contextmenu event). */
  onLongPress?: (x: number, y: number) => void;
}

function ResetCountdown({ at, estimated }: { at: number; estimated: boolean }) {
  const now = useNow(1000);
  if (at <= now) return <>Reset reached · updating usage</>;
  return <>{estimated ? 'Estimated reset in ' : 'Resets in '}<b className="font-semibold text-fg tabular-nums"><Countdown at={at} /></b></>;
}

function Gauge({ w, now, account }: { w: UsageWindow; now: number; account: Account }) {
  const { stale, retryAt } = account;
  const pace = paceFor(w, now);
  const reset = accountReset(account, w, now);
  const previousCycle = w.expired || (stale && w.resetsAt && new Date(w.resetsAt).getTime() <= now);
  return (
    <div className="flex h-[300px] min-w-0 flex-col rounded-lg bg-frame/70 px-2 py-4 text-center">
      <div className="mb-3 text-[13px] font-medium">{w.label}</div>
      <Ring used={w.used} elapsed={previousCycle ? null : elapsedFraction(w, now)} stale={stale} />
      {previousCycle && <div className="mt-2 text-[11.5px] text-subtle-fg">Current usage pending</div>}
      <div className="mt-auto pt-3 text-[12.5px] text-muted-fg">
        {reset ? (
          <>
            <ResetCountdown at={reset.at} estimated={reset.estimated} />
          </>
        ) : stale && retryAt && retryAt > now ? <>Next usage check in <Countdown at={retryAt} /></>
          : stale ? 'Reset needs fresh reading' : w.resetsAt ? 'Awaiting updated reset' : 'Reset time unknown'}
      </div>
      {reset && <div className="text-[11.5px] text-subtle-fg">{fmtClock(reset.at)}</div>}
      <div className="mt-2 h-5">{pace && <Chip tone={pace.tone}>{pace.label}</Chip>}</div>
    </div>
  );
}

function Chats({ a }: { a: Account }) {
  const list = a.sessions ?? [];
  const working = list.filter((s) => s.working).length;
  const waiting = list.filter((s) => s.state === 'waiting').length;
  const paused = list.filter((s) => s.state === 'paused').length;
  const shown = list.slice(0, 4);
  return (
    <div className="mt-3 h-[160px] overflow-hidden rounded-lg border border-line bg-frame/50 px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between text-[12px] font-medium">
        <span>Chats</span>
        <span className="text-muted-fg tabular-nums">
          {working > 0 ? `${working} working` : ''}{working && waiting ? ' · ' : ''}{waiting > 0 ? `${waiting} waiting` : ''}{(working || waiting) && paused ? ' · ' : ''}{paused > 0 ? `${paused} limit paused` : ''}{!working && !waiting && !paused ? '0 active' : ''}
        </span>
      </div>
      <ul className="flex flex-col gap-1 overflow-hidden">
        {shown.map((s) => (
          <li key={s.id} className="flex min-w-0 items-center gap-2 text-[12.5px]">
            <span title={s.state === 'paused' ? '5-hour limit reached' : s.state === 'waiting' ? 'Waiting' : 'Working'} className={`block size-[7px] shrink-0 rounded-full ${s.state === 'paused' ? 'bg-bad' : s.state === 'waiting' ? 'bg-warn' : 'bg-good'}`} />
            <span className="min-w-0 flex-1 truncate">{s.name || s.folder || 'Untitled chat'}</span>
            <span className="ml-auto shrink-0 text-[11.5px] text-subtle-fg tabular-nums">
              {s.state === 'paused' ? 'limit paused' : s.state === 'waiting' ? 'waiting' : 'working'}
            </span>
          </li>
        ))}
      </ul>
      {!list.length && <div className="mt-3 text-center text-xs text-subtle-fg">No active chats</div>}
      {list.length > shown.length && <div className="mt-1 text-[11.5px] text-subtle-fg">+{list.length - shown.length} more</div>}
    </div>
  );
}

function Bar({ w, now, account }: { w: UsageWindow; now: number; account: Account }) {
  const { stale } = account;
  const reset = accountReset(account, w, now);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[13px]">
        <span>{w.label}</span>
        <span className="tabular-nums text-muted-fg">{w.expired ? 'previous period · ' : ''}{Math.round(w.used)}% used</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-frame">
        <div
          className="h-full rounded-full"
          style={{ width: `${w.used}%`, background: colorVar(levelFor(w.used)), transition: 'width 1s var(--ease-out-expo)' }}
        />
      </div>
      {(w.resetsAt || stale) && (
        <div className="mt-1 text-[11.5px] text-subtle-fg">
          {reset ? <ResetCountdown at={reset.at} estimated={reset.estimated} />
            : stale ? 'Reset time unavailable' : 'Awaiting updated reset'}
        </div>
      )}
    </div>
  );
}

export function AccountCard({ account: a, now, delay, onRemove, onLogin, onContextMenu, onMenu, onLongPress }: Props) {
  const [signingIn, setSigningIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const needsLogin = ['no_login', 'expired'].includes(a.authStatus ?? a.status);
  const loginButton = needsLogin && (
    <div className="mt-3">
      <button disabled={signingIn} className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-50" onClick={async () => {
        setSigningIn(true);
        setLoginError(null);
        try { await onLogin(a); } catch (error) { setLoginError(error instanceof Error ? error.message : 'Could not start sign-in.'); }
        finally { setSigningIn(false); }
      }}>{signingIn ? 'Opening sign-in…' : 'Sign in for usage'}</button>
      {loginError && <p role="alert" className="mt-2 text-xs text-bad">{loginError}</p>}
    </div>
  );
  const remove = (
    <button
      onClick={() => onRemove(a)}
      title="Remove from dashboard (does not touch the login)"
      aria-label={`Remove ${a.name} from dashboard`}
      className="rounded-md p-1 text-subtle-fg transition-colors hover:bg-bad/10 hover:text-bad"
    >
      <Trash2 className="size-3.5" />
    </button>
  );
  const right = (
    <div className="flex items-center gap-2">
      {a.plan && <Chip className={planClasses(a.plan)}>{a.plan}</Chip>}
      {!a.plan && a.planUnknown && <span title="Plan not detected yet, so some limits may be missing until the next live reading"><Chip tone="mute">Plan unknown</Chip></span>}
      {onMenu && (
        <button
          onClick={(e) => { e.stopPropagation(); onMenu(e.currentTarget); }}
          aria-haspopup="menu"
          aria-label={`${a.name} actions`}
          title="Account actions"
          className="rounded-md p-1 text-subtle-fg transition-colors hover:bg-frame hover:text-fg"
        >
          <EllipsisVertical className="size-3.5" />
        </button>
      )}
      {remove}
    </div>
  );

  if (a.status !== 'ok' || !a.windows?.length) {
    const Icon = a.status === 'no_login' || a.status === 'expired' ? KeyRound : a.status === 'error' ? WifiOff : TriangleAlert;
    const message = a.message || (a.status === 'ok' ? 'The server returned no usage windows for this account yet. It will retry on the next poll.' : 'No details were reported. It will retry on the next poll.');
    return (
      <FrameCard title={a.name} icon={<span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-warn" /><ProviderIcon provider={providerOf(a)} /></span>} right={right} delay={delay} onContextMenu={onContextMenu} onLongPress={onLongPress}>
        <div className="flex gap-3 p-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-warn/12 text-warn"><Icon className="size-4" /></div>
          <div className="min-w-0">
            <div className="text-sm font-medium">{a.status === 'no_login' ? 'CLI usage login missing' : a.status === 'expired' ? 'Login expired' : 'Can’t read usage'}</div>
            <p className="mt-0.5 text-[13px] text-muted-fg">{message}</p>
            {loginButton}
            <p className="mt-2 truncate text-xs text-subtle-fg">{a.configDir}</p>
          </div>
        </div>
        <div className="px-4 pb-4 -mt-1"><Chats a={a} /></div>
      </FrameCard>
    );
  }

  const main = mainWindows(a);
  const rest = a.windows.filter((w) => !main.includes(w));
  const critical = a.windows.some((w) => w.used >= 90);
  const weeklyPending = /^Team\b/i.test(a.plan ?? '') && !a.windows.some((w) => w.key === 'seven_day');

  return (
    <FrameCard
      title={a.name}
      icon={<span className="flex items-center gap-1.5">{isIdle(a) ? <span className="idle-dot" title="Idle: nothing used in the current windows" /> : <span className="live-dot" />}<ProviderIcon provider={providerOf(a)} /></span>}
      right={right}
      delay={delay}
      beam={critical}
      bodyClassName="flex"
      onContextMenu={onContextMenu}
      onLongPress={onLongPress}
    >
      <div className="flex min-w-0 flex-1 flex-col p-3">
        <div className={`grid gap-3 ${main.length === 1 && !weeklyPending ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {main.map((w) => <Gauge key={w.key} w={w} now={now} account={a} />)}
          {weeklyPending && <div className="flex h-[300px] min-w-0 flex-col rounded-lg bg-frame/70 px-2 py-4 text-center">
            <div className="mb-3 text-[13px] font-medium">Weekly · all models</div>
            <div className="m-auto max-w-36 text-xs leading-relaxed text-subtle-fg">Awaiting fresh usage reading</div>
            <div className="mt-auto text-[11.5px] text-subtle-fg">{needsLogin ? 'Sign in to check weekly limit' : 'Checked with next usage update'}</div>
          </div>}
        </div>
        {rest.length > 0 && (
          <div className="mt-4 grid gap-3.5 px-1 pb-1">{rest.map((w) => <Bar key={w.key} w={w} now={now} account={a} />)}</div>
        )}
        <Chats a={a} />
        <div className="mt-auto flex min-h-[92px] flex-col justify-end">
          {a.stale && <p className="px-1 text-[11px] leading-relaxed text-subtle-fg">Last read {new Date(a.fetchedAt).toLocaleString()} · {a.staleMessage}</p>}
          {loginButton}
          <p className="mt-3 truncate px-1 text-[11.5px] text-subtle-fg">{a.configDir}</p>
        </div>
      </div>
    </FrameCard>
  );
}
