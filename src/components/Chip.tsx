import type { ReactNode } from 'react';
import type { Level } from '../lib/types';

const tones: Record<Level | 'mute' | 'accent', string> = {
  good: 'bg-good/12 text-good',
  warn: 'bg-warn/14 text-warn',
  bad: 'bg-bad/12 text-bad',
  mute: 'bg-frame text-muted-fg border border-line',
  accent: 'bg-accent/12 text-accent',
};

export function Chip({ tone = 'mute', children, className = '' }: { tone?: Level | 'mute' | 'accent'; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}
