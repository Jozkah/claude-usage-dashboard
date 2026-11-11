/* Shared markup pieces for the minimalist mockups. Each page styles the classes itself. */
(function () {
  const D = window.DASH;
  const rowFor = (a, k) => D.limitRows.find((r) => r.a === a && r.k === k);
  D.html = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild; };
  D.bar = (r) => {
    if (!r) return '<div class="bar none">no reading</div>';
    const blocks = r.marks.map((m, i) => (i ? m - r.marks[i - 1] : m));
    return `<div class="bar" role="img" aria-label="${r.label}: ${100 - r.used}% left">${blocks.map((w, i) => `<i class="${i === blocks.length - 1 ? 'today' : ''}" style="width:${w}%"></i>`).join('')}<b style="left:${r.elapsed * 100}%" title="Even pace"></b></div>`;
  };
  D.limit = (a, k) => { const r = rowFor(a, k); return r ? { r, left: 100 - r.used, bar: D.bar(r) } : { r: null, left: null, bar: D.bar(null) }; };
  D.sparkDays = () => D.days.slice(-14);
})();
