import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inside, metadata, normalizeMdc, searchCatalog, verifyLibrary } from '../../scripts/tuffex-docs.mjs';

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

it('preserves upstream metadata without treating since as a package version', () => {
  expect(metadata('---\ntitle: "Button 按钮"\nsince: 1.0.0\nverified: false\ntags: [button, action]\n---\n# Button')).toMatchObject({ title: 'Button 按钮', since: '1.0.0', verified: 'false', tags: ['button', 'action'] });
});
it('turns embedded demo code into an ordinary fenced Vue example', () => {
  const text = '::TuffDemoWrapper{demo="ButtonDemo" code-lang="vue"}\n---\ncode: |\n  <template>\n    <TxButton />\n  </template>\n---\n::';
  expect(normalizeMdc(text)).toContain('```vue\n<template>\n  <TxButton />\n</template>\n```');
  expect(normalizeMdc(text)).not.toContain('::TuffDemoWrapper');
});
it('preserves nested API rows, enums and quoted defaults', () => {
  const yaml = 'rows:\n  - parameter: variant\n    type:\n      kind: enum\n      enums: [primary, secondary]\n    default: "false"';
  expect(normalizeMdc(`::DocApiTable\n---\n${yaml}\n---\n::`)).toBe(`\`\`\`yaml\n${yaml}\n\`\`\`\n`);
});
it('maps website-only dynamic catalogues to the local index', () => {
  expect(normalizeMdc('::DocsSuiteCatalog\n::')).toContain('../COMPONENTS.md');
});
it('prioritizes exact component slug matches and accepts Chinese searches', () => {
  const catalog = { pages: [{ slug: 'button', title: 'Button 按钮', symbols: ['TxButton'], description: '触感按钮', category: 'Basic', tags: ['action'], path: 'reference/button.md', sections: [], suite: 'base' }] };
  expect(searchCatalog(catalog, '按钮')[0].slug).toBe('button');
  expect(searchCatalog(catalog, 'TxButton')[0].slug).toBe('button');
  expect(searchCatalog(catalog, 'nonexistent')).toEqual([]);
  expect(() => searchCatalog(catalog, '')).toThrow();
});
it('ranks the named component above other pages mentioning it', () => {
  const row = { title: 'Guide', symbols: ['TxDataTable'], description: '', category: 'Basic', tags: [], sections: [], suite: 'base' };
  const catalog = { pages: [{ ...row, slug: 'a-guide', path: 'reference/a-guide.md' }, { ...row, slug: 'data-table', title: 'DataTable 数据表格', path: 'reference/data-table.md' }] };
  expect(searchCatalog(catalog, 'TxDataTable')[0].slug).toBe('data-table');
  expect(searchCatalog(catalog, 'loading-variant')).toEqual([]);
  expect(searchCatalog(catalog, 'loading-variant', 3, () => '# API\n- parameter: loading-variant')[0].match.line).toBe(2);
});
it('rejects traversal, absolute paths and symlink destinations', () => {
  const root = mkdtempSync(join(tmpdir(), 'tuffex-doc-path-')); temporary.push(root);
  expect(() => inside(root, '../elsewhere')).toThrow();
  expect(() => inside(root, '/etc/hosts')).toThrow();
  expect(() => inside(root, 'a\\b')).toThrow();
  symlinkSync(tmpdir(), join(root, 'link'));
  expect(() => inside(root, 'link/elsewhere')).toThrow();
  expect(inside(root, 'reference/button.md')).toBe(join(root, 'reference/button.md'));
});
it('verifies every saved reference and cross-reference without a network request', () => {
  const result = verifyLibrary();
  expect(result.pages).toBeGreaterThan(100);
  expect(result.exampleFiles).toBeGreaterThan(300);
  expect(result.commit).toMatch(/^[a-f0-9]{40}$/);
});
it('fails closed on a modified snapshot file in an isolated fixture', () => {
  const root = mkdtempSync(join(tmpdir(), 'tuffex-doc-integrity-')); temporary.push(root);
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 1, commit: 'a'.repeat(40), counts: { pages: 0 }, packages: { tuffex: { version: 'test' } }, files: [{ path: 'source.txt', sha256: 'b'.repeat(64) }] }));
  writeFileSync(join(root, 'catalog.json'), JSON.stringify({ commit: 'a'.repeat(40), pages: [] }));
  writeFileSync(join(root, 'source.txt'), 'changed');
  expect(() => verifyLibrary(root)).toThrow('modified source.txt');
});
