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
   The log does not record the [1m] flag, so the size alone decides. */
const LONG_PROMPT = {
  'haiku-5-5': { threshold: 100000, i: 0.5, o: 2.5 },
  'sonnet-4-5': { threshold: 200000, i: 6, o: 22.5 },
  'sonnet-4': { threshold: 200000, i: 6, o: 22.5 },
};

/* Prompt size classes let aggregated usage keep the long-context decision per request. */
export const promptClass = (n) => (n > 200000 ? 2 : n > 100000 ? 1 : 0);
export const promptOfClass = (c) => [0, 100001, 200001][c] || 0;

const FAST_PRICES = {
  'opus-5-5': [8, 40],
  'opus-5': [10, 50],
  'opus-4-8': [10, 50],
};

export function priceFor(model) {
  const normalized = String(model || '').toLowerCase().replace(/^anthropic\./, '').replace(/\[[^\]]*\]$/, '');
  let key = null;
  let match = /^claude-(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?(?:[-@]\d{8})?(?:-v\d+(?::\d+)?)?$/.exec(normalized);
  if (match) key = `${match[1]}-${match[2]}${match[3] ? '-' + match[3] : ''}`;
  else if ((match = /^claude-3(?:-(\d))?-(opus|sonnet|haiku)(?:[-@]\d{8})?(?:-v\d+(?::\d+)?)?$/.exec(normalized))) {
    key = `${match[2]}-3${match[1] ? '-' + match[1] : ''}`;
  }
  const rates = key && PRICES[key];
  return rates ? { i: rates[0], o: rates[1], read: rates[2], long: LONG_PROMPT[key], fast: FAST_PRICES[key] } : null;
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
    + usage.c5 * input * 1.25 + usage.c1 * input * 2) / 1e6;
  const batch = usage.tier === 'batch' ? 0.5 : 1;
  const region = usage.geo === 'us' ? 1.1 : 1;
  return tokenCost * batch * region + searches * 0.01;
}
