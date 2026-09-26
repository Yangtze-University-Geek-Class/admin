#!/usr/bin/env node
// Offline asset normalization; no network, no environment-file reads, no database access.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Private data lives in the main checkout's .tools, also when this runs from a task worktree.
const privateRoot = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim()) + '/.tools';
const jobPath = resolve(process.argv[2] ?? '');
if (!jobPath.startsWith(privateRoot + '/forum-runtime/')) throw new Error('Private runtime job required');
const job = JSON.parse(readFileSync(jobPath, 'utf8'));
const output = resolve(dirname(jobPath), 'assets');
mkdirSync(output, { recursive: true, mode: 0o700 });
const sharp = createRequire(resolve(root, 'app/server/package.json'))('sharp');
const hash = value => createHash('sha256').update(value).digest('hex');
const result = { assets: {}, aliases: {}, rejected: [] };
for (const item of job.files) {
  const source = resolve(item.source);
  if (!source.startsWith(privateRoot + '/forum-migration/') || lstatSync(source).isSymbolicLink() || realpathSync(source) !== source) throw new Error('Unsafe source asset');
  const bytes = readFileSync(source);
  if (hash(bytes) !== item.sha256 || bytes.length > 64 * 1024 * 1024) throw new Error('Asset changed or exceeds size limit');
  let payload, mime, extension, disposition = 'inline';
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, animated: false, failOn: 'error' });
    const meta = await image.metadata();
    if (!['jpeg', 'png', 'webp', 'gif'].includes(meta.format)) throw new Error('Not an allowed raster image');
    payload = await image.rotate().webp({ lossless: true }).toBuffer(); mime = 'image/webp'; extension = 'webp';
  } catch {
    if (item.name.endsWith('.mp4') && bytes.subarray(4, 8).toString() === 'ftyp') {
      payload = bytes; mime = 'video/mp4'; extension = 'mp4';
    } else if (item.name.endsWith('.md') && !bytes.includes(0)) {
      payload = bytes; mime = 'text/plain; charset=utf-8'; extension = 'txt'; disposition = 'attachment';
    } else {
      result.rejected.push(item.name); continue;
    }
  }
  const id = hash(payload);
  const name = `${id}.${extension}`;
  if (!result.assets[id]) writeFileSync(resolve(output, name), payload, { flag: 'wx', mode: 0o600 });
  result.assets[id] = { file: name, sha256: id, bytes: payload.length, mime, disposition };
  result.aliases[item.name] = id;
}
writeFileSync(resolve(dirname(jobPath), 'asset-index.json'), JSON.stringify(result), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ normalized: Object.keys(result.aliases).length, rejected: result.rejected.length, distinctAssets: Object.keys(result.assets).length }));
