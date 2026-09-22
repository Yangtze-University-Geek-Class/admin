#!/usr/bin/env node
// Provenance guard, not a security audit or a replacement for upstream tests.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = resolve(root, 'app/forum');
const source = JSON.parse(readFileSync(resolve(base, 'UPSTREAM.json'), 'utf8'));
const adoption = JSON.parse(readFileSync(resolve(base, 'ADOPTION.json'), 'utf8'));
const permitted = new Set(Object.keys(adoption.modifiedUpstreamFiles));
const changes = [];
for (const [name, expected] of Object.entries(source.original_files)) {
  const file = resolve(base, name);
  if (isAbsolute(name) || relative(base, file).startsWith('..')) throw new Error('Invalid upstream provenance path');
  if (!existsSync(file)) throw new Error(`Missing upstream source: ${name}`);
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (actual !== expected) {
    changes.push(name);
    if (!permitted.has(name)) throw new Error(`Undocumented upstream adaptation: ${name}`);
  }
}
if (permitted.has('LICENSE') || permitted.has('pnpm-lock.yaml') || permitted.has('package.json')) throw new Error('License/lockfile/manifest changes require a separately reviewed upstream upgrade');
for (const path of ['app/web/sites/forum', 'app/server/src/routes/forum', 'app/server/src/lib/forum-db.ts']) {
  if (existsSync(resolve(root, path))) throw new Error(`Retired forum implementation returned to active source: ${path}`);
}
console.log(`Forum provenance passed: ${Object.keys(source.original_files).length} upstream files, ${changes.length} documented adaptations, MIT retained, source ${source.commit}.`);
