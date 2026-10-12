import { useMemo } from 'react';
import { CalendarClock, Hourglass, RotateCcw } from 'lucide-react';
import type { Account } from '../lib/types';
import { colorVar, fmtClock, fmtDur, levelFor } from '../lib/format';
import { FrameCard } from './FrameCard';

export function ResetTimeline({ accounts, now }: { accounts: Account[]; now: number }) {
  const items = useMemo(() => {
    const out: { id: string; account: string; label: string; at: number; used: number; five: boolean }[] = [];
    for (const a of accounts) {
      if (a.status !== 'ok') continue;
      for (const w of a.windows ?? []) {
        if (!w.resetsAt) continue;
        out.push({ id: a.id + w.key, account: a.name, label: w.label, at: new Date(w.resetsAt).getTime(), used: w.used, five: w.key === 'five_hour' });
      }
    }
    return out.sort((x, y) => x.at - y.at).slice(0, 6);
  }, [accounts]);

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
                <div className="truncate text-xs text-muted-fg">{it.label}</div>
              </div>
              <div className="text-right">
                <div className="text-[13px] font-medium tabular-nums">{fmtDur(it.at - now)}</div>
                <div className="text-[11.5px] text-subtle-fg">{fmtClock(it.at)}</div>
              </div>
            </li>
          ))}
          {items.length === 0 && <li className="py-8 text-center text-sm text-muted-fg">No upcoming resets.</li>}
        </ul>
      </div>
    </FrameCard>
  );
}
