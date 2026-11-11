import type { MouseEvent } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { ProviderIcon, providerOf } from './ProviderIcon';
import { Countdown } from './Countdown';
import type { Account, UsageWindow } from '../lib/types';
import { colorVar, fmtAgo, levelFor, mainWindows } from '../lib/format';
import { accountReset } from '../lib/reset';
import { useNow } from '../lib/api';

const SHORT: Record<string, string> = { five_hour: '5 hour', seven_day: 'Weekly' };
const label = (w: UsageWindow) => SHORT[w.key] ?? w.label.replace(/ · all models$/i, '');
const R = 22, C = 2 * Math.PI * R;

/** A thin ring that shows how much of the limit is left. */
function Ring({ w, dim }: { w: UsageWindow; dim: boolean }) {
  const left = Math.max(0, Math.min(100, 100 - w.used));
  return (
    <div className={`flex flex-col items-center gap-1.5 ${dim ? 'opacity-50' : ''}`} role="img" aria-label={`${label(w)}: ${Math.round(left)}% left`}>
      <div className="relative size-[60px]">
        <svg viewBox="0 0 52 52" className="size-full -rotate-90">
          <circle cx="26" cy="26" r={R} fill="none" stroke="var(--frame)" strokeWidth="4" />
          <circle cx="26" cy="26" r={R} fill="none" stroke={colorVar(levelFor(w.used))} strokeWidth="4" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - left / 100)} style={{ transition: 'stroke-dashoffset 0.5s var(--ease-out-expo)' }} />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-[13px] font-semibold tabular-nums">{Math.round(left)}</span>
      </div>
      <span className="text-[11.5px] text-subtle-fg">{label(w)}</span>
    </div>
  );
}

function Reset({ at }: { at: number }) {
  const now = useNow(1000);
  return at <= now ? <>resetting</> : <>resets in <b className="font-semibold text-fg tabular-nums"><Countdown at={at} /></b></>;
}

interface Props {
  account: Account;
  now: number;
  selected?: boolean;
  onOpen: (anchor: HTMLElement) => void;
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void;
}

/** Compact account tile for the grid view: tightest limit as one number, each limit as ten squares. */
export function AccountTile({ account: a, now, onOpen, onContextMenu }: Props) {
  const ws = mainWindows(a).filter((w) => !w.expired);
  const tight = ws.length ? ws.reduce((m, w) => (w.used > m.used ? w : m)) : null;
  const reset = tight ? accountReset(a, tight, now) : null;
  const dim = !!a.stale;
  const provider = providerOf(a);
  return (
    <div
      onContextMenu={onContextMenu}
      className="group relative flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-card p-3.5 transition-colors hover:border-fg/25"
    >
      <div className="flex items-center gap-2">
        <ProviderIcon provider={provider} className="size-5" />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{a.name}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(e.currentTarget); }}
          aria-haspopup="menu" aria-label={`${a.name} actions`}
          className="relative -mr-1 grid size-7 place-items-center rounded-md text-subtle-fg transition-colors before:absolute before:-inset-1 before:content-[''] hover:bg-frame hover:text-fg"
        >
          <EllipsisVertical className="size-4" />
        </button>
      </div>

      <div className="flex items-start justify-around py-1">
        {ws.length ? ws.slice(0, 2).map((w) => <Ring key={w.key} w={w} dim={dim} />) : <span className="py-5 text-[12px] text-subtle-fg">{a.status === 'ok' ? 'no reading' : 'no login'}</span>}
      </div>

      <div className="mt-auto truncate text-[11.5px] text-subtle-fg">
        {dim ? <span className="font-medium text-warn">Not live · read {fmtAgo(now - a.fetchedAt)}</span> : reset ? <Reset at={reset.at} /> : a.provider ? a.provider : `${a.sessions?.length ?? 0} open chats`}
      </div>
    </div>
  );
}
