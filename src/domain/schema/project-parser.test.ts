import { describe, expect, it } from 'vitest'

import { LoancrateSchemaParser } from '@/adapters/schema'

import { parseSchemaProject } from './project-parser'
import type { ConfigDeclaration, EnumDeclaration, ModelDeclaration } from './types'
import { createVirtualSchemaFile, serializeVirtualSchemaFile } from './vfs'

const parser = new LoancrateSchemaParser()

const configSource = `
// Shared configuration
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
  schemas = ["base", "shop"]
}

enum Role {
  USER
  ADMIN
  @@schema("base")
}
`

const userSource = `
/// Application user
model User {
  id        Int     @id @default(autoincrement())
  email     String  @unique(map: "users_email_key")
  role      Role    @default(USER)
  posts     Post[]
  managerId Int?
  manager   User?   @relation("Management", fields: [managerId], references: [id], onDelete: SetNull)
  reports   User[]  @relation("Management")

  @@unique([email, role], name: "user_email_role")
  @@index([role(sort: Desc)], type: BTree)
  @@schema("base")
}
`

const postSource = `
model Post {
  id       Int    @id @default(autoincrement())
  authorId Int
  author   User   @relation(fields: [authorId], references: [id], onDelete: Cascade)

  @@schema("shop")
}
`

describe('parseSchemaProject', () => {
  it('merges multi-file symbols and resolves advanced relations', () => {
    const result = parseSchemaProject(
      {
        revision: 7,
        files: [
          createVirtualSchemaFile('schema.prisma', configSource),
          createVirtualSchemaFile('models/user.prisma', userSource),
          createVirtualSchemaFile('models/post.prisma', postSource),
        ],
      },
      parser,
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return

    expect(result.snapshot.revision).toBe(7)
    expect(Object.keys(result.snapshot.files)).toEqual([
      'schema.prisma',
      'models/user.prisma',
      'models/post.prisma',
    ])
    expect(result.snapshot.graph.symbols.User).toHaveLength(1)
    expect(result.snapshot.graph.symbols.Post).toHaveLength(1)
    expect(result.snapshot.graph.symbols.Role).toHaveLength(1)
    expect(result.snapshot.graph.relations).toHaveLength(4)
    expect(result.snapshot.graph.logicalRelations).toHaveLength(2)
    expect(result.snapshot.graph.logicalRelations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({
            modelName: 'Post',
            cardinality: 'many',
          }),
          target: expect.objectContaining({
            modelName: 'User',
            cardinality: 'one',
          }),
          foreignKey: expect.objectContaining({
            fieldNames: ['authorId'],
            referenceNames: ['id'],
          }),
        }),
      ]),
    )
    expect(result.snapshot.graph.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceModelName: 'Post',
          sourceFieldName: 'author',
          targetModelName: 'User',
          fields: ['authorId'],
          references: ['id'],
          onDelete: 'Cascade',
        }),
        expect.objectContaining({
          sourceModelName: 'User',
          sourceFieldName: 'manager',
          name: 'Management',
          sourceCardinality: 'optional',
        }),
      ]),
    )
  })

  it('scopes same-named member IDs to their containing declarations', () => {
    const result = parseSchemaProject(
      {
        revision: 9,
        files: [
          createVirtualSchemaFile(
            'schema.prisma',
            `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
}

enum PostState {
  ACTIVE
}

enum CommentState {
  ACTIVE
}

model User {
  id Int @id
  posts Post[]
  comments Comment[]
}

model Post {
  id Int @id
  authorId Int
  author User @relation(fields: [authorId], references: [id])
}

model Comment {
  id Int @id
  authorId Int
  author User @relation(fields: [authorId], references: [id])
}
`,
          ),
        ],
      },
      parser,
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return

    const declarations = result.snapshot.graph.declarations
    const post = declarations.find(
      (declaration) => declaration.kind === 'model' && declaration.name === 'Post',
    )
    const comment = declarations.find(
      (declaration) => declaration.kind === 'model' && declaration.name === 'Comment',
    )
    if (!post || post.kind !== 'model' || !comment || comment.kind !== 'model') {
      throw new Error('Expected Post and Comment models')
    }

    const postFields = post.members.filter((member) => member.kind === 'field')
    const commentFields = comment.members.filter((member) => member.kind === 'field')
    const postAuthor = postFields.find((field) => field.name === 'author')
    const postAuthorId = postFields.find((field) => field.name === 'authorId')
    const commentAuthor = commentFields.find((field) => field.name === 'author')
    const commentAuthorId = commentFields.find((field) => field.name === 'authorId')
    if (!postAuthor || !postAuthorId || !commentAuthor || !commentAuthorId) {
      throw new Error('Expected relation fields on Post and Comment')
    }
    expect(postAuthor.id).not.toBe(commentAuthor.id)
    expect(postAuthorId.id).not.toBe(commentAuthorId.id)

    const postRelation = result.snapshot.graph.logicalRelations.find(
      (relation) => relation.source.modelName === 'Post',
    )
    const commentRelation = result.snapshot.graph.logicalRelations.find(
      (relation) => relation.source.modelName === 'Comment',
    )
    expect(postRelation?.source.fieldIds).toEqual([postAuthor.id, postAuthorId.id])
    expect(commentRelation?.source.fieldIds).toEqual([
      commentAuthor.id,
      commentAuthorId.id,
    ])
    expect(postRelation?.source.fieldIds).not.toContain(commentAuthor.id)
    expect(commentRelation?.source.fieldIds).not.toContain(postAuthor.id)

    const enumValues = declarations
      .filter((declaration) => declaration.kind === 'enum')
      .flatMap((declaration) => declaration.members)
      .filter((member) => member.kind === 'enumValue')
    expect(new Set(enumValues.map((value) => value.id)).size).toBe(2)

    const providers = declarations
      .flatMap((declaration) =>
        declaration.kind === 'generator' || declaration.kind === 'datasource'
          ? declaration.members
          : [],
      )
      .filter((member) => member.kind === 'config')
      .filter((member) => member.name === 'provider')
    expect(new Set(providers.map((provider) => provider.id)).size).toBe(2)
  })

  it('produces deterministic canonical output that parses again', () => {
    const initial = parseSchemaProject(
      {
        revision: 1,
        files: [
          createVirtualSchemaFile('schema.prisma', configSource),
          createVirtualSchemaFile('models/user.prisma', userSource),
          createVirtualSchemaFile('models/post.prisma', postSource),
        ],
      },
      parser,
    )
    expect(initial.valid).toBe(true)
    if (!initial.valid) return

    const canonicalFiles = Object.entries(initial.snapshot.canonicalFiles).map(
      ([path, content]) => createVirtualSchemaFile(path, content),
    )
    const reparsed = parseSchemaProject({ revision: 2, files: canonicalFiles }, parser)

    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return
    expect(reparsed.snapshot.canonicalFiles).toEqual(initial.snapshot.canonicalFiles)
  })

  it('reports syntax errors without producing a graph snapshot', () => {
    const result = parseSchemaProject(
      {
        revision: 4,
        files: [createVirtualSchemaFile('schema.prisma', 'model User { id Int @id')],
      },
      parser,
    )

    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.revision).toBe(4)
    expect(result.diagnostics[0]).toMatchObject({
      code: 'syntax-error',
      filePath: 'schema.prisma',
    })
  })

  it('characterizes NBSP between declaration tokens as a ranged syntax error', () => {
    const result = parseSchemaProject(
      {
        revision: 18,
        files: [
          createVirtualSchemaFile(
            'schema.prisma',
            'model\u00a0User {\n  id Int @id\n}\n',
          ),
        ],
      },
      parser,
    )

    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'syntax-error',
      filePath: 'schema.prisma',
      message: expect.stringContaining('horizontal whitespace'),
      range: {
        start: { offset: 5, line: 1, column: 6 },
        end: { offset: 6, line: 1, column: 7 },
      },
    })
  })

  it('rejects unresolved relation fields and references', () => {
    const result = parseSchemaProject(
      {
        revision: 5,
        files: [
          createVirtualSchemaFile(
            'schema.prisma',
            `
model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  author User @relation(fields: [missingId], references: [missing])
}
`,
          ),
        ],
      },
      parser,
    )

    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['unknown-relation-field', 'unknown-relation-reference']),
    )
  })

  it('handles Unicode identifiers in comments and source text', () => {
    const result = parseSchemaProject(
      {
        revision: 6,
        files: [
          createVirtualSchemaFile(
            'schema.prisma',
            '/// 用户资料\nmodel Profile {\n  id Int @id // 主键\n}\n',
          ),
        ],
      },
      parser,
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.snapshot.canonicalFiles['schema.prisma']).toContain('/// 用户资料')
    expect(result.snapshot.canonicalFiles['schema.prisma']).toContain('// 主键')
  })

  it('attaches only adjacent final comment groups to their owners', () => {
    const result = parseSchemaProject(
      {
        revision: 10,
        files: [
          createVirtualSchemaFile(
            'schema.prisma',
            `// 独立模型注释

/// 用户文档
// 用户说明
model User {
  // 独立字段注释

  /// 标识文档
  // 标识说明
  id Int @id // 行尾注释

  /// 表映射
  @@map("用户")
}
`,
          ),
        ],
      },
      parser,
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return
    const declarations = result.snapshot.graph.declarations
    expect(declarations[0]).toMatchObject({
      kind: 'commentBlock',
      comments: [{ kind: 'comment', text: '独立模型注释' }],
    })
    const user = declarations.find(
      (declaration) => declaration.kind === 'model' && declaration.name === 'User',
    )
    if (!user || user.kind !== 'model') throw new Error('Missing User model')
    expect(user.leadingComments).toMatchObject([
      { kind: 'docComment', text: '用户文档' },
      { kind: 'comment', text: '用户说明' },
    ])
    expect(user.members[0]).toMatchObject({
      kind: 'commentBlock',
      comments: [{ kind: 'comment', text: '独立字段注释' }],
    })
    expect(user.members[1]).toMatchObject({
      kind: 'field',
      leadingComments: [
        { kind: 'docComment', text: '标识文档' },
        { kind: 'comment', text: '标识说明' },
      ],
      trailingComment: { kind: 'comment', text: '行尾注释' },
    })
    expect(user.members[2]).toMatchObject({
      kind: 'blockAttribute',
      leadingComments: [{ kind: 'docComment', text: '表映射' }],
    })

    expect(result.snapshot.canonicalFiles['schema.prisma']).toBe(`// 独立模型注释

/// 用户文档
// 用户说明
model User {
  // 独立字段注释

  /// 标识文档
  // 标识说明
  id Int @id // 行尾注释
  /// 表映射
  @@map("用户")
}
`)
  })

  it('keeps leading comment ownership parse-write-parse idempotent', () => {
    const source = `/// Client generator
generator client {
  /// Provider docs
  provider = "prisma-client-js" // provider tail
}

/// State docs
enum State {
  /// Active docs
  ACTIVE // active tail
}

/// Alias docs
type UserId = Int
`
    const initial = parseSchemaProject(
      {
        revision: 11,
        files: [createVirtualSchemaFile('schema.prisma', source)],
      },
      parser,
    )
    expect(initial.valid).toBe(true)
    if (!initial.valid) return

    const reparsed = parseSchemaProject(
      {
        revision: 12,
        files: [
          createVirtualSchemaFile(
            'schema.prisma',
            initial.snapshot.canonicalFiles['schema.prisma'] ?? '',
          ),
        ],
      },
      parser,
    )
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return
    expect(reparsed.snapshot.canonicalFiles).toEqual(initial.snapshot.canonicalFiles)

    const named = reparsed.snapshot.graph.declarations.filter(
      (declaration) => declaration.kind !== 'commentBlock',
    )
    expect(named.map((declaration) => declaration.leadingComments?.[0]?.text)).toEqual([
      'Client generator',
      'State docs',
      'Alias docs',
    ])
  })

  it('keeps comments before a closing brace and at EOF standalone', () => {
    const result = parseSchemaProject(
      {
        revision: 13,
        files: [
          createVirtualSchemaFile(
            'models/user.prisma',
            `model User {
  id Int @id
  // before closing brace
}
// first EOF comment
/// second EOF comment`,
          ),
        ],
      },
      parser,
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return
    const user = result.snapshot.graph.declarations.find(
      (declaration): declaration is ModelDeclaration =>
        declaration.kind === 'model' && declaration.name === 'User',
    )
    if (!user) throw new Error('Missing User model')

    expect(user.members.at(-1)).toMatchObject({
      kind: 'commentBlock',
      comments: [
        {
          text: 'before closing brace',
          source: {
            filePath: 'models/user.prisma',
            range: { start: { line: 3, column: 3 } },
          },
        },
      ],
    })
    expect(result.snapshot.graph.declarations.at(-1)).toMatchObject({
      kind: 'commentBlock',
      comments: [{ text: 'first EOF comment' }, { text: 'second EOF comment' }],
    })
    expect(result.snapshot.canonicalFiles['models/user.prisma']).toBe(`model User {
  id Int @id

  // before closing brace
}

// first EOF comment
/// second EOF comment
`)
  })

  it('assigns same-line declaration tails without stealing the next owner', () => {
    const result = parseSchemaProject(
      {
        revision: 14,
        files: [
          createVirtualSchemaFile(
            'schema.prisma',
            `model User {} // user tail
/// Post docs
model Post {}
`,
          ),
        ],
      },
      parser,
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return
    const models = result.snapshot.graph.declarations.filter(
      (declaration): declaration is ModelDeclaration => declaration.kind === 'model',
    )
    expect(models).toHaveLength(2)
    expect(models[0]?.trailingComment).toMatchObject({
      text: 'user tail',
      source: {
        filePath: 'schema.prisma',
        range: { start: { line: 1, column: 15, offset: 14 } },
      },
    })
    expect(models[1]?.leadingComments).toMatchObject([
      {
        text: 'Post docs',
        source: {
          filePath: 'schema.prisma',
          range: { start: { line: 2, column: 1, offset: 27 } },
        },
      },
    ])
    expect(result.snapshot.graph.declarations).toHaveLength(2)
    expect(result.snapshot.canonicalFiles['schema.prisma']).toBe(`model User {

} // user tail

/// Post docs
model Post {

}
`)
  })

  it('preserves attached and standalone enum/config comments with source ownership', () => {
    const result = parseSchemaProject(
      {
        revision: 15,
        files: [
          createVirtualSchemaFile(
            'schema.prisma',
            `generator client {
  // standalone config

  /// provider docs
  provider = "prisma-client-js" // provider tail
  // config before close
}

enum Role {
  // standalone enum

  /// admin docs
  ADMIN // admin tail
  // enum before close
}
`,
          ),
        ],
      },
      parser,
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return
    const generator = result.snapshot.graph.declarations.find(
      (declaration): declaration is ConfigDeclaration =>
        declaration.kind === 'generator',
    )
    const role = result.snapshot.graph.declarations.find(
      (declaration): declaration is EnumDeclaration =>
        declaration.kind === 'enum' && declaration.name === 'Role',
    )
    if (!generator || !role) throw new Error('Missing config or enum')

    expect(generator.members.map((member) => member.kind)).toEqual([
      'commentBlock',
      'config',
      'commentBlock',
    ])
    expect(generator.members[1]).toMatchObject({
      kind: 'config',
      leadingComments: [{ text: 'provider docs' }],
      trailingComment: { text: 'provider tail' },
      source: { filePath: 'schema.prisma' },
    })
    expect(role.members.map((member) => member.kind)).toEqual([
      'commentBlock',
      'enumValue',
      'commentBlock',
    ])
    expect(role.members[1]).toMatchObject({
      kind: 'enumValue',
      leadingComments: [{ text: 'admin docs' }],
      trailingComment: { text: 'admin tail' },
      source: { filePath: 'schema.prisma' },
    })
    for (const text of [
      'standalone config',
      'provider docs',
      'provider tail',
      'config before close',
      'standalone enum',
      'admin docs',
      'admin tail',
      'enum before close',
    ]) {
      expect(
        result.snapshot.canonicalFiles['schema.prisma']?.match(new RegExp(text, 'gu')),
      ).toHaveLength(1)
    }
  })

  it('round-trips comments across BOM, CRLF, and multiple files', () => {
    const schemaFile = createVirtualSchemaFile(
      'schema.prisma',
      '\uFEFF/// client docs\r\ngenerator client {\r\n  // provider standalone\r\n\r\n  /// provider docs\r\n  provider = "prisma-client-js"\r\n}\r\n',
    )
    const modelFile = createVirtualSchemaFile(
      'models/user.prisma',
      '/// user docs\r\nmodel User {\r\n  /// id docs\r\n  id Int @id\r\n}\r\n// model EOF\r\n',
    )
    const initial = parseSchemaProject(
      { revision: 16, files: [schemaFile, modelFile] },
      parser,
    )

    expect(initial.valid).toBe(true)
    if (!initial.valid) return
    expect(initial.snapshot.files['schema.prisma']).toMatchObject({
      hasBom: true,
      lineEnding: '\r\n',
    })
    const serializedFiles = Object.values(initial.snapshot.files).map((file) =>
      createVirtualSchemaFile(
        file.path,
        serializeVirtualSchemaFile(
          file,
          initial.snapshot.canonicalFiles[file.path] ?? '',
        ),
      ),
    )
    expect(serializedFiles.find((file) => file.path === 'schema.prisma')).toMatchObject(
      {
        hasBom: true,
        lineEnding: '\r\n',
      },
    )

    const reparsed = parseSchemaProject(
      { revision: 17, files: serializedFiles },
      parser,
    )
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return
    expect(reparsed.snapshot.canonicalFiles).toEqual(initial.snapshot.canonicalFiles)

    const comments = reparsed.snapshot.graph.declarations.flatMap((declaration) => {
      if (declaration.kind === 'commentBlock') return declaration.comments
      const leading = declaration.leadingComments ?? []
      const members =
        declaration.kind === 'typeAlias'
          ? []
          : declaration.members.flatMap((member) =>
              member.kind === 'commentBlock'
                ? member.comments
                : (member.leadingComments ?? []),
            )
      return [...leading, ...members]
    })
    expect(comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'client docs',
          source: expect.objectContaining({ filePath: 'schema.prisma' }),
        }),
        expect.objectContaining({
          text: 'user docs',
          source: expect.objectContaining({ filePath: 'models/user.prisma' }),
        }),
        expect.objectContaining({
          text: 'model EOF',
          source: expect.objectContaining({ filePath: 'models/user.prisma' }),
        }),
      ]),
    )
  })

  it('classifies one-to-one and implicit many-to-many logical relations', () => {
    const result = parseSchemaProject(
      {
        revision: 8,
        files: [
          createVirtualSchemaFile(
            'schema.prisma',
            `
model User {
  id Int @id
  profile Profile?
}

model Profile {
  id Int @id
  userId Int @unique
  user User @relation(fields: [userId], references: [id])
}

model Post {
  id Int @id
  categories Category[]
}

model Category {
  id Int @id
  posts Post[]
}
`,
          ),
        ],
      },
      parser,
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return
    const oneToOne = result.snapshot.graph.logicalRelations.find(
      (relation) => relation.source.modelName === 'Profile',
    )
    expect(oneToOne).toMatchObject({
      source: { cardinality: 'zero-one' },
      target: { cardinality: 'one' },
    })
    const manyToMany = result.snapshot.graph.logicalRelations.find(
      (relation) =>
        relation.source.modelName === 'Category' ||
        relation.source.modelName === 'Post',
    )
    expect(manyToMany).toMatchObject({
      source: { cardinality: 'many' },
      target: { cardinality: 'many' },
      foreignKey: undefined,
    })
  })
})
