import path from 'node:path';

export function parseDesktopProcessState(profiles, processes) {
  const state = Object.fromEntries(Object.keys(profiles).map((id) => [id, false]));
  const normalize = (value) => path.win32.normalize(value).replace(/[\\/]+$/, '').toLowerCase();
  for (const process of processes) {
    const command = process.CommandLine || '';
    const executable = process.ExecutablePath || '';
    const match = command.match(/--user-data-dir=(?:"([^"]+)"|(\S+))/i);
    if (match) {
      const directory = normalize(match[1] || match[2]);
      for (const [id, profile] of Object.entries(profiles)) {
        if (directory === normalize(profile)) state[id] = true;
      }
    } else if (/\\WindowsApps\\Claude_[^\\]+\\app\\Claude\.exe$/i.test(executable)) {
      state.personal = true;
    }
  }
  return state;
}
