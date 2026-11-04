// Anthropic Claude API prices in USD per million tokens.
// Source: https://platform.claude.com/docs/en/about-claude/pricing
const PRICES = {
  'fable-5-1': [10, 50, 0.025],
  'fable-5': [10, 50, 0.1],
  'mythos-5-1': [10, 50, 0.025],
  'mythos-5': [10, 50, 0.1],
  'opus-5-5': [4, 20, 0.05],
  'opus-5': [5, 25, 0.1],
  'opus-4-8': [5, 25, 0.1],
  'opus-4-7': [5, 25, 0.1],
  'opus-4-6': [5, 25, 0.1],
  'opus-4-5': [5, 25, 0.1],
  'opus-4-1': [15, 75, 0.1],
  'opus-4': [15, 75, 0.1],
  'sonnet-5-5': [2, 10, 0.05],
  'sonnet-5': [2, 10, 0.1],
  'sonnet-4-6': [3, 15, 0.1],
  'sonnet-4-5': [3, 15, 0.1],
  'sonnet-4': [3, 15, 0.1],
  'haiku-5-5': [0.1, 0.5, 0.1],
  'haiku-4-5': [1, 5, 0.1],
  'haiku-3-5': [0.8, 4, 0.1],
  'haiku-3': [0.25, 1.25, 0.12],
  'sonnet-3-7': [3, 15, 0.1],
  'sonnet-3-5': [3, 15, 0.1],
  'sonnet-3': [3, 15, 0.1],
  'opus-3': [15, 75, 0.1],
};

/* Tokens are stored raw and priced at report time, so a price change needs no rescan.
   PRICING_VERSION is informational only; bump it when the table changes. */
export const PRICING_VERSION = 4;

/* Above `threshold` prompt tokens (input + cache) a request is billed at the `i`/`o` rates.
   The log does not record the [1m] flag, so the size alone decides.
   verified: live pricing page (2026-11) tiers only Haiku 5.5 (over 100k); Claude 4.6+ bill the 1M window flat.
   verified:false rows are historical (Sonnet 4 / 4.5 charged 2x input, 1.5x output over 200k in the 1M beta)
   and are not on the current page; kept so old logs are not under-estimated. */
export const LONG_PROMPT = {
  'haiku-5-5': { threshold: 100000, i: 0.5, o: 2.5, verified: true },
  'sonnet-4-5': { threshold: 200000, i: 6, o: 22.5, verified: false },
  'sonnet-4': { threshold: 200000, i: 6, o: 22.5, verified: false },
};
/* Every PRICES key is either in LONG_PROMPT or listed here as flat-priced across the whole window.
   A test requires one of the two, so adding a model forces a long-context decision. */
export const FLAT_LONG_CONTEXT = [
  'fable-5-1', 'fable-5', 'mythos-5-1', 'mythos-5', 'opus-5-5', 'opus-5', 'opus-4-8', 'opus-4-7', 'opus-4-6',
  'sonnet-5-5', 'sonnet-5', 'sonnet-4-6', 'haiku-4-5',
  // no 1M window existed for these
  'opus-4-5', 'opus-4-1', 'opus-4', 'haiku-3-5', 'haiku-3', 'sonnet-3-7', 'sonnet-3-5', 'sonnet-3', 'opus-3',
];
export const PRICED_MODEL_KEYS = Object.keys(PRICES);

/* Prompt size classes let aggregated usage keep the long-context decision per request. */
export const promptClass = (n) => (n > 200000 ? 2 : n > 100000 ? 1 : 0);
export const promptOfClass = (c) => [0, 100001, 200001][c] || 0;

const FAST_PRICES = {
  'opus-5-5': [8, 40],
  'opus-5': [10, 50],
  'opus-4-8': [10, 50],
};

/* Non-Claude models, USD per million tokens, standard tier: [input, cached input, output, long input, long output].
   Cached input null = no cache discount listed (billed as input). Long rates apply when one request's prompt is larger
   than the threshold; OpenAI 272k, Google 200k. Cache writes are not billed separately by these providers.
   Sources: https://developers.openai.com/api/docs/pricing and https://aistudio.google.com/docs/pricing (checked 2026-11-04).
   The fast / priority / batch tiers are not visible in local logs, so everything is priced at the standard tier. */
const OPENAI_LONG = 272000;
const GOOGLE_LONG = 200000;
const OTHER_PRICES = {
  'gpt-6-astra': [10, 1, 50, 20, 75, OPENAI_LONG],
  'gpt-6.1-sol': [2, 0.1, 10, 4, 15, OPENAI_LONG],
  'gpt-6.1-terra': [1, 0.05, 5, 2, 7.5, OPENAI_LONG],
  'gpt-6-luna': [0.1, 0.01, 0.5, 0.2, 0.75, OPENAI_LONG],
  'gpt-6-sol': [2, 0.2, 10, 4, 15, OPENAI_LONG],
  'gpt-5.6-sol': [4, 0.4, 20, 8, 30, OPENAI_LONG],
  'gpt-5.6-terra': [2, 0.2, 12, 4, 18, OPENAI_LONG],
  'gpt-5.6-luna': [0.2, 0.02, 1.2, 0.4, 1.8, OPENAI_LONG],
  'gpt-5.5': [5, 0.5, 30, 10, 45, OPENAI_LONG],
  'gpt-5.5-pro': [30, null, 180, 60, 270, OPENAI_LONG],
  'gpt-5.4': [2.5, 0.25, 15, 5, 22.5, OPENAI_LONG],
  'gpt-5.4-pro': [30, null, 180, 60, 270, OPENAI_LONG],
  'gpt-5.4-mini': [0.75, 0.075, 4.5],
  'gpt-5.4-nano': [0.2, 0.02, 1.25],
  'gpt-5.3-codex': [1.75, 0.175, 14],
  'gpt-5.2': [1.75, 0.175, 14],
  'gpt-5.2-pro': [21, null, 168],
  'gpt-5.1': [1.25, 0.125, 10],
  'gpt-5': [1.25, 0.125, 10],
  'gpt-5-mini': [0.25, 0.025, 2],
  'gpt-5-nano': [0.05, 0.005, 0.4],
  'gpt-5-pro': [15, null, 120],
  'gpt-4.1': [2, 0.5, 8],
  'gpt-4.1-mini': [0.4, 0.1, 1.6],
  'gpt-4o': [2.5, 1.25, 10],
  'gpt-4o-mini': [0.15, 0.075, 0.6],
  'o3': [2, 0.5, 8],
  'o3-pro': [20, null, 80],
  'gemini-3.1-pro-preview': [2, 0.2, 12, 4, 18, GOOGLE_LONG],
  'gemini-3.1-flash-lite': [0.25, 0.025, 1.5],
  'gemini-3-flash-preview': [0.5, 0.05, 3],
  'gemini-3.5-flash-lite': [0.3, 0.03, 2.5],
  'gemini-3.6-flash': [0.75, 0.075, 3.75],
  'gemini-3.8-flash': [0.75, 0.075, 3.75],
  'gemini-4-argon': [2, 0.1, 10],
  'gemini-2.5-pro': [1.25, 0.125, 10, 2.5, 15, GOOGLE_LONG],
  'gemini-2.5-flash': [0.3, 0.03, 2.5],
  'gemini-2.5-flash-lite': [0.1, 0.01, 0.4],
};
/* Announced price changes: from this day on the model is billed at the second set of rates. */
const OTHER_STEPS = {
  'gemini-3.6-flash': ['2027-01-01', [1.5, 0.15, 7.5]],
  'gemini-3.8-flash': ['2027-01-01', [1.5, 0.15, 7.5]],
  'gemini-4-argon': ['2026-12-01', [4, 0.2, 20]],
};
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function otherPriceFor(model) {
  const key = String(model || '').toLowerCase().replace(/\\/g, '/').split('/').filter(Boolean).pop()
    ?.replace(/:latest$/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '');
  let rates = key && Object.hasOwn(OTHER_PRICES, key) ? OTHER_PRICES[key] : null;
  if (!rates) return null;
  const step = OTHER_STEPS[key];
  if (step && todayKey() >= step[0]) rates = [...step[1], undefined, undefined, rates[5]];
  const [i, cached, o, longIn, longOut, threshold] = rates;
  return {
    i, o, read: cached == null ? 1 : cached / i, w5: 1, w1: 1,
    long: longIn ? { threshold, i: longIn, o: longOut, verified: true } : undefined, fast: undefined,
  };
}

export function priceFor(model) {
  const normalized = String(model || '').toLowerCase().replace(/^anthropic\./, '').replace(/\[[^\]]*\]$/, '');
  let key = null;
  let match = /^claude-(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?(?:[-@]\d{8})?(?:-v\d+(?::\d+)?)?$/.exec(normalized);
  if (match) key = `${match[1]}-${match[2]}${match[3] ? '-' + match[3] : ''}`;
  else if ((match = /^claude-3(?:-(\d))?-(opus|sonnet|haiku)(?:[-@]\d{8})?(?:-v\d+(?::\d+)?)?$/.exec(normalized))) {
    key = `${match[2]}-3${match[1] ? '-' + match[1] : ''}`;
  }
  const rates = key && PRICES[key];
  if (rates) return { i: rates[0], o: rates[1], read: rates[2], long: LONG_PROMPT[key], fast: FAST_PRICES[key] };
  return otherPriceFor(model);
}

export function costOf(price, usage) {
  const searches = Math.max(0, Number(usage.search) || 0);
  if (!price) return searches * 0.01;
  const promptTokens = usage.prompt ?? (usage.in + usage.cr + usage.c5 + usage.c1);
  const long = price.long && promptTokens > price.long.threshold ? price.long : null;
  const fast = usage.speed === 'fast' ? price.fast : null;
  const input = fast ? fast[0] : long ? long.i : price.i;
  const output = fast ? fast[1] : long ? long.o : price.o;
  const tokenCost = (usage.in * input + usage.out * output + usage.cr * input * price.read
    + usage.c5 * input * (price.w5 ?? 1.25) + usage.c1 * input * (price.w1 ?? 2)) / 1e6;
  const batch = usage.tier === 'batch' ? 0.5 : 1;
  const region = usage.geo === 'us' ? 1.1 : 1;
  return tokenCost * batch * region + searches * 0.01;
}
