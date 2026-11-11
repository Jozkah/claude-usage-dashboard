import { useMemo } from 'react';
import type { Account, UsageWindow } from '../lib/types';
import { colorVar, elapsedFraction, levelFor } from '../lib/format';
import { accountReset } from '../lib/reset';
import { useHistory, useNow } from '../lib/api';
import { checkpoints, paceInfo } from '../lib/pace';
import { Countdown } from './Countdown';

const TONE: Record<string, string> = { bad: 'text-bad', warn: 'text-warn', good: 'text-good', mute: 'text-muted-fg' };
const pctText = (n: number) => (n < 0.05 ? '0%' : `${n >= 10 ? Math.round(n) : n.toFixed(1)}%`);

function Reset({ at, estimated }: { at: number; estimated: boolean }) {
  const now = useNow(1000);
  if (at <= now) return <>Reset reached, updating usage</>;
  return <>{estimated ? 'Estimated reset in ' : 'Resets in '}<b className="font-semibold text-fg tabular-nums"><Countdown at={at} /></b></>;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props { w: UsageWindow; label: string; account: Account; now: number }

/**
 * A window as a ruled bar. The bar is usage from 0 to 100%. Each earlier day (or hour) is its own block,
 * ending at a checkpoint, and the block in orange is what was used since the last checkpoint.
 * The tick shows where even pacing would be, the hatched stretch is the projection to the reset.
 */
export function UsageBar({ w, label, account, now }: Props) {
  const weekly = w.key.startsWith('seven_day');
  const hist = useHistory(account.id, w.key, weekly ? '7d' : '6h', account.fetchedAt || 0);
  const cp = useMemo(() => (hist.ready ? checkpoints(hist.points, w, now) : null), [hist.ready, hist.points, w, now]);
  const pace = useMemo(() => (hist.ready ? paceInfo(hist.points, w, now) : null), [hist.ready, hist.points, w, now]);
  const used = Math.max(0, Math.min(100, w.used));
  const left = Math.round(100 - used);
  const reset = accountReset(account, w, now);
  const e = elapsedFraction(w, now);
  const level = levelFor(used);

  // blocks: [from, to, kind]
  const blocks: { from: number; to: number; today: boolean; title: string }[] = [];
  if (cp) {
    for (let i = 0; i < cp.marks.length - 1; i++) {
      const a = cp.marks[i], b = cp.marks[i + 1];
      const from = a.used ?? (blocks.length ? blocks[blocks.length - 1].to : 0);
      const to = b.used ?? from;
      if (to - from <= 0.05) continue;
      const last = i === cp.marks.length - 2;
      const when = new Date(a.t);
      const name = last ? (cp.unit === 'day' ? 'Today' : 'This hour') : cp.unit === 'day' ? DAYS[when.getDay()] : `${String(when.getHours()).padStart(2, '0')}:00`;
      blocks.push({ from, to, today: last, title: `${name}: +${pctText(to - from)}` });
    }
  }
  const proj = pace?.projected != null ? Math.min(100, pace.projected) : null;
  const unit = cp?.unit === 'hour' ? 'hour' : 'day';

  if (w.expired) {
    // the reading belongs to a window that has already reset: say so instead of showing it as current
    return (
      <div className="min-w-0">
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
          <span className="font-medium">{label}</span>
          <span className="text-subtle-fg">no current reading</span>
        </div>
        <div className="h-3 rounded-[4px] border border-dashed border-line" />
        <div className="mt-1.5 text-[12px] text-subtle-fg">The last reading was {Math.round(used)}% used, from a window that has since reset.</div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums"><b className={`text-[15px] font-bold ${level === 'bad' ? 'text-bad' : ''}`}>{left}%</b> <span className="text-subtle-fg">left</span></span>
      </div>

      <div
        className="relative h-3 rounded-[4px] bg-frame"
        role="img"
        aria-label={`${label}: ${left}% left${cp?.sinceLast != null ? `, ${pctText(cp.sinceLast)} used since the last checkpoint` : ''}`}
      >
        {blocks.length > 0 ? blocks.map((b, i) => (
          <span
            key={i} title={b.title}
            className="absolute inset-y-0 first:rounded-l-[4px]"
            style={{
              left: `${b.from}%`, width: `${Math.max(0.6, b.to - b.from)}%`,
              background: b.today ? 'var(--signal)' : 'var(--subtle-fg)',
              opacity: b.today ? 1 : i % 2 ? 0.45 : 0.62,
              boxShadow: b.today ? '0 0 14px var(--glow), inset -1.5px 0 0 var(--card)' : 'inset -1.5px 0 0 var(--card)',
              borderRadius: `${b.from <= 0.01 ? 4 : 0}px ${b.to >= used - 0.01 ? 4 : 0}px ${b.to >= used - 0.01 ? 4 : 0}px ${b.from <= 0.01 ? 4 : 0}px`,
            }}
          />
        )) : (
          <span className="absolute inset-y-0 left-0 rounded-[4px]" style={{ width: `${used}%`, background: level === 'good' ? 'var(--signal)' : colorVar(level), transition: 'width 0.5s var(--ease-out-expo)' }} />
        )}
        {proj != null && proj > used + 0.5 && (
          <span
            title={`Projected: ${pctText(proj)} by the reset`}
            className="absolute inset-y-0 rounded-r-[4px] border-y border-r border-dashed"
            style={{ left: `${used}%`, width: `${proj - used}%`, borderColor: pace?.tone === 'bad' ? 'var(--bad)' : 'var(--subtle-fg)', background: `color-mix(in srgb, ${pace?.tone === 'bad' ? 'var(--bad)' : 'var(--fg)'} 8%, transparent)` }}
          />
        )}
        {e != null && (
          <span title={`Even pace: ${Math.round(100 - e * 100)}% left by now`} className="absolute -inset-y-[3px] w-[2px] rounded-sm bg-fg/70" style={{ left: `calc(${Math.min(100, e * 100)}% - 1px)` }} />
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-[12px] text-subtle-fg">
        <span className="tabular-nums">
          {cp?.sinceLast != null ? (
            <>
              <b className="font-semibold text-signal">{cp.unit === 'day' ? 'Today' : 'This hour'} +{pctText(cp.sinceLast)}</b>
              {cp.previous != null && <> · {cp.unit === 'day' ? 'Yesterday' : 'Last hour'} +{pctText(cp.previous)}</>}
            </>
          ) : `${Math.round(used)}% used`}
        </span>
        <span>
          {reset ? <Reset at={reset.at} estimated={reset.estimated} />
            : account.stale ? 'Reset needs fresh reading' : w.resetsAt ? 'Awaiting updated reset' : 'Reset time unknown'}
        </span>
      </div>

      {pace && (
        <p className="mt-1 text-[12.5px]" title={pace.detail}>
          <b className={`font-semibold ${TONE[pace.tone]}`}>{pace.label}</b>
          {pace.allowance != null && pace.label !== 'Limit reached' && <span className="text-subtle-fg"> · budget {pctText(pace.allowance)} per {unit}</span>}
        </p>
      )}
    </div>
  );
}
