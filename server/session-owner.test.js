import test from 'node:test';
import assert from 'node:assert/strict';
import { routeDesktopSessions } from './session-owner.js';

test('a resumed Personal chat belongs to Work Desktop process', () => {
  const accounts = [
    { id: 'personal', configDir: 'C:\\Users\\Me\\.claude' },
    { id: 'work', configDir: '~/.claude-work' },
    { id: 'third', configDir: '~/.claude-third' },
  ];
  const lists = [
    [{ pid: 123, id: 'resumed', name: 'Resumed chat', state: 'busy', working: true, lastActiveAt: 5 },
      { pid: 456, id: 'personal-chat', state: 'waiting', working: false, lastActiveAt: 4 }],
    [{ pid: 789, id: 'terminal-chat', state: 'busy', working: true, lastActiveAt: 3 }],
    [],
  ];
  const profiles = { personal: 'C:\\Profiles\\Personal', work: 'C:\\Profiles\\Work', third: 'C:\\Profiles\\Third' };
  const processes = [
    { ProcessId: 123, ParentProcessId: 222, ExecutablePath: 'C:\\ClaudeCode\\claude.exe' },
    { ProcessId: 222, ParentProcessId: 1, CommandLine: '"C:\\Claude.exe" --user-data-dir="C:\\Profiles\\Work"' },
    { ProcessId: 456, ParentProcessId: 333, ExecutablePath: 'C:\\ClaudeCode\\claude.exe' },
    { ProcessId: 333, ParentProcessId: 1, ExecutablePath: 'C:\\Program Files\\WindowsApps\\Claude_4.0_x64__publisher\\app\\Claude.exe' },
    { ProcessId: 789, ParentProcessId: 1, ExecutablePath: 'C:\\ClaudeCode\\claude.exe' },
  ];
  const result = routeDesktopSessions(accounts, lists, profiles, processes);
  assert.deepEqual(result.map((list) => list.map((session) => session.id)),
    [['personal-chat'], ['resumed', 'terminal-chat'], []]);
  assert.equal('pid' in result[1][0], false);
});

test('duplicate session appears once under running Desktop owner', () => {
  const accounts = [{ id: 'personal', configDir: '~/.claude' }, { id: 'work', configDir: '~/.claude-work' }];
  const session = { pid: 123, id: 'same', state: 'busy', working: true, lastActiveAt: 10 };
  const result = routeDesktopSessions(accounts, [[session], [{ ...session, lastActiveAt: 11 }]],
    { work: 'C:\\Profiles\\Work' }, [
      { ProcessId: 123, ParentProcessId: 222 },
      { ProcessId: 222, ParentProcessId: 1, CommandLine: 'Claude.exe --user-data-dir=C:\\Profiles\\Work' },
    ]);
  assert.deepEqual(result.map((list) => list.length), [0, 1]);
  assert.equal(result[1][0].lastActiveAt, 11);
});

test('unknown Desktop profile keeps session in recorded config folder', () => {
  const accounts = [{ id: 'personal', configDir: '~/.claude' }, { id: 'work', configDir: '~/.claude-work' }];
  const lists = [[{ pid: 123, id: 'chat', state: 'busy', working: true, lastActiveAt: 1 }], []];
  const processes = [
    { ProcessId: 123, ParentProcessId: 222 },
    { ProcessId: 222, ParentProcessId: 333, CommandLine: 'Claude.exe --user-data-dir=C:\\Profiles\\Unknown' },
    { ProcessId: 333, ParentProcessId: 1, CommandLine: 'Claude.exe --user-data-dir=C:\\Profiles\\Work' },
  ];
  const result = routeDesktopSessions(accounts, lists, { work: 'C:\\Profiles\\Work' }, processes);
  assert.deepEqual(result.map((list) => list.map((session) => session.id)), [['chat'], []]);
});
