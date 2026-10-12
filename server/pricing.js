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
};

export const PRICING_VERSION = 3;

const FAST_PRICES = {
  'opus-5-5': [8, 40],
  'opus-5': [10, 50],
  'opus-4-8': [10, 50],
};

export function priceFor(model) {
  const normalized = String(model || '').toLowerCase().replace(/^anthropic\./, '');
  const match = /^claude-(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d+))?(?:[-@]\d{8})?(?:-v\d+(?::\d+)?)?$/.exec(normalized);
  if (!match) return null;
  const key = `${match[1]}-${match[2]}${match[3] ? '-' + match[3] : ''}`;
  const rates = PRICES[key];
  return rates ? { i: rates[0], o: rates[1], read: rates[2], longPrompt: key === 'haiku-5-5', fast: FAST_PRICES[key] } : null;
}

export function costOf(price, usage) {
  const searches = Math.max(0, Number(usage.search) || 0);
  if (!price) return searches * 0.01;
  const promptTokens = usage.in + usage.cr + usage.c5 + usage.c1;
  const high = price.longPrompt && promptTokens > 100000;
  const fast = usage.speed === 'fast' ? price.fast : null;
  const input = fast ? fast[0] : high ? 0.5 : price.i;
  const output = fast ? fast[1] : high ? 2.5 : price.o;
  const tokenCost = (usage.in * input + usage.out * output + usage.cr * input * price.read
    + usage.c5 * input * 1.25 + usage.c1 * input * 2) / 1e6;
  const batch = usage.tier === 'batch' ? 0.5 : 1;
  const region = usage.geo === 'us' ? 1.1 : 1;
  return tokenCost * batch * region + searches * 0.01;
}
