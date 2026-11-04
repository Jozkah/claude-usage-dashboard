import type { Account, Level, UsageWindow } from './types';

export const levelFor = (used: number): Level => (used >= 85 ? 'bad' : used >= 60 ? 'warn' : 'good');
export const colorVar = (l: Level) => `var(--${l})`;

export function windowLength(key: string): number | null {
  if (key === 'five_hour') return 5 * 3600e3;
  if (key.startsWith('seven_day')) return 7 * 864e5;
  return null;
}

/** 0..1 share of the window that has already passed, or null if unknown. */
export function elapsedFraction(w: UsageWindow, now: number): number | null {
  const len = windowLength(w.key);
  if (!len || !w.resetsAt) return null;
  const left = new Date(w.resetsAt).getTime() - now;
  const e = 1 - left / len;
  return e >= 0 && e <= 1 ? e : null;
}

export type Pace = { label: string; tone: Level | 'mute' } | null;

export function paceFor(w: UsageWindow, now: number): Pace {
  const e = elapsedFraction(w, now);
  if (e == null || e < 0.03) return null;
  const diff = w.used - e * 100;
  if (diff > 12) return { label: 'Burning fast', tone: 'bad' };
  if (diff < -12) return { label: 'Room to spare', tone: 'good' };
  return { label: 'On pace', tone: 'mute' };
}

export function fmtDur(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1000) return 'now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

export function fmtClock(ts: number | string): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameDay = d.toDateString() === new Date().toDateString();
  if (sameDay) return time;
  // within a week a weekday is unambiguous; further out (or in the past) show the date
  const days = Math.abs(d.getTime() - Date.now()) / 864e5;
  const date = days < 6 ? d.toLocaleDateString([], { weekday: 'short' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${date} ${time}`;
}

export function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Percentage points left on the tightest of the two main windows. */
/** True for an account that reads fine but has used nothing in any window and has no chat running. */
export function isIdle(a: Account): boolean {
  const ws = a.windows ?? [];
  return a.status === 'ok' && ws.length > 0 && ws.every((w) => w.used === 0) && !(a.sessions ?? []).some((s) => s.working);
}

export function headroom(a: Account): number {
  const ws = a.windows ?? [];
  const main = ws.filter((w) => w.key === 'five_hour' || w.key === 'seven_day');
  const use = main.length ? main : ws;
  if (!use.length) return 0;
  return Math.min(...use.map((w) => 100 - w.used));
}

export function mainWindows(a: Account): UsageWindow[] {
  const ws = a.windows ?? [];
  const main = ws.filter((w) => w.key === 'five_hour' || w.key === 'seven_day');
  return main.length ? main : ws.slice(0, 2);
}

/** Friendly model name from an API id (handles Bedrock/Vertex prefixes, dated and legacy ids). */
const cap = (w: string) => w[0].toUpperCase() + w.slice(1);
const BRANDS: Record<string, string> = {
  gpt: 'GPT', gemini: 'Gemini', gemma: 'Gemma', qwen: 'Qwen', deepseek: 'DeepSeek', kimi: 'Kimi', grok: 'Grok', llama: 'Llama',
  glm: 'GLM', mistral: 'Mistral', mixtral: 'Mixtral', codex: 'Codex', phi: 'Phi', command: 'Command', minimax: 'MiniMax', hy: 'Hy',
};
const UPPER_WORDS = new Set(['mtp', 'vl', 'moe', 'ai', 'it', 'gguf', 'llm']);

/** Name for models that are not Claude: provider prefixes and file paths are dropped, brands and sizes are cased (gpt-6-sol -> GPT-6 Sol). */
export function otherModelName(id: string): string {
  let s = (id.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? id).replace(/\.gguf$/i, '').replace(/:(?:latest|\d{4}-\d{2}-\d{2})$/i, '');
  let quant = '';
  const q = /[-_.](q\d(?:_[a-z0-9]+)*|f16|bf16|fp8|int4)$/i.exec(s);
  if (q) { quant = ` (${q[1].toUpperCase()})`; s = s.slice(0, q.index); }
  const tokens = s.split(/[-_ ]+/).filter(Boolean);
  if (tokens.length === 0) return id;
  const words = tokens.map((t, i) => {
    const lower = t.toLowerCase();
    if (/^\d+(\.\d+)*[bkm]$/i.test(t) || UPPER_WORDS.has(lower)) return t.toUpperCase();
    if (/^o\d/.test(lower) && i === 0) return lower; // OpenAI o-series: o3, o4
    const brand = /^([a-z]+?)(\d.*)?$/i.exec(t);
    if (brand && BRANDS[brand[1].toLowerCase()]) return BRANDS[brand[1].toLowerCase()] + (brand[2] ?? '');
    if (/^v\d/i.test(t)) return t.toUpperCase();
    return /^\d/.test(t) ? t : cap(t);
  });
  // GPT-5.6 Sol: the version sticks to the brand with a hyphen
  if (words[0] === 'GPT' && words[1] && /^\d/.test(words[1])) words.splice(0, 2, `GPT-${words[1]}`);
  return words.join(' ') + quant;
}

export function modelName(id: string): string {
  const clean = id
    .replace(/^(?:[a-z]{2}\.)?anthropic\./i, '') // bedrock prefixes, optionally with a region
    .replace(/-v\d+(?::\d+)?$/i, '')
    .replace(/@\d{8}$/, '')
    .replace(/-(?:\d{8}|latest)$/, '');
  const fmt = (family: string, version: string, rest: string) => {
    const suffix = rest.replace(/^-/, '').replace(/-/g, ' ');
    return `Claude ${cap(family)} ${version}${suffix ? ` ${suffix}` : ''}`;
  };
  const legacy = /^claude-(\d+)-(\d+)-([a-z]+)(.*)$/i.exec(clean); // claude-3-5-sonnet
  if (legacy) return fmt(legacy[3], `${legacy[1]}.${legacy[2]}`, legacy[4]);
  const old = /^claude-(\d+)-([a-z]+)(.*)$/i.exec(clean); // claude-3-opus
  if (old) return fmt(old[2], old[1], old[3]);
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(.*)$/i.exec(clean); // claude-sonnet-4-5
  if (!match) return id === 'unknown' ? 'Unknown model' : otherModelName(id);
  return fmt(match[1], match[3] ? `${match[2]}.${match[3]}` : match[2], match[4]);
}
