// Cross-platform test runner: expands server/*.test.js itself so it works on
// Node 18/20/22+ and in Windows cmd (no shell glob, no Node glob support needed).
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(path.join(root, 'server'))
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join('server', name));
files.push(path.join('src', 'lib', 'lib.test.mjs'));
if (!files.length) {
  console.error('No server/*.test.js files found.');
  process.exit(1);
}
const extra = process.argv.slice(2);
const result = spawnSync(process.execPath, ['--test', ...extra, ...files], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
