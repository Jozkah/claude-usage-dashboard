import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Point, RangeKey, TokenReport, UsageResponse } from './types';

const TIMEOUT_MS = 30_000;

/** True for a request we cancelled ourselves (superseded poll, unmount, stale history). */
export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** fetch with a hard timeout so one hung request cannot block polling forever; honours a caller `signal`. */
async function fetchTimeout(url: string, init: RequestInit = {}, ms = TIMEOUT_MS): Promise<Response> {
  const ctl = new AbortController();
  const outer = init.signal;
  const onOuter = () => ctl.abort();
  if (outer?.aborted) ctl.abort();
  else outer?.addEventListener('abort', onOuter, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (timedOut && isAbort(e)) throw new Error('Request timed out');
    throw e;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
  }
}

async function fetchUsage(force: boolean, signal?: AbortSignal): Promise<UsageResponse> {
  const res = await fetchTimeout('/api/usage' + (force ? '?force=1' : ''), { cache: 'no-store', signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/** Throws on a failed request so callers can tell an error from an empty series. */
async function fetchHistory(id: string, key: string, range: RangeKey, since?: number, signal?: AbortSignal): Promise<Point[]> {
  const q = new URLSearchParams({ id, key, range });
  if (since !== undefined) q.set('since', String(since)); // servers without `since` ignore it and send the whole range
  const res = await fetchTimeout('/api/history?' + q.toString(), { cache: 'no-store', signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = (await res.json()) as { points?: Point[] };
  return j.points ?? [];
}

export async function fetchTokens(days: number | 'all' = 'all', signal?: AbortSignal): Promise<TokenReport> {
  const res = await fetchTimeout(`/api/tokens?days=${days}`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return (await res.json()) as TokenReport;
}

const REFUSED = 'The dashboard server refused the request.';

/** POST helper: checks status, parses JSON with a safe fallback, throws the server's error text. */
async function postJson<T extends object>(url: string, fallback: string, body?: unknown): Promise<T> {
  const res = await fetchTimeout(url, {
    method: 'POST',
    // the server requires a JSON content type on every POST, with or without a body
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(result.error || (res.status === 403 ? REFUSED : fallback));
  return result;
}

export async function addAccount(name: string, configDir: string, provider?: 'codex' | 'grok', create = false): Promise<string | null> {
  try {
    await postJson('/api/accounts', 'Could not add the account.', { name, configDir, ...(provider ? { provider } : {}), ...(create ? { create: true } : {}) });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Could not add the account.';
  }
}

export async function removeAccount(id: string): Promise<void> {
  const res = await fetchTimeout('/api/accounts/' + encodeURIComponent(id), { method: 'DELETE' });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || (res.status === 403 ? REFUSED : 'Could not remove the account.'));
  }
}

export async function setTeamSeat(id: string, seatTier: 'standard' | 'premium' | null): Promise<string> {
  await postJson('/api/accounts/' + encodeURIComponent(id) + '/seat', 'Could not save Team seat.', { seatTier });
  return seatTier ? `Team seat set to ${seatTier}.` : 'Team seat marked unknown.';
}

export async function startAccountLogin(id: string): Promise<void> {
  await postJson('/api/accounts/' + encodeURIComponent(id) + '/login', 'Could not start sign-in.');
}

export async function openClaude(id: string, kind: 'code' | 'desktop', name: string, app = 'Claude'): Promise<string> {
  await postJson('/api/accounts/' + encodeURIComponent(id) + '/open', 'Could not open Claude.', { kind });
  return kind === 'code' ? `${app === 'Claude' ? 'Claude Code' : app} opened in a new window as ${name}.` : `Claude Desktop is starting as ${name}.`;
}

interface AccountSyncResult { accounts: { name?: string; id: string; chats: string; setup: Record<string, number>; errors: string[] }[] }

/** Links chats and merges skills, commands, agents and plugins across every account (additive, nothing is overwritten). */
export async function syncAllAccounts(): Promise<string> {
  const r = await postJson<AccountSyncResult>('/api/accounts/sync-all', 'Could not sync the accounts.');
  const copied = r.accounts.reduce((t, a) => t + a.setup.skills + a.setup.commands + a.setup.agents + a.setup.plugins, 0);
  const problems = r.accounts.flatMap((a) => a.errors.map((e) => `${a.name ?? a.id}: ${e}`));
  const base = `All accounts synced: chats ${r.accounts.every((a) => a.chats !== 'kept separate') ? 'are shared' : 'partly shared'}, ${copied} skill/command/agent/plugin item${copied === 1 ? '' : 's'} copied.`;
  return problems.length ? `${base} Needs attention: ${problems.join(' ')}` : base;
}

export async function shareLocalChats(sourceId: string, targetId: string, targetName = 'the target account'): Promise<string> {
  const result = await postJson<{ alreadyShared?: boolean }>('/api/chats/share', 'Could not share local chats.', { sourceId, targetId });
  return `${result.alreadyShared ? 'Local chats already shared.' : 'Local chats shared.'} In ${targetName} Desktop Code, start a local session and type /resume to pick a chat.`;
}

export async function syncDesktopChats(): Promise<string> {
  const result = await postJson<{ copied?: Record<string, number>; conflicts?: number }>('/api/chats/sync-desktop', 'Could not sync Desktop sessions.');
  const counts = Object.entries(result.copied ?? {}).map(([name, count]) => `${count} to ${name}`).join(', ');
  return `Synced ${counts || '0 chats'}. ${result.conflicts ?? 0} differing records left untouched. New local Code chats copy while dashboard runs. Open Desktop panes may need reopening to refresh. Earlier private thinking cannot transfer between organizations.`;
}

export async function syncDesktopLabels(): Promise<string> {
  const result = await postJson<{ titles?: number; groups?: number; assignments?: number }>('/api/chats/sync-labels', 'Could not sync Desktop names and groups.');
  return `Synced ${result.titles ?? 0} chat names, ${result.groups ?? 0} groups, ${result.assignments ?? 0} group assignments. Reopen Claude Desktop profiles to refresh their sidebars.`;
}

export async function syncCodeSetup(sourceId?: string, targetId?: string, targetName = 'the target account'): Promise<string> {
  const body = sourceId && targetId ? { sourceId, targetId } : undefined;
  const result = await postJson<{ plugins?: number }>('/api/code-setup/sync', 'Could not sync local Claude Code setup.', body);
  return `Copied ${result.plugins ?? 0} local plugins plus missing skills to ${targetName}. Restart Claude Code or Desktop to reload them.`;
}

const STALL_MS = 8_000;

/** Polls the API every 15 s while the tab is visible; `refresh(true)` forces a fresh reading. */
export function useUsage() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [lastLoad, setLastLoad] = useState(0);
  const busy = useRef(false);
  const inflight = useRef<{ ctl: AbortController; force: boolean } | null>(null);
  const pendingForce = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (busy.current) {
      // never drop a user-initiated refresh: it supersedes a background poll, or runs once a forced one ends
      if (force) {
        pendingForce.current = true;
        if (inflight.current && !inflight.current.force) inflight.current.ctl.abort();
      }
      return;
    }
    busy.current = true;
    const ctl = new AbortController();
    inflight.current = { ctl, force };
    if (force) setLoading(true); // background polls stay silent
    const stall = setTimeout(() => setStalled(true), STALL_MS);
    const mine = () => inflight.current?.ctl === ctl; // false once unmount/remount reset the state
    try {
      const d = await fetchUsage(force, ctl.signal);
      if (!mine()) return;
      setData(d);
      setError(null);
      setLastLoad(Date.now());
    } catch (e) {
      // an abort is a newer request or unmount superseding this one: not a failure
      if (!isAbort(e) && mine()) setError(e instanceof Error ? e.message : 'Server not reachable');
    } finally {
      clearTimeout(stall);
      if (mine()) {
        inflight.current = null;
        busy.current = false;
        setStalled(false);
        if (pendingForce.current) {
          pendingForce.current = false;
          void refresh(true); // keeps the spinner on
        } else setLoading(false);
      }
    }
  }, []);

  /** Abandon the request in flight (if any) and ask again, forcing a fresh reading. */
  const restart = useCallback(() => {
    if (busy.current) {
      pendingForce.current = true;
      inflight.current?.ctl.abort();
    } else void refresh(true);
  }, [refresh]);

  useEffect(() => {
    void refresh(false);
    const poll = () => { if (!document.hidden) void refresh(false); };
    const id = setInterval(poll, 15_000); // usage is cached server-side; this keeps open chats live
    document.addEventListener('visibilitychange', poll);
    window.addEventListener('focus', poll);
    return () => {
      inflight.current?.ctl.abort();
      inflight.current = null; // lets a remount (StrictMode) start its own request
      busy.current = false;
      pendingForce.current = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', poll);
      window.removeEventListener('focus', poll);
    };
  }, [refresh]);

  return { data, loading, error, stalled, lastLoad, refresh, restart };
}

/** One shared interval per period, so a hundred countdowns cost one timer. Paused while the tab is hidden. */
function makeTicker(ms: number) {
  let value = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const subs = new Set<() => void>();
  const tick = () => {
    if (document.hidden) return;
    value = Date.now();
    subs.forEach((f) => f());
  };
  return {
    subscribe(f: () => void) {
      subs.add(f);
      if (!timer) {
        tick();
        timer = setInterval(tick, ms);
        document.addEventListener('visibilitychange', tick);
      }
      return () => {
        subs.delete(f);
        if (!subs.size && timer) {
          clearInterval(timer);
          timer = undefined;
          document.removeEventListener('visibilitychange', tick);
        }
      };
    },
    get() {
      // with nobody subscribed the cached value goes stale: refresh it, but stay stable within one render
      if (!timer && Date.now() - value > 250) value = Date.now();
      return value;
    },
  };
}
const tickers = new Map<number, ReturnType<typeof makeTicker>>();

/** Re-renders every `ms` milliseconds and returns the current time. Only the component that calls it re-renders. */
export function useNow(ms = 1000): number {
  let t = tickers.get(ms);
  if (!t) tickers.set(ms, (t = makeTicker(ms)));
  return useSyncExternalStore(t.subscribe, t.get);
}

interface HistoryState { k: string; points: Point[]; ready: boolean; error: boolean }

const SPAN: Record<RangeKey, number> = { '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 864e5 };
const FULL_EVERY = 20; // reload the whole range after this many increments, since the server downsamples

/**
 * Merge a `since` response into the points we already have: whatever the server returned replaces
 * everything from its first timestamp on, and points older than the range are dropped.
 */
export function mergeHistory(prev: Point[], next: Point[], cutoff: number): Point[] {
  if (!next.length) return prev.filter((p) => p[0] >= cutoff);
  const from = next[0][0];
  return [...prev.filter((p) => p[0] < from && p[0] >= cutoff), ...next];
}

/**
 * History for one window of one account; reloads when `tick` changes. Pass no id to skip fetching.
 * Later reloads of the same series ask the server only for points since the last one (`since`).
 */
export function useHistory(id: string | undefined, key: string | undefined, range: RangeKey, tick: number) {
  const k = id && key ? `${id}:${key}:${range}` : '';
  const [state, setState] = useState<HistoryState>({ k: '', points: [], ready: false, error: false });
  const last = useRef<{ k: string; points: Point[]; inc: number } | null>(null);
  const [retryN, setRetryN] = useState(0);
  useEffect(() => {
    if (!k || !id || !key) return;
    const ctl = new AbortController();
    const prev = last.current?.k === k ? last.current : null;
    const since = prev && prev.points.length && prev.inc < FULL_EVERY ? prev.points[prev.points.length - 1][0] : undefined;
    fetchHistory(id, key, range, since, ctl.signal)
      .then((p) => {
        if (ctl.signal.aborted) return;
        const points = since !== undefined && prev ? mergeHistory(prev.points, p, Date.now() - SPAN[range]) : p;
        last.current = { k, points, inc: since !== undefined && prev ? prev.inc + 1 : 0 };
        setState({ k, points, ready: true, error: false });
      })
      .catch((e) => {
        if (ctl.signal.aborted || isAbort(e)) return;
        setState((s) => ({ k, points: s.k === k ? s.points : [], ready: true, error: true }));
      });
    return () => ctl.abort();
  }, [k, id, key, range, tick, retryN]);
  const retry = useCallback(() => { last.current = null; setRetryN((n) => n + 1); }, []);
  // a different series than the one loaded: show the loading state, never the previous data
  if (!k) return { points: [] as Point[], ready: true, error: false, retry };
  if (state.k !== k) return { points: [] as Point[], ready: false, error: false, retry };
  return { points: state.points, ready: state.ready, error: state.error, retry };
}
