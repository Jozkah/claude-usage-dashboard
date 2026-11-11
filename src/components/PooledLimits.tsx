import { useMemo } from 'react';
import type { Account } from '../lib/types';
import { fmtDur } from '../lib/format';
import { poolLimits, type PoolRow, type Segment } from '../lib/pool';
import { ProviderIcon, providerOf, type Provider } from './ProviderIcon';

const LABEL: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', grok: 'Grok Build', cursor: 'Cursor', opencode: 'OpenCode' };
const COLOR: Record<string, string> = { claude: 'var(--claude)', codex: 'var(--codex)', grok: 'var(--grok)', cursor: 'var(--cursor)', opencode: 'var(--opencode)' };
const TONE: Record<string, string> = { bad: 'text-bad', good: 'text-good', mute: 'text-muted-fg' };

/** One account inside a limit: name, a slim bar of what is left, and the numbers in fixed columns. */
function AccountLine({ s, now, color, onPick }: { s: Segment; now: number; color: string; onPick: (id: string) => void }) {
  const left = s.left == null ? null : Math.round(s.left);
  const tick = s.elapsed == null ? null : Math.min(100, Math.max(0, 100 - s.elapsed * 100));
  const reset = s.resetAt == null ? null : fmtDur(s.resetAt - now);
  const diff = s.left != null && s.elapsed != null && s.elapsed >= 0.03 ? 100 - s.left - s.elapsed * 100 : null;
  const pace = diff == null ? null : diff > 12 ? { t: 'Over pace', tone: 'bad' } : diff < -12 ? { t: 'Under pace', tone: 'good' } : { t: 'On pace', tone: 'mute' };
  return (
    <button
      onClick={() => onPick(s.account.id)}
      aria-label={left == null ? `${s.account.name}: no live reading` : `${s.account.name}: ${left}% left${reset ? `, resets in ${reset}` : ''}`}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-frame md:grid-cols-[130px_minmax(0,1fr)_44px_74px_84px]"
    >
      <span className="truncate text-[13px] font-medium">{s.account.name}</span>
      <span className="order-last col-span-2 md:order-none md:col-span-1">
        {left == null ? (
          <span className="block h-[7px] rounded-[3px] border border-dashed border-line" />
        ) : (
          <span className="relative block h-[7px] rounded-[3px] bg-frame">
            <span className="absolute inset-y-0 left-0 rounded-[3px]" style={{ width: `${s.left}%`, background: color, transition: 'width 0.5s var(--ease-out-expo)' }} />
            {tick != null && tick > 0 && tick < 100 && (
              <span title="Where even pacing would be" aria-hidden="true" className="absolute -inset-y-[3px] w-px bg-fg" style={{ left: `${tick}%` }} />
            )}
          </span>
        )}
      </span>
      <span className="text-right text-[13px] font-bold tabular-nums max-md:col-start-2 max-md:row-start-1">{left == null ? '–' : `${left}%`}</span>
      <span className="hidden text-right text-[12.5px] text-muted-fg tabular-nums md:block">{reset ?? (left == null ? 'no reading' : '')}</span>
      <span className={`hidden text-right text-[12px] font-medium md:block ${pace ? TONE[pace.tone] : ''}`}>{pace?.t ?? ''}</span>
    </button>
  );
}

function Block({ row, color, now, onPick }: { row: PoolRow; color: string; now: number; onPick: (id: string) => void }) {
  return (
    <div className="border-t border-line px-4 py-4 first:border-t-0">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-2">
        <h3 className="text-[14px] font-semibold">{row.label}</h3>
        {row.left == null ? <span className="text-[12.5px] text-subtle-fg">No live reading</span> : (
          <>
            <span className="text-[12.5px] text-muted-fg tabular-nums">{Math.round(row.left)}% left on average</span>
            {row.refill != null && row.resetIn != null && row.refill > 0 && (
              <span className="text-[12.5px] text-subtle-fg tabular-nums">{Math.round(row.refill)}% comes back in {fmtDur(row.resetIn)}</span>
            )}
          </>
        )}
      </div>
      <div className="flex flex-col">
        {row.segments.map((s) => <AccountLine key={s.account.id} s={s} now={now} color={color} onPick={onPick} />)}
      </div>
    </div>
  );
}

interface Props { accounts: Account[]; now: number; onPick: (id: string) => void }

/**
 * Each limit pooled across the accounts of one provider, as a short ledger: one line per account with a slim bar
 * of what is left, the tick where even pacing would be, the % left, time to reset and a pace word.
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
            {g.rows.map((r) => <Block key={r.key} row={r} color={COLOR[g.provider] ?? 'var(--codex)'} now={now} onPick={onPick} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
