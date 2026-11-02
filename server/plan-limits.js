export function visibleUsageWindows(plan, windows) {
  if (!Array.isArray(windows)) return windows;
  if (!/^Max\s+(?:5|20)x$/i.test(String(plan || '').trim())) return windows;
  return windows.filter((window) => window.key !== 'five_hour');
}
