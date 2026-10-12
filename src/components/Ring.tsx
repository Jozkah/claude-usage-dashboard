import { useEffect, useState } from 'react';
import { colorVar, levelFor } from '../lib/format';
import { AnimatedNumber } from './AnimatedNumber';

interface Props {
  used: number;
  /** 0..1 share of the window already passed; drawn as a thin inner ring. */
  elapsed: number | null;
  size?: number;
}

/** Animated gauge: outer ring = usage, thin inner ring = time already elapsed. */
export function Ring({ used, elapsed, size = 132 }: Props) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const stroke = 11;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const r2 = r - stroke - 2;
  const C2 = 2 * Math.PI * r2;
  const color = colorVar(levelFor(used));
  const half = size / 2;

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <circle cx={half} cy={half} r={r} fill="none" strokeWidth={stroke} style={{ stroke: 'var(--line)' }} />
        <circle
          cx={half} cy={half} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - (on ? used : 0) / 100)}
          style={{
            stroke: color,
            transition: 'stroke-dashoffset 1.2s var(--ease-out-expo), stroke 0.4s',
            filter: `drop-shadow(0 0 6px color-mix(in srgb, ${color} 35%, transparent))`,
          }}
        />
        {elapsed != null && (
          <>
            <circle cx={half} cy={half} r={r2} fill="none" strokeWidth={3} style={{ stroke: 'var(--line)' }} />
            <circle
              cx={half} cy={half} r={r2} fill="none" strokeWidth={3} strokeLinecap="round"
              strokeDasharray={C2}
              strokeDashoffset={C2 * (1 - (on ? elapsed : 0))}
              style={{ stroke: 'var(--subtle-fg)', transition: 'stroke-dashoffset 1.2s var(--ease-out-expo)' }}
            />
          </>
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[28px] leading-none font-semibold tracking-tight">
          <AnimatedNumber value={used} decimals={0} />
          <span className="ml-0.5 text-sm font-medium text-muted-fg">%</span>
        </div>
        <div className="mt-1 text-[11px] text-subtle-fg">used</div>
      </div>
    </div>
  );
}
