import type { StickerLookup } from '~/editor/inline-stickers'
import type { Node, NodeType } from '@milkdown/kit/prose/model'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import { describe, expect, it } from 'vitest'
import { inlineStickers } from '~/editor/inline-stickers'

/**
 * Stickers stay in the line (#276, Bilibili's comment box): a picture block
 * holding a sticker and a typed `[包名_名字]` both become an inline image.
 * The schema is the few nodes Crepe has that matter here.
 */
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    code_block: { group: 'block', content: 'text*', code: true },
    'image-block': { group: 'block', atom: true, attrs: { src: { default: '' }, caption: { default: '' }, ratio: { default: 1 } } },
    text: { group: 'inline' },
    image: { group: 'inline', inline: true, atom: true, attrs: { src: { default: '' }, alt: { default: '' }, title: { default: '' } } },
  },
  marks: { inlineCode: { code: true } },
})
const WAVE = `/api/forum/stickers/${'a'.repeat(64)}.webp`
const find: StickerLookup = key => ('src' in key ? key.src === WAVE : key.token === '[极客娘_打招呼]') ? { src: WAVE, label: '打招呼' } : undefined
const { doc, paragraph, code_block: codeBlock, image } = schema.nodes as Record<'doc' | 'paragraph' | 'code_block' | 'image', NodeType>
const block = schema.nodes['image-block']!
const run = (...blocks: Node[]) => inlineStickers(EditorState.create({ schema, doc: doc.create(null, blocks) }), find)?.doc.toJSON()

describe('stickers in the post editor', () => {
  it('turns a picture block holding a sticker into a paragraph with the sticker in the line', () => {
    expect(run(block.create({ src: WAVE, ratio: 1 }))).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: WAVE, alt: '打招呼', title: '' } }] }],
    })
  })

  it('turns [极客娘_打招呼] typed between words into the sticker', () => {
    const out = run(paragraph.create(null, schema.text('早[极客娘_打招呼]好 [极客娘_没有]')))
    expect(out.content[0].content).toEqual([
      { type: 'text', text: '早' },
      { type: 'image', attrs: { src: WAVE, alt: '打招呼', title: '' } },
      { type: 'text', text: '好 [极客娘_没有]' },
    ])
  })

  it('treats a picture block on the controlled CDN the same way (#286), and not one on another domain', () => {
    const cdn = `https://cdn.crosery.com/yzgc/static/site/forum/stickers/${'a'.repeat(64)}.webp`
    const findCdn: StickerLookup = key => ('src' in key ? key.src === cdn : false) ? { src: cdn, label: '打招呼' } : undefined
    const inline = (...blocks: Node[]) => inlineStickers(EditorState.create({ schema, doc: doc.create(null, blocks) }), findCdn)?.doc.toJSON()
    expect(inline(block.create({ src: cdn, ratio: 1 }))).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: cdn, alt: '打招呼', title: '' } }] }],
    })
    for (const src of [`https://evil.example/yzgc/static/site/forum/stickers/${'a'.repeat(64)}.webp`, `https://cdn.crosery.com/yzgc/static/site/forum/guides/${'a'.repeat(64)}.webp`, `https://cdn.crosery.com/yzgc/static/site/forum/stickers/../x/${'a'.repeat(64)}.webp`])
      expect(inline(block.create({ src }))).toBeUndefined()
  })

  it('leaves other pictures, code and unknown names alone', () => {
    expect(run(block.create({ src: '/api/forum/uploads/b.png' }))).toBeUndefined()
    expect(run(codeBlock.create(null, schema.text('[极客娘_打招呼]')))).toBeUndefined()
    expect(run(paragraph.create(null, schema.text('[极客娘_打招呼]', [schema.marks.inlineCode!.create()])))).toBeUndefined()
    expect(run(paragraph.create(null, [schema.text('早 '), image.create({ src: WAVE, alt: '打招呼' })]))).toBeUndefined()
  })
})
