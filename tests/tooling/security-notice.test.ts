import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { productionSecurityNotice, verifySecurityNotice } from '../../scripts/security-notice.mjs';
import { inlineScriptHashes } from '../../app/forum/scripts/csp-header.mjs';
import type * as Vite from '../../app/web/node_modules/vite';

const html = '<!doctype html><html><head><title>Fixture</title></head><body><main>Normal page</main><script type="module" src="/page.js"></script><script type="application/json">{"safe":true}</script></body></html>';
const selector = 'meta[name="security-authorization"]';
let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'geek-security-notice-')));
  await writeFile(join(root, 'index.html'), html);
  // 故意生成动态加载边界，验证正式提示不破坏运行时分块加载。
  await writeFile(join(root, 'page.js'), 'globalThis.loadFixture = () => import("./entry.js");');
  await writeFile(join(root, 'entry.js'), 'export const value = 42; export async function lazyValue() { return (await import("./lazy.js")).value; }');
  await writeFile(join(root, 'lazy.js'), 'export const value = 73;');
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

async function build(vite: { build(config: Vite.InlineConfig): Promise<unknown> }, environment: string | undefined, directory: string, enabled = true) {
  const output = join(root, directory);
  await vite.build({
    root, configFile: false, envFile: false, publicDir: false, logLevel: 'silent',
    plugins: enabled ? [productionSecurityNotice({ GEEK_DEPLOYMENT_ENVIRONMENT: environment })] : [],
    build: {
      outDir: output, emptyOutDir: true, minify: true, modulePreload: false,
      rollupOptions: { input: { page: join(root, 'index.html'), logic: join(root, 'entry.js') }, preserveEntrySignatures: 'strict' },
    },
  });
  verifySecurityNotice({ root: output, entry: 'index.html', env: { GEEK_DEPLOYMENT_ENVIRONMENT: environment } });
  const page = await readFile(join(output, 'index.html'), 'utf8');
  const names = (await readdir(join(output, 'assets'))).sort();
  const assets = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(join(output, 'assets', name), 'utf8')])));
  return { output, page, assets };
}

describe.each(['web', 'console'])('%s production security notice build boundary', (application) => {
  let vite: typeof Vite;
  beforeAll(async () => {
    // 打包器由被测应用在运行时选择，不能用 Vitest 自身的 Vite 版本替代。
    const require = createRequire(new URL(`../../app/${application}/package.json`, import.meta.url));
    vite = await import(pathToFileURL(require.resolve('vite')).href);
  });
  const compile = (environment: string | undefined, directory: string, enabled = true) => build(vite, environment, `${application}-${directory}`, enabled);
  it('keeps preview and unconfigured output byte-identical to the build without the plugin', async () => {
    const baseline = await compile(undefined, 'baseline', false);
    for (const environment of [undefined, 'preview', 'local', 'development']) {
      const result = await compile(environment, `off-${environment}`);
      expect(result.page).toBe(baseline.page);
      expect(result.assets).toEqual(baseline.assets);
    }
  });

  it('uses distinct stable content hashes while preserving executable exports and lazy imports', async () => {
    const preview = await compile('preview', 'preview');
    const production = await compile('production', 'production');
    const repeated = await compile('production', 'repeated');
    expect(production.page).toBe(repeated.page);
    expect(production.assets).toEqual(repeated.assets);
    const entry = Object.keys(production.assets).find(name => name.startsWith('logic-'))!;
    const previousEntry = Object.keys(preview.assets).find(name => name.startsWith('logic-'))!;
    expect(entry).not.toBe(previousEntry);
    expect(production.assets[entry]).toContain('/*! security-authorization');
    // CDN 共享前缀中，同键不能对应另一套环境的不同字节。
    for (const name of Object.keys(production.assets)) {
      if (name in preview.assets) expect(production.assets[name]).toBe(preview.assets[name]);
    }
    // 在原生 Node 中加载运行时生成的文件，避免 Vitest 把它当源码重新打包。
    const result = execFileSync(process.execPath, ['--input-type=module', '-e',
      'const m = await import(process.argv[1]); console.log(JSON.stringify({ value: m.value, lazy: await m.lazyValue() }));',
      pathToFileURL(join(production.output, 'assets', entry)).href], { encoding: 'utf8' });
    expect(JSON.parse(result)).toEqual({ value: 42, lazy: 73 });
  });

  it('adds only head metadata, preserving the page body and CSP inline-script hashes', async () => {
    const preview = await compile('preview', 'html-preview');
    const production = await compile('production', 'html-production');
    const before = new JSDOM(preview.page);
    const after = new JSDOM(production.page);
    expect(before.window.document.querySelector(selector)).toBeNull();
    expect(after.window.document.querySelectorAll(selector)).toHaveLength(1);
    expect(after.window.document.querySelector(`body ${selector}`)).toBeNull();
    expect(after.window.document.body.textContent).toBe(before.window.document.body.textContent);
    expect(after.window.document.querySelectorAll('script').length).toBe(before.window.document.querySelectorAll('script').length);
    expect(inlineScriptHashes(production.page)).toEqual(inlineScriptHashes(preview.page));
    before.window.close();
    after.window.close();
  });

  it('rejects a production artifact when minification removes the actual linked entry notice', async () => {
    const production = await compile('production', 'missing-notice');
    const document = new JSDOM(production.page);
    const source = document.window.document.querySelector('script[type="module"][src]')!.getAttribute('src')!;
    document.window.close();
    const file = join(production.output, source.slice(1));
    await writeFile(file, (await readFile(file, 'utf8')).replace(/\/\*! security-authorization[\s\S]*?\*\//, ''));
    expect(() => verifySecurityNotice({ root: production.output, entry: 'index.html', env: { GEEK_DEPLOYMENT_ENVIRONMENT: 'production' } })).toThrow(/入口 JS/);
  });

  it('does not inject during development even with an inherited production environment', async () => {
    const server = await vite.createServer({
      root, configFile: false, envFile: false, publicDir: false, logLevel: 'silent',
      plugins: [productionSecurityNotice({ GEEK_DEPLOYMENT_ENVIRONMENT: 'production' })],
      server: { middlewareMode: true, watch: null },
    });
    try {
      const rendered = new JSDOM(await server.transformIndexHtml('/index.html', html));
      expect(rendered.window.document.querySelector(selector)).toBeNull();
      expect(rendered.window.document.querySelector('main')?.textContent).toBe('Normal page');
      rendered.window.close();
    } finally { await server.close(); }
  });
});
