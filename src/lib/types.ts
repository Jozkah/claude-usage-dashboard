export interface UsageWindow {
  key: string;
  label: string;
  used: number;
  resetsAt: string | null;
  /** Cached reading whose reset time has passed: `used` describes the previous period. */
  expired?: boolean;
}

export interface ChatSession {
  id: string;
  name: string | null;
  folder: string | null;
  lastActiveAt: number;
  working: boolean;
  state?: 'busy' | 'waiting';
}

export type AccountStatus = 'ok' | 'no_login' | 'expired' | 'error';

export interface Account {
  id: string;
  name: string;
  configDir: string;
  /** Absent for Claude Code accounts. */
  provider?: 'codex';
  fetchedAt: number;
  plan?: string | null;
  /** Snapshot seeded without a known plan: limits shown may be incomplete. */
  planUnknown?: boolean;
  status: AccountStatus;
  authStatus?: AccountStatus;
  retryAt?: number;
  nextPollAt?: number | null;
  message?: string;
  windows?: UsageWindow[];
  sessions?: ChatSession[];
  stale?: boolean;
  staleMessage?: string;
}

export interface UsageResponse {
  serverTime: number;
  mock: boolean;
  accounts: Account[];
}

export type Point = [number, number];
export type RangeKey = '6h' | '24h' | '7d';
export type Level = 'good' | 'warn' | 'bad';

export interface NamedShare { name: string; tokens: number; cost: number }
export interface DayUsage {
  date: string;
  requests: number;
  failed: number;
  canceled: number;
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
export interface TokenReport {
  scanning: boolean;
  ready: boolean;
  done: number;
  total: number;
  updatedAt: number;
  days: DayUsage[];
  /** Optional: the server's current calendar day (YYYY-MM-DD) and zone, when it reports them. */
  today?: string;
  timeZone?: string;
}
