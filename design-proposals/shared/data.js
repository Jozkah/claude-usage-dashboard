/* SAMPLE DATA: synthetic numbers shaped like the real dashboard API. Replace with /api/usage and /api/tokens. */
(function () {
  const rnd = (s) => () => ((s = Math.imul(48271, s) % 2147483647) & 2147483647) / 2147483647;
  const r = rnd(7);
  const MODELS = [
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', color: '#4f7cff', price: '$4 / $20' },
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', color: '#3fb68b', price: '$2 / $10' },
    { id: 'gpt-6-sol', name: 'GPT-6 Sol', color: '#e0a030', price: '$2 / $10' },
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', color: '#e0587f', price: '$0.10 / $0.50' },
    { id: 'qwen3.8-27b', name: 'Qwen3.8 27B', color: '#8b6cf0', price: 'no price' },
  ];
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(2026, 10, 11); d.setDate(d.getDate() - i);
    const k = 0.25 + 0.75 * Math.abs(Math.sin(i * 0.9 + 1)) * (i % 7 === 3 ? 0.35 : 1);
    const parts = MODELS.map((m, j) => Math.max(0, [0.52, 0.28, 0.1, 0.06, 0.04][j] * (0.6 + r()) * k));
    days.push({ date: d.toISOString().slice(0, 10), parts: parts.map((p) => Math.round(p * 3.1e9)) });
  }
  window.DASH = {
    models: MODELS,
    days,
    today: '2026-11-11',
    accounts: [
      { id: 'personal', name: 'Personal', provider: 'claude', plan: 'Max 20x', five: null, week: 24, weekReset: '6d 20h', fiveReset: null, chats: [{ t: 'Universal Game Manager vertical slice', s: 'working' }, { t: 'Dashboard audit', s: 'waiting' }], dir: '~/.claude', live: true },
      { id: 'work', name: 'Work', provider: 'claude', plan: 'Team', five: 28, week: 27, fiveReset: '3h 22m', weekReset: '6d 8h', chats: [{ t: 'Replace Stripe and CoinGate billing', s: 'working' }, { t: 'App performance analysis', s: 'working' }, { t: 'MiMo-V2.6 vs Qwen3.8 engine evaluation', s: 'working' }], dir: '~/.claude-work', live: true },
      { id: 'third', name: 'Work (Shared)', provider: 'claude', plan: 'Team', five: 0, week: 27, fiveReset: null, weekReset: '4d 4h', chats: [], dir: '~/.claude-third', live: false },
      { id: 'work2', name: 'Work 2', provider: 'claude', plan: 'Team', five: 0, week: 0, fiveReset: null, weekReset: '17h 32m', chats: [], dir: '~/.claude-work2', live: false },
      { id: 'codex', name: 'Codex', provider: 'codex', plan: 'Pro', five: 61, week: 84, fiveReset: '1h 10m', weekReset: '2d 6h', chats: [{ t: 'Hide internal Codex chats', s: 'waiting' }], dir: '~/.codex', live: true },
    ],
    stats: { requests: 8952, failed: 8, canceled: 3, input: 31523, output: 12098593, cacheRead: 3528459568, cacheWrite: 65563466, reasoning: 21222 },
    rows: [
      ['Claude Opus 5.5', 4120, '88.1M', '41.2M', '71.9B', '2.1B', '$21,904', '$4 / $20'],
      ['Claude Sonnet 5.5', 2988, '51.0M', '19.4M', '38.2B', '1.1B', '$3,402', '$2 / $10'],
      ['GPT-6 Sol', 131, '1.4M', '68K', '19.9M', '0', '$12', '$2 / $10'],
      ['Claude Haiku 5.5', 902, '9.3M', '3.0M', '4.4B', '88M', '$61', '$0.10 / $0.50'],
      ['Qwen3.8 27B', 233, '0.7M', '73K', '10.7M', '0', '–', 'no price'],
    ],
  };
  const sum = (a) => a.reduce((n, x) => n + x, 0);
  window.DASH.fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)));
  window.DASH.dayTotal = (d) => sum(d.parts);
  window.DASH.left = (a) => 100 - Math.max(a.five ?? 0, a.week ?? 0);
  window.DASH.best = () => window.DASH.accounts.slice().sort((a, b) => window.DASH.left(b) - window.DASH.left(a))[0];
})();
