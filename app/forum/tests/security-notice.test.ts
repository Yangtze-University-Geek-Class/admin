import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { productionSecurityNotice, verifySecurityNotice } from '../../../scripts/security-notice.mjs'

it('preserves production authorization through Nuxt native minification without aliasing preview asset hashes', async () => {
  const appRequire = createRequire(import.meta.url)
  const nuxtRequire = createRequire(appRequire.resolve('nuxt/package.json'))
  const builderRequire = createRequire(nuxtRequire.resolve('@nuxt/vite-builder'))
  // Vitest uses a different Vite version; exercise the one actually used by Nuxt.
  const { build } = await import(pathToFileURL(builderRequire.resolve('vite')).href)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'forum-security-notice-')))
  try {
    await writeFile(join(root, 'package.json'), '{"type":"module"}')
    await writeFile(join(root, 'index.html'), '<main>Forum fixture</main><script type="module" src="/entry.js"></script>')
    await writeFile(join(root, 'entry.js'), '/*! @license Fixture fixture-author@example.test */\nglobalThis.noticeValue = 42;')
    const environments = ['preview', 'production'] as const
    const assets: Record<typeof environments[number], Record<string, string>> = { preview: {}, production: {} }
    for (const environment of environments) {
      const output = join(root, environment)
      const env = { GEEK_DEPLOYMENT_ENVIRONMENT: environment }
      await build({
        root, configFile: false, envFile: false, publicDir: false, logLevel: 'silent',
        plugins: [productionSecurityNotice(env)],
        build: { outDir: output, emptyOutDir: true, minify: true, modulePreload: false },
      })
      expect(verifySecurityNotice({ root: output, entry: 'index.html', env }).notice).toBe(environment === 'production')
      const entries = await readdir(join(output, 'assets'))
      assets[environment] = Object.fromEntries(await Promise.all(entries.map(async name => [name, await readFile(join(output, 'assets', name), 'utf8')])))
      for (const code of Object.values(assets[environment]))
        expect(code).not.toContain('fixture-author@example.test')
      const html = await readFile(join(output, 'index.html'), 'utf8')
      const source = /<script\b[^>]*src="([^"]+)"/.exec(html)![1]!
      const result = execFileSync(process.execPath, ['--input-type=module', '-e',
        'await import(process.argv[1]); console.log(globalThis.noticeValue)', pathToFileURL(join(output, source.slice(1))).href], { encoding: 'utf8' })
      expect(result.trim()).toBe('42')
    }
    expect(Object.keys(assets.production)).not.toEqual(Object.keys(assets.preview))
    for (const name of Object.keys(assets.production)) {
      if (name in assets.preview)
        expect(assets.production[name]).toBe(assets.preview[name])
    }
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})
