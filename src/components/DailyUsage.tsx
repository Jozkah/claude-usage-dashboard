import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { FrameCard } from './FrameCard';

interface NamedShare { name: string; tokens: number; cost: number }
interface DayUsage {
  date: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
  unpriced: number;
  models: NamedShare[];
  projects: NamedShare[];
}
interface TokenReport { scanning: boolean; ready: boolean; done: number; total: number; updatedAt: number; days: DayUsage[] }

function useTokens(): TokenReport | null {
  const [data, setData] = useState<TokenReport | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let wait = 60_000;
      try {
        const r = await fetch('/api/tokens?days=90', { cache: 'no-store' });
        if (r.ok) {
          const j = (await r.json()) as TokenReport;
          if (!stop) setData(j);
          if (j.scanning || !j.ready) wait = 5_000;
        }
      } catch { /* server restarting */ }
      if (!stop) timer = setTimeout(load, wait);
    };
    void load();
    return () => { stop = true; clearTimeout(timer); };
  }, []);
  return data;
}

const tok = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n));
const usd = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`);
const shortModel = (m: string) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '');

const pad = (n: number) => String(n).padStart(2, '0');
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const RANGES = [7, 30, 90] as const;
type Metric = 'tokens' | 'cost';

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: (v: T) => string }) {
  return (
    <div className="flex rounded-lg border border-line bg-card p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={String(o)}
          onClick={() => onChange(o)}
          className={`rounded-md px-2.5 py-1 font-medium transition-colors ${value === o ? 'bg-frame text-fg' : 'text-muted-fg hover:text-fg'}`}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
}

function Shares({ title, items, total, metric }: { title: string; items: NamedShare[]; total: number; metric: Metric }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 text-[12px] font-medium text-muted-fg">{title}</div>
      <ul className="flex flex-col gap-2">
        {items.slice(0, 5).map((s) => {
          const v = metric === 'tokens' ? s.tokens : s.cost;
          return (
            <li key={s.name} className="text-[12.5px]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{s.name}</span>
                <span className="shrink-0 tabular-nums text-muted-fg">{metric === 'tokens' ? tok(s.tokens) : usd(s.cost)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-frame">
                <div className="h-full rounded-full bg-accent" style={{ width: `${total ? Math.max(2, (v / total) * 100) : 0}%` }} />
              </div>
            </li>
          );
        })}
        {items.length === 0 && <li className="text-xs text-subtle-fg">Nothing yet.</li>}
      </ul>
    </div>
  );
}

export function DailyUsage({ delay = 0 }: { delay?: number }) {
  const report = useTokens();
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [metric, setMetric] = useState<Metric>('tokens');
  const [hover, setHover] = useState<number | null>(null);

  const view = useMemo(() => {
    const byDate = new Map((report?.days ?? []).map((d) => [d.date, d]));
    const list: { date: string; d: DayUsage | undefined }[] = [];
    for (let i = range - 1; i >= 0; i--) {
      const dt = new Date();
      dt.setDate(dt.getDate() - i);
      const k = key(dt);
      list.push({ date: k, d: byDate.get(k) });
    }
    const days = list.map((x) => x.d).filter((x): x is DayUsage => !!x);
    const merge = (pick: (d: DayUsage) => NamedShare[]) => {
      const m = new Map<string, NamedShare>();
      for (const d of days) for (const s of pick(d)) {
        const cur = m.get(s.name) ?? { name: s.name, tokens: 0, cost: 0 };
        cur.tokens += s.tokens; cur.cost += s.cost;
        m.set(s.name, cur);
      }
      return [...m.values()].sort((a, b) => (metric === 'tokens' ? b.tokens - a.tokens : b.cost - a.cost));
    };
    const totalTok = days.reduce((s, d) => s + d.total, 0);
    const totalCost = days.reduce((s, d) => s + d.cost, 0);
    const unpriced = days.reduce((s, d) => s + d.unpriced, 0);
    const val = (d?: DayUsage) => (d ? (metric === 'tokens' ? d.total : d.cost) : 0);
    return {
      list,
      max: Math.max(1, ...list.map((x) => val(x.d))),
      val,
      totalTok, totalCost, unpriced,
      activeDays: days.length,
      models: merge((d) => d.models).map((m) => ({ ...m, name: shortModel(m.name) })),
      projects: merge((d) => d.projects),
      table: [...days].sort((a, b) => (a.date < b.date ? 1 : -1)),
    };
  }, [report, range, metric]);

  const scanning = report && (report.scanning || !report.ready);
  const shown = hover != null ? view.list[hover] : null;
  const shownVal = shown ? view.val(shown.d) : null;

  return (
    <FrameCard
      title="Daily usage on this computer"
      icon={<BarChart3 className="size-3.5" />}
      delay={delay}
      right={
        <div className="flex items-center gap-2">
          <Seg value={metric} options={['tokens', 'cost'] as const} onChange={setMetric} label={(v) => (v === 'tokens' ? 'Tokens' : 'Est. cost')} />
          <Seg value={range} options={RANGES} onChange={setRange} label={(v) => `${v}d`} />
        </div>
      }
    >
      <div className="p-4">
        {!report && <div className="h-40 animate-pulse rounded-lg bg-frame" />}

        {report && (
          <>
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
                  {shown ? shown.date : `last ${range} days`}
                  {!shown && view.activeDays > 0 && (
                    <> · {metric === 'tokens' ? `${usd(view.totalCost)} est.` : `${tok(view.totalTok)} tokens`} · avg {metric === 'tokens' ? tok(view.totalTok / view.activeDays) : usd(view.totalCost / view.activeDays)}/active day</>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 flex h-36 items-end gap-[3px]" onMouseLeave={() => setHover(null)}>
              {view.list.map((x, i) => {
                const v = view.val(x.d);
                return (
                  <div key={x.date} className="group flex h-full min-w-0 flex-1 items-end" onMouseEnter={() => setHover(i)}>
                    <div
                      className={`w-full rounded-t-[3px] transition-colors ${hover === i ? 'bg-accent' : 'bg-accent/55'}`}
                      style={{ height: v ? `${Math.max(3, (v / view.max) * 100)}%` : '2px', opacity: v ? 1 : 0.25, transition: 'height .7s var(--ease-out-expo)' }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-subtle-fg">
              <span>{view.list[0]?.date.slice(5)}</span>
              <span>{view.list[view.list.length - 1]?.date.slice(5)}</span>
            </div>

            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <Shares title="By model" items={view.models} total={metric === 'tokens' ? view.totalTok : view.totalCost} metric={metric} />
              <Shares title="By project" items={view.projects} total={metric === 'tokens' ? view.totalTok : view.totalCost} metric={metric} />
            </div>

            <div className="mt-6">
              <div className="mb-2 text-[12px] font-medium text-muted-fg">Day by day</div>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-0 bg-frame text-left text-[11.5px] text-muted-fg">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">Date</th>
                      <th className="px-3 py-1.5 text-right font-medium">Tokens</th>
                      <th className="px-3 py-1.5 text-right font-medium">Est. cost</th>
                      <th className="hidden px-3 py-1.5 font-medium sm:table-cell">Main model</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.table.map((d) => (
                      <tr key={d.date} className="border-t border-line/70">
                        <td className="px-3 py-1.5 tabular-nums">{d.date}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{tok(d.total)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{usd(d.cost)}</td>
                        <td className="hidden max-w-[180px] truncate px-3 py-1.5 text-muted-fg sm:table-cell">{d.models[0] ? shortModel(d.models[0].name) : '–'}</td>
                      </tr>
                    ))}
                    {view.table.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-subtle-fg">No chat history found yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="mt-4 text-[11.5px] leading-relaxed text-subtle-fg">
              Read from the chat logs on this computer, so phone and other-PC usage is not included here (it is in the limit gauges above).
              Cost uses <a href="https://platform.claude.com/docs/en/about-claude/pricing" target="_blank" rel="noreferrer" className="underline">Anthropic’s public API prices</a>, not what your plan charges. Fast mode, US inference, batch pricing, and web searches are included when recorded in the logs
              {view.unpriced > 0 ? `; ${tok(view.unpriced)} tokens from models without a known price are counted in tokens only` : ''}.
              Logs are shared by all accounts on this PC, so this is a combined total.
            </p>
          </>
        )}
      </div>
    </FrameCard>
  );
}
