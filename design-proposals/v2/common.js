/* Shared helpers for the v2 mockups. Sample data only (shared/data.js). */
(function () {
  const D = window.DASH;
  /** Cumulative usage at each day checkpoint of a window with `used` percent spent (deterministic, for the mockups). */
  D.marks = function (used, days, seed) {
    const w = []; let s = 0;
    for (let i = 0; i < days; i++) { const v = 0.4 + ((Math.sin((i + seed) * 2.3) + 1) / 2) * 1.2; w.push(v); s += v; }
    let c = 0;
    return w.map((v) => (c += (v / s) * used));
  };
  D.limitRows = D.accounts.flatMap((a, i) => [
    ['five', 'Session', a.five, a.fiveReset, 5, i],
    ['week', 'Weekly', a.week, a.weekReset, 7, i],
  ].filter((r) => r[2] != null).map(([k, label, used, reset, n, seed]) => ({ a, k, label, used, reset, marks: D.marks(used, k === 'week' ? 4 : 3, seed), elapsed: k === 'week' ? 0.43 + seed * 0.04 : 0.5 + seed * 0.06 })));
  D.byProvider = ['claude', 'codex'].map((p) => ({ p, name: p === 'claude' ? 'Claude Code' : 'Codex', accounts: D.accounts.filter((a) => a.provider === p) }));
  D.nextResets = D.limitRows.filter((r) => r.reset).map((r) => ({ ...r, mins: parseReset(r.reset) })).sort((x, y) => x.mins - y.mins);
  function parseReset(t) { const m = /(\d+)d/.exec(t), h = /(\d+)h/.exec(t), mm = /(\d+)m/.exec(t); return (m ? +m[1] * 1440 : 0) + (h ? +h[1] * 60 : 0) + (mm ? +mm[1] : 0); }
  D.clock = (mins) => { const d = new Date(Date.now() + mins * 60000); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); };
  D.day = (mins) => new Date(Date.now() + mins * 60000).toLocaleDateString('en', { weekday: 'short' });
  D.left = (a) => 100 - Math.max(a.five ?? 0, a.week ?? 0);
})();
