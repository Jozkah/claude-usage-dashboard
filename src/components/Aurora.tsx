/** Slow drifting glow behind the page. Barely visible in light mode, richer in dark. */
export function Aurora() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-0 overflow-hidden"
      style={{ opacity: 'var(--aurora-opacity)' }}
    >
      <div className="aurora-blob" style={{ width: '46vw', height: '46vw', left: '-8vw', top: '-18vw', background: 'color-mix(in srgb, var(--accent) 70%, transparent)', animation: 'float-a 26s ease-in-out infinite' }} />
      <div className="aurora-blob" style={{ width: '38vw', height: '38vw', right: '-10vw', top: '8vh', background: 'color-mix(in srgb, #38bdf8 55%, transparent)', animation: 'float-b 32s ease-in-out infinite' }} />
      <div className="aurora-blob" style={{ width: '30vw', height: '30vw', left: '38vw', bottom: '-16vw', background: 'color-mix(in srgb, #f472b6 45%, transparent)', animation: 'float-a 38s ease-in-out infinite reverse' }} />
    </div>
  );
}
