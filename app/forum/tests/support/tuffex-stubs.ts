import type { Component, ComputedRef } from 'vue'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { computed, defineComponent, h, inject, provide } from 'vue'

/**
 * Stand-ins for the Tuffex components the mounted forum components use, on the
 * in-memory tree from ./sfc.ts. Each renders the element a reader or a screen
 * reader meets (textarea, radio buttons, button) and keeps the props the forum
 * passes; the look is Tuffex's business and is checked in a browser.
 */

interface MarkedLike { parse: (source: string) => string }
let marked: MarkedLike | undefined

/**
 * TxMarkdownView renders with `new Marked({ gfm: true, breaks: true })`. The
 * forum does not depend on marked, so load the copy Tuffex ships; call this in
 * `beforeAll` before mounting anything that shows Markdown.
 */
export async function loadMarked(): Promise<MarkedLike> {
  if (!marked) {
    const fromForum = createRequire(import.meta.url)
    const fromTuffex = createRequire(fromForum.resolve('@talex-touch/tuffex/package.json'))
    const module = await import(pathToFileURL(fromTuffex.resolve('marked')).href) as { Marked: new (options: object) => MarkedLike }
    marked = new module.Marked({ gfm: true, breaks: true })
  }
  return marked
}

/** Renders marked's HTML into an `html` prop (DOMPurify, the second layer, needs a browser). */
const TxMarkdownView = defineComponent({
  props: { content: { type: String, required: true } },
  setup(props) {
    return () => {
      if (!marked)
        throw new Error('call loadMarked() in beforeAll first')
      return h('article', { html: marked.parse(props.content) })
    }
  },
})

/** A `<textarea>`; type into it with `node.props.onInput(value)`. */
const TxTextarea = defineComponent({
  props: { modelValue: { type: String, default: '' }, placeholder: { type: String, default: '' } },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('textarea', {
      value: props.modelValue,
      placeholder: props.placeholder,
      onInput: (value: string) => emit('update:modelValue', value),
    })
  },
})

const GROUP = Symbol('radio-group')
interface Group { model: ComputedRef<unknown>, select: (value: unknown) => void }

const TxRadioGroup = defineComponent({
  props: { modelValue: { type: [String, Number], default: undefined } },
  emits: ['update:modelValue'],
  setup(props, { emit, slots }) {
    provide<Group>(GROUP, { model: computed(() => props.modelValue), select: value => emit('update:modelValue', value) })
    return () => h('div', { role: 'radiogroup' }, slots.default?.())
  },
})

/** A `role="radio"` button; choose it with `node.props.onClick()`. */
const TxRadio = defineComponent({
  props: { value: { type: [String, Number], required: true } },
  setup(props, { slots }) {
    const group = inject<Group>(GROUP)
    return () => h('button', {
      'role': 'radio',
      'aria-checked': group?.model.value === props.value,
      'onClick': () => group?.select(props.value),
    }, slots.default?.())
  },
})

const TxButton = defineComponent({
  props: { disabled: Boolean, loading: Boolean },
  emits: ['click'],
  setup(props, { emit, slots }) {
    return () => h('button', { disabled: props.disabled, onClick: () => emit('click') }, slots.default?.())
  },
})

const TxInput = defineComponent({
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('input', { value: props.modelValue, onInput: (value: string) => emit('update:modelValue', value) })
  },
})

const TxSelect = defineComponent({
  props: { modelValue: { type: [String, Number, Array], default: '' } },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('select', { value: props.modelValue, onChange: (value: unknown) => emit('update:modelValue', value) })
  },
})

interface Rule { required?: boolean, validator?: (value: unknown, rule: Rule, model: object) => unknown }

/** Exposes `validate()`, which runs the rules the way TxFormItem does: `required` first, then each validator. */
const TxForm = defineComponent({
  props: { model: { type: Object, required: true }, rules: { type: Object, default: () => ({}) } },
  setup(props, { slots, expose }) {
    const empty = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)
    expose({
      validate: async () => Object.entries(props.rules as Record<string, Rule[]>).every(([field, rules]) => {
        const value = (props.model as Record<string, unknown>)[field]
        return rules.every(rule => !(rule.required && empty(value)) && (!rule.validator || rule.validator(value, rule, props.model) !== false))
      }),
    })
    return () => h('form', null, slots.default?.())
  },
})

/** Layout wrappers: a `div` with every slot in order. */
function container(tag = 'div'): Component {
  return defineComponent({
    setup(_props, { slots }) {
      return () => h(tag, null, Object.values(slots).flatMap(slot => (typeof slot === 'function' ? slot() : [])))
    },
  })
}

export const TUFFEX_STUBS: Record<string, Component> = {
  TxMarkdownView,
  TxTextarea,
  TxRadioGroup,
  TxRadio,
  TxButton,
  TxInput,
  TxFlex: container(),
  TxStack: container(),
  TxCard: container(),
  TxSelect,
  TxForm,
  TxFormItem: container(),
  TxEmptyState: container(),
  TxDrawer: container('section'),
  // The rest of a post card around its edit form; the tests read and press none of them.
  TxTooltip: container(),
  TxAlert: container(),
  TxCellLink: container(),
  TxStatusBadge: container(),
  TxCopyButton: container(),
  TxIconButton: container(),
  TxDropdownMenu: container(),
  TxDropdownItem: container(),
}
