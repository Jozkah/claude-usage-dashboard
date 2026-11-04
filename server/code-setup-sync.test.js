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
    assert.equal(syncCodeSetup(personal, work).plugins, 1);
    assert.equal(fs.existsSync(path.join(work, '.credentials.json')), false);
    assert.equal(fs.existsSync(path.join(work, 'skills', 'synced')), false);
    assert.equal(fs.existsSync(path.join(work, 'skills', 'local-skill')), true);
    const settings = JSON.parse(fs.readFileSync(path.join(work, 'settings.json')));
    assert.deepEqual(settings.enabledPlugins, { one: true, two: true });
    assert.equal(settings.permissions, undefined);
    const installed = JSON.parse(fs.readFileSync(path.join(work, 'plugins', 'installed_plugins.json')));
    assert.equal(installed.plugins.one[0].installPath, path.join(work, 'plugins', 'cache', 'one'));
    const before = fs.readFileSync(path.join(work, 'settings.json'), 'utf8');
    assert.equal(syncCodeSetup(personal, work).plugins, 0);
    assert.equal(fs.readFileSync(path.join(work, 'settings.json'), 'utf8'), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function setupPair() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-code-setup-'));
  const personal = path.join(root, 'personal');
  const work = path.join(root, 'work');
  for (const dir of [personal, work]) fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
  return { root, personal, work };
}

test('aborts without writing when the target settings are unreadable', () => {
  const { root, personal, work } = setupPair();
  try {
    fs.writeFileSync(path.join(personal, 'settings.json'), JSON.stringify({ enabledPlugins: { one: true } }));
    const corrupt = '{ "hooks": {}, // comment\n}';
    fs.writeFileSync(path.join(work, 'settings.json'), corrupt);
    assert.throws(() => syncCodeSetup(personal, work), /Cannot parse/);
    assert.equal(fs.readFileSync(path.join(work, 'settings.json'), 'utf8'), corrupt);
    assert.equal(fs.existsSync(path.join(work, 'plugins', 'installed_plugins.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('accepts a BOM, backs up changed files and reports per-category counts', () => {
  const { root, personal, work } = setupPair();
  try {
    fs.writeFileSync(path.join(personal, 'settings.json'), JSON.stringify({ enabledPlugins: { one: true } }));
    fs.writeFileSync(path.join(work, 'settings.json'), '﻿{"theme":"dark"}');
    fs.writeFileSync(path.join(personal, 'plugins', 'known_marketplaces.json'),
      JSON.stringify({ market: { installLocation: path.join(personal, 'plugins', 'marketplaces', 'market') } }));
    const result = syncCodeSetup(personal, work);
    assert.deepEqual(result, { plugins: 0, marketplaces: 1, skills: 0, settings: 1 });
    const known = JSON.parse(fs.readFileSync(path.join(work, 'plugins', 'known_marketplaces.json'), 'utf8'));
    assert.equal(known.market.installLocation, path.join(work, 'plugins', 'marketplaces', 'market'));
    assert.ok(fs.readdirSync(work).some((name) => name.startsWith('settings.json.backup-setup-')));
    assert.deepEqual(syncCodeSetup(personal, work), { plugins: 0, marketplaces: 0, skills: 0, settings: 0 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('does not create empty settings keys when neither side defines them', () => {
  const { root, personal, work } = setupPair();
  try {
    fs.writeFileSync(path.join(work, 'settings.json'), '{"theme":"dark"}');
    syncCodeSetup(personal, work);
    assert.equal(fs.readFileSync(path.join(work, 'settings.json'), 'utf8'), '{"theme":"dark"}');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
