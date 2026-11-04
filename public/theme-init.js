// Apply the saved theme before first paint to avoid a flash.
// Kept as a separate file (not inline) so the Content-Security-Policy can stay strict.
try {
  var t = localStorage.getItem('cud-theme');
  if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  if (t === 'dark') {
    document.documentElement.classList.add('dark');
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#09090b');
  }
} catch (e) { /* storage blocked: the app falls back to the OS setting */ }
