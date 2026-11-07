export function visibleUsageWindows(plan, windows) {
  if (!Array.isArray(windows)) return windows;
  if (!/^(?:Max\s+(?:5|20)x|Max\s*\(x5\)|Ultra\s*\(x20\)|Ultra)$/i.test(String(plan || '').trim())) return windows;
  return windows.filter((window) => window.key !== 'five_hour');
}
