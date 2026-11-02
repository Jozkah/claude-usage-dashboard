export function activeSessionState(status) {
  const value = String(status || '').toLowerCase();
  return value === 'busy' || value === 'waiting' ? value : null;
}
