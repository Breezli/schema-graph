import { describe, expect, it } from 'vitest'

import { LoancrateSchemaParser } from '@/adapters/schema'

import { parseSchemaProject } from './project-parser'
import { createVirtualSchemaFile } from './vfs'

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
