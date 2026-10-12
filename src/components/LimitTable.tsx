import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, CircleCheck, Flame, ListChecks, TriangleAlert } from 'lucide-react';
import type { Account, Level } from '../lib/types';
import { colorVar, fmtDur, levelFor, paceFor } from '../lib/format';
import { Chip } from './Chip';
import { FrameCard } from './FrameCard';

type SortKey = 'account' | 'window' | 'used' | 'reset';

interface Row {
  id: string;
  account: string;
  window: string;
  used: number;
  resetAt: number | null;
  pace: ReturnType<typeof paceFor>;
}

const STATUS: Record<Level, { label: string; icon: typeof CircleCheck }> = {
  good: { label: 'Healthy', icon: CircleCheck },
  warn: { label: 'Watch', icon: TriangleAlert },
  bad: { label: 'Near limit', icon: Flame },
};

export function LimitTable({ accounts, now }: { accounts: Account[]; now: number }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'used', dir: -1 });

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const a of accounts) {
      if (a.status !== 'ok') continue;
      for (const w of a.windows ?? []) {
        out.push({
          id: a.id + w.key,
          account: a.name,
          window: w.label,
          used: w.used,
          resetAt: w.resetsAt ? new Date(w.resetsAt).getTime() : null,
          pace: paceFor(w, now),
        });
      }
    }
    const { key, dir } = sort;
    return out.sort((x, y) => {
      const a = key === 'account' ? x.account : key === 'window' ? x.window : key === 'used' ? x.used : x.resetAt ?? Infinity;
      const b = key === 'account' ? y.account : key === 'window' ? y.window : key === 'used' ? y.used : y.resetAt ?? Infinity;
      return (a < b ? -1 : a > b ? 1 : 0) * dir;
    });
    // `now` is intentionally not a dependency of the sort order for reset times
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, sort, Math.floor(now / 30000)]);

  const th = (key: SortKey, label: string, cls = '') => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
    return (
      <th className={`px-4 py-2.5 text-left text-xs font-medium text-muted-fg ${cls}`}>
        <button
          onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'used' ? -1 : 1 }))}
          className="inline-flex items-center gap-1.5 transition-colors hover:text-fg"
        >
          {label}
          <Icon className={`size-3 ${active ? 'text-fg' : 'text-subtle-fg'}`} />
        </button>
      </th>
    );
  };

  return (
    <FrameCard icon={<ListChecks className="size-3.5 text-subtle-fg" />} title="Limit monitor" delay={120}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-b border-line">
              {th('account', 'Account')}
              {th('window', 'Limit')}
              {th('used', 'Used', 'w-[26%]')}
              {th('reset', 'Resets in')}
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-fg">Pace</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-fg">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const lvl = levelFor(r.used);
              const S = STATUS[lvl];
              return (
                <tr key={r.id} className="animate-fade border-b border-line/70 last:border-0 transition-colors hover:bg-frame/70" style={{ animationDelay: `${i * 35}ms` }}>
                  <td className="px-4 py-3 font-medium">{r.account}</td>
                  <td className="px-4 py-3 text-muted-fg">{r.window}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-frame">
                        <div className="h-full rounded-full" style={{ width: `${r.used}%`, background: colorVar(lvl), transition: 'width 1s var(--ease-out-expo)' }} />
                      </div>
                      <span className="w-10 text-right tabular-nums">{Math.round(r.used)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-fg">{r.resetAt ? fmtDur(r.resetAt - now) : '—'}</td>
                  <td className="px-4 py-3">{r.pace ? <Chip tone={r.pace.tone}>{r.pace.label}</Chip> : <span className="text-subtle-fg">—</span>}</td>
                  <td className="px-4 py-3">
                    <Chip tone={lvl}><S.icon className="size-3" />{S.label}</Chip>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-fg">No readings yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </FrameCard>
  );
}
