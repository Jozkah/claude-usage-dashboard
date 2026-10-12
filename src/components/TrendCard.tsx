import { useEffect, useMemo, useState } from 'react';
import { ChartColumn, ChartLine, TrendingUp } from 'lucide-react';
import type { Account, RangeKey } from '../lib/types';
import { colorVar, levelFor } from '../lib/format';
import { useHistory } from '../lib/api';
import { AnimatedNumber } from './AnimatedNumber';
import { FrameCard } from './FrameCard';
import { UsageChart } from './UsageChart';

interface Props {
  accounts: Account[];
  preferredId: string;
  tick: number;
  range: RangeKey;
  onRange: (r: RangeKey) => void;
}

const selectCls =
  'rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs font-medium outline-none transition-shadow focus:ring-2 focus:ring-accent/40';

export function TrendCard({ accounts, preferredId, tick, range, onRange }: Props) {
  const okAccounts = accounts.filter((a) => a.status === 'ok' && a.windows?.length);
  const [accId, setAccId] = useState('');
  const [key, setKey] = useState('five_hour');
  const [mode, setMode] = useState<'bars' | 'area'>('bars');

  // follow the account picked in the sidebar
  useEffect(() => {
    if (preferredId !== 'all' && okAccounts.some((a) => a.id === preferredId)) setAccId(preferredId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredId]);

  const acc = okAccounts.find((a) => a.id === accId) ?? okAccounts[0];
  const windows = acc?.windows ?? [];
  const win = windows.find((w) => w.key === key) ?? windows[0];

  const { points, ready } = useHistory(acc?.id, win?.key, range, tick);
  const peak = useMemo(() => points.reduce((m, p) => Math.max(m, p[1]), 0), [points]);

  const seg = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'bg-card text-fg shadow-sm' : 'text-muted-fg hover:text-fg'}`;

  const right = (
    <div className="flex items-center gap-2">
      <div className="flex rounded-lg border border-line bg-frame p-0.5">
        {(['6h', '24h', '7d'] as RangeKey[]).map((r) => (
          <button key={r} onClick={() => onRange(r)} className={seg(range === r)}>{r}</button>
        ))}
      </div>
      <div className="flex rounded-lg border border-line bg-frame p-0.5">
        <button onClick={() => setMode('bars')} className={seg(mode === 'bars')} title="Bars"><ChartColumn className="size-3.5" /></button>
        <button onClick={() => setMode('area')} className={seg(mode === 'area')} title="Line"><ChartLine className="size-3.5" /></button>
      </div>
    </div>
  );

  return (
    <FrameCard icon={<TrendingUp className="size-3.5 text-subtle-fg" />} title="Usage trend" right={right} delay={60} className="h-full">
      <div className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[32px] leading-none font-semibold tracking-tight" style={{ color: win ? colorVar(levelFor(win.used)) : undefined }}>
              {win ? <AnimatedNumber value={win.used} suffix="%" /> : '—'}
            </div>
            <div className="mt-2 text-xs text-muted-fg">
              {win ? <>now · peak <span className="font-medium text-fg">{Math.round(peak)}%</span> in this range</> : 'No data yet'}
            </div>
          </div>
          <div className="flex gap-2">
            <select className={selectCls} value={acc?.id ?? ''} onChange={(e) => { setAccId(e.target.value); }} aria-label="Account">
              {okAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className={selectCls} value={win?.key ?? ''} onChange={(e) => setKey(e.target.value)} aria-label="Limit">
              {windows.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <UsageChart points={points} range={range} mode={mode} ready={ready} seriesKey={`${acc?.id}:${win?.key}`} />
        </div>
      </div>
    </FrameCard>
  );
}
