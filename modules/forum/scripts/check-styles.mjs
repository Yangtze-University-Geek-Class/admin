import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * R2 guard: this project ships **no custom styling**. Visual decisions are
 * expressed through tuffex component props/slots and UnoCSS utility classes;
 * the only stylesheets are third-party ones named in `nuxt.config.ts`.
 *
 * Five rules, all of which must fail loudly when the property they protect is
 * broken — run `--self-test` to prove that they do.
 *
 *   vue-style-block ...... a `.vue` file carries a `<style>` block
 *   inline-style-binding . `style="…"`, `:style="…"`, `v-bind:style`, or a
 *                          JS write (`el.style.x =`, `setProperty(`, `cssText =`)
 *   stylesheet-file ...... a project-authored .css/.scss/.sass/.less/.styl
 *   nuxt-css-entry ....... `nuxt.config.ts` `css:` entry that is not a bare
 *                          package specifier (a relative path means a
 *                          project-authored stylesheet sneaked in)
 *   math-random .......... `Math.random` under `app/` (R3 determinism)
 *
 * The matcher deliberately does **not** fire on the word "style" in prose, in
 * a markdown seed string, in a comment, or in a CSS-variable token name: every
 * code file is lexed first and its comments and string/template literals are
 * blanked out (same length, newlines kept, so line numbers still line up),
 * and inside a `.vue` only the `<template>` and `<script>` regions are read.
 * Reads such as `getComputedStyle(el)` and `el.style.getPropertyValue('--x')`
 * are not writes and are not violations — the smoke tests depend on them.
 */

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT_PATH = fileURLToPath(import.meta.url)

/** Recursively scanned. Anything outside these plus the root config files is not ours. */
const SOURCE_DIRS = ['app', 'modules', 'scripts', 'tests']
/** Root-level files (not recursive) that are still project-authored source. */
const ROOT_FILE_EXT = new Set(['.ts', '.mjs', '.js', '.vue'])
const SKIP_DIRS = new Set(['node_modules', '.nuxt', '.output', '.git', 'dist', 'reports', '.data'])

const STYLESHEET_EXT = new Set(['.css', '.scss', '.sass', '.less', '.styl'])
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue'])

/** Attribute position: start of line, whitespace or `<` before the name. */
const INLINE_PATTERNS = [
  { name: 'style="…"', re: /(?:^|[\s<])style\s*=\s*["'{]/g },
  { name: ':style / v-bind:style', re: /(?:^|[\s<])(?::|v-bind:)style(?:\.[\w-]+)*\s*=/g },
  { name: '.style.<prop> = …', re: /\.style\s*\.\s*[\w$]+\s*=(?!=)/g },
  { name: '.style = …', re: /\.style\s*=(?!=)/g },
  { name: 'setProperty(…)', re: /\bsetProperty\s*\(/g },
  { name: '.cssText = …', re: /\.cssText\s*=(?!=)/g },
]

// --------------------------------------------------------------------- lexing

/**
 * Blanks comments and string/template literals, preserving length and
 * newlines so an index into the result still points at the original line.
 * `${…}` interpolations stay live code.
 */
export function stripCode(source) {
  const out = [...source]
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n')
        out[k] = ' '
    }
  }

  /** Template-literal nesting: `braceDepth === 0` means we are in literal text. */
  const stack = []
  let i = 0
  let prev = ''

  while (i < source.length) {
    const top = stack[stack.length - 1]
    const ch = source[i]

    if (top && top.braceDepth === 0) {
      if (ch === '\\') {
        blank(i, i + 2)
        i += 2
        continue
      }
      if (ch === '`') {
        stack.pop()
        prev = '`'
        i += 1
        continue
      }
      if (ch === '$' && source[i + 1] === '{') {
        top.braceDepth = 1
        prev = '{'
        i += 2
        continue
      }
      blank(i, i + 1)
      i += 1
      continue
    }

    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? source.length : end
      blank(i, stop)
      i = stop
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      blank(i, stop)
      i = stop
      continue
    }
    if (ch === '"' || ch === '\'') {
      const end = closingQuote(source, i, ch)
      blank(i + 1, end)
      prev = ch
      i = end + 1
      continue
    }
    if (ch === '`') {
      stack.push({ braceDepth: 0 })
      i += 1
      continue
    }
    if (ch === '/' && isRegexStart(prev)) {
      const end = closingSlash(source, i)
      blank(i + 1, end)
      prev = '/'
      i = end + 1
      continue
    }
    if (top && ch === '{') {
      top.braceDepth += 1
    }
    else if (top && ch === '}') {
      top.braceDepth -= 1
      if (top.braceDepth === 0) {
        prev = '`'
        i += 1
        continue
      }
    }

    if (!/\s/.test(ch))
      prev = ch
    i += 1
  }

  return out.join('')
}

function closingQuote(source, start, quote) {
  for (let k = start + 1; k < source.length; k++) {
    if (source[k] === '\\') {
      k += 1
      continue
    }
    if (source[k] === quote || source[k] === '\n')
      return k
  }
  return source.length
}

function closingSlash(source, start) {
  let inClass = false
  for (let k = start + 1; k < source.length; k++) {
    const ch = source[k]
    if (ch === '\\') {
      k += 1
      continue
    }
    if (ch === '\n')
      return k
    if (ch === '[')
      inClass = true
    else if (ch === ']')
      inClass = false
    else if (ch === '/' && !inClass)
      return k
  }
  return source.length
}

/** A `/` opens a regex only where a value may start. */
function isRegexStart(prev) {
  return prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev)
}

/**
 * Keeps only what a `.vue` file's template and script contribute, blanking
 * `<style>` blocks, custom blocks and HTML comments. Script regions are lexed
 * like any other code file; template regions keep their attributes.
 */
function maskVue(source) {
  const out = new Array(source.length).fill(' ')
  for (let k = 0; k < source.length; k++) {
    if (source[k] === '\n')
      out[k] = '\n'
  }
  const copy = (from, to, text) => {
    for (let k = 0; k < text.length; k++)
      out[from + k] = text[k]
    void to
  }

  for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const body = match[1]
    copy(match.index + match[0].indexOf(body), match.index + match[0].length, stripCode(body))
  }
  for (const match of source.matchAll(/<template\b[^>]*>([\s\S]*?)<\/template>\s*(?=<script|<style|$)/g)) {
    const body = match[1]
    copy(match.index + match[0].indexOf(body), match.index + match[0].length, blankHtmlComments(body))
  }
  return out.join('')
}

function blankHtmlComments(body) {
  const out = [...body]
  for (const match of body.matchAll(/<!--[\s\S]*?-->/g)) {
    for (let k = match.index; k < match.index + match[0].length; k++) {
      if (out[k] !== '\n')
        out[k] = ' '
    }
  }
  return out.join('')
}

// -------------------------------------------------------------------- walking

function collect(root) {
  const files = []
  for (const dir of SOURCE_DIRS)
    walk(join(root, dir), files)
  let rootEntries
  try {
    rootEntries = readdirSync(root, { withFileTypes: true })
  }
  catch {
    return files
  }
  for (const entry of rootEntries) {
    if (entry.isFile() && (ROOT_FILE_EXT.has(extname(entry.name)) || STYLESHEET_EXT.has(extname(entry.name))))
      files.push(join(root, entry.name))
  }
  return files
}

function walk(dir, files) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  }
  catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name))
        walk(join(dir, entry.name), files)
      continue
    }
    if (entry.isFile())
      files.push(join(dir, entry.name))
  }
}

// --------------------------------------------------------------------- rules

function locate(source, index) {
  const before = source.slice(0, index)
  const line = before.split('\n').length
  const lineStart = before.lastIndexOf('\n') + 1
  const lineEnd = source.indexOf('\n', index)
  const text = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim()
  return { line, text }
}

export function scan(root) {
  const violations = []
  const add = (file, source, index, rule, detail) => {
    const { line, text } = locate(source, index)
    violations.push({
      file: relative(root, file) || file,
      line,
      rule,
      detail,
      text: text.length > 160 ? `${text.slice(0, 157)}…` : text,
    })
  }

  for (const file of collect(root)) {
    const ext = extname(file)

    if (STYLESHEET_EXT.has(ext)) {
      violations.push({
        file: relative(root, file) || file,
        line: 1,
        rule: 'stylesheet-file',
        detail: `project-authored ${ext} stylesheet`,
        text: '',
      })
      continue
    }
    if (!CODE_EXT.has(ext))
      continue

    let source
    try {
      source = readFileSync(file, 'utf8')
    }
    catch {
      continue
    }

    if (ext === '.vue') {
      for (const match of source.matchAll(/<style\b[\s>]|<style>/g))
        add(file, source, match.index, 'vue-style-block', 'a <style> block in an SFC')
    }

    const masked = ext === '.vue' ? maskVue(source) : stripCode(source)

    for (const { name, re } of INLINE_PATTERNS) {
      re.lastIndex = 0
      for (const match of masked.matchAll(re))
        add(file, source, match.index, 'inline-style-binding', name)
    }

    const inApp = relative(root, file).split(sep)[0] === 'app'
    if (inApp) {
      for (const match of masked.matchAll(/\bMath\s*\.\s*random\b/g))
        add(file, source, match.index, 'math-random', 'non-deterministic randomness under app/')
    }
  }

  violations.push(...scanNuxtCss(root))
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  return violations
}

/** `css:` may only name bare package specifiers; a path means our own stylesheet. */
function scanNuxtCss(root) {
  const file = join(root, 'nuxt.config.ts')
  let source
  try {
    source = readFileSync(file, 'utf8')
  }
  catch {
    return []
  }
  const block = /\bcss\s*:\s*\[([\s\S]*?)\]/.exec(stripLineComments(source))
  if (!block)
    return []

  const violations = []
  const offset = block.index + block[0].indexOf(block[1])
  for (const match of block[1].matchAll(/['"]([^'"]+)['"]/g)) {
    const spec = match[1]
    if (/^[.~/]/.test(spec) || spec.startsWith('@/')) {
      const { line, text } = locate(source, offset + match.index)
      violations.push({
        file: 'nuxt.config.ts',
        line,
        rule: 'nuxt-css-entry',
        detail: `"${spec}" is not a bare package specifier`,
        text,
      })
    }
  }
  return violations
}

/** Keeps quotes intact (we need the specifiers) but drops commented-out entries. */
function stripLineComments(source) {
  return source.replaceAll(/(^|\n)\s*\/\/[^\n]*/g, match => match.replaceAll(/[^\n]/g, ' '))
}

// ------------------------------------------------------------------ self-test

const CLEAN_FIXTURES = {
  'nuxt.config.ts': `export default defineNuxtConfig({
  css: ['@unocss/reset/tailwind-compat.css', '@talex-touch/tuffex/style.css'],
})
`,
  // Negative controls: utility classes (including \`!important\` variants),
  // prose and comments that merely mention styling.
  'app/Ok.vue': `<script setup lang="ts">
// An inline style would be a violation; saying so in a comment is not.
const label = 'style'
</script>

<template>
  <!-- style="color: red" lives in a comment here, which is not a binding -->
  <TxFormItem class="!items-stretch" label="标题">
    <span class="text-$tx-text-color-primary">{{ label }} 这一段散文里出现 style 这个词</span>
  </TxFormItem>
</template>
`,
  // A markdown seed string is data, not markup.
  'app/data/seed-content.ts': `export const POST = \`模板把 \\\`--tx-ba-max-height\\\` 放进了 :style="unlimited ? 'none' : undefined"，
同时 floating-ui 用 setProperty 写同一个变量；示例里还有一段 <style scoped> 和 Math.random() 的说明。\`
`,
  // Reads are not writes; the smoke tests need these.
  'app/utils/probe.ts': `export function iconPainted(el: Element): boolean {
  const computed = getComputedStyle(el)
  const variable = (el as HTMLElement).style.getPropertyValue('--tx-avatar-bg')
  return computed.maskImage !== 'none' || variable !== ''
}
`,
  // Vendor payloads are out of scope even when they sit under the scanned root.
  'node_modules/@vendor/ui/Bad.vue': `<template><div :style="{ color: 'red' }" /></template>
<style>.x { color: red }</style>
`,
  'node_modules/@vendor/ui/vendor.css': `.x { color: red }
`,
}

const DIRTY_FIXTURES = [
  {
    name: 'a <style> block in an SFC',
    rule: 'vue-style-block',
    path: 'app/Bad.vue',
    content: `<template><div class="x" /></template>

<style scoped>
.x { color: red; }
</style>
`,
  },
  {
    name: 'a :style binding in a template',
    rule: 'inline-style-binding',
    path: 'app/BadBind.vue',
    content: `<script setup lang="ts">
const x = { color: 'red' }
</script>

<template><div :style="x" /></template>
`,
  },
  {
    name: 'a plain style attribute in a template',
    rule: 'inline-style-binding',
    path: 'app/BadAttr.vue',
    content: `<template><div style="color: red" /></template>
`,
  },
  {
    name: 'a JS inline-style write',
    rule: 'inline-style-binding',
    path: 'app/write.ts',
    content: `export function paint(el: HTMLElement): void {
  el.style.color = 'red'
}
`,
  },
  {
    name: 'a setProperty write',
    rule: 'inline-style-binding',
    path: 'app/set.ts',
    content: `export function paint(el: HTMLElement): void {
  el.style.setProperty('--x', '1px')
}
`,
  },
  {
    name: 'a project-authored stylesheet',
    rule: 'stylesheet-file',
    path: 'app/foo.css',
    content: `.x { color: red }
`,
  },
  {
    name: 'a relative nuxt.config css entry',
    rule: 'nuxt-css-entry',
    path: 'nuxt.config.ts',
    content: `export default defineNuxtConfig({
  css: ['@unocss/reset/tailwind-compat.css', './app/assets/forum.css'],
})
`,
  },
  {
    name: 'Math.random under app/',
    rule: 'math-random',
    path: 'app/rand.ts',
    content: `export const pick = (): number => Math.random()
`,
  },
]

function writeFixtures(root, extra) {
  for (const [path, content] of Object.entries({ ...CLEAN_FIXTURES, ...extra })) {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
}

function runSelf(root) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, '--root', root], { encoding: 'utf8' })
  return { code: result.status, output: `${result.stdout}${result.stderr}` }
}

function selfTest() {
  const base = mkdtempSync(join(tmpdir(), 'tuff-forum-style-guard-'))
  const failures = []
  try {
    const cleanRoot = join(base, 'clean')
    writeFixtures(cleanRoot, {})
    const clean = runSelf(cleanRoot)
    if (clean.code !== 0)
      failures.push(`the clean fixture must pass, got exit ${clean.code}:\n${clean.output}`)
    else console.log('✓ negative controls (utility class, markdown seed, comment, computed-style read, node_modules) stay clean')

    for (const fixture of DIRTY_FIXTURES) {
      const root = join(base, fixture.rule + fixture.path.replaceAll(/\W/g, '_'))
      writeFixtures(root, { [fixture.path]: fixture.content })
      const run = runSelf(root)
      if (run.code === 0) {
        failures.push(`${fixture.name} (${fixture.rule}) did not fail the scan`)
        continue
      }
      if (!run.output.includes(fixture.rule)) {
        failures.push(`${fixture.name} failed, but the report never names "${fixture.rule}":\n${run.output}`)
        continue
      }
      if (!run.output.includes(fixture.path)) {
        failures.push(`${fixture.name} failed, but the report never names "${fixture.path}":\n${run.output}`)
        continue
      }
      console.log(`✓ ${fixture.rule.padEnd(20)} fails on ${fixture.name}`)
    }
  }
  finally {
    rmSync(base, { recursive: true, force: true })
  }

  if (failures.length) {
    console.error(`\ncheck-styles --self-test FAILED (${failures.length}):`)
    for (const failure of failures)
      console.error(`  - ${failure}`)
    process.exit(1)
  }
  console.log(`\nself-test passed: ${DIRTY_FIXTURES.length} rules fail on a break, ${Object.keys(CLEAN_FIXTURES).length} negative controls stay clean`)
}

// ----------------------------------------------------------------------- main

const args = process.argv.slice(2)
if (args.includes('--self-test')) {
  selfTest()
}
else {
  const rootArgIndex = args.indexOf('--root')
  const root = resolve(rootArgIndex === -1 ? PROJECT_ROOT : args[rootArgIndex + 1])
  const violations = scan(root)

  if (violations.length) {
    console.error(`check-styles: ${violations.length} violation(s) in ${root}`)
    for (const violation of violations)
      console.error(`  ${violation.file}:${violation.line} — ${violation.rule} — ${violation.detail}${violation.text ? `\n      ${violation.text}` : ''}`)
    console.error('\nR2: this project ships no custom styling. Use tuffex props/slots and UnoCSS utility classes.')
    process.exit(1)
  }
  console.log(`check-styles: clean (${collect(root).length} files scanned in ${relative(process.cwd(), root) || '.'})`)
}
