import { describe, expect, it } from 'vitest'
import { extractMentions } from '~/data/mentions'

describe('extractMentions', () => {
  it('finds handles, lower-cased and de-duplicated, in order', () => {
    expect(extractMentions('@Mika 看看，@talex 和 @mika 也来')).toEqual(['mika', 'talex'])
    expect(extractMentions('（@leon）\n> @kai_1 回复')).toEqual(['leon', 'kai_1'])
  })

  it('ignores code spans and fences', () => {
    expect(extractMentions('SPA 里要用 `@click`，不是 @talex 说的那样')).toEqual(['talex'])
    expect(extractMentions('~~~vue\n<TxButton @click="go" />\n~~~\n\n@mika 看看')).toEqual(['mika'])
    expect(extractMentions('```\n@ryan inside fence\n```')).toEqual([])
  })

  it('ignores package scopes, version pins and email domains', () => {
    expect(extractMentions('`@talex-touch/tuffex@0.5.0` 已经发布')).toEqual([])
    expect(extractMentions('用 @talex-touch/tuffex 的 TxButton')).toEqual([])
    expect(extractMentions('pnpm add @talex-touch/tuffex')).toEqual([])
    expect(extractMentions('mail me at someone@example.com')).toEqual([])
    expect(extractMentions('tuffex@0.5.0 和 @talex')).toEqual(['talex'])
  })

  it('returns nothing for text without mentions', () => {
    expect(extractMentions('没有提及任何人')).toEqual([])
    expect(extractMentions('')).toEqual([])
  })
})
