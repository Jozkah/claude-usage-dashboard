import { memo, useEffect, useMemo, useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { fetchTokens } from '../lib/api';
import { modelName } from '../lib/format';
import type { DayUsage, ModelPrice, NamedShare, TokenReport } from '../lib/types';
import { FrameCard } from './FrameCard';
import { Select } from './Select';
import { useProgressive } from '../lib/scroll';

function useTokens() {
  const [report, setReport] = useState<TokenReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const ctl = new AbortController();
    const load = async () => {
      let wait = 60_000;
      try {
        const j = await fetchTokens('all', ctl.signal);
        if (!stop) { setReport(j); setError(null); }
        if (j.scanning || !j.ready) wait = 5_000;
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : 'Server not reachable');
        wait = 15_000;
      }
      if (!stop) timer = setTimeout(load, wait);
    };
    void load();
    return () => { stop = true; ctl.abort(); clearTimeout(timer); };
  }, [attempt]);
  return { report, error, retry: () => setAttempt((n) => n + 1) };
}

const tok = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n));
const usd = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Pure calendar arithmetic on YYYY-MM-DD strings, so no browser time zone gets involved. */
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const RANGES = [7, 30, 90, 'all'] as const;
const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(n / d >= 0.999 || n / d < 0.1 ? 1 : 0)}%` : '–');

/** One colour per model, assigned by all-time usage so a model keeps its colour when the range changes. */
const MODEL_COLORS = ['#4f7cff', '#3fb68b', '#8b6cf0', '#e0a030', '#e0587f', '#38b2d6', '#d6743a'];
const OTHER_COLOR = '#7b8394';
type Metric = 'tokens' | 'cost';

function Seg<T extends string | number>({ value, options, onChange, label, group }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: (v: T) => string; group: string }) {
  return (
    <div role="group" aria-label={group} className="flex rounded-lg border border-line bg-card p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={String(o)}
          onClick={() => onChange(o)}
          aria-pressed={value === o}
          className={`rounded-md px-2.5 py-1 font-medium transition-colors ${value === o ? 'bg-frame text-fg' : 'text-muted-fg hover:text-fg'}`}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
}

function Shares({ title, items, total, metric, color }: { title: string; items: (NamedShare & { id?: string })[]; total: number; metric: Metric; color: (item: NamedShare & { id?: string }, index: number) => string }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 text-[12px] font-medium text-muted-fg">{title}</div>
      <ul className="flex flex-col gap-2">
        {items.slice(0, 5).map((s, i) => {
          const v = metric === 'tokens' ? s.tokens : s.cost;
          return (
            <li key={s.name} className="text-[12.5px]">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5"><span className="size-2 shrink-0 rounded-sm" style={{ background: color(s, i) }} /><span className="truncate">{s.name}</span></span>
                <span className="shrink-0 tabular-nums text-muted-fg">{metric === 'tokens' ? tok(s.tokens) : usd(s.cost)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-frame">
                <div className="h-full rounded-full" style={{ width: `${total ? Math.max(2, (v / total) * 100) : 0}%`, background: color(s, i) }} />
              </div>
            </li>
          );
        })}
        {items.length === 0 && <li className="text-xs text-subtle-fg">Nothing yet.</li>}
      </ul>
    </div>
  );
}

type ModelRow = { id: string; name: string; requests: number; input: number; output: number; cacheRead: number; cacheWrite: number; tokens: number; cost: number };
type Stats = { reasoning: number; success: number; failed: number; canceled: number; input: number; output: number; cacheRead: number; cacheWrite: number };

function Tile({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-frame/50 px-3 py-2.5" title={hint}>
      <div className="text-[11.5px] text-muted-fg">{label}</div>
      <div className={`mt-0.5 truncate text-[17px] font-semibold tabular-nums ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

/** Request outcomes and token mix for the chosen range. Success = answered requests; failed = API errors; canceled = user interrupts. */
function RequestStats({ stats: s }: { stats: Stats }) {
  const requests = s.success + s.failed + s.canceled;
  const prompt = s.input + s.cacheRead + s.cacheWrite;
  const mix = [
    { name: 'Uncached input', v: s.input, color: '#4f7cff' },
    { name: 'Cache read', v: s.cacheRead, color: '#e0a030' },
    { name: 'Cache write', v: s.cacheWrite, color: '#e0587f' },
    { name: 'Output', v: s.output, color: '#3fb68b' },
  ];
  const all = mix.reduce((n, m) => n + m.v, 0);
  return (
    <div className="mt-6 grid gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Requests" value={tok(requests)} />
        <Tile label="Success" value={tok(s.success)} tone="text-good" />
        <Tile label="Failed" value={tok(s.failed)} tone={s.failed ? 'text-bad' : ''} hint="API errors such as overloaded or rate limited" />
        <Tile label="Canceled" value={tok(s.canceled)} hint="Requests you interrupted" />
        <Tile label="Success rate" value={pct(s.success, requests)} tone="text-good" />
        <Tile label="Cache hit rate" value={pct(s.cacheRead, prompt)} tone="text-warn" hint="Cache reads as a share of all prompt tokens" />
        {s.reasoning > 0 && <Tile label="Reasoning" value={tok(s.reasoning)} hint="Thinking tokens, reported by Codex and OpenCode (already part of output)" />}
      </div>
      <div>
        <div className="mb-2 text-[12px] font-medium text-muted-fg">Token mix</div>
        <div className="flex h-2 overflow-hidden rounded-full bg-frame" role="img" aria-label={mix.map((m) => `${m.name} ${pct(m.v, all)}`).join(', ')}>
          {mix.map((m) => <div key={m.name} style={{ flexGrow: m.v, flexBasis: 0, background: m.color }} />)}
        </div>
        <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-4">
          {mix.map((m) => (
            <li key={m.name} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 truncate"><span className="size-2 shrink-0 rounded-sm" style={{ background: m.color }} />{m.name}</span>
              <span className="tabular-nums text-muted-fg">{tok(m.v)} · {pct(m.v, all)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Per-model totals with the public price per million tokens that the cost estimate uses (models without one are tokens-only). */
function ModelTable({ rows, prices, colorOf }: { rows: ModelRow[]; prices?: Record<string, ModelPrice>; colorOf: (id: string) => string }) {
  if (rows.length === 0) return null;
  const rate = (p?: ModelPrice) => (p ? `$${p.input} / $${p.output}` : 'no price');
  const th = 'px-3 py-1.5 text-right font-medium';
  const td = 'px-3 py-1.5 text-right tabular-nums';
  return (
    <div className="mt-6">
      <div className="mb-2 text-[12px] font-medium text-muted-fg">Models</div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-[12.5px]">
          <thead className="bg-frame text-left text-[11.5px] text-muted-fg">
            <tr>
              <th className="px-3 py-1.5 font-medium">Model</th>
              <th className={th}>Requests</th>
              <th className={th}>Input</th>
              <th className={th}>Output</th>
              <th className={th}>Cache read</th>
              <th className={th}>Cache write</th>
              <th className={th}>Est. cost</th>
              <th className={th} title="USD per million input / output tokens">Price in / out</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-t border-line/70">
                <td className="max-w-[220px] px-3 py-1.5"><span className="flex items-center gap-1.5"><span className="size-2 shrink-0 rounded-sm" style={{ background: colorOf(m.id) }} /><span className="truncate" title={m.id}>{m.name}</span></span></td>
                <td className={td}>{tok(m.requests)}</td>
                <td className={td}>{tok(m.input)}</td>
                <td className={td}>{tok(m.output)}</td>
                <td className={td}>{tok(m.cacheRead)}</td>
                <td className={td}>{tok(m.cacheWrite)}</td>
                <td className={td}>{prices?.[m.id] ? usd(m.cost) : '–'}</td>
                <td className={`${td} text-muted-fg`}>{rate(prices?.[m.id])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const DailyUsage = memo(function DailyUsage({ delay = 0 }: { delay?: number }) {
  const { report, error, retry } = useTokens();
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [metric, setMetric] = useState<Metric>('tokens');
  const [hover, setHover] = useState<number | null>(null);
  const [client, setClient] = useState('all');
  const [model, setModel] = useState('all');

  const view = useMemo(() => {
    /** The day as seen through the client and model filters. Failed/canceled are only known per client, so a model filter hides them. */
    const eff = (d: DayUsage): DayUsage | undefined => {
      let x: DayUsage | undefined = d;
      if (client !== 'all') { const c = d.clients?.[client]; x = c ? { ...c, date: d.date } : undefined; }
      if (x && model !== 'all') {
        const m = x.models.find((n) => n.name === model);
        x = m ? { date: x.date, requests: m.requests ?? 0, failed: 0, canceled: 0, input: m.input ?? 0, output: m.output ?? 0, cacheRead: m.cacheRead ?? 0, cacheWrite: m.cacheWrite ?? 0, reasoning: 0, total: m.tokens, cost: m.cost, unpriced: 0, models: [m], projects: [] } : undefined;
      }
      return x;
    };
    const byDate = new Map<string, DayUsage>();
    for (const d of report?.days ?? []) { const x = eff(d); if (x) byDate.set(d.date, x); }
    const list: { date: string; d: DayUsage | undefined }[] = [];
    // the server buckets days in its own time zone: anchor on its calendar, not the browser's
    const latest = [...byDate.keys()].sort().pop() ?? '';
    const local = key(new Date());
    const today = report?.today && DAY.test(report.today) ? report.today : latest > local ? latest : local;
    const span = range === 'all'
      ? Math.max(1, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${[...byDate.keys()].sort()[0] ?? today}T00:00:00Z`)) / 86_400_000) + 1)
      : range;
    for (let i = span - 1; i >= 0; i--) {
      const k = addDays(today, -i);
      list.push({ date: k, d: byDate.get(k) });
    }
    // model colours: ranked by all-time tokens, the first few get a colour, the rest share grey
    const allTime = new Map<string, number>();
    for (const d of report?.days ?? []) for (const m of d.models) allTime.set(m.name, (allTime.get(m.name) ?? 0) + m.tokens);
    const ranked = [...allTime.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    const colorOf = (name: string) => { const i = ranked.indexOf(name); return i >= 0 && i < MODEL_COLORS.length ? MODEL_COLORS[i] : OTHER_COLOR; };
    const legend = ranked.slice(0, MODEL_COLORS.length).filter((n) => list.some((x) => x.d?.models.some((m) => m.name === n)))
      .map((n) => ({ name: modelName(n), color: colorOf(n) }));
    if (ranked.length > MODEL_COLORS.length) legend.push({ name: 'Other', color: OTHER_COLOR });
    const days = list.map((x) => x.d).filter((x): x is DayUsage => !!x);
    const pickModels = (d: DayUsage) => d.models;
    const merge = (pick: (d: DayUsage) => NamedShare[]) => {
      const m = new Map<string, NamedShare>();
      for (const d of days) for (const s of pick(d)) {
        const name = pick === pickModels ? modelName(s.name) : s.name;
        const cur = m.get(s.name) ?? { name, id: s.name, tokens: 0, cost: 0 };
        cur.tokens += s.tokens; cur.cost += s.cost;
        m.set(s.name, cur);
      }
      return [...m.values()].sort((a, b) => (metric === 'tokens' ? b.tokens - a.tokens : b.cost - a.cost));
    };
    const totalTok = days.reduce((s, d) => s + d.total, 0);
    const totalCost = days.reduce((s, d) => s + d.cost, 0);
    const unpriced = days.reduce((s, d) => s + d.unpriced, 0);
    const sumOf = (k: 'requests' | 'failed' | 'canceled' | 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'reasoning') => days.reduce((n, d) => n + (d[k] || 0), 0);
    const stats = { success: sumOf('requests'), failed: sumOf('failed'), canceled: sumOf('canceled'), input: sumOf('input'), output: sumOf('output'), cacheRead: sumOf('cacheRead'), cacheWrite: sumOf('cacheWrite'), reasoning: sumOf('reasoning') };
    const val = (d?: DayUsage) => (d ? (metric === 'tokens' ? d.total : d.cost) : 0);
    const base = {
      list,
      max: Math.max(1, ...list.map((x) => val(x.d))),
      val,
      totalTok, totalCost, unpriced, stats, legend, colorOf,
      activeDays: days.length,
      models: merge(pickModels),
      projects: merge((d) => d.projects),
      table: [...days].map((d) => ({ ...d, models: [...d.models].sort((a, b) => b.tokens - a.tokens) })).sort((a, b) => (a.date < b.date ? 1 : -1)),
    };
    // per-client totals for the chosen range (ignores the client filter so the split stays visible)
    const inRange = new Set(list.map((x) => x.date));
    const perClient = new Map<string, NamedShare>();
    for (const d of report?.days ?? []) {
      if (!inRange.has(d.date)) continue;
      for (const [name, c] of Object.entries(d.clients ?? {})) {
        const cur = perClient.get(name) ?? { name, tokens: 0, cost: 0 };
        cur.tokens += c.total; cur.cost += c.cost;
        perClient.set(name, cur);
      }
    }
    const clientShares = [...perClient.values()].sort((a, b) => b.tokens - a.tokens);
    const rows = new Map<string, ModelRow>();
    for (const d of days) for (const m of d.models) {
      const cur = rows.get(m.name) ?? { id: m.name, name: modelName(m.name), requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0, cost: 0 };
      cur.requests += m.requests ?? 0; cur.input += m.input ?? 0; cur.output += m.output ?? 0;
      cur.cacheRead += m.cacheRead ?? 0; cur.cacheWrite += m.cacheWrite ?? 0; cur.tokens += m.tokens; cur.cost += m.cost;
      rows.set(m.name, cur);
    }
    const modelRows = [...rows.values()].sort((a, b) => b.tokens - a.tokens);
    const clientNames = [...new Set((report?.days ?? []).flatMap((d) => Object.keys(d.clients ?? {})))];
    return { ...base, clientShares, clientNames, modelRows, modelOptions: ranked };
  }, [report, range, metric, client, model]);

  const rows = useProgressive(view.table.length, 30, `${range}|${client}|${model}`);
  const scanning = report && (report.scanning || !report.ready);
  const shown = hover != null ? view.list[hover] : null;
  const shownVal = shown ? view.val(shown.d) : null;

  return (
    <FrameCard
      title="Daily usage on this computer"
      icon={<BarChart3 className="size-3.5" />}
      delay={delay}
      right={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {view.clientNames.length > 1 && (
            <Select label="Client" className="w-36" value={client} onChange={setClient}
              options={[{ value: 'all', label: 'All clients' }, ...view.clientNames.map((n) => ({ value: n, label: n }))]} />
          )}
          {view.modelOptions.length > 1 && (
            <Select label="Model" className="w-44" value={model} onChange={setModel}
              options={[{ value: 'all', label: 'All models' }, ...view.modelOptions.map((n) => ({ value: n, label: modelName(n) }))]} />
          )}
          <Seg group="Metric" value={metric} options={['tokens', 'cost'] as const} onChange={setMetric} label={(v) => (v === 'tokens' ? 'Tokens' : 'Est. cost')} />
          <Seg group="Days shown" value={range} options={RANGES} onChange={setRange} label={(v) => (v === 'all' ? 'All' : `${v}d`)} />
        </div>
      }
    >
      <div className="p-4">
        {!report && !error && <div className="h-40 animate-pulse rounded-lg bg-frame" />}
        {!report && error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-3 text-[13px]">
            <span>Could not load daily usage ({error}).</span>
            <button onClick={retry} className="rounded-lg border border-line bg-card px-3 py-1 text-xs font-medium">Retry</button>
          </div>
        )}

        {report && (
          <>
            {error && (
              <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px]">
                <span>Showing older numbers: the latest refresh failed ({error}).</span>
                <button onClick={retry} className="rounded-md border border-line bg-card px-2.5 py-0.5 text-xs font-medium">Retry</button>
              </div>
            )}
            {scanning && (
              <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-line bg-frame/60 px-3 py-2 text-[12.5px] text-muted-fg">
                <Loader2 className="size-3.5 animate-spin" />
                {report.total
                  ? `Reading your chat history for the first time… ${report.done.toLocaleString()} of ${report.total.toLocaleString()} files. Numbers below are partial until it finishes.`
                  : 'Looking for chat history…'}
              </div>
            )}

            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
              <div>
                <div className="text-[28px] leading-none font-semibold tracking-tight tabular-nums">
                  {shown ? (metric === 'tokens' ? tok(shownVal ?? 0) : usd(shownVal ?? 0)) : metric === 'tokens' ? tok(view.totalTok) : usd(view.totalCost)}
                </div>
                <div className="mt-1.5 text-[12.5px] text-muted-fg">
                  {shown ? shown.date : range === 'all' ? 'all time' : `last ${range} days`}
                  {!shown && view.activeDays > 0 && (
                    <> · {metric === 'tokens' ? `${usd(view.totalCost)} est.` : `${tok(view.totalTok)} tokens`} · avg {metric === 'tokens' ? tok(view.totalTok / view.activeDays) : usd(view.totalCost / view.activeDays)}/active day</>
                  )}
                </div>
              </div>
            </div>

            {view.legend.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-fg">
                {view.legend.map((l) => (
                  <li key={l.name} className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: l.color }} />{l.name}</li>
                ))}
              </ul>
            )}
            <div
              role="group"
              aria-label={`Daily ${metric === 'tokens' ? 'tokens' : 'estimated cost'}, ${range === 'all' ? 'all time' : `last ${range} days`}`}
              className="mt-3 flex h-36 items-end gap-[2px]"
              onPointerLeave={() => setHover(null)}
            >
              {view.list.map((x, i) => {
                const v = view.val(x.d);
                return (
                  <div
                    key={x.date}
                    tabIndex={0}
                    role="img"
                    aria-label={`${x.date}: ${metric === 'tokens' ? `${tok(v)} tokens` : usd(v)}`}
                    className="group flex h-full min-w-0 flex-1 items-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    onPointerEnter={() => setHover(i)}
                    onPointerDown={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                  >
                    <div
                      className="flex w-full flex-col-reverse overflow-hidden rounded-t-[3px] transition-opacity"
                      style={{ height: v ? `${Math.max(3, (v / view.max) * 100)}%` : '2px', opacity: v ? (hover === null || hover === i ? 1 : 0.55) : 0.25, background: v ? undefined : 'var(--color-line)', transition: 'height .7s var(--ease-out-expo), opacity .15s' }}
                    >
                      {x.d && v > 0 && x.d.models.map((m) => {
                        const mv = metric === 'tokens' ? m.tokens : m.cost;
                        return <div key={m.name} style={{ flexGrow: mv, flexBasis: 0, minHeight: mv > 0 ? 1 : 0, background: view.colorOf(m.name) }} />;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-subtle-fg">
              <span>{view.list[0]?.date.slice(5)}</span>
              <span>{view.list[view.list.length - 1]?.date.slice(5)}</span>
            </div>

            <RequestStats stats={view.stats} />

            <div className={`mt-6 grid gap-6 sm:grid-cols-2 ${view.clientShares.length > 1 ? 'lg:grid-cols-3' : ''}`}>
              {view.clientShares.length > 1 && (
                <Shares title="By client" items={view.clientShares} total={view.clientShares.reduce((n, c) => n + (metric === 'tokens' ? c.tokens : c.cost), 0)} metric={metric} color={(c) => MODEL_COLORS[view.clientNames.indexOf(c.name) % MODEL_COLORS.length]} />
              )}
              <Shares title="By model" items={view.models} total={metric === 'tokens' ? view.totalTok : view.totalCost} metric={metric} color={(s) => view.colorOf(s.id ?? s.name)} />
              <Shares title="By project" items={view.projects} total={metric === 'tokens' ? view.totalTok : view.totalCost} metric={metric} color={(_s, i) => MODEL_COLORS[i % MODEL_COLORS.length]} />
            </div>

            <ModelTable rows={view.modelRows} prices={report.prices} colorOf={view.colorOf} />

            <div className="mt-6">
              <div className="mb-2 text-[12px] font-medium text-muted-fg">Day by day</div>
              <div className="rounded-lg border border-line">
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-12 z-10 bg-frame text-left text-[11.5px] text-muted-fg">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">Date</th>
                      <th className="px-3 py-1.5 text-right font-medium">Tokens</th>
                      <th className="px-3 py-1.5 text-right font-medium">Est. cost</th>
                      <th className="hidden px-3 py-1.5 font-medium sm:table-cell">Main model</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.table.slice(0, rows.count).map((d) => (
                      <tr key={d.date} className="day-row border-t border-line/70">
                        <td className="px-3 py-1.5 tabular-nums">{d.date}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{tok(d.total)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{usd(d.cost)}</td>
                        <td className="hidden max-w-[180px] truncate px-3 py-1.5 text-muted-fg sm:table-cell">{d.models[0] ? modelName(d.models[0].name) : '–'}</td>
                      </tr>
                    ))}
                    {view.table.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-subtle-fg">No chat history found yet.</td></tr>
                    )}
                  </tbody>
                </table>
                {rows.more && (
                  <div ref={rows.sentinel} className="flex items-center justify-between gap-3 border-t border-line/70 px-3 py-2 text-[12px] text-subtle-fg">
                    <span>Showing {rows.count} of {view.table.length} days. More load as you scroll.</span>
                    <button onClick={rows.showAll} className="rounded-md px-2 py-1 font-medium text-fg transition-colors hover:bg-frame">Show all</button>
                  </div>
                )}
              </div>
            </div>

            <p className="mt-4 text-[11.5px] leading-relaxed text-subtle-fg">
              Read from the chat logs on this computer, so phone and other-PC usage is not included here (it is in the limit gauges above).
              Cost uses <a href="https://platform.claude.com/docs/en/about-claude/pricing" target="_blank" rel="noreferrer" className="underline">Anthropic’s public API prices</a>, not what your plan charges. Fast mode, US inference, batch pricing, and web searches are included when recorded in the logs
              {view.unpriced > 0 ? `; ${tok(view.unpriced)} tokens from models without a known price are counted in tokens only` : ''}.
              Logs are shared by all accounts on this PC, so this is a combined total. Days follow {report.timeZone ? `the ${report.timeZone} time zone` : 'the server’s local calendar'}.
            </p>
          </>
        )}
      </div>
    </FrameCard>
  );
});
