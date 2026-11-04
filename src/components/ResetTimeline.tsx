import { useMemo } from 'react';
import { CalendarClock, Hourglass, RotateCcw } from 'lucide-react';
import type { Account } from '../lib/types';
import { colorVar, fmtClock, fmtDur, levelFor } from '../lib/format';
import { accountReset } from '../lib/reset';
import { FrameCard } from './FrameCard';

export function ResetTimeline({ accounts, now }: { accounts: Account[]; now: number }) {
  const nowBucket = Math.floor(now / 30000);
  const items = useMemo(() => {
    const out: { id: string; account: string; label: string; at: number | null; used: number; five: boolean; estimated: boolean }[] = [];
    for (const a of accounts) {
      for (const w of a.windows ?? []) {
        const reset = accountReset(a, w, now);
        const five = w.key === 'five_hour';
        // a window without a usable reset still gets a row, so a missing limit is visible
        out.push(reset
          ? { id: `${a.id}:${w.key}`, account: a.name, label: w.label, at: reset.at, used: w.used, five, estimated: reset.estimated }
          : { id: `${a.id}:${w.key}`, account: a.name, label: `${w.label} · reset unavailable`, at: null, used: w.used, five, estimated: false });
      }
      if (!a.windows?.length) out.push({ id: a.id, account: a.name, label: 'Reset time unavailable', at: null, used: 0, five: false, estimated: false });
    }
    return out.sort((x, y) => (x.at ?? Infinity) - (y.at ?? Infinity));
  }, [accounts, nowBucket]);

  return (
    <FrameCard icon={<CalendarClock className="size-3.5 text-subtle-fg" />} title="Upcoming resets" delay={90} className="h-full">
      <div className="relative p-4">
        <div className="absolute top-6 bottom-6 left-[33px] border-l border-dashed border-line" />
        <ul className="relative space-y-3.5">
          {items.map((it, i) => (
            <li key={it.id} className="animate-rise flex items-center gap-3" style={{ animationDelay: `${150 + i * 55}ms` }}>
              <div
                className="relative grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-card shadow-sm"
                style={{ color: colorVar(levelFor(it.used)) }}
              >
                {it.five ? <Hourglass className="size-4" /> : <RotateCcw className="size-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{it.account}</div>
                <div className="truncate text-xs text-muted-fg">{it.label}{it.estimated ? ' · estimated' : ''}</div>
              </div>
              <div className="text-right">
                <div className="text-[13px] font-medium tabular-nums">{it.at ? fmtDur(it.at - now) : 'Unknown'}</div>
                <div className="text-[11.5px] text-subtle-fg">{it.at ? fmtClock(it.at) : 'Awaiting live usage'}</div>
              </div>
            </li>
          ))}
          {items.length === 0 && <li className="py-8 text-center text-sm text-muted-fg">No upcoming resets.</li>}
        </ul>
      </div>
    </FrameCard>
  );
}
