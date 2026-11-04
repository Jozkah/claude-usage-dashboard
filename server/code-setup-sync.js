import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createBackup, writeFileAtomic } from './sync-support.js';

// Missing file -> fallback. Any other failure (unreadable, invalid JSON) aborts the
// sync before anything is written, so a user's settings are never replaced by defaults.
function readJson(file, fallback) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return { exists: false, value: fallback };
    throw new Error(`Cannot read ${file}: ${error.message}`);
  }
  try {
    const value = JSON.parse(text.replace(/^﻿/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a JSON object');
    return { exists: true, value };
  } catch (error) {
    throw new Error(`Cannot parse ${file}: ${error.message}. Nothing was changed.`);
  }
}

// Writes only when the parsed content changed; backs up the existing file first.
// Returns an undo function (restores the previous bytes, or removes a file that did not exist).
function writeJsonIfChanged(file, loaded, next, stateDir) {
  if (JSON.stringify(loaded.value) === JSON.stringify(next)) return null;
  const previous = loaded.exists ? fs.readFileSync(file) : null;
  if (loaded.exists) createBackup(file, 'setup', { stateDir });
  writeFileAtomic(file, JSON.stringify(next, null, 2) + '\n');
  return () => { if (previous) writeFileAtomic(file, previous); else fs.rmSync(file, { force: true }); };
}

// Lists missing copy units below `from`: entries `depth` levels down (the plugin cache is
// marketplace/plugin/version). Existing units are skipped without walking their contents.
function missingUnits(from, to, depth) {
  const units = [];
  const walk = (src, dst, level) => {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      if (!fs.existsSync(d)) units.push([s, d]);
      else if (entry.isDirectory() && level + 1 < depth) walk(s, d, level + 1);
    }
  };
  walk(from, to, 0);
  return units;
}

function remap(location, source, target) {
  if (typeof location !== 'string') return location;
  const relative = path.relative(source, location);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    return path.join(target, relative);
  }
  return location;
}

export function syncCodeSetup(source, target, { stateDir } = {}) {
  const sourcePlugins = path.join(source, 'plugins');
  const targetPlugins = path.join(target, 'plugins');
  if (!fs.existsSync(sourcePlugins) || !fs.existsSync(targetPlugins)) throw new Error('Both Claude Code plugin folders are required.');

  // Phase 1: read and compute everything. Any unreadable/corrupt file aborts before any change.
  const installedFile = path.join(targetPlugins, 'installed_plugins.json');
  const knownFile = path.join(targetPlugins, 'known_marketplaces.json');
  const settingsFile = path.join(target, 'settings.json');
  const sourceInstalled = readJson(path.join(sourcePlugins, 'installed_plugins.json'), { plugins: {} }).value;
  const targetInstalledLoaded = readJson(installedFile, { version: 2, plugins: {} });
  const sourceKnown = readJson(path.join(sourcePlugins, 'known_marketplaces.json'), {}).value;
  const targetKnownLoaded = readJson(knownFile, {});
  const sourceSettings = readJson(path.join(source, 'settings.json'), {}).value;
  const targetSettingsLoaded = readJson(settingsFile, {});

  const targetInstalled = structuredClone(targetInstalledLoaded.value);
  targetInstalled.plugins ||= {};
  let plugins = 0;
  for (const [name, installations] of Object.entries(sourceInstalled.plugins || {})) {
    if (targetInstalled.plugins[name] || !Array.isArray(installations)) continue;
    const userInstallations = installations.filter((entry) => entry.scope === 'user').map((entry) => ({
      ...entry, installPath: remap(entry.installPath, source, target),
    }));
    if (userInstallations.length) { targetInstalled.plugins[name] = userInstallations; plugins++; }
  }

  const targetKnown = structuredClone(targetKnownLoaded.value);
  let marketplaces = 0;
  for (const [name, marketplace] of Object.entries(sourceKnown)) {
    if (name in targetKnown) continue;
    targetKnown[name] = { ...marketplace, installLocation: remap(marketplace.installLocation, source, target) };
    marketplaces++;
  }

  const targetSettings = structuredClone(targetSettingsLoaded.value);
  let settings = 0;
  for (const key of ['enabledPlugins', 'extraKnownMarketplaces']) {
    if (sourceSettings[key] === undefined && targetSettings[key] === undefined) continue;
    const merged = { ...sourceSettings[key], ...targetSettings[key] };
    settings += Object.keys(merged).length - Object.keys(targetSettings[key] || {}).length;
    targetSettings[key] = merged;
  }

  // Phase 2: copy files (never overwrites). Each unit is copied to a temp name and renamed, so a
  // crash never leaves a half-copied folder. Phase 3: write the JSON indexes last. Any failure
  // removes everything created and restores the previous JSON files (all-or-nothing).
  const created = [];
  const undo = [];
  let skills = 0;
  const copyUnit = (from, to) => {
    let top = path.dirname(to);
    while (!fs.existsSync(path.dirname(top)) && path.dirname(top) !== top) top = path.dirname(top);
    if (!fs.existsSync(path.dirname(to))) { created.push(top); fs.mkdirSync(path.dirname(to), { recursive: true }); }
    const temp = `${to}.sync-${crypto.randomUUID()}.tmp`;
    try {
      fs.cpSync(from, temp, { recursive: true, force: false });
      fs.renameSync(temp, to);
      created.push(to);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  };
  try {
    for (const [name, depth] of [['cache', 3], ['marketplaces', 1]]) {
      const from = path.join(sourcePlugins, name);
      if (!fs.existsSync(from)) continue;
      for (const [s, d] of missingUnits(from, path.join(targetPlugins, name), depth)) copyUnit(s, d);
    }
    const sourceSkills = path.join(source, 'skills');
    if (fs.existsSync(sourceSkills)) {
      for (const entry of fs.readdirSync(sourceSkills, { withFileTypes: true })) {
        if (entry.name === 'synced') continue; // account-managed skills remain account-specific
        const destination = path.join(target, 'skills', entry.name);
        if (fs.existsSync(destination)) continue;
        copyUnit(path.join(sourceSkills, entry.name), destination);
        skills++;
      }
    }
    for (const [file, loaded, next] of [[installedFile, targetInstalledLoaded, targetInstalled],
      [knownFile, targetKnownLoaded, targetKnown], [settingsFile, targetSettingsLoaded, targetSettings]]) {
      const revert = writeJsonIfChanged(file, loaded, next, stateDir);
      if (revert) undo.push(revert);
    }
  } catch (error) {
    for (const revert of undo.reverse()) { try { revert(); } catch { /* keep the original error */ } }
    for (const item of created.reverse()) fs.rmSync(item, { recursive: true, force: true });
    throw error;
  }
  return { plugins, marketplaces, skills, settings };
}
