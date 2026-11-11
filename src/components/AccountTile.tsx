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
const CELLS = 10;

/** Ten squares: each is a tenth of the limit that is still left. */
function Squares({ w, dim }: { w: UsageWindow; dim: boolean }) {
  const left = Math.max(0, 100 - w.used);
  const filled = Math.round((left / 100) * CELLS);
  const color = colorVar(levelFor(w.used));
  return (
    <div className={`grid grid-cols-10 gap-[3px] ${dim ? 'opacity-50' : ''}`} role="img" aria-label={`${label(w)}: ${Math.round(left)}% left`}>
      {Array.from({ length: CELLS }, (_, i) => (
        <span key={i} className="aspect-square rounded-[3px]" style={{ background: i < filled ? color : 'var(--frame)' }} />
      ))}
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
  const left = tight ? Math.round(100 - tight.used) : null;
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

      <div className="flex items-baseline gap-1.5">
        <span className={`text-[34px] leading-none font-semibold tracking-[-0.04em] tabular-nums ${dim ? 'opacity-50' : ''}`} style={{ color: tight ? colorVar(levelFor(tight.used)) : 'var(--subtle-fg)' }}>
          {left == null ? '–' : `${left}%`}
        </span>
        <span className="text-[12px] text-subtle-fg">{tight ? `left · ${label(tight).toLowerCase()}` : a.status === 'ok' ? 'no reading' : 'no login'}</span>
      </div>

      <div className="flex flex-col gap-2.5">
        {ws.slice(0, 2).map((w) => (
          <div key={w.key}>
            <div className="mb-1 flex justify-between text-[11.5px] text-subtle-fg"><span>{label(w)}</span><span className="tabular-nums">{Math.round(100 - w.used)}%</span></div>
            <Squares w={w} dim={dim} />
          </div>
        ))}
      </div>

      <div className="mt-auto truncate text-[11.5px] text-subtle-fg">
        {dim ? <span className="font-medium text-warn">Not live · read {fmtAgo(now - a.fetchedAt)}</span> : reset ? <Reset at={reset.at} /> : a.provider ? a.provider : `${a.sessions?.length ?? 0} open chats`}
      </div>
    </div>
  );
}
