import type { Component, ObjectDirective } from 'vue'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'

/**
 * The forum's vitest runs in node, with no DOM library and no Vue plugin (the
 * toolchain's package.json is upstream's). To test what a component does, this
 * compiles one of the app's single-file components with Vue's own compiler,
 * hands it Vue's APIs the way Nuxt auto-imports them, and mounts it on a small
 * in-memory tree instead of a document: enough to click, type and read what
 * the template shows. Layout and CSS stay with the browser checks.
 */

/** One node of the in-memory tree: an element, `#text` or `#comment`. */
export interface TestNode {
  tag: string
  text: string
  props: Record<string, unknown>
  children: TestNode[]
  parent: TestNode | null
  /** Set by `v-show`. */
  hidden: boolean
}

function createNode(tag: string, text = ''): TestNode {
  return { tag, text, props: {}, children: [], parent: null, hidden: false }
}

function detach(child: TestNode) {
  const parent = child.parent
  if (!parent)
    return
  parent.children.splice(parent.children.indexOf(child), 1)
  child.parent = null
}

const renderer = Vue.createRenderer<TestNode, TestNode>({
  createElement: tag => createNode(tag),
  createText: text => createNode('#text', text),
  createComment: text => createNode('#comment', text),
  setText: (node, text) => {
    node.text = text
  },
  setElementText: (element, text) => {
    for (const child of [...element.children])
      detach(child)
    if (text) {
      const child = createNode('#text', text)
      child.parent = element
      element.children.push(child)
    }
  },
  insert: (child, parent, anchor) => {
    detach(child)
    const at = anchor ? parent.children.indexOf(anchor) : -1
    if (at < 0)
      parent.children.push(child)
    else
      parent.children.splice(at, 0, child)
    child.parent = parent
  },
  remove: detach,
  parentNode: node => node.parent,
  nextSibling: (node) => {
    const siblings = node.parent?.children ?? []
    return siblings[siblings.indexOf(node) + 1] ?? null
  },
  patchProp: (element, key, _previous, next) => {
    if (next === null || next === undefined)
      Reflect.deleteProperty(element.props, key)
    else
      element.props[key] = next
  },
})

/** Vue's `v-show` writes `el.style`; on this tree it flips `hidden`. */
const vShow: ObjectDirective<TestNode, unknown> = {
  beforeMount: (element, { value }) => {
    element.hidden = !value
  },
  updated: (element, { value }) => {
    element.hidden = !value
  },
}

const vue: Record<string, unknown> = { ...Vue, vShow }
const VUE_AUTO_IMPORTS = Object.keys(vue).filter(name => /^[a-z_$][\w$]*$/i.test(name) && name !== 'default')

export interface LoadOptions {
  /** Modules the component imports, by the specifier it uses. `vue` is always there. */
  imports?: Record<string, unknown>
  /** Nuxt auto-imports other than Vue's own: composables, `useHead`, … */
  globals?: Record<string, unknown>
}

/** Compiles `app/<path>` into a component object, as Nuxt would build it. */
export function loadComponent(path: string, { imports = {}, globals = {} }: LoadOptions = {}): Component {
  const file = new URL(`../../app/${path}`, import.meta.url)
  const { descriptor, errors } = parse(readFileSync(file, 'utf8'), { filename: file.pathname })
  if (errors.length)
    throw errors[0]
  const { content } = compileScript(descriptor, { id: path, inlineTemplate: true })
  const js = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText

  const modules: Record<string, unknown> = { vue, ...imports }
  const requireModule = (specifier: string) => {
    if (!(specifier in modules))
      throw new Error(`${path} imports ${specifier}; pass it in loadComponent's imports`)
    return modules[specifier]
  }
  const scope = { ...Object.fromEntries(VUE_AUTO_IMPORTS.map(name => [name, vue[name]])), ...globals }
  const exports: { default?: Component } = {}
  // Evaluating the compiler's output is the point of this loader.
  new Function('require', 'exports', ...Object.keys(scope), js)(requireModule, exports, ...Object.values(scope))
  if (!exports.default)
    throw new Error(`${path} compiled to no component`)
  return exports.default
}

export interface Mounted {
  root: TestNode
  unmount: () => void
}

/** Mounts `component` with `props`; `components` stand in for globally registered ones (Tuffex, other app components). */
export function mount(component: Component, props: Record<string, unknown> = {}, components: Record<string, Component> = {}): Mounted {
  const root = createNode('#root')
  const app = renderer.createApp(component, props)
  for (const [name, definition] of Object.entries(components))
    app.component(name, definition)
  app.mount(root)
  return { root, unmount: () => app.unmount() }
}

/** Every element under `node` (itself included) that `match` accepts, in document order. */
export function findAll(node: TestNode, match: (node: TestNode) => boolean): TestNode[] {
  const found = match(node) ? [node] : []
  for (const child of node.children)
    found.push(...findAll(child, match))
  return found
}

export function find(node: TestNode, match: (node: TestNode) => boolean): TestNode | undefined {
  return findAll(node, match)[0]
}

/** False when `v-show` hides the node or one of its ancestors. */
export function isShown(node: TestNode): boolean {
  for (let current: TestNode | null = node; current; current = current.parent) {
    if (current.hidden)
      return false
  }
  return true
}

/** The text a reader sees under `node`, whitespace collapsed. */
export function textOf(node: TestNode): string {
  const parts = findAll(node, child => child.tag === '#text').map(child => child.text)
  return parts.join('').replace(/\s+/g, ' ').trim()
}
