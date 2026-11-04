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

const spaced = { personal: 'C:\\Users\\Me\\Claude-Data', work: 'C:\\Users\\First Last\\ClaudeProfiles\\Work' };
const claude = (CommandLine) => ({ ExecutablePath: 'C:\\x\\Claude.exe', CommandLine });

test('parses fully quoted and space-separated user-data-dir arguments', () => {
  assert.equal(parseDesktopProcessState(spaced, [
    claude('"C:\\x\\Claude.exe" "--user-data-dir=C:\\Users\\First Last\\ClaudeProfiles\\Work"')]).work, true);
  assert.equal(parseDesktopProcessState(spaced, [
    claude('"C:\\x\\Claude.exe" --user-data-dir "C:\\Users\\First Last\\ClaudeProfiles\\Work"')]).work, true);
  assert.equal(parseDesktopProcessState(spaced, [
    claude('"C:\\x\\Claude.exe" "--user-data-dir=C:\\Users\\Me\\Claude-Data"')]).personal, true);
});

test('ignores trailing slashes and case differences', () => {
  const state = parseDesktopProcessState(spaced, [
    claude('"C:\\x\\Claude.exe" --user-data-dir="c:\\users\\first last\\claudeprofiles\\work\\\\"')]);
  assert.equal(state.work, true);
  assert.equal(state.personal, false);
});

test('fails closed when a Desktop process cannot be attributed to a profile', () => {
  assert.deepEqual(parseDesktopProcessState(spaced, [
    claude('"C:\\x\\Claude.exe" --user-data-dir="D:\\Elsewhere"')]), { personal: true, work: true });
});

test('ignores unrelated processes and handles empty input', () => {
  assert.deepEqual(parseDesktopProcessState(spaced, []), { personal: false, work: false });
  assert.deepEqual(parseDesktopProcessState(spaced, [{ ExecutablePath: 'C:\\bin\\claude.exe', CommandLine: 'claude --help' }]),
    { personal: false, work: false });
});
