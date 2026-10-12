import { useId } from 'react';

interface Props {
  values: number[];
  color: string;
  height?: number;
}

/** Tiny trend line with a soft gradient fill that draws itself in. */
export function Sparkline({ values, color, height = 40 }: Props) {
  const id = useId().replace(/:/g, '');
  if (values.length < 2) {
    return <div className="h-10 w-full rounded-md border border-dashed border-line opacity-60" style={{ height }} />;
  }
  const W = 100;
  const H = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 3 - ((v - min) / span) * (H - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="animate-draw" key={values.length + ':' + values[values.length - 1]}>
        <path d={area} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}
