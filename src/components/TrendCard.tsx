import { memo, useEffect, useMemo, useState } from 'react';
import { ChartColumn, ChartLine, TrendingUp } from 'lucide-react';
import type { Account, RangeKey } from '../lib/types';
import { colorVar, levelFor } from '../lib/format';
import { useHistory } from '../lib/api';
import { AnimatedNumber } from './AnimatedNumber';
import { FrameCard } from './FrameCard';
import { UsageChart } from './UsageChart';
import { Select } from './Select';

interface Props {
  accounts: Account[];
  preferredId: string;
  tick: number;
  range: RangeKey;
  onRange: (r: RangeKey) => void;
}

function AccountTrend({ account, selectedKey, range, mode, tick }: { account: Account; selectedKey: string; range: RangeKey; mode: 'bars' | 'area'; tick: number }) {
  const window = account.windows?.find((item) => item.key === selectedKey) ?? account.windows?.[0];
  const { points, ready, error, retry } = useHistory(account.id, window?.key, range, tick);
  return (
    <div className="rounded-lg border border-line bg-frame/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">{account.name} · {window?.label ?? 'No limit'}</span>
        <span className="text-muted-fg">{window ? `${Math.round(window.used)}% used${account.stale ? ' · last reading' : ''}` : 'No reading'}</span>
      </div>
      <UsageChart points={points} range={range} mode={mode} ready={ready} error={error} onRetry={retry} seriesKey={`${account.id}:${window?.key}`} />
    </div>
  );
}

export const TrendCard = memo(function TrendCard({ accounts, preferredId, tick, range, onRange }: Props) {
  const okAccounts = accounts.filter((a) => a.status === 'ok' && a.windows?.length);
  const [accId, setAccId] = useState('');
  const [key, setKey] = useState('five_hour');
  const [mode, setMode] = useState<'bars' | 'area'>('bars');

  // follow the account picked in the sidebar
  const okIds = okAccounts.map((a) => a.id).join('\n');
  useEffect(() => {
    if (preferredId !== 'all' && okIds.split('\n').includes(preferredId)) setAccId(preferredId);
  }, [preferredId, okIds]);

  const acc = okAccounts.find((a) => a.id === accId) ?? okAccounts[0];
  const showAll = accId === 'all';
  const windows = acc?.windows ?? [];
  const win = windows.find((w) => w.key === key) ?? windows[0];

  // the single-series fetch is only needed when one account is shown
  const { points, ready, error, retry } = useHistory(showAll ? undefined : acc?.id, win?.key, range, tick);
  const peak = useMemo(() => points.reduce((m, p) => Math.max(m, p[1]), 0), [points]);

  const seg = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'bg-card text-fg shadow-sm' : 'text-muted-fg hover:text-fg'}`;

  const right = (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Time range" className="flex rounded-lg border border-line bg-frame p-0.5">
        {(['6h', '24h', '7d'] as RangeKey[]).map((r) => (
          <button key={r} onClick={() => onRange(r)} aria-pressed={range === r} className={seg(range === r)}>{r}</button>
        ))}
      </div>
      <div role="group" aria-label="Chart style" className="flex rounded-lg border border-line bg-frame p-0.5">
        <button onClick={() => setMode('bars')} aria-pressed={mode === 'bars'} aria-label="Bars" className={seg(mode === 'bars')} title="Bars"><ChartColumn className="size-3.5" /></button>
        <button onClick={() => setMode('area')} aria-pressed={mode === 'area'} aria-label="Line" className={seg(mode === 'area')} title="Line"><ChartLine className="size-3.5" /></button>
      </div>
    </div>
  );

  return (
    <FrameCard icon={<TrendingUp className="size-3.5 text-subtle-fg" />} title="Usage trend" right={right} delay={60} className="h-full">
      <div className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[32px] leading-none font-semibold tracking-tight" style={{ color: win && !showAll ? colorVar(levelFor(win.used)) : undefined }}>
              {showAll ? `${okAccounts.length} accounts` : win ? <AnimatedNumber value={win.used} suffix="%" /> : '—'}
            </div>
            <div className="mt-2 text-xs text-muted-fg">
              {showAll ? `Recorded usage for every account${win ? ` · limit: ${win.label}` : ''}` : win ? <>now · peak <span className="font-medium text-fg">{Math.round(peak)}%</span> in this range</> : 'No data yet'}
            </div>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap gap-2">
            <Select label="Account" className="min-w-0 max-w-full" value={showAll ? 'all' : acc?.id ?? ''} onChange={setAccId} options={[{ value: 'all', label: 'All accounts' }, ...okAccounts.map((a) => ({ value: a.id, label: a.name }))]} />
            <Select label="Limit" className="min-w-0 max-w-full" value={win?.key ?? ''} onChange={setKey} options={(showAll ? [...new Map(okAccounts.flatMap((a) => a.windows ?? []).map((w) => [w.key, w])).values()] : windows).map((w) => ({ value: w.key, label: w.label }))} />
          </div>
        </div>
        <div className="mt-4">
          {showAll ? <div className="space-y-3">{okAccounts.map((account) => <AccountTrend key={account.id} account={account} selectedKey={key} range={range} mode={mode} tick={tick} />)}</div>
            : <UsageChart points={points} range={range} mode={mode} ready={ready} error={error} onRetry={retry} seriesKey={`${acc?.id}:${win?.key}`} />}
        </div>
      </div>
    </FrameCard>
  );
});
