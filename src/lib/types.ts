export interface UsageWindow {
  key: string;
  label: string;
  used: number;
  resetsAt: string | null;
}

export interface ChatSession {
  id: string;
  name: string | null;
  folder: string | null;
  where: string | null;
  startedAt: number | null;
  lastActiveAt: number;
  working: boolean;
}

export type AccountStatus = 'ok' | 'no_login' | 'expired' | 'error';

export interface Account {
  id: string;
  name: string;
  configDir: string;
  fetchedAt: number;
  plan?: string | null;
  status: AccountStatus;
  message?: string;
  windows?: UsageWindow[];
  sessions?: ChatSession[];
  raw?: unknown;
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
