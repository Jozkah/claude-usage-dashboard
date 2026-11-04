// prestart guard: fail early with a clear message instead of a stack trace or a plain-text notice.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`Node.js 20 or newer is required (found ${process.versions.node}). See .nvmrc.`);
  process.exit(1);
}
if (!existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('dist/ not found: run "npm run build" before "npm start" (or use "npm run dev").');
  process.exit(1);
}
