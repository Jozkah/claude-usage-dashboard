import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncCodeSetup } from './code-setup-sync.js';

test('copies local plugin setup without credentials or account-managed skills', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-code-setup-'));
  try {
    const personal = path.join(root, 'personal');
    const work = path.join(root, 'work');
    for (const dir of [personal, work]) fs.mkdirSync(path.join(dir, 'plugins', 'cache'), { recursive: true });
    fs.mkdirSync(path.join(personal, 'skills', 'local-skill'), { recursive: true });
    fs.mkdirSync(path.join(personal, 'skills', 'synced'), { recursive: true });
    fs.writeFileSync(path.join(personal, '.credentials.json'), 'secret');
    fs.writeFileSync(path.join(personal, 'settings.json'), JSON.stringify({ enabledPlugins: { one: true }, permissions: { defaultMode: 'bypassPermissions' } }));
    fs.writeFileSync(path.join(work, 'settings.json'), JSON.stringify({ theme: 'dark', enabledPlugins: { two: true } }));
    fs.writeFileSync(path.join(personal, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { one: [{ scope: 'user', installPath: path.join(personal, 'plugins', 'cache', 'one') }] } }));
    fs.writeFileSync(path.join(personal, 'plugins', 'known_marketplaces.json'), '{}');
    fs.writeFileSync(path.join(work, 'plugins', 'installed_plugins.json'), '{"version":2,"plugins":{}}');
    assert.deepEqual(syncCodeSetup(personal, work), { plugins: 1 });
    assert.equal(fs.existsSync(path.join(work, '.credentials.json')), false);
    assert.equal(fs.existsSync(path.join(work, 'skills', 'synced')), false);
    assert.equal(fs.existsSync(path.join(work, 'skills', 'local-skill')), true);
    const settings = JSON.parse(fs.readFileSync(path.join(work, 'settings.json')));
    assert.deepEqual(settings.enabledPlugins, { one: true, two: true });
    assert.equal(settings.permissions, undefined);
    const installed = JSON.parse(fs.readFileSync(path.join(work, 'plugins', 'installed_plugins.json')));
    assert.equal(installed.plugins.one[0].installPath, path.join(work, 'plugins', 'cache', 'one'));
    assert.deepEqual(syncCodeSetup(personal, work), { plugins: 0 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
