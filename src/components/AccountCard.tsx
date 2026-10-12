import { KeyRound, TriangleAlert, Trash2, WifiOff } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { Account, UsageWindow } from '../lib/types';
import { colorVar, elapsedFraction, fmtClock, fmtDur, levelFor, mainWindows, paceFor } from '../lib/format';
import { Chip } from './Chip';
import { FrameCard } from './FrameCard';
import { Ring } from './Ring';

interface Props {
  account: Account;
  now: number;
  delay: number;
  onRemove: (a: Account) => void;
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void;
}

function Gauge({ w, now }: { w: UsageWindow; now: number }) {
  const pace = paceFor(w, now);
  return (
    <div className="rounded-lg bg-frame/70 px-2 py-4 text-center">
      <div className="mb-3 text-[13px] font-medium">{w.label}</div>
      <Ring used={w.used} elapsed={elapsedFraction(w, now)} />
      <div className="mt-3 text-[12.5px] text-muted-fg">
        {w.resetsAt ? (
          <>
            Resets in <b className="font-semibold text-fg tabular-nums">{fmtDur(new Date(w.resetsAt).getTime() - now)}</b>
          </>
        ) : 'Reset time unknown'}
      </div>
      {w.resetsAt && <div className="text-[11.5px] text-subtle-fg">{fmtClock(w.resetsAt)}</div>}
      <div className="mt-2 h-5">{pace && <Chip tone={pace.tone}>{pace.label}</Chip>}</div>
    </div>
  );
}

function Chats({ a, now }: { a: Account; now: number }) {
  const list = a.sessions ?? [];
  if (!list.length) return null;
  const working = list.filter((s) => s.working).length;
  const shown = list.slice(0, 4);
  return (
    <div className="mt-3 rounded-lg border border-line bg-frame/50 px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between text-[12px] font-medium">
        <span>Chats</span>
        <span className="text-muted-fg tabular-nums">
          {working > 0 ? `${working} working · ` : ''}{list.length} open
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {shown.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-[12.5px]">
            <span className={s.working ? 'live-dot' : 'size-2 shrink-0 rounded-full bg-subtle-fg/50'} />
            <span className="truncate">{s.name || s.folder || 'Untitled chat'}</span>
            <span className="ml-auto shrink-0 text-[11.5px] text-subtle-fg tabular-nums">
              {s.working ? 'now' : `${fmtDur(now - s.lastActiveAt)} ago`}
            </span>
          </li>
        ))}
      </ul>
      {list.length > shown.length && <div className="mt-1 text-[11.5px] text-subtle-fg">+{list.length - shown.length} more</div>}
    </div>
  );
}

function Bar({ w, now }: { w: UsageWindow; now: number }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[13px]">
        <span>{w.label}</span>
        <span className="tabular-nums text-muted-fg">{Math.round(w.used)}% used</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-frame">
        <div
          className="h-full rounded-full"
          style={{ width: `${w.used}%`, background: colorVar(levelFor(w.used)), transition: 'width 1s var(--ease-out-expo)' }}
        />
      </div>
      {w.resetsAt && (
        <div className="mt-1 text-[11.5px] text-subtle-fg">
          Resets in <span className="tabular-nums">{fmtDur(new Date(w.resetsAt).getTime() - now)}</span>
        </div>
      )}
    </div>
  );
}

export function AccountCard({ account: a, now, delay, onRemove, onContextMenu }: Props) {
  const remove = (
    <button
      onClick={() => onRemove(a)}
      title="Remove from dashboard (does not touch the login)"
      className="rounded-md p-1 text-subtle-fg transition-colors hover:bg-bad/10 hover:text-bad"
    >
      <Trash2 className="size-3.5" />
    </button>
  );
  const right = (
    <div className="flex items-center gap-2">
      {a.plan && <Chip tone="accent">{a.plan}</Chip>}
      {remove}
    </div>
  );

  if (a.status !== 'ok' || !a.windows?.length) {
    const Icon = a.status === 'no_login' ? KeyRound : a.status === 'expired' ? KeyRound : a.status === 'error' ? WifiOff : TriangleAlert;
    return (
      <FrameCard title={a.name} icon={<span className="size-2 rounded-full bg-warn" />} right={right} delay={delay} onContextMenu={onContextMenu}>
        <div className="flex gap-3 p-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-warn/12 text-warn"><Icon className="size-4" /></div>
          <div className="min-w-0">
            <div className="text-sm font-medium">{a.status === 'no_login' ? 'Not logged in' : a.status === 'expired' ? 'Login expired' : 'Can’t read usage'}</div>
            <p className="mt-0.5 text-[13px] text-muted-fg">{a.message}</p>
            <p className="mt-2 truncate text-xs text-subtle-fg">{a.configDir}</p>
          </div>
        </div>
        <div className="px-4 pb-4 -mt-1"><Chats a={a} now={now} /></div>
      </FrameCard>
    );
  }

  const main = mainWindows(a);
  const rest = a.windows.filter((w) => !main.includes(w));
  const critical = a.windows.some((w) => w.used >= 90);

  return (
    <FrameCard
      title={a.name}
      icon={<span className="live-dot" />}
      right={right}
      delay={delay}
      beam={critical}
      onContextMenu={onContextMenu}
    >
      <div className="p-3">
        <div className="grid grid-cols-2 gap-3">
          {main.map((w) => <Gauge key={w.key} w={w} now={now} />)}
        </div>
        {rest.length > 0 && (
          <div className="mt-4 grid gap-3.5 px-1 pb-1">{rest.map((w) => <Bar key={w.key} w={w} now={now} />)}</div>
        )}
        <Chats a={a} now={now} />
        {a.stale && <p className="mt-3 px-1 text-xs text-warn">Last read {new Date(a.fetchedAt).toLocaleString()}. Live usage unavailable: {a.staleMessage}</p>}
        <p className="mt-3 truncate px-1 text-[11.5px] text-subtle-fg">{a.configDir}</p>
      </div>
    </FrameCard>
  );
}
