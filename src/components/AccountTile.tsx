import { useMemo, type MouseEvent } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { ProviderIcon, providerOf } from './ProviderIcon';
import { Countdown } from './Countdown';
import type { Account, UsageWindow } from '../lib/types';
import { colorVar, elapsedFraction, fmtAgo, levelFor, mainWindows } from '../lib/format';
import { checkpoints, paceInfo } from '../lib/pace';
import { accountReset } from '../lib/reset';
import { useHistory, useNow } from '../lib/api';

const SHORT: Record<string, string> = { five_hour: '5 hour', seven_day: 'Weekly' };
const label = (w: UsageWindow) => SHORT[w.key] ?? w.label.replace(/ · all models$/i, '');
const R = 22, C = 2 * Math.PI * R;
/** Dash pattern that is empty up to `from`, dashed up to `to`, then empty again (pathLength is 100). */
function dashes(from: number, to: number) {
  const n = Math.max(1, Math.floor((to - from) / 2.4));
  const parts = [0, from];
  for (let i = 0; i < n; i++) parts.push(1.2, 1.2);
  const used = parts.reduce((x, y) => x + y, 0);
  parts.push(0, Math.max(0, 100 - used));
  return parts.join(' ');
}
const pct = (n: number) => (n < 0.05 ? '0%' : `${n >= 10 ? Math.round(n) : n.toFixed(1)}%`);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * A ring that fills clockwise with what was used. Each earlier day is its own arc, split by a gap at the checkpoint,
 * the arc in violet is what was used since the last checkpoint, and the tick is where even pacing would be.
 */
function Ring({ w, account, now, dim }: { w: UsageWindow; account: Account; now: number; dim: boolean }) {
  const weekly = w.key.startsWith('seven_day');
  const hist = useHistory(account.id, w.key, weekly ? '7d' : '6h', account.fetchedAt || 0);
  const cp = useMemo(() => (hist.ready ? checkpoints(hist.points, w, now) : null), [hist.ready, hist.points, w, now]);
  const pace = useMemo(() => (hist.ready ? paceInfo(hist.points, w, now) : null), [hist.ready, hist.points, w, now]);
  const used = Math.max(0, Math.min(100, w.used));
  const proj = pace?.projected != null ? Math.min(100, pace.projected) : null;
  const bad = pace?.tone === 'bad';
  const e = elapsedFraction(w, now);
  const level = levelFor(used);

  const arcs: { from: number; to: number; today: boolean; title: string }[] = [];
  if (cp) {
    for (let i = 0; i < cp.marks.length - 1; i++) {
      const m = cp.marks[i], n = cp.marks[i + 1];
      const from = m.used ?? (arcs.length ? arcs[arcs.length - 1].to : 0);
      const to = n.used ?? from;
      if (to - from <= 0.05) continue;
      const last = i === cp.marks.length - 2;
      const name = last ? (cp.unit === 'day' ? 'Today' : 'This hour') : cp.unit === 'day' ? DAYS[new Date(m.t).getDay()] : `${String(new Date(m.t).getHours()).padStart(2, '0')}:00`;
      arcs.push({ from, to, today: last, title: `${name}: +${(to - from).toFixed(1)}%` });
    }
  }
  const seg = (from: number, to: number, color: string, extra?: object, title?: string, key?: number) => {
    const len = Math.max(0.8, ((to - from) / 100) * C - 1.6);
    return <circle key={key} cx="26" cy="26" r={R} fill="none" stroke={color} strokeWidth="4" strokeDasharray={`${len} ${C}`} strokeDashoffset={-(from / 100) * C} style={extra as React.CSSProperties}>{title && <title>{title}</title>}</circle>;
  };
  const tickAngle = e != null ? Math.min(1, e) * 2 * Math.PI : null;

  return (
    <div className={`flex min-w-0 flex-col items-center gap-1.5 ${dim ? 'opacity-50' : ''}`} role="img" aria-label={`${label(w)}: ${Math.round(used)}% used`}>
      <div className="relative size-[64px]">
        <svg viewBox="0 0 52 52" className="size-full -rotate-90 overflow-visible">
          <circle cx="26" cy="26" r={R} fill="none" stroke="var(--frame)" strokeWidth="4" />
          {arcs.length ? arcs.map((x, i) => seg(x.from, x.to, x.today ? 'var(--signal)' : 'var(--subtle-fg)', x.today ? { filter: 'drop-shadow(0 0 3px var(--glow))' } : { opacity: i % 2 ? 0.45 : 0.62 }, x.title, i))
            : seg(0, used, level === 'good' ? 'var(--signal)' : colorVar(level))}
          {proj != null && proj > used + 0.5 && (
            <circle cx="26" cy="26" r={R} fill="none" stroke={bad ? 'var(--bad)' : 'var(--subtle-fg)'} strokeWidth="3" pathLength={100} strokeDasharray={dashes(used, proj)} opacity="0.9">
              <title>{`Projected: ${Math.round(proj)}% by the reset`}</title>
            </circle>
          )}
          {tickAngle != null && (
            <line x1={26 + (R - 5) * Math.cos(tickAngle)} y1={26 + (R - 5) * Math.sin(tickAngle)} x2={26 + (R + 5) * Math.cos(tickAngle)} y2={26 + (R + 5) * Math.sin(tickAngle)} stroke="var(--fg)" strokeWidth="1.6" strokeLinecap="round" opacity="0.8"><title>Even pace</title></line>
          )}
        </svg>
        <span className={`absolute inset-0 grid place-items-center text-[14px] font-semibold tabular-nums ${level === 'bad' ? 'text-bad' : ''}`}>{Math.round(used)}</span>
      </div>
      <span className="text-[11.5px] text-subtle-fg">{label(w)}</span>
      {cp?.sinceLast != null && <span className="text-[11px] font-semibold text-signal tabular-nums">{cp.unit === 'day' ? 'Today' : 'This hour'} +{pct(cp.sinceLast)}</span>}
      {pace && <span className={`max-w-[116px] text-center text-[11px] leading-tight font-semibold text-balance ${bad ? 'text-bad' : pace.tone === 'good' ? 'text-good' : pace.tone === 'warn' ? 'text-warn' : 'text-muted-fg'}`} title={pace.detail}>{pace.label}</span>}
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

      <div className="flex items-start justify-around gap-1 py-1">
        {ws.length ? ws.slice(0, 2).map((w) => <Ring key={w.key} w={w} account={a} now={now} dim={dim} />) : <span className="py-5 text-[12px] text-subtle-fg">{a.status === 'ok' ? 'no reading' : 'no login'}</span>}
      </div>

      <div className="mt-auto truncate text-[11.5px] text-subtle-fg">
        {dim ? <span className="font-medium text-warn">Not live · read {fmtAgo(now - a.fetchedAt)}</span> : reset ? <Reset at={reset.at} /> : a.provider ? a.provider : `${a.sessions?.length ?? 0} open chats`}
      </div>
    </div>
  );
}
