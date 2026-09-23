import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CREW, DEPARTMENT_ID_PATTERN, DEPARTMENTS, FORUM_CAPABILITIES, TITLES, TONES } from '../app/data/titles'

// The forum keeps its own copy of the server catalogue because it must not
// import core code at runtime. This test reads the real server file as text
// and fails when the two drift. It does not import the server module: the
// forum toolchain (Node 26, its own tsconfig) never compiles app/server.
const serverFile = fileURLToPath(new URL('../../server/src/lib/roles.ts', import.meta.url))
const source = readFileSync(serverFile, 'utf8')

function block(name: string): string {
  const start = source.indexOf(`export const ${name}`)
  expect(start, `server roles.ts no longer exports ${name}`).toBeGreaterThanOrEqual(0)
  const open = source.indexOf('=', start)
  let depth = 0
  for (let index = open; index < source.length; index++) {
    const char = source[index]
    if (char === '{' || char === '[') depth++
    else if (char === '}' || char === ']') {
      depth--
      if (depth === 0) return source.slice(open + 1, index + 1)
    }
  }
  throw new Error(`unterminated ${name} in server roles.ts`)
}

describe('forum titles match app/server/src/lib/roles.ts', () => {
  it('uses the same tone palette', () => {
    const serverTones = Object.fromEntries([...block('TONES').matchAll(/(\w+):\s*"(#[0-9A-Fa-f]{6})"/g)].map(match => [match[1], match[2]]))
    expect(serverTones).toEqual(TONES)
  })

  it('uses the same title labels, tags, icons, tones and ranks', () => {
    const titles = block('TITLES')
    for (const [id, title] of Object.entries(TITLES)) {
      const row = new RegExp(`${id}:\\s*\\{[^}]*label:\\s*"([^"]+)"[^}]*tag:\\s*"([^"]+)"[^}]*icon:\\s*"([^"]+)"[^}]*tone:\\s*"([^"]+)"[^}]*rank:\\s*(\\d+)`).exec(titles)
      expect(row, `server TITLES has no ${id}`).not.toBeNull()
      expect({ label: row![1], tag: row![2], icon: `i-carbon-${row![3]}`, tone: row![4], rank: Number(row![5]) })
        .toEqual({ label: title.label, tag: title.tag, icon: title.icon, tone: title.tone, rank: title.rank })
    }
  })

  it('uses the same crew look and department id pattern', () => {
    const crew = /CREW_TITLE\s*=\s*\{\s*tag:\s*"([^"]+)",\s*tone:\s*"([^"]+)"[^,]*,\s*rank:\s*(\d+)/.exec(source)
    expect(crew).not.toBeNull()
    expect({ tag: crew![1], tone: crew![2], rank: Number(crew![3]) }).toEqual({ tag: CREW.tag, tone: CREW.tone, rank: CREW.rank })
    expect(/DEPARTMENT_ID_PATTERN\s*=\s*"([^"]+)"/.exec(source)?.[1]).toBe(DEPARTMENT_ID_PATTERN)
  })

  it('lists the same forum capabilities in the same order', () => {
    const ids = [...block('CAPABILITIES').matchAll(/id:\s*"(forum\.[\w.]+)"/g)].map(match => match[1])
    expect(ids).toEqual([...FORUM_CAPABILITIES])
  })

  it('copies the forum part of every default department pack', () => {
    const departments = block('DEFAULT_DEPARTMENTS')
    const field = (entry: string, pattern: RegExp): string => {
      const value = pattern.exec(entry)?.[1]
      if (value === undefined) throw new Error(`server department entry lacks ${pattern}: ${entry.slice(0, 80)}`)
      return value
    }
    const forumOnly = (list: string) => [...list.matchAll(/"(forum\.[\w.]+)"/g)].map(match => match[1])
    const entries = departments.split(/\n\s*\{\n/).slice(1)
    expect(entries).toHaveLength(DEPARTMENTS.length)
    for (const entry of entries) {
      const id = field(entry, /id:\s*"([^"]+)"/)
      const forum = DEPARTMENTS.find(department => department.id === id)
      expect(forum, `forum has no department ${id}`).toBeDefined()
      expect({
        name: field(entry, /name:\s*"([^"]+)"/),
        tag: field(entry, /tag:\s*"([^"]+)"/),
        icon: `i-carbon-${field(entry, /icon:\s*"([^"]+)"/)}`,
        tone: field(entry, /tone:\s*"([^"]+)"/),
        headForum: forumOnly(field(entry, /head_capabilities:\s*\[([^\]]*)\]/)),
        crewForum: forumOnly(field(entry, /member_capabilities:\s*\[([^\]]*)\]/)),
      }).toEqual({ name: forum!.name, tag: forum!.tag, icon: forum!.icon, tone: forum!.tone, headForum: [...forum!.headForum], crewForum: [...forum!.crewForum] })
    }
  })
})
