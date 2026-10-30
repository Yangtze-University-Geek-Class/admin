// 公开发布来源清单与私有内容索引分离；不包含绝对路径、业务数据或任何凭据。
import { lstatSync, readFileSync } from 'node:fs';
import { basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATIC_CDN_NAMESPACE, STATIC_CDN_PREFIX } from './static-cdn-base.mjs';
import { assertObjectContent, assertStorageKey, CDN_MIME_TYPES as TYPES, sha256 } from './static-cdn-s3.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const MAX_BYTES = 10 * 1024 * 1024;
export function releaseKey({ environment, commit }) {
  if (!['production', 'preview'].includes(environment) || typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) throw new Error('发布必须指定 production/preview 和完整小写 commit');
  return `${STATIC_CDN_NAMESPACE}indexes/releases/${environment}/${commit}/manifest.json`;
}
function shape(key) {
  assertStorageKey(key);
  const sub = key.slice(STATIC_CDN_PREFIX.length);
  if (key.startsWith(`${STATIC_CDN_PREFIX}assets/`)) return { role: 'portal-asset', source: `build/web/${sub}` };
  if (key.startsWith(`${STATIC_CDN_PREFIX}console-assets/`)) return { role: 'console-asset', source: `build/web/${sub}` };
  if (key.startsWith(`${STATIC_CDN_PREFIX}forum/_nuxt/`)) return { role: 'forum-asset', source: `build/forum/${sub.slice('forum/'.length)}` };
  if (key.startsWith(`${STATIC_CDN_PREFIX}forum/guides/`)) return { role: 'guide-image', source: `app/forum/content/guide-images/${basename(key)}` };
  if (key.startsWith(`${STATIC_CDN_PREFIX}forum/stickers/`)) return { role: 'sticker', source: null };
  if (key.startsWith(`${STATIC_CDN_PREFIX}forum/published/`)) return { role: 'published-image', source: `app/forum/public/published/${basename(key)}` };
  throw new Error('清单对象不在公开静态资源范围');
}
function fields(object, required) {
  if (!object || typeof object !== 'object' || Array.isArray(object)
    || Object.keys(object).sort().join(',') !== [...required].sort().join(',')) throw new Error('清单字段不完整或含合同外字段');
}

export function validateReleaseManifest(manifest) {
  fields(manifest, ['schema_version', 'environment', 'commit', 'generated_at', 'objects']);
  releaseKey(manifest);
  if (manifest.schema_version !== 1 || typeof manifest.generated_at !== 'string'
    || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(manifest.generated_at)
    || new Date(manifest.generated_at).toISOString() !== manifest.generated_at || !Array.isArray(manifest.objects)) throw new Error('清单版本、时间或对象列表无效');
  const keys = new Set();
  for (const object of manifest.objects) {
    fields(object, ['key', 'sha256', 'bytes', 'content_type', 'source_path', 'role']);
    const expected = shape(object.key);
    if (keys.has(object.key)) throw new Error('清单对象键重复');
    keys.add(object.key);
    if (typeof object.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(object.sha256) || !Number.isSafeInteger(object.bytes) || object.bytes < 0 || object.bytes > MAX_BYTES
      || !TYPES[object.key.split('.').at(-1)] || TYPES[object.key.split('.').at(-1)] !== object.content_type || expected.role !== object.role) throw new Error('清单对象摘要、大小、类型或角色无效');
    if (typeof object.source_path !== 'string' || (expected.source ? object.source_path !== expected.source
      : !/^app\/server\/assets\/stickers\/[a-z0-9][a-z0-9-]{0,19}\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.webp$/.test(object.source_path))) throw new Error('清单来源路径不在静态源文件允许范围');
    if (object.role === 'sticker' && basename(object.key) !== `${object.sha256}.webp`) throw new Error('表情键与内容 SHA-256 不符');
    if (object.role === 'guide-image' && object.key.split('.').at(-2) !== Buffer.from(object.sha256, 'hex').toString('base64url').slice(0, 8)) throw new Error('截图键与内容哈希不符');
    if (object.key.split('/').some(segment => segment.startsWith('.'))) throw new Error('拒绝隐藏来源');
  }
  return manifest;
}

export function readEntry(entry) {
  const stat = lstatSync(entry.file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES || stat.size !== entry.size) throw new Error('源文件类型或长度已变化，拒绝上传');
  const body = readFileSync(entry.file);
  if (body.length !== entry.size || (entry.sha256 && sha256(body) !== entry.sha256)) throw new Error('源文件 SHA-256 或字节数已变化');
  return body;
}

export function createReleaseManifest(entries, { environment, commit, generatedAt, sourceRoot = REPO }) {
  releaseKey({ environment, commit });
  if (!generatedAt || !Number.isFinite(Date.parse(generatedAt))) throw new Error('须指定稳定的 generated-at（发布提交时间）');
  const objects = entries.map(entry => {
    const body = readEntry(entry);
    assertObjectContent(entry.key, body, entry.mime);
    const expected = shape(entry.key);
    return {
      key: entry.key, sha256: sha256(body), bytes: body.length, content_type: entry.mime,
      source_path: expected.source ?? relative(sourceRoot, entry.file), role: expected.role,
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
  return validateReleaseManifest({ schema_version: 1, environment, commit, generated_at: new Date(generatedAt).toISOString(), objects });
}

/** 仅写入私有构建产物，父级可存入环境私有桶；不上传到公开桶。 */
export function contentIndex(manifest) {
  validateReleaseManifest(manifest);
  const hashes = {};
  for (const object of manifest.objects) {
    const group = hashes[object.sha256] ??= { bytes: object.bytes, keys: [] };
    if (group.bytes !== object.bytes) throw new Error('同一摘要的大小冲突');
    group.keys.push(object.key);
  }
  return { schema_version: 1, hashes };
}

export const manifestText = manifest => `${JSON.stringify(validateReleaseManifest(manifest), null, 2)}\n`;
