import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The escaping lives in pure functions (shared/post-markdown.ts, shared/forum-api.ts) that have their own
 * tests, and PostEditor and the pages using it are mounted in post-editor*.test.ts; this file holds the rest
 * of the pages and components to calling them by reading the source, so dropping one of these calls fails
 * here instead of reaching a guest's post.
 */
function source(path: string): string {
  return readFileSync(new URL(`../app/${path}`, import.meta.url), 'utf8')
}

describe('post bodies are written in PostEditor and shown through ForumMarkdown', () => {
  it('the new-topic page, the reply drawer and the edit form all use PostEditor', () => {
    for (const path of ['pages/new.vue', 'components/ReplyComposer.vue', 'components/PostCard.vue']) {
      const file = source(path)
      expect(file, path).toMatch(/<PostEditor\b/)
      expect(file, path).not.toMatch(/TxMarkdownEditor/)
    }
  })

  it('PostEditor previews through ForumMarkdown, never TxMarkdownView or another renderer directly', () => {
    const editor = source('components/PostEditor.vue')
    expect(editor).toMatch(/<ForumMarkdown [^>]*:content="content"/)
    expect(editor).not.toMatch(/TxMarkdownView|TxMarkdownEditor|marked|v-html/)
  })

  it('ForumMarkdown hands TxMarkdownView only renderableMarkdown of the text', () => {
    const view = source('components/ForumMarkdown.vue')
    expect(view).toMatch(/const safe = computed\(\(\) => renderableMarkdown\(props\.content\)\)/)
    expect(view).toMatch(/<TxMarkdownView :content="safe" \/>/)
  })

  it('PostCard edits the post as written and saves the draft', () => {
    const card = source('components/PostCard.vue')
    expect(card).toMatch(/^\s*draft\.value = props\.post\.content$/m)
    expect(card).toMatch(/actions\.editPost\(props\.post\.id, draft\.value\)/)
  })
})

describe('profile pages go through the shared checks', () => {
  it('the profile links the website only through linkableWebsite, for the href and for window.open', () => {
    const profile = source('pages/u/[username]/index.vue')
    expect(profile).toMatch(/const website = computed\(\(\) => linkableWebsite\(profile\.value\?\.website\)\)/)
    expect(profile).toMatch(/if \(linkableWebsite\(href\)\)\s+window\.open\(href/)
    expect(profile).toMatch(/:href="website"/)
    expect(profile).not.toMatch(/:href="profile\.website"/)
  })

  it('the preferences page checks and sends the profile through profileProblem and profileBody', () => {
    const preferences = source('pages/u/[username]/preferences.vue')
    expect(preferences).toMatch(/profileProblem\(draft, current\.displayName\)/)
    expect(preferences).toMatch(/\.\.\.profileBody\(draft, current\.displayName\)/)
    // The old save wrote the trimmed draft name every time; the avatar preview's `draft.displayName || …` is fine.
    expect(preferences).not.toMatch(/displayName: draft\.displayName\.trim\(\)/)
  })
})
