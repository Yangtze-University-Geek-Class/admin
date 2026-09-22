import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
// `nuxt/kit`, not `@nuxt/kit`: the latter is only a transitive dependency here,
// so its types do not resolve without adding a direct dependency.
import { addComponent, defineNuxtModule } from 'nuxt/kit'

/**
 * Registers every `@talex-touch/tuffex` component with Nuxt's component system.
 *
 * The list is derived from the published `dist/es/<dir>/index.d.ts` barrels, so
 * it cannot drift from the installed version: a component is registered the
 * moment the package exports it. `addComponent` keeps laziness and chunking in
 * Nuxt's hands — a route that references no tuffex component pulls no tuffex chunk.
 *
 * Mirrors `apps/nexus/modules/tuffex-components.ts` in talex-touch, which scans
 * the source barrels; here the input is the npm dist.
 */

/** Components are exported as `TxFoo` / `TuffFoo`; everything else is a type, a key or a helper. */
const COMPONENT_NAME = /^(?:Tx|Tuff)[A-Z][A-Za-z0-9]*$/

/**
 * Suite and utility aggregates plus build artefacts, not component directories.
 * The aggregates re-export the real barrels wholesale, so walking them would
 * register every component a second time and trip the collision check.
 */
const SKIPPED_DIRECTORIES = new Set(['ai', 'base', 'pro', 'utils', '_virtual', 'packages'])

/**
 * `dist/es` of the installed package. The package's `./*` export wildcard
 * shadows `package.json`, so resolve the CJS main (`dist/lib/index.js`) and
 * step over to its ESM sibling instead.
 */
function resolveDistRoot(): string {
  const require = createRequire(import.meta.url)
  return join(dirname(require.resolve('@talex-touch/tuffex')), '..', 'es')
}

/**
 * Reads the component names a barrel exports, following `export * from './x'`
 * one hop: three barrels (breadcrumb, pagination, steps) are a bare star
 * re-export of `./src`, and reading only the top file would silently miss them.
 *
 * Deliberately textual: these `.d.ts` files are flat re-exports with no logic
 * to run, and importing them would drag the type graph into the config context.
 */
function readBarrelExports(barrel: string, followStar = true): string[] {
  let source: string
  try {
    source = readFileSync(barrel, 'utf8')
  }
  catch {
    return []
  }

  const names = new Set<string>()

  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const entry of (block[1] ?? '').split(',')) {
      const trimmed = entry.trim()
      // `export type { X }` and `export { type X }` are both type-only.
      if (!trimmed || trimmed.startsWith('type '))
        continue
      // `A as B` registers under B, which is what consumers write.
      const name = (trimmed.split(/\s+as\s+/).pop() ?? '').trim()
      if (COMPONENT_NAME.test(name))
        names.add(name)
    }
  }

  if (followStar) {
    for (const star of source.matchAll(/export\s+\*\s+from\s+['"](\.[^'"]*)['"]/g)) {
      const target = join(barrel, '..', star[1] ?? '')
      for (const name of [
        ...readBarrelExports(`${target}.d.ts`, false),
        ...readBarrelExports(join(target, 'index.d.ts'), false),
      ]) {
        names.add(name)
      }
    }
  }

  return [...names]
}

export default defineNuxtModule({
  meta: { name: 'tuffex-components' },
  setup(_options, nuxt) {
    const distRoot = resolveDistRoot()

    const directories = readdirSync(distRoot).filter((entry) => {
      if (SKIPPED_DIRECTORIES.has(entry))
        return false
      try {
        return statSync(join(distRoot, entry, 'index.d.ts')).isFile()
      }
      catch {
        return false
      }
    })

    /** name -> directory, so a collision can name both sides. */
    const claimed = new Map<string, string>()
    const collisions: string[] = []

    for (const directory of directories.sort()) {
      for (const name of readBarrelExports(join(distRoot, directory, 'index.d.ts'))) {
        const owner = claimed.get(name)
        if (owner) {
          // Two barrels exporting one name is ambiguous, and picking a winner
          // silently is how a component starts rendering as something else.
          collisions.push(`${name}: ${owner} and ${directory}`)
          continue
        }
        claimed.set(name, directory)

        addComponent({
          name,
          // The package subpath export; `./*` maps to `dist/es/*/index.js`.
          filePath: `@talex-touch/tuffex/${directory}`,
          export: name,
        })
      }
    }

    if (collisions.length) {
      throw new Error(
        `[tuffex-components] duplicate component exports across barrels:\n  ${collisions.join('\n  ')}`,
      )
    }

    // Vite only learns about a subpath when a page first imports it, then
    // re-optimizes and aborts the in-flight page load ("Failed to fetch
    // dynamically imported module" once per cold cache). Declaring every
    // registered subpath up front makes the first request as clean as the rest.
    const optimizeDeps = (nuxt.options.vite.optimizeDeps ||= {})
    ;(optimizeDeps.include ||= []).push(
      ...directories.map(directory => `@talex-touch/tuffex/${directory}`),
      '@talex-touch/tuffex/utils',
    )

    console.info(`[tuffex-components] registered ${claimed.size} components from ${directories.length} barrels`)
  },
})
