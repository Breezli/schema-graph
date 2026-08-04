import { describe, expect, it } from 'vitest'

import {
  alignPrismaFieldsForTab,
  type PrismaFieldAlignmentEdit,
  type PrismaFieldAlignmentRequest,
} from './prisma-field-alignment'

function run(
  textWithCursor: string,
  options: Partial<Omit<PrismaFieldAlignmentRequest, 'text' | 'cursor'>> = {},
) {
  const cursor = textWithCursor.indexOf('|')
  if (cursor < 0) throw new Error('Test input needs a | cursor marker')
  const text = textWithCursor.slice(0, cursor) + textWithCursor.slice(cursor + 1)
  return alignPrismaFieldsForTab({
    text,
    cursor,
    lineEnding: '\n',
    ...options,
  })
}

function apply(textWithCursor: string, lineEnding: '\n' | '\r\n' = '\n') {
  const cursor = textWithCursor.indexOf('|')
  const text = textWithCursor.slice(0, cursor) + textWithCursor.slice(cursor + 1)
  const result = alignPrismaFieldsForTab({ text, cursor, lineEnding })
  expect(result.kind).toBe('edit')
  const edit = result as PrismaFieldAlignmentEdit
  const updated =
    text.slice(0, edit.replacementRange.startOffset) +
    edit.replacementText +
    text.slice(edit.replacementRange.endOffset)
  return { edit, updated }
}

describe('alignPrismaFieldsForTab', () => {
  it('advances from a name to the aligned type column', () => {
    const { edit, updated } = apply(`model User {
  id String @id
  displayName| String
}`)

    expect(updated).toBe(`model User {
  id          String @id
  displayName String
}`)
    expect(edit.columns).toEqual({ name: 3, type: 15, attributes: 22 })
    expect(edit.cursor).toEqual({ line: 3, column: 15 })
    expect(edit.declaration).toEqual({ kind: 'model', name: 'User' })
  })

  it('advances from a type to the aligned attribute column', () => {
    const { edit, updated } = apply(`view Report {
  id Int @unique
  ownerIdentifier String|
}`)

    expect(updated).toBe(`view Report {
  id              Int    @unique
  ownerIdentifier String 
}`)
    expect(edit.cursor).toEqual({ line: 3, column: 26 })
  })

  it('uses the longest sibling name and type widths', () => {
    const { updated } = apply(`type Address {
  x Int @map("x")
  unusuallyLongField Decimal|
  zip String
}`)

    expect(updated).toBe(`type Address {
  x                  Int     @map("x")
  unusuallyLongField Decimal 
  zip                String
}`)
  })

  it('handles incomplete rows and irregular spacing', () => {
    const { edit, updated } = apply(`model Post {
 title|
    publishedAt       DateTime
  slug   String   @unique
}`)

    expect(updated).toBe(`model Post {
  title       
  publishedAt DateTime
  slug        String   @unique
}`)
    expect(edit.cursor).toEqual({ line: 2, column: 15 })
  })

  it('leaves blank, doc-comment, line-comment, and block-attribute lines intact', () => {
    const { updated } = apply(`model User {
  /// Primary identifier
  id Int @id

  // Kept exactly
  name| String
  @@map("users")
}`)

    expect(updated).toBe(`model User {
  /// Primary identifier
  id   Int    @id

  // Kept exactly
  name String
  @@map("users")
}`)
  })

  it('preserves CRLF line endings and reports line/column cursor positions', () => {
    const input = 'model User {\r\n  id Int @id\r\n  longer| String\r\n}\r\n'
    const { edit, updated } = apply(input, '\r\n')

    expect(updated).toBe(
      'model User {\r\n  id     Int    @id\r\n  longer String\r\n}\r\n',
    )
    expect(edit.cursor).toEqual({ line: 3, column: 10 })
    expect(edit.replacementText).toContain('\r\n')
    expect(edit.replacementText).not.toMatch(/(^|[^\r])\n/)
  })

  it('preserves multiline comments and continuations with CRLF', () => {
    const input =
      'model User {\r\n  id Int @id\r\n  /*\r\n  fakeField ExtremelyLongType\r\n  */\r\n  name String @default(\r\n    "kept"\r\n  )\r\n  longerName| String\r\n}\r\n'
    const { edit, updated } = apply(input, '\r\n')

    expect(updated).toBe(
      'model User {\r\n  id         Int    @id\r\n  /*\r\n  fakeField ExtremelyLongType\r\n  */\r\n  name       String @default(\r\n    "kept"\r\n  )\r\n  longerName String\r\n}\r\n',
    )
    expect(edit.replacementText).not.toMatch(/(^|[^\r])\n/)
  })

  it('ignores braces in strings and comments when locating the block', () => {
    const { updated } = apply(`model Config {
  id String @default("}")
  // } enum Fake { value String }
  payload| Json @default("{still here}")
}

enum Role {
  USER
}`)

    expect(updated).toContain('  id      String @default("}")')
    expect(updated).toContain('  payload Json   @default("{still here}")')
  })

  it('keeps nested function and array attribute remainders unchanged', () => {
    const remainder =
      '@default(dbgenerated("concat(\'a b\', json_build_array(1, 2))")) // keep { }'
    const { updated } = apply(`model Event {
  id Int @id
  description String| ${remainder}
}`)

    expect(updated).toBe(`model Event {
  id          Int    @id
  description String ${remainder}
}`)
  })

  it('preserves real nested array and function arguments in attributes', () => {
    const remainder =
      '@relation(fields: [authorId, tenantId], references: [id, tenantId], map: "author link") // exact'
    const { updated } = apply(`model Post {
  id Int @id
  authorId Int
  author User| ${remainder}
}`)

    expect(updated).toBe(`model Post {
  id       Int  @id
  authorId Int
  author   User ${remainder}
}`)
  })

  it('preserves multiline block comments with identifier-looking lines', () => {
    const { updated } = apply(`model User {
  id Int @id
  /* keep this block byte-for-byte
  identifierLooking SuperLongType @default("not a field")
    anotherIdentifier Json
  */
  displayName| String
}`)

    expect(updated).toBe(`model User {
  id          Int    @id
  /* keep this block byte-for-byte
  identifierLooking SuperLongType @default("not a field")
    anotherIdentifier Json
  */
  displayName String
}`)
  })

  it('preserves multiline defaults, relations, arrays, and block indexes', () => {
    const { edit, updated } = apply(`model Post {
  id Int @id
  title String @default(
    dbgenerated(
      "concat('a', 'b')"
    )
  )
  author User @relation(
    fields: [authorId],
    references: [id],
    map: "post author"
  )
  authorId Int
  @@index([
    authorId,
    title,
  ])
  displayName| String
}`)

    expect(updated).toBe(`model Post {
  id          Int    @id
  title       String @default(
    dbgenerated(
      "concat('a', 'b')"
    )
  )
  author      User   @relation(
    fields: [authorId],
    references: [id],
    map: "post author"
  )
  authorId    Int
  @@index([
    authorId,
    title,
  ])
  displayName String
}`)
    expect(edit.cursor).toEqual({ line: 18, column: 15 })
  })

  it('ignores nested continuation braces, strings, and comments', () => {
    const { updated } = apply(`model Event {
  id Int @id
  payload Json @default(
    {
      delimiters: "})] /* still a string */",
      nested: build(
        ["{", "]"],
        /*
        identifierLooking ImpossiblyLongType
        braces: { call: "not code" }
        */
        { value: "safe" },
      ),
    }
  )
  note String @default("first line
identifierLookingOutsideIndent SuperLongType { [ (
last line")
  recordedAt| DateTime
}`)

    expect(updated).toBe(`model Event {
  id         Int      @id
  payload    Json     @default(
    {
      delimiters: "})] /* still a string */",
      nested: build(
        ["{", "]"],
        /*
        identifierLooking ImpossiblyLongType
        braces: { call: "not code" }
        */
        { value: "safe" },
      ),
    }
  )
  note       String   @default("first line
identifierLookingOutsideIndent SuperLongType { [ (
last line")
  recordedAt DateTime
}`)
  })

  it('preserves an inline comment on an incomplete field row', () => {
    const { updated } = apply(`model Draft {
  id Int @id
  title| // type pending
}`)

    expect(updated).toBe(`model Draft {
  id    Int @id
  title     // type pending
}`)
  })

  it.each(['enum', 'datasource', 'generator'])(
    'does not align inside %s blocks',
    (kind) => {
      const result = run(`${kind} Example {
  value|
}`)
      expect(result).toEqual({
        kind: 'noop',
        fallback: true,
        reason: 'outside-eligible-declaration',
      })
    },
  )

  it('accepts a one-based line and column cursor and maps the result', () => {
    const text = `model User {
  id Int
  displayName String
}`
    const result = alignPrismaFieldsForTab({
      text,
      cursor: { line: 3, column: 14 },
      lineEnding: '\n',
    })

    expect(result.kind).toBe('edit')
    if (result.kind === 'edit') {
      expect(result.cursor).toEqual({ line: 3, column: 15 })
      const updated =
        text.slice(0, result.replacementRange.startOffset) +
        result.replacementText +
        text.slice(result.replacementRange.endOffset)
      expect(result.cursorOffset).toBe(updated.indexOf('displayName') + 12)
      expect(result.replacementRange.start).toEqual({ line: 2, column: 1 })
      expect(result.replacementRange.end).toEqual({ line: 3, column: 21 })
    }
  })

  it('finds an unclosed eligible declaration at end of file', () => {
    const { edit, updated } = apply(`model Draft {
  id Int
  title|`)

    expect(updated).toBe(`model Draft {
  id    Int
  title `)
    expect(edit.cursor).toEqual({ line: 3, column: 9 })
  })

  it('advances chained calls from type to attributes without realigning again', () => {
    const first = apply(`model User {
  id Int @id
  name| String @unique
}`)
    expect(first.edit.cursor.column).toBe(first.edit.columns.type)

    const secondCursor = first.edit.cursorOffset
    const second = alignPrismaFieldsForTab({
      text: first.updated,
      cursor: secondCursor,
      lineEnding: '\n',
    })

    expect(second.kind).toBe('edit')
    if (second.kind === 'edit') {
      expect(second.cursor).toEqual({
        line: 3,
        column: second.columns.attributes,
      })
      expect(second.changed).toBe(false)
      expect(second.replacementText).toBe(
        first.updated.slice(
          second.replacementRange.startOffset,
          second.replacementRange.endOffset,
        ),
      )
    }
  })

  it('returns fallback no-ops for unsupported invocation states', () => {
    expect(run('model User {\n  |// comment\n}')).toMatchObject({
      kind: 'noop',
      reason: 'ineligible-row',
    })
    expect(run('model User {\n  id Str|ing\n}')).toMatchObject({
      kind: 'noop',
      reason: 'unsupported-cursor-context',
    })
    expect(run('enum Role {\n  USER|\n}')).toMatchObject({
      kind: 'noop',
      reason: 'outside-eligible-declaration',
    })
    expect(
      run('model User {\n  id| Int\n}', {
        cursorCount: 2,
      }),
    ).toMatchObject({ kind: 'noop', reason: 'multiple-cursors' })
    expect(
      run('model User {\n  id| Int\n}', {
        selection: { start: 15, end: 17 },
      }),
    ).toMatchObject({ kind: 'noop', reason: 'nonempty-selection' })
  })
})
