import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDesktopProcessState } from './desktop-process-state.js';

test('detects three isolated Desktop instances from their profile paths', () => {
  const profiles = { personal: 'C:\\Users\\Me\\Claude-Data',
    work: 'C:\\Users\\Me\\ClaudeProfiles\\Work',
    third: 'C:\\Users\\Me\\ClaudeProfiles\\Third' };
  const processes = [
    { ExecutablePath: 'C:\\Program Files\\WindowsApps\\Claude_1.0\\app\\Claude.exe',
      CommandLine: '"C:\\Program Files\\WindowsApps\\Claude_1.0\\app\\Claude.exe"' },
    { ExecutablePath: 'C:\\Portable\\Claude.exe',
      CommandLine: '"C:\\Portable\\Claude.exe" --user-data-dir="C:\\Users\\Me\\ClaudeProfiles\\Third"' },
  ];
  assert.deepEqual(parseDesktopProcessState(profiles, processes),
    { personal: true, work: false, third: true });
});
