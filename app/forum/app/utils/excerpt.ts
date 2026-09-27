/**
 * One line of plain text from a Markdown post body, for the summary Discourse
 * shows under a pinned topic and for search hits.
 *
 * Deliberately lossy: code blocks disappear entirely, link text survives
 * without its target, and everything collapses onto one line.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function postExcerpt(markdown: string, maxLength = 120): string {
  const text = plainText(markdown)
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

/**
 * A post's one-line text, wherever it came from (#156): the server cuts an
 * `excerpt` for lists (where it no longer sends `content`) and sends `content`
 * on the topic page and in the answers to writes that changed a body. Either
 * way the caller wants a line, not a body: prefer the server's `excerpt`
 * when it is there, otherwise cut one from the body.
 *
 * Not to be confused with `content`: a post the server never sent a body for
 * has an empty `content` but a real `excerpt`, and reading `content` there
 * would show nothing.
 */
export function postLine(post: { content?: string, excerpt?: string }, maxLength = 120): string {
  if (post.excerpt !== undefined && post.excerpt !== '')
    return post.excerpt
  return postExcerpt(post.content ?? '', maxLength)
}

/**
 * An excerpt centred on where `query` matches, so a hit halfway down a long
 * post is actually visible. Falls back to the leading excerpt when the query
 * only matched something the plain-text pass stripped (a code fence, say).
 */
export function matchExcerpt(markdown: string, query: string, maxLength = 120): string {
  const text = plainText(markdown)
  const needle = query.trim().toLowerCase()
  const at = needle ? text.toLowerCase().indexOf(needle) : -1
  if (at < 0 || text.length <= maxLength)
    return postExcerpt(markdown, maxLength)

  const start = Math.max(0, at - Math.floor((maxLength - needle.length) / 2))
  const end = Math.min(text.length, start + maxLength)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}
