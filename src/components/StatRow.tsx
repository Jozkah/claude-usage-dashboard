import { Clock, Flame, Trophy, Users } from 'lucide-react';
import type { Account, UsageWindow } from '../lib/types';
import { colorVar, fmtDur, headroom, levelFor } from '../lib/format';
import { useHistory } from '../lib/api';
import { AnimatedNumber } from './AnimatedNumber';
import { FrameCard } from './FrameCard';
import { Sparkline } from './Sparkline';

interface Props {
  accounts: Account[];
  now: number;
  tick: number;
}

const Icon = ({ children }: { children: React.ReactNode }) => <span className="text-subtle-fg [&>svg]:size-3.5">{children}</span>;

function Body({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[132px] flex-col justify-between gap-3 p-4">{children}</div>;
}

export function StatRow({ accounts, now, tick }: Props) {
  const ok = accounts.filter((a) => a.status === 'ok' && a.windows?.length);
  const attention = accounts.length - ok.length;

  // account with the most room
  const best = [...ok].sort((a, b) => headroom(b) - headroom(a))[0];

  // tightest single window
  let tight: { acc: Account; w: UsageWindow } | null = null;
  for (const a of ok) for (const w of a.windows ?? []) if (!tight || w.used > tight.w.used) tight = { acc: a, w };

  // soonest reset
  let next: { acc: Account; w: UsageWindow; at: number } | null = null;
  for (const a of ok) {
    for (const w of a.windows ?? []) {
      if (!w.resetsAt) continue;
      const at = new Date(w.resetsAt).getTime();
      if (at > now && (!next || at < next.at)) next = { acc: a, w, at };
    }
  }

  const bestHist = useHistory(best?.id, 'five_hour', '24h', tick);
  const tightHist = useHistory(tight?.acc.id, tight?.w.key, '24h', tick);

  const tightColor = tight ? colorVar(levelFor(tight.w.used)) : 'var(--subtle-fg)';

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <FrameCard icon={<Icon><Users /></Icon>} title="Accounts" delay={0}>
        <Body>
          <div>
            <div className="text-[32px] leading-none font-semibold tracking-tight">
              <AnimatedNumber value={ok.length} />
              <span className="ml-1.5 text-base font-medium text-muted-fg">of {accounts.length}</span>
            </div>
            <div className="mt-2 text-xs text-muted-fg">
              {attention === 0 ? 'All accounts reporting' : `${attention} need${attention === 1 ? 's' : ''} attention`}
            </div>
          </div>
          <div className="flex gap-1.5">
            {accounts.map((a, i) => (
              <span
                key={a.id}
                title={a.name}
                className="animate-pop h-1.5 flex-1 rounded-full"
                style={{ background: a.status === 'ok' ? 'var(--good)' : 'var(--warn)', animationDelay: `${300 + i * 80}ms` }}
              />
            ))}
          </div>
        </Body>
      </FrameCard>

      <FrameCard icon={<Icon><Trophy /></Icon>} title="Most room right now" delay={70}>
        <Body>
          <div>
            <div className="truncate text-[22px] leading-none font-semibold tracking-tight">{best ? best.name : '—'}</div>
            <div className="mt-2 text-xs text-muted-fg">
              {best ? (
                <>
                  <span className="font-medium text-good"><AnimatedNumber value={headroom(best)} />% left</span> on its tightest limit
                </>
              ) : 'No data yet'}
            </div>
          </div>
          <Sparkline values={bestHist.points.map((p) => p[1])} color="var(--good)" />
        </Body>
      </FrameCard>

      <FrameCard icon={<Icon><Flame /></Icon>} title="Tightest limit" delay={140}>
        <Body>
          <div>
            <div className="text-[32px] leading-none font-semibold tracking-tight" style={{ color: tightColor }}>
              {tight ? <AnimatedNumber value={tight.w.used} suffix="%" /> : '—'}
            </div>
            <div className="mt-2 truncate text-xs text-muted-fg">{tight ? `${tight.acc.name} · ${tight.w.label}` : 'No data yet'}</div>
          </div>
          <Sparkline values={tightHist.points.map((p) => p[1])} color={tightColor} />
        </Body>
      </FrameCard>

      <FrameCard icon={<Icon><Clock /></Icon>} title="Next reset" delay={210}>
        <Body>
          <div>
            <div className="text-[32px] leading-none font-semibold tracking-tight tabular-nums">{next ? fmtDur(next.at - now) : '—'}</div>
            <div className="mt-2 truncate text-xs text-muted-fg">{next ? `${next.acc.name} · ${next.w.label}` : 'No upcoming reset'}</div>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-frame">
            {next && (
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${Math.max(4, Math.min(100, (1 - (next.at - now) / (next.w.key === 'five_hour' ? 5 * 3600e3 : 7 * 864e5)) * 100))}%`,
                  transition: 'width 1s linear',
                }}
              />
            )}
          </div>
        </Body>
      </FrameCard>
    </div>
  );
}
