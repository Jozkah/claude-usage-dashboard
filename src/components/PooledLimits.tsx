import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import type { Account } from '../lib/types';
import { fmtDur } from '../lib/format';
import { initials, poolLimits, type PoolRow, type Segment } from '../lib/pool';
import { ProviderIcon, providerOf, type Provider } from './ProviderIcon';

const LABEL: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', grok: 'Grok Build' };
const COLOR: Record<string, string> = { claude: 'var(--claude)', codex: 'var(--codex)', grok: 'var(--grok)' };
const TONE: Record<string, string> = { bad: 'text-bad', good: 'text-good', mute: 'text-muted-fg' };
const hatch = 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--fg) 22%, transparent) 0 1px, transparent 1px 5px)';

function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return <span title={title} className="inline-flex items-center gap-1 rounded-md bg-card/90 px-1.5 py-0.5 text-[12px] font-semibold text-fg tabular-nums shadow-[0_0_0_1px_var(--line)]">{children}</span>;
}

function SegmentBar({ s, now, color, onPick }: { s: Segment; now: number; color: string; onPick: (id: string) => void }) {
  if (s.left == null) {
    return (
      <button onClick={() => onPick(s.account.id)} title={`${s.account.name}: no live reading`} className="relative flex h-12 min-w-0 flex-1 items-center justify-center rounded-lg border border-dashed border-line text-[12px] text-subtle-fg transition-colors hover:border-fg/40">
        <span className="absolute left-2 top-1/2 -translate-y-1/2"><Chip>{initials(s.account.name)}</Chip></span>
        no reading
      </button>
    );
  }
  const left = Math.round(s.left);
  const marker = s.elapsed == null ? null : Math.min(100, Math.max(0, 100 - s.elapsed * 100));
  const reset = s.resetAt == null ? null : fmtDur(s.resetAt - now);
  return (
    <button
      onClick={() => onPick(s.account.id)}
      title={`${s.account.name}: ${left}% left${reset ? `, resets in ${reset}` : ''}`}
      aria-label={`${s.account.name}: ${left}% left${reset ? `, resets in ${reset}` : ''}`}
      className="relative flex h-12 min-w-0 flex-1 items-center overflow-hidden rounded-lg bg-frame text-left outline-offset-2 transition-transform duration-150 active:scale-[0.99]"
      style={{ backgroundImage: hatch }}
    >
      <span className="absolute inset-y-0 left-0" style={{ width: `${s.left}%`, background: color, transition: 'width 0.5s var(--ease-out-expo)' }} />
      <span className="relative ml-2 flex items-center gap-1.5">
        <span className="grid size-6 place-items-center rounded-full bg-card text-[10px] font-bold text-fg shadow-[0_0_0_1px_var(--line)]">{initials(s.account.name)}</span>
        <Chip>{left}%</Chip>
      </span>
      {marker != null && marker > 0 && marker < 100 && (
        <span title="Where even pacing would be" aria-hidden="true" className="absolute inset-y-0 w-[2.5px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" style={{ left: `calc(${marker}% - 1px)` }} />
      )}
      {reset && <span className="absolute right-2 top-1/2 -translate-y-1/2"><Chip title="Time until this window resets"><RefreshCw className="size-3" strokeWidth={2.2} />{reset}</Chip></span>}
    </button>
  );
}

function Row({ row, color, now, onPick }: { row: PoolRow; color: string; now: number; onPick: (id: string) => void }) {
  return (
    <div className="grid gap-x-8 gap-y-3 border-t border-line px-5 py-4 first:border-t-0 md:grid-cols-[190px_minmax(0,1fr)] md:items-center">
      <div>
        <div className="text-[13.5px] font-semibold">{row.label}</div>
        {row.left == null ? <div className="mt-1 text-[13px] text-subtle-fg">No live reading</div> : (
          <>
            <div className="mt-0.5 flex items-baseline gap-1.5 tabular-nums"><span className="text-[28px] leading-none font-bold tracking-[-0.03em]">{Math.round(row.left)}%</span><span className="text-[13px] text-subtle-fg">left</span></div>
            {row.pace && <div className={`mt-1 text-[12.5px] font-medium ${TONE[row.pace.tone]}`}>{row.pace.label}</div>}
            {row.refill != null && row.resetIn != null && row.refill > 0 && (
              <div className="mt-0.5 flex items-center gap-1 text-[12.5px] text-subtle-fg tabular-nums"><RefreshCw className="size-3" strokeWidth={2} />+{Math.round(row.refill)}% in {fmtDur(row.resetIn)}</div>
            )}
          </>
        )}
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-1.5 sm:flex">{row.segments.map((s) => <SegmentBar key={s.account.id} s={s} now={now} color={color} onPick={onPick} />)}</div>
    </div>
  );
}

interface Props { accounts: Account[]; now: number; onPick: (id: string) => void }

/**
 * Every limit pooled across the accounts of one provider: one bar per limit, one segment per account.
 * The solid part is what is left, the hatched part is what is used, the white tick is even pacing,
 * and the chip is the time until that account's window resets.
 */
export function PooledLimits({ accounts, now, onPick }: Props) {
  const groups = useMemo(() => poolLimits(accounts, providerOf, now), [accounts, now]);
  if (!groups.length) return null;
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g.provider}>
          <div className="mb-2 flex items-center gap-2 px-1 text-[14px] font-semibold">
            <ProviderIcon provider={g.provider as Provider} className="size-[18px]" title={false} />
            {LABEL[g.provider] ?? g.provider}
          </div>
          <div className="panel overflow-hidden">
            {g.rows.map((r) => <Row key={r.key} row={r} color={COLOR[g.provider] ?? 'var(--codex)'} now={now} onPick={onPick} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
