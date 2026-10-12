import fs from 'node:fs';
import path from 'node:path';

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
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

  for (const name of ['cache', 'marketplaces']) {
    const from = path.join(sourcePlugins, name);
    const to = path.join(targetPlugins, name);
    if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true, force: false });
  }
  const sourceSkills = path.join(source, 'skills');
  const targetSkills = path.join(target, 'skills');
  if (fs.existsSync(sourceSkills)) {
    fs.mkdirSync(targetSkills, { recursive: true });
    for (const entry of fs.readdirSync(sourceSkills, { withFileTypes: true })) {
      if (entry.name === 'synced') continue; // account-managed skills remain account-specific
      const destination = path.join(targetSkills, entry.name);
      if (!fs.existsSync(destination)) fs.cpSync(path.join(sourceSkills, entry.name), destination, { recursive: true, force: false });
    }
  }

  const sourceInstalled = readJson(path.join(sourcePlugins, 'installed_plugins.json'), { plugins: {} });
  const targetInstalledFile = path.join(targetPlugins, 'installed_plugins.json');
  const targetInstalled = readJson(targetInstalledFile, { version: 2, plugins: {} });
  targetInstalled.plugins ||= {};
  let plugins = 0;
  for (const [name, installations] of Object.entries(sourceInstalled.plugins || {})) {
    if (targetInstalled.plugins[name] || !Array.isArray(installations)) continue;
    const userInstallations = installations.filter((entry) => entry.scope === 'user').map((entry) => ({
      ...entry, installPath: remap(entry.installPath, source, target),
    }));
    if (userInstallations.length) { targetInstalled.plugins[name] = userInstallations; plugins++; }
  }
  writeJson(targetInstalledFile, targetInstalled);

  const knownFile = path.join(targetPlugins, 'known_marketplaces.json');
  const sourceKnown = readJson(path.join(sourcePlugins, 'known_marketplaces.json'), {});
  const targetKnown = readJson(knownFile, {});
  for (const [name, marketplace] of Object.entries(sourceKnown)) {
    if (!(name in targetKnown)) targetKnown[name] = {
      ...marketplace, installLocation: remap(marketplace.installLocation, source, target),
    };
  }
  writeJson(knownFile, targetKnown);

  const sourceSettings = readJson(path.join(source, 'settings.json'), {});
  const targetSettingsFile = path.join(target, 'settings.json');
  const targetSettings = readJson(targetSettingsFile, {});
  for (const key of ['enabledPlugins', 'extraKnownMarketplaces']) {
    targetSettings[key] = { ...sourceSettings[key], ...targetSettings[key] };
  }
  writeJson(targetSettingsFile, targetSettings);
  return { plugins };
}
