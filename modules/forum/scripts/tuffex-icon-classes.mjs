#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Icon classes tuffex components render themselves (`<i class="i-carbon-…">`).
 *
 * UnoCSS's default pipeline excludes node_modules, so these classes are never
 * extracted from the package; the host has to safelist them. Scanning the
 * published dist at config-load time keeps the list in step with the installed
 * version instead of a hand-copied snapshot.
 */

const ICON_CLASS = /\bi-(?:carbon|ri|simple-icons)-[a-z0-9-]+/g

/** `dist/es` of the installed package (the `./*` export wildcard shadows package.json, so resolve the CJS main). */
function resolveDistRoot() {
  const require = createRequire(import.meta.url)
  try {
    return join(dirname(require.resolve('@talex-touch/tuffex')), '..', 'es')
  }
  catch {
    return null
  }
}

function* walkJs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory())
      yield* walkJs(full)
    else if (entry.isFile() && entry.name.endsWith('.js'))
      yield full
  }
}

/** @returns {string[]} sorted, de-duplicated icon classes found in the tuffex dist. */
export function tuffexIconClasses() {
  const root = resolveDistRoot()
  if (!root) {
    console.warn('[tuffex-icon-classes] @talex-touch/tuffex is not installed; safelist is empty')
    return []
  }

  const found = new Set()
  for (const file of walkJs(root)) {
    for (const match of readFileSync(file, 'utf8').matchAll(ICON_CLASS))
      found.add(match[0])
  }
  return [...found].sort()
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const classes = tuffexIconClasses()
  for (const cls of classes)
    console.log(cls)
  console.error(`${classes.length} icon classes`)
}
