export interface HighlightPart {
  text: string
  /** True for the segments that matched the query. */
  hit: boolean
}

/**
 * Splits text into alternating plain and matched segments so a template can
 * wrap the matches in `<mark>` without `v-html`. Case-insensitive; the
 * original casing of the text is preserved in every segment.
 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const needle = query.trim().toLowerCase()
  if (!needle)
    return [{ text, hit: false }]

  const haystack = text.toLowerCase()
  const parts: HighlightPart[] = []
  let cursor = 0
  for (;;) {
    const at = haystack.indexOf(needle, cursor)
    if (at < 0)
      break
    if (at > cursor)
      parts.push({ text: text.slice(cursor, at), hit: false })
    parts.push({ text: text.slice(at, at + needle.length), hit: true })
    cursor = at + needle.length
  }
  if (cursor < text.length)
    parts.push({ text: text.slice(cursor), hit: false })
  return parts
}
