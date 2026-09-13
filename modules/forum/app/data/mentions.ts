/**
 * `@username` tokens in Markdown. One definition for the seed, the store and
 * the tests, so all three agree on what counts as a mention.
 *
 * Not a mention: anything inside a code span or fence (`@click`, a Vue
 * directive), the scope of a package name (`@talex-touch/tuffex`), a version
 * pin (`tuffex@0.5.0`), or the domain of an email address.
 */
const MENTION_PATTERN = /(?<![\w@/.-])@([a-z0-9_-]+)(?![\w/@-])/gi
const FENCED_CODE = /(```|~~~)[\s\S]*?\1/g
const INLINE_CODE = /`[^`\n]*`/g

/** Lower-cased handles in order of appearance, duplicates removed. */
export function extractMentions(content: string): string[] {
  const prose = content.replace(FENCED_CODE, ' ').replace(INLINE_CODE, ' ')
  const handles = new Set<string>()
  for (const match of prose.matchAll(MENTION_PATTERN))
    handles.add((match[1] ?? '').toLowerCase())
  return [...handles]
}
