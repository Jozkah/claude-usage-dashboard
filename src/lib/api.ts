import { useCallback, useEffect, useRef, useState } from 'react';
import type { Point, RangeKey, TokenReport, UsageResponse } from './types';

const TIMEOUT_MS = 30_000;

/** fetch with a hard timeout so one hung request cannot block polling forever. */
async function fetchTimeout(url: string, init: RequestInit = {}, ms = TIMEOUT_MS): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('Request timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchUsage(force = false): Promise<UsageResponse> {
  const res = await fetchTimeout('/api/usage' + (force ? '?force=1' : ''), { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/** Throws on a failed request so callers can tell an error from an empty series. */
export async function fetchHistory(id: string, key: string, range: RangeKey): Promise<Point[]> {
  const q = new URLSearchParams({ id, key, range });
  const res = await fetchTimeout('/api/history?' + q.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = (await res.json()) as { points?: Point[] };
  return j.points ?? [];
}

export async function fetchTokens(days = 90): Promise<TokenReport> {
  const res = await fetchTimeout(`/api/tokens?days=${days}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return (await res.json()) as TokenReport;
}

const REFUSED = 'The dashboard server refused the request.';

/** POST helper: checks status, parses JSON with a safe fallback, throws the server's error text. */
async function postJson<T extends object>(url: string, fallback: string, body?: unknown): Promise<T> {
  const res = await fetchTimeout(url, {
    method: 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const result = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(result.error || (res.status === 403 ? REFUSED : fallback));
  return result;
}

export async function addAccount(name: string, configDir: string): Promise<string | null> {
  try {
    await postJson('/api/accounts', 'Could not add the account.', { name, configDir });
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

export async function startAccountLogin(id: string): Promise<void> {
  await postJson('/api/accounts/' + encodeURIComponent(id) + '/login', 'Could not start sign-in.');
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

export async function syncCodeSetup(): Promise<string> {
  const result = await postJson<{ plugins?: number }>('/api/code-setup/sync', 'Could not sync local Claude Code setup.');
  return `Copied ${result.plugins ?? 0} local plugins plus missing skills to Work. Restart Claude Code or Desktop to reload them.`;
}

/** Polls the API every 15 s while the tab is visible; `refresh(true)` forces a fresh reading. */
export function useUsage() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastLoad, setLastLoad] = useState(0);
  const busy = useRef(false);
  const pendingForce = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (busy.current) {
      // never drop a user-initiated refresh: run it once the in-flight request ends
      if (force) pendingForce.current = true;
      return;
    }
    busy.current = true;
    if (force) setLoading(true); // background polls stay silent
    try {
      const d = await fetchUsage(force);
      setData(d);
      setError(null);
      setLastLoad(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Server not reachable');
    } finally {
      busy.current = false;
      setLoading(false);
      if (pendingForce.current) {
        pendingForce.current = false;
        void refresh(true);
      }
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    const poll = () => { if (!document.hidden) void refresh(false); };
    const id = setInterval(poll, 15_000); // usage is cached server-side; this keeps open chats live
    document.addEventListener('visibilitychange', poll);
    window.addEventListener('focus', poll);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', poll);
      window.removeEventListener('focus', poll);
    };
  }, [refresh]);

  return { data, loading, error, lastLoad, refresh };
}

/** Re-renders every `ms` milliseconds and returns the current time. Pauses while the tab is hidden. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tickNow = () => { if (!document.hidden) setNow(Date.now()); };
    const id = setInterval(tickNow, ms);
    document.addEventListener('visibilitychange', tickNow);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tickNow); };
  }, [ms]);
  return now;
}

interface HistoryState { k: string; points: Point[]; ready: boolean; error: boolean }

/** History for one window of one account; reloads when `tick` changes. Pass no id to skip fetching. */
export function useHistory(id: string | undefined, key: string | undefined, range: RangeKey, tick: number) {
  const k = id && key ? `${id}:${key}:${range}` : '';
  const [state, setState] = useState<HistoryState>({ k: '', points: [], ready: false, error: false });
  const [retryN, setRetryN] = useState(0);
  useEffect(() => {
    if (!k || !id || !key) return;
    let live = true;
    fetchHistory(id, key, range)
      .then((p) => { if (live) setState({ k, points: p, ready: true, error: false }); })
      .catch(() => { if (live) setState((s) => ({ k, points: s.k === k ? s.points : [], ready: true, error: true })); });
    return () => { live = false; };
  }, [k, id, key, range, tick, retryN]);
  const retry = useCallback(() => setRetryN((n) => n + 1), []);
  // a different series than the one loaded: show the loading state, never the previous data
  if (!k) return { points: [] as Point[], ready: true, error: false, retry };
  if (state.k !== k) return { points: [] as Point[], ready: false, error: false, retry };
  return { points: state.points, ready: state.ready, error: state.error, retry };
}
