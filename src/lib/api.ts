import { useCallback, useEffect, useRef, useState } from 'react';
import type { Point, RangeKey, UsageResponse } from './types';

export async function fetchUsage(force = false): Promise<UsageResponse> {
  const res = await fetch('/api/usage' + (force ? '?force=1' : ''), { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

export async function fetchHistory(id: string, key: string, range: RangeKey): Promise<Point[]> {
  const q = new URLSearchParams({ id, key, range });
  const res = await fetch('/api/history?' + q.toString(), { cache: 'no-store' });
  if (!res.ok) return [];
  const j = (await res.json()) as { points?: Point[] };
  return j.points ?? [];
}

export async function addAccount(name: string, configDir: string): Promise<string | null> {
  const res = await fetch('/api/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, configDir }),
  });
  if (res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error || 'Could not add the account.';
}

export async function removeAccount(id: string): Promise<void> {
  await fetch('/api/accounts/' + encodeURIComponent(id), { method: 'DELETE' });
}

export async function shareLocalChats(sourceId: string, targetId: string): Promise<string> {
  const res = await fetch('/api/chats/share', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceId, targetId }),
  });
  const result = (await res.json()) as { error?: string; alreadyShared?: boolean };
  if (!res.ok) throw new Error(result.error || 'Could not share local chats.');
  return `${result.alreadyShared ? 'Local chats already shared.' : 'Local chats shared.'} In Work Desktop Code, start a local session and type /resume to pick a chat.`;
}

export async function syncDesktopChats(): Promise<string> {
  const res = await fetch('/api/chats/sync-desktop', { method: 'POST' });
  const result = (await res.json()) as { error?: string; toWork?: number; toPersonal?: number; conflicts?: number };
  if (!res.ok) throw new Error(result.error || 'Could not sync Desktop sessions.');
  return `Synced ${result.toWork ?? 0} chats to Work, ${result.toPersonal ?? 0} to Personal. ${result.conflicts ?? 0} differing records left untouched. New chats sync automatically while dashboard server runs. If Recents does not update, reopen Claude Desktop. Earlier private thinking cannot transfer between organizations.`;
}

export async function syncCodeSetup(): Promise<string> {
  const res = await fetch('/api/code-setup/sync', { method: 'POST' });
  const result = (await res.json()) as { error?: string; plugins?: number };
  if (!res.ok) throw new Error(result.error || 'Could not sync local Claude Code setup.');
  return `Copied ${result.plugins ?? 0} local plugins plus missing skills to Work. Restart Claude Code or Desktop to reload them.`;
}

/** Polls the API every minute; `refresh(true)` forces a fresh reading. */
export function useUsage() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastLoad, setLastLoad] = useState(0);
  const busy = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
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
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    const id = setInterval(() => void refresh(false), 15_000); // usage is cached server-side; this keeps open chats live
    return () => clearInterval(id);
  }, [refresh]);

  return { data, loading, error, lastLoad, refresh };
}

/** Re-renders every `ms` milliseconds and returns the current time. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** History for one window of one account; reloads when `tick` changes. */
export function useHistory(id: string | undefined, key: string | undefined, range: RangeKey, tick: number) {
  const [points, setPoints] = useState<Point[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!id || !key) { setPoints([]); setReady(true); return; }
    let live = true;
    fetchHistory(id, key, range)
      .then((p) => { if (live) { setPoints(p); setReady(true); } })
      .catch(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [id, key, range, tick]);
  return { points, ready };
}

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = useCallback(() => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle('dark', next);
      try { localStorage.setItem('cud-theme', next ? 'dark' : 'light'); } catch { /* private mode */ }
      return next;
    });
  }, []);
  return { dark, toggle };
}
