import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The escaping lives in pure functions (shared/post-markdown.ts, shared/forum-api.ts) that have their own
 * tests; this file holds the pages and components to calling them. The forum toolchain has no DOM to mount
 * a component in, so it reads the source: putting `post.content` back into the editor, or dropping one of
 * these calls, fails here instead of reaching a guest's post.
 */
function source(path: string): string {
  return readFileSync(new URL(`../app/${path}`, import.meta.url), 'utf8')
}

describe('someone else\'s text reaches the editor only through the escaping helpers', () => {
  it('PostCard edits through editDraft and saves fromEditor of the draft', () => {
    const card = source('components/PostCard.vue')
    expect(card).toMatch(/draft\.value = editDraft\(props\.post\)/)
    expect(card).toMatch(/actions\.editPost\(props\.post\.id, fromEditor\(draft\.value\)\)/)
    expect(card).not.toMatch(/draft\.value = props\.post\.content/)
  })

  it('ReplyComposer prefills quoteDraft and sends fromEditor of the draft', () => {
    const composer = source('components/ReplyComposer.vue')
    expect(composer).toMatch(/content\.value = props\.replyTo \? quoteDraft\(props\.replyTo\) : ''/)
    expect(composer).toMatch(/const text = computed\(\(\) => fromEditor\(content\.value\)\.trim\(\)\)/)
    expect(composer).toMatch(/const body = text\.value/)
    expect(composer).not.toMatch(/postExcerpt\(/)
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
