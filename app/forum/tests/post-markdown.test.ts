import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { isUnsafeDestination, renderableMarkdown, WORD_JOINER } from '../shared/post-markdown'

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
]

describe('raw HTML in a post is shown as text', () => {
  it.each(ATTACKS)('%j renders no tag and no event handler', (source) => {
    const out = html(source)
    expect(out).not.toMatch(FORBIDDEN_TAG)
    // Handler text may survive as visible text (&lt;span onclick=…); never inside a real tag.
    expect(out).not.toMatch(/<[a-z][^>]*\son\w+=/i)
    expect(out).not.toMatch(/<[a-z][^>]*\sstyle=/i)
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
