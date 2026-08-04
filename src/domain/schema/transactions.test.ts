import { describe, expect, it } from 'vitest'

import { LoancrateSchemaParser } from '@/adapters/schema'

import { parseSchemaProject } from './project-parser'
import {
  addModelToProject,
  addOneToManyRelation,
  addFieldToModel,
  deleteFieldFromProject,
  deleteModelFromProject,
  renameModelInProject,
  updateFieldInProject,
} from './transactions'
import type {
  ModelDeclaration,
  SchemaField,
  SchemaProjectSnapshot,
  VirtualSchemaFile,
} from './types'
import { createVirtualSchemaFile } from './vfs'

const parser = new LoancrateSchemaParser()

function snapshotFrom(source: string): SchemaProjectSnapshot {
  return snapshotFromFiles([createVirtualSchemaFile('schema.prisma', source)])
}

function snapshotFromFiles(files: readonly VirtualSchemaFile[]): SchemaProjectSnapshot {
  const result = parseSchemaProject({ revision: 1, files }, parser)
  if (!result.valid) throw new Error(result.diagnostics[0]?.message)
  return result.snapshot
}

function field(declaration: ModelDeclaration, name: string): SchemaField {
  const member = declaration.members.find(
    (entry): entry is SchemaField => entry.kind === 'field' && entry.name === name,
  )
  if (!member) throw new Error(`Missing field ${declaration.name}.${name}`)
  return member
}

function model(snapshot: SchemaProjectSnapshot, name: string): ModelDeclaration {
  const declaration = snapshot.graph.declarations.find(
    (entry): entry is ModelDeclaration =>
      (entry.kind === 'model' || entry.kind === 'view' || entry.kind === 'type') &&
      entry.name === name,
  )
  if (!declaration) throw new Error(`Missing model ${name}`)
  return declaration
}

describe('visual schema transactions', () => {
  it('adds a canonical model that parses again', () => {
    const snapshot = snapshotFrom('model User {\n  id Int @id\n}\n')
    const result = addModelToProject(snapshot, 'schema.prisma', 'AuditLog')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const reparsed = parseSchemaProject({ revision: 2, files: result.files }, parser)
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return
    expect(reparsed.snapshot.graph.symbols.AuditLog).toHaveLength(1)
    expect(reparsed.snapshot.canonicalFiles['schema.prisma']).toContain(
      'id Int @id @default(autoincrement())',
    )
  })

  it('creates both sides of a one-to-many relation', () => {
    const snapshot = snapshotFrom(`
model User {
  id Int @id
}

model Post {
  id Int @id
}
`)
    const result = addOneToManyRelation(
      snapshot,
      model(snapshot, 'Post').id,
      model(snapshot, 'User').id,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const reparsed = parseSchemaProject({ revision: 2, files: result.files }, parser)
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return
    expect(reparsed.snapshot.canonicalFiles['schema.prisma']).toContain(
      'user User? @relation(fields: [userId], references: [id])',
    )
    expect(reparsed.snapshot.canonicalFiles['schema.prisma']).toContain('posts Post[]')
  })

  it('renames relation targets and protects referenced key fields', () => {
    const snapshot = snapshotFrom(`
model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}
`)
    const renamed = renameModelInProject(
      snapshot,
      model(snapshot, 'User').id,
      'Account',
    )
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(renamed.declarationIdRemap).toEqual({
      [model(snapshot, 'User').id]: 'model:schema.prisma:Account',
    })
    const reparsed = parseSchemaProject({ revision: 2, files: renamed.files }, parser)
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return
    expect(reparsed.snapshot.canonicalFiles['schema.prisma']).toContain('user Account')

    const account = model(reparsed.snapshot, 'Account')
    const idField = account.members.find(
      (member) => member.kind === 'field' && member.name === 'id',
    )
    expect(idField).toBeDefined()
    if (!idField || idField.kind !== 'field') return
    expect(
      deleteFieldFromProject(reparsed.snapshot, account.id, idField.id),
    ).toMatchObject({
      ok: false,
    })
  })

  it('renames references only for relations targeting the renamed model', () => {
    const snapshot = snapshotFrom(`
model User {
  id Int @id
  parentId Int?
  parent User? @relation("Hierarchy", fields: [parentId], references: [id])
  children User[] @relation("Hierarchy")
  authoredArticles Article[] @relation("Author")
  reviewedArticles Article[] @relation("Reviewer")
}

model Category {
  id Int @id
  articles Article[]
}

model Article {
  id Int @id
  authorId Int
  reviewerId Int
  categoryId Int
  author User @relation("Author", fields: [authorId], references: [id])
  reviewer User @relation("Reviewer", fields: [reviewerId], references: [id])
  category Category @relation(fields: [categoryId], references: [id])
}
`)
    const user = model(snapshot, 'User')
    const renamed = updateFieldInProject(snapshot, user.id, field(user, 'id').id, {
      name: 'userKey',
    })

    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    const reparsed = parseSchemaProject({ revision: 2, files: renamed.files }, parser)
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return

    const relations = reparsed.snapshot.graph.relations
    expect(
      relations.find((relation) => relation.sourceFieldName === 'parent')?.references,
    ).toEqual(['userKey'])
    expect(
      relations.find((relation) => relation.sourceFieldName === 'author')?.references,
    ).toEqual(['userKey'])
    expect(
      relations.find((relation) => relation.sourceFieldName === 'author')?.fields,
    ).toEqual(['authorId'])
    expect(
      relations.find((relation) => relation.sourceFieldName === 'reviewer')?.references,
    ).toEqual(['userKey'])
    expect(
      relations.find((relation) => relation.sourceFieldName === 'category')?.references,
    ).toEqual(['id'])
  })

  it('renames a relation field without rewriting its selector attributes', () => {
    const snapshot = snapshotFrom(`
model User {
  account Int @id
  invoices Invoice[]
}

model Invoice {
  id Int @id
  accountId Int
  account User @relation(fields: [accountId], references: [account])
}
`)
    const invoice = model(snapshot, 'Invoice')
    const renamed = updateFieldInProject(
      snapshot,
      invoice.id,
      field(invoice, 'account').id,
      { name: 'owner' },
    )

    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    const reparsed = parseSchemaProject({ revision: 2, files: renamed.files }, parser)
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return

    const canonical = reparsed.snapshot.canonicalFiles['schema.prisma'] ?? ''
    expect(canonical).toContain(
      'owner User @relation(fields: [accountId], references: [account])',
    )
    expect(canonical).not.toContain('references: [owner]')
    expect(
      reparsed.snapshot.graph.relations.find(
        (relation) => relation.sourceFieldName === 'owner',
      ),
    ).toMatchObject({ fields: ['accountId'], references: ['account'] })
  })

  it('renames parameterized block selectors without touching their options', () => {
    const snapshot = snapshotFrom(`model Example {
  id Int @id
  value String
  generated String @default(value())

  @@index([value(sort: Desc)], type: value)
  @@unique([value(length: 12)])
  @@index([value(sort: Desc, ops: raw("text_ops"))], map: "value_index")
  @@map("value")
}
`)
    const example = model(snapshot, 'Example')
    const renamed = updateFieldInProject(
      snapshot,
      example.id,
      field(example, 'value').id,
      { name: 'payload' },
    )

    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    const reparsed = parseSchemaProject({ revision: 2, files: renamed.files }, parser)
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return

    const canonical = reparsed.snapshot.canonicalFiles['schema.prisma'] ?? ''
    expect(canonical).toContain('@@index([payload(sort: Desc)], type: value)')
    expect(canonical).toContain('@@unique([payload(length: 12)])')
    expect(canonical).toContain(
      '@@index([payload(sort: Desc, ops: raw("text_ops"))], map: "value_index")',
    )
    expect(canonical).toContain('generated String @default(value())')
    expect(canonical).toContain('@@map("value")')
    expect(canonical).not.toContain('payload(sort: payload)')
    expect(canonical).not.toContain('payload(length: payload)')
  })

  it('renames one member of composite relation references and constraints', () => {
    const snapshot = snapshotFrom(`
model User {
  tenantId Int
  id Int
  posts Post[]

  @@id([tenantId, id])
}

model Post {
  id Int @id
  authorTenantId Int
  authorId Int
  author User @relation(fields: [authorTenantId, authorId], references: [tenantId, id])
}
`)
    const user = model(snapshot, 'User')
    const renamed = updateFieldInProject(snapshot, user.id, field(user, 'id').id, {
      name: 'externalId',
    })

    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    const reparsed = parseSchemaProject({ revision: 2, files: renamed.files }, parser)
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return
    expect(reparsed.snapshot.canonicalFiles['schema.prisma']).toContain(
      '@@id([tenantId, externalId])',
    )
    expect(
      reparsed.snapshot.graph.relations.find(
        (relation) => relation.sourceFieldName === 'author',
      )?.references,
    ).toEqual(['tenantId', 'externalId'])
  })

  it('rejects deletion of a field-level primary key', () => {
    const snapshot = snapshotFrom(`model User {
  id Int @id
  name String
}
`)
    const user = model(snapshot, 'User')

    expect(deleteFieldFromProject(snapshot, user.id, field(user, 'id').id)).toEqual({
      ok: false,
      message: '字段“id”正被 @id 约束使用，不能删除。',
    })
  })

  it.each([
    { constraint: '@@id([value])', name: '@@id' },
    { constraint: '@@unique([value])', name: '@@unique' },
    { constraint: '@@index([value(sort: Desc)])', name: '@@index' },
    { constraint: '@@fulltext([value])', name: '@@fulltext' },
  ])('rejects deletion of a field used by $name', ({ constraint, name }) => {
    const snapshot = snapshotFrom(`model Example {
  value String
  other String

  ${constraint}
}
`)
    const example = model(snapshot, 'Example')

    expect(
      deleteFieldFromProject(snapshot, example.id, field(example, 'value').id),
    ).toEqual({
      ok: false,
      message: `字段“value”正被 ${name} 约束使用，不能删除。`,
    })
  })

  it('creates distinct named relations when the model pair already has one', () => {
    let snapshot = snapshotFrom(`
model User {
  id Int @id
}

model Post {
  id Int @id
}
`)
    const first = addOneToManyRelation(
      snapshot,
      model(snapshot, 'Post').id,
      model(snapshot, 'User').id,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    let reparsed = parseSchemaProject({ revision: 2, files: first.files }, parser)
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return
    snapshot = reparsed.snapshot

    const second = addOneToManyRelation(
      snapshot,
      model(snapshot, 'Post').id,
      model(snapshot, 'User').id,
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    reparsed = parseSchemaProject({ revision: 3, files: second.files }, parser)
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return

    const canonical = reparsed.snapshot.canonicalFiles['schema.prisma'] ?? ''
    expect(canonical).toContain(
      'user2 User? @relation("PostUserRelation", fields: [user2Id], references: [id])',
    )
    expect(canonical).toContain('posts2 Post[] @relation("PostUserRelation")')
    expect(reparsed.snapshot.graph.logicalRelations).toHaveLength(2)
    expect(
      new Set(
        reparsed.snapshot.graph.logicalRelations.map(
          (relation) => relation.name ?? '__default__',
        ),
      ).size,
    ).toBe(2)
  })

  it('uses deterministic unique names for repeated self-relations', () => {
    let snapshot = snapshotFrom(`model User {
  id Int @id
}
`)
    const first = addOneToManyRelation(
      snapshot,
      model(snapshot, 'User').id,
      model(snapshot, 'User').id,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    let reparsed = parseSchemaProject({ revision: 2, files: first.files }, parser)
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return
    snapshot = reparsed.snapshot

    const second = addOneToManyRelation(
      snapshot,
      model(snapshot, 'User').id,
      model(snapshot, 'User').id,
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    reparsed = parseSchemaProject({ revision: 3, files: second.files }, parser)
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return

    const canonical = reparsed.snapshot.canonicalFiles['schema.prisma'] ?? ''
    expect(canonical).toContain(
      'user User? @relation("UserUserRelation", fields: [userId], references: [id])',
    )
    expect(canonical).toContain('users User[] @relation("UserUserRelation")')
    expect(canonical).toContain(
      'user2 User? @relation("UserUserRelation2", fields: [user2Id], references: [id])',
    )
    expect(canonical).toContain('users2 User[] @relation("UserUserRelation2")')
    expect(reparsed.snapshot.graph.logicalRelations).toHaveLength(2)
    expect(
      new Set(
        reparsed.snapshot.graph.logicalRelations.map((relation) => relation.name),
      ),
    ).toEqual(new Set(['UserUserRelation', 'UserUserRelation2']))
  })

  it('preserves attached and standalone comments through structural mutations', () => {
    let snapshot = snapshotFrom(`
/// 用户模型
model User {
  // 保留的独立注释

  /// 主键
  id Int @id
  /// 可删除字段
  nickname String // 字段尾注释
  /// 映射属性
  @@map("users")
}
`)

    const added = addFieldToModel(snapshot, model(snapshot, 'User').id, 'email')
    expect(added.ok).toBe(true)
    if (!added.ok) return
    let reparsed = parseSchemaProject({ revision: 2, files: added.files }, parser)
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return
    snapshot = reparsed.snapshot

    const renamed = renameModelInProject(
      snapshot,
      model(snapshot, 'User').id,
      'Account',
    )
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    reparsed = parseSchemaProject({ revision: 3, files: renamed.files }, parser)
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return
    snapshot = reparsed.snapshot

    const account = model(snapshot, 'Account')
    const nickname = account.members.find(
      (member) => member.kind === 'field' && member.name === 'nickname',
    )
    if (!nickname || nickname.kind !== 'field') throw new Error('Missing nickname')
    const deleted = deleteFieldFromProject(snapshot, account.id, nickname.id)
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    reparsed = parseSchemaProject({ revision: 4, files: deleted.files }, parser)
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return

    const canonical = reparsed.snapshot.canonicalFiles['schema.prisma'] ?? ''
    for (const text of [
      '用户模型',
      '保留的独立注释',
      '主键',
      '可删除字段',
      '字段尾注释',
      '映射属性',
    ]) {
      expect(canonical.match(new RegExp(text, 'gu'))).toHaveLength(1)
    }
    expect(canonical).toContain('model Account')
    expect(canonical).toContain('email String')
    expect(canonical).not.toContain('nickname String')
  })

  it.each([
    { fieldName: 'first', comment: 'first field docs', tail: 'first field tail' },
    { fieldName: 'last', comment: 'last field docs', tail: 'last field tail' },
  ])(
    'promotes comments when deleting the $fieldName commented member',
    ({ fieldName, comment, tail }) => {
      const snapshot = snapshotFrom(`model Example {
  /// first field docs
  first String // first field tail
  middle Int
  /// last field docs
  last String // last field tail
}
`)
      const example = model(snapshot, 'Example')
      const deleted = deleteFieldFromProject(
        snapshot,
        example.id,
        field(example, fieldName).id,
      )

      expect(deleted.ok).toBe(true)
      if (!deleted.ok) return
      const reparsed = parseSchemaProject({ revision: 2, files: deleted.files }, parser)
      expect(reparsed.valid).toBe(true)
      if (!reparsed.valid) return
      const canonical = reparsed.snapshot.canonicalFiles['schema.prisma'] ?? ''
      expect(canonical).not.toContain(`${fieldName} String`)
      expect(canonical.match(new RegExp(comment, 'gu'))).toHaveLength(1)
      expect(canonical.match(new RegExp(tail, 'gu'))).toHaveLength(1)

      const updated = model(reparsed.snapshot, 'Example')
      const promoted = updated.members.find(
        (member) =>
          member.kind === 'commentBlock' &&
          member.comments.some((entry) => entry.text === comment),
      )
      expect(promoted).toMatchObject({
        kind: 'commentBlock',
        comments: [
          { text: comment, source: { filePath: 'schema.prisma' } },
          { text: tail, source: { filePath: 'schema.prisma' } },
        ],
      })
    },
  )

  it('cascade-deletes a model and all comments owned by it', () => {
    const snapshot = snapshotFrom(`// independent before

/// model leading
model User {
  // model member standalone

  /// id leading
  id Int @id // id trailing
  // before closing brace
} // model trailing
// independent EOF
`)
    const deleted = deleteModelFromProject(snapshot, model(snapshot, 'User').id)

    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    const canonical = deleted.files.find(
      (file) => file.path === 'schema.prisma',
    )?.content
    expect(canonical).toBe(`// independent before

// independent EOF
`)
    for (const deletedText of [
      'model leading',
      'model member standalone',
      'id leading',
      'id trailing',
      'before closing brace',
      'model trailing',
      'model User',
    ]) {
      expect(canonical).not.toContain(deletedText)
    }
  })

  it('promotes removed relation-field comments in their original model and file', () => {
    const snapshot = snapshotFromFiles([
      createVirtualSchemaFile(
        'models/user.prisma',
        `// user file survives

/// deleted user model
model User {
  id Int @id
}
`,
      ),
      createVirtualSchemaFile(
        'models/post.prisma',
        `model Post {
  id Int @id
  authorId Int
  /// relation docs
  author User @relation(fields: [authorId], references: [id]) // relation tail
}
`,
      ),
    ])
    const deleted = deleteModelFromProject(snapshot, model(snapshot, 'User').id)

    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    const userFile = deleted.files.find((file) => file.path === 'models/user.prisma')
    const postFile = deleted.files.find((file) => file.path === 'models/post.prisma')
    expect(userFile?.content).toBe('// user file survives\n')
    expect(postFile?.content).toContain('authorId Int')
    expect(postFile?.content).not.toContain('author User')
    expect(postFile?.content).toContain('/// relation docs')
    expect(postFile?.content).toContain('// relation tail')

    const reparsed = parseSchemaProject({ revision: 2, files: deleted.files }, parser)
    expect(reparsed.valid).toBe(true)
    if (!reparsed.valid) return
    const post = model(reparsed.snapshot, 'Post')
    expect(post.members.at(-1)).toMatchObject({
      kind: 'commentBlock',
      comments: [
        { text: 'relation docs', source: { filePath: 'models/post.prisma' } },
        { text: 'relation tail', source: { filePath: 'models/post.prisma' } },
      ],
    })
    expect(
      reparsed.snapshot.graph.declarations.some(
        (declaration) => declaration.kind === 'model' && declaration.name === 'User',
      ),
    ).toBe(false)
  })
})
