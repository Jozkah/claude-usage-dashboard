import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Point, RangeKey } from '../lib/types';
import { colorVar, levelFor } from '../lib/format';

const SPAN: Record<RangeKey, number> = { '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 864e5 };
const BUCKETS: Record<RangeKey, number> = { '6h': 36, '24h': 48, '7d': 42 };
const H = 260;
const PAD = { l: 6, r: 44, t: 14, b: 28 };

interface Props {
  points: Point[];
  range: RangeKey;
  mode: 'bars' | 'area';
  /** Changes when the series changes, to replay the entrance animation. */
  seriesKey: string;
  ready: boolean;
  /** Request failed: show an error with a retry instead of the empty state. */
  error?: boolean;
  onRetry?: () => void;
}

function tickLabel(ts: number, range: RangeKey) {
  const d = new Date(ts);
  return range === '7d'
    ? d.toLocaleDateString([], { weekday: 'short' })
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Full date and time, so a 7d reading says which Tuesday and what time. */
function tipLabel(ts: number, range: RangeKey) {
  return new Date(ts).toLocaleString([], range === '6h'
    ? { hour: '2-digit', minute: '2-digit' }
    : { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const UsageChart = memo(function UsageChart({ points, range, mode, seriesKey, ready, error = false, onRetry }: Props) {
  const gradId = useId().replace(/:/g, '');
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(280, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(280, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const span = SPAN[range];
  const plotW = width - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const from = useMemo(() => {
    const t = points.length ? Math.max(Date.now(), points[points.length - 1][0]) : Date.now();
    return t - span;
    // deliberately keyed on the data, not on the Date.now()/closure helpers
  }, [points, span]);

  const bars = useMemo(() => {
    const n = BUCKETS[range];
    const size = span / n;
    const out: { t: number; v: number | null }[] = Array.from({ length: n }, (_, i) => ({ t: from + i * size, v: null }));
    for (const [t, v] of points) {
      const i = Math.min(n - 1, Math.max(0, Math.floor((t - from) / size)));
      const cur = out[i].v;
      if (cur == null || v > cur) out[i].v = v;
    }
    return out;
  }, [points, range, span, from]);

  const y = useCallback((v: number) => PAD.t + plotH * (1 - v / 100), [plotH]);
  const xT = useCallback((t: number) => PAD.l + ((t - from) / span) * plotW, [from, span, plotW]);

  const empty = ready && !error && points.length === 0;
  const failed = ready && error && points.length === 0;

  /* ----- hover handling (pointer events so touch works too) ----- */
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (mode === 'bars') {
      const bw = plotW / bars.length;
      const i = Math.floor((x - PAD.l) / bw);
      setHover(i >= 0 && i < bars.length && bars[i].v != null ? i : null);
    } else {
      let best = -1;
      let bd = Infinity;
      points.forEach((p, i) => {
        const d = Math.abs(xT(p[0]) - x);
        if (d < bd) { bd = d; best = i; }
      });
      setHover(best >= 0 ? best : null);
    }
  };

  /* keyboard: arrows step through readings */
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const count = mode === 'bars' ? bars.length : points.length;
    let i = hover == null ? (dir === 1 ? -1 : count) : hover;
    for (;;) {
      i += dir;
      if (i < 0 || i >= count) return;
      if (mode === 'area' || bars[i].v != null) { setHover(i); return; }
    }
  };

  /* ----- tooltip data ----- */
  let tip: { x: number; y: number; v: number; t: number } | null = null;
  if (hover != null) {
    if (mode === 'bars' && bars[hover]?.v != null) {
      const bw = plotW / bars.length;
      tip = { x: PAD.l + hover * bw + bw / 2, y: y(bars[hover].v as number), v: bars[hover].v as number, t: bars[hover].t };
    } else if (mode === 'area' && points[hover]) {
      tip = { x: xT(points[hover][0]), y: y(points[hover][1]), v: points[hover][1], t: points[hover][0] };
    }
  }

  const areaPath = useMemo(() => {
    if (points.length < 2) return { line: '', fill: '' };
    const pts = points.map((p) => [xT(p[0]), y(p[1])] as const);
    const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
    const fill = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${PAD.t + plotH} L${pts[0][0].toFixed(1)} ${PAD.t + plotH} Z`;
    return { line, fill };
  }, [points, xT, y, plotH]);

  // fewer labels on narrow charts so neighbouring times never run into each other
  const tickCount = Math.max(2, Math.min(6, Math.floor(plotW / 96)));
  const ticks = useMemo(() => Array.from({ length: tickCount }, (_, i) => from + (span * (i + 0.5)) / tickCount), [from, span, tickCount]);
  const lastV = points.length ? points[points.length - 1][1] : 0;
  const peakV = points.reduce((m, p) => Math.max(m, p[1]), 0);
  const summary = points.length
    ? `Usage chart, ${range}. Latest ${Math.round(lastV)}%, peak ${Math.round(peakV)}%, ${points.length} readings. Use left and right arrow keys to read values.`
    : 'Usage chart with no readings in this range.';
  const areaColor = colorVar(levelFor(lastV));

  return (
    <div
      ref={wrap}
      className="relative touch-pan-y select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      style={{ height: H }}
      tabIndex={0}
      role="group"
      aria-label={summary}
      onPointerMove={onMove}
      onPointerDown={onMove}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKey}
      onBlur={() => setHover(null)}
    >
      <svg width={width} height={H} className="block overflow-visible" role="img" aria-label={summary}>
        {/* grid + right axis */}
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={PAD.l + plotW} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--chart-grid)' }} strokeWidth={1} />
            <text x={width - PAD.r + 12} y={y(v) + 4} fontSize={11} style={{ fill: 'var(--subtle-fg)' }}>{v}</text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} x={xT(t)} y={H - 6} fontSize={11} textAnchor="middle" style={{ fill: 'var(--subtle-fg)' }}>
            {tickLabel(t, range)}
          </text>
        ))}

        {empty || failed ? null : mode === 'bars' ? (
          <g key={seriesKey + range}>
            {bars.map((b, i) => {
              const bw = plotW / bars.length;
              const gap = Math.max(2, bw * 0.28);
              const h = b.v == null ? 0 : b.v <= 0 ? 1 : Math.max(3, plotH * (b.v / 100)); // real zero = thin baseline
              const active = hover === i;
              return (
                <rect
                  key={i}
                  x={PAD.l + i * bw + gap / 2}
                  y={PAD.t + plotH - h}
                  width={Math.max(2, bw - gap)}
                  height={h}
                  rx={3}
                  className="animate-grow"
                  style={{
                    transformBox: 'fill-box',
                    animationDelay: `${i * 14}ms`,
                    fill: active ? 'var(--primary)' : 'var(--chart-bar)',
                    transition: 'fill 0.18s',
                  }}
                />
              );
            })}
          </g>
        ) : points.length === 1 ? (
          <circle cx={xT(points[0][0])} cy={y(points[0][1])} r={5} style={{ fill: areaColor }} />
        ) : (
          <g key={seriesKey + range} className="animate-draw">
            <defs>
              <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={areaColor} stopOpacity="0.26" />
                <stop offset="100%" stopColor={areaColor} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={areaPath.fill} fill={`url(#${gradId})`} />
            <path d={areaPath.line} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: areaColor }} />
          </g>
        )}

        {/* hover guides */}
        {tip && mode === 'bars' && (
          <line x1={PAD.l} x2={PAD.l + plotW} y1={tip.y} y2={tip.y} strokeDasharray="3 4" strokeWidth={1} style={{ stroke: 'var(--subtle-fg)' }} />
        )}
        {tip && mode === 'area' && (
          <g>
            <line x1={tip.x} x2={tip.x} y1={PAD.t} y2={PAD.t + plotH} strokeDasharray="3 4" strokeWidth={1} style={{ stroke: 'var(--subtle-fg)' }} />
            <circle cx={tip.x} cy={tip.y} r={4.5} style={{ fill: 'var(--card)', stroke: areaColor }} strokeWidth={2} />
          </g>
        )}
      </svg>

      {tip && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-primary px-2 py-1 text-xs font-medium whitespace-nowrap text-primary-fg shadow-lg"
          style={{ left: Math.min(Math.max(tip.x, 60), width - PAD.r - 20), top: Math.max(tip.y - 8, 24) }}
        >
          {Math.round(tip.v)}% · {tipLabel(tip.t, range)}
        </div>
      )}

      {failed && (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
          <div className="text-sm font-medium">Could not load readings</div>
          {onRetry && <button onClick={onRetry} className="rounded-lg border border-line bg-card px-3 py-1 text-xs font-medium">Retry</button>}
        </div>
      )}

      {empty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
          <div className="text-sm font-medium">No readings in this range</div>
          <div className="max-w-xs text-xs text-muted-fg">
            Choose a longer range, or wait for a successful live usage reading.
          </div>
        </div>
      )}
    </div>
  );
});
