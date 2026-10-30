import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReleaseManifest, contentIndex, validateReleaseManifest } from '../../scripts/static-cdn-manifest.mjs';

const identity = { environment: 'preview', commit: 'a'.repeat(40), generatedAt: '2026-10-26T17:21:00.000Z' };
const object = {
  key: 'yzgc/static/site/assets/app-12345678.js',
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  bytes: 3, content_type: 'text/javascript', source_path: 'build/web/assets/app-12345678.js', role: 'portal-asset',
};
const valid = () => ({
  schema_version: 1, environment: identity.environment, commit: identity.commit, generated_at: identity.generatedAt, objects: [object],
});
describe('release provenance and private content index', () => {
  it.each([
    { schema_version: 2 }, { environment: 'local' }, { commit: 'abc' },
    { generated_at: '2026-10-27T01:21:00+08:00' }, { generated_at: '2026-99-01T00:00:00.000Z' },
    { objects: {} }, { signed_url: 'https://fixture.invalid/?signature=fixture' },
  ])('rejects invalid or private release fields %j', change => {
    expect(() => validateReleaseManifest({ ...valid(), ...change })).toThrow();
  });

  it.each([
    { sha256: 'opaque-etag' }, { bytes: -1 }, { bytes: 1.5 }, { bytes: 10 * 1024 * 1024 + 1 },
    { content_type: 'text/html' }, { role: 'private-upload' }, { source_path: '/private/.env' },
    { source_path: 'build/web/assets/../../private.txt' }, { secret: 'fixture' },
    { key: 'indexes/content/fixture/sha256.json' }, { key: 'yzgc/static/site/assets/app-12345678.js?token=fixture' },
  ])('rejects unsafe object metadata %j', change => {
    expect(() => validateReleaseManifest({ ...valid(), objects: [{ ...object, ...change }] })).toThrow();
  });

  it('separates immutable release provenance from content hashes without publishing local paths or credentials', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cdn-manifest-'));
    try {
      const file = join(dir, 'a.js'); writeFileSync(file, 'abc');
      const manifest = createReleaseManifest([{ file, key: 'yzgc/static/site/assets/app-12345678.js', size: 3, mime: 'text/javascript' }], identity);
      expect(manifest).toEqual({
        schema_version: 1, environment: 'preview', commit: 'a'.repeat(40), generated_at: identity.generatedAt,
        objects: [{
          key: 'yzgc/static/site/assets/app-12345678.js',
          sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
          bytes: 3, content_type: 'text/javascript', source_path: 'build/web/assets/app-12345678.js', role: 'portal-asset',
        }],
      });
      expect(validateReleaseManifest(manifest)).toBe(manifest);
      expect(contentIndex(manifest)).not.toHaveProperty('commit');
      expect(JSON.stringify(manifest)).not.toContain(dir);
      expect(() => validateReleaseManifest({ ...manifest, secret: 'fixture' })).toThrow(/字段/);
      expect(() => validateReleaseManifest({ ...manifest, objects: [...manifest.objects, manifest.objects[0]] })).toThrow(/重复/);
      expect(() => validateReleaseManifest({ ...manifest, objects: [{ ...manifest.objects[0], source_path: '/private/.env' }] })).toThrow(/来源/);
      for (const key of ['yzgc/static/site/assets/nohash.js', 'yzgc/static/site/forum/_nuxt/builds/latest.json', 'yzgc/static/site/assets/.hidden-12345678.js']) {
        expect(() => validateReleaseManifest({ ...manifest, objects: [{ ...manifest.objects[0], key }] })).toThrow();
      }
      expect(() => validateReleaseManifest({ ...manifest, commit: [manifest.commit] })).toThrow();
      expect(() => validateReleaseManifest({ ...manifest, objects: [{ ...manifest.objects[0], sha256: [manifest.objects[0].sha256] }] })).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('records exported forum images as public, content-addressed release objects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cdn-published-manifest-'));
    try {
      const key = 'yzgc/static/site/forum/published/ba7816bf8f01cfea.webp';
      const file = join(dir, 'ba7816bf8f01cfea.webp');
      writeFileSync(file, 'abc');
      const manifest = createReleaseManifest([{ file, key, size: 3, mime: 'image/webp' }], identity);
      expect(manifest.objects[0]).toMatchObject({ key, role: 'published-image', source_path: 'app/forum/public/published/ba7816bf8f01cfea.webp', content_type: 'image/webp' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
