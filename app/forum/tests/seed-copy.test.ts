import { describe, expect, it } from 'vitest'
import { CATEGORY_SEEDS, REPLY_SNIPPETS, TOPIC_SEEDS, USER_SEEDS } from '~/data/seed-content'

// The owner bans decorative arrow characters in anything the forum renders;
// seed prose says "先是…然后…" instead. Arrows, Supplemental Arrows-A and -B.
const ARROWS = /[←-⇿⟰-⟿⤀-⥿]/

describe('seed copy', () => {
  it('has no arrow characters in any rendered seed text', () => {
    const texts = [
      ...TOPIC_SEEDS.flatMap(topic => [topic.title, topic.body]),
      ...REPLY_SNIPPETS,
      ...CATEGORY_SEEDS.flatMap(category => [category.name, category.description]),
      ...USER_SEEDS.flatMap(user => [user.displayName, user.bio]),
    ]
    expect(texts.filter(text => ARROWS.test(text))).toEqual([])
  })
})
