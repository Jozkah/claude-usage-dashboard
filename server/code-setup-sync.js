import fs from 'node:fs';
import path from 'node:path';
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
function writeJsonIfChanged(file, loaded, next) {
  if (JSON.stringify(loaded.value) === JSON.stringify(next)) return false;
  if (loaded.exists) createBackup(file, 'setup');
  writeFileAtomic(file, JSON.stringify(next, null, 2) + '\n');
  return true;
}

function remap(location, source, target) {
  if (typeof location !== 'string') return location;
  const relative = path.relative(source, location);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    return path.join(target, relative);
  }
  return location;
}

export function syncCodeSetup(source, target) {
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

  // Phase 2: copy files (never overwrites). Phase 3: write the JSON indexes last,
  // so a failed copy never leaves an index that points at missing folders.
  for (const name of ['cache', 'marketplaces']) {
    const from = path.join(sourcePlugins, name);
    const to = path.join(targetPlugins, name);
    if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true, force: false });
  }
  let skills = 0;
  const sourceSkills = path.join(source, 'skills');
  const targetSkills = path.join(target, 'skills');
  if (fs.existsSync(sourceSkills)) {
    fs.mkdirSync(targetSkills, { recursive: true });
    for (const entry of fs.readdirSync(sourceSkills, { withFileTypes: true })) {
      if (entry.name === 'synced') continue; // account-managed skills remain account-specific
      const destination = path.join(targetSkills, entry.name);
      if (fs.existsSync(destination)) continue;
      fs.cpSync(path.join(sourceSkills, entry.name), destination, { recursive: true, force: false });
      skills++;
    }
  }
  writeJsonIfChanged(installedFile, targetInstalledLoaded, targetInstalled);
  writeJsonIfChanged(knownFile, targetKnownLoaded, targetKnown);
  writeJsonIfChanged(settingsFile, targetSettingsLoaded, targetSettings);
  return { plugins, marketplaces, skills, settings };
}
