import { describe, expect, it } from 'vitest'

import { LoancrateSchemaParser } from '@/adapters/schema'

import { parseSchemaProject } from './project-parser'
import {
  deriveForeignKeySemantics,
  resolveParentListLogicalRelation,
} from './relation-semantics'
import type { ModelDeclaration, SchemaField, SchemaProjectSnapshot } from './types'
import { createVirtualSchemaFile } from './vfs'

const parser = new LoancrateSchemaParser()

function snapshotFrom(source: string): SchemaProjectSnapshot {
  const result = parseSchemaProject(
    { revision: 1, files: [createVirtualSchemaFile('schema.prisma', source)] },
    parser,
  )
  if (!result.valid) throw new Error(result.diagnostics[0]?.message)
  return result.snapshot
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

function field(declaration: ModelDeclaration, name: string): SchemaField {
  const member = declaration.members.find(
    (entry): entry is SchemaField => entry.kind === 'field' && entry.name === name,
  )
  if (!member) throw new Error(`Missing field ${declaration.name}.${name}`)
  return member
}

describe('relation selection semantics', () => {
  it('resolves only the parent list side of a one-to-many foreign key', () => {
    const snapshot = snapshotFrom(`
model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  authorId Int
  author User @relation(fields: [authorId], references: [id])
}
`)
    const user = model(snapshot, 'User')
    const post = model(snapshot, 'Post')
    const posts = field(user, 'posts')
    const author = field(post, 'author')
    const authorId = field(post, 'authorId')

    const resolved = resolveParentListLogicalRelation(snapshot.graph, user.id, posts.id)
    expect(resolved).toBeDefined()
    expect(deriveForeignKeySemantics(resolved!)).toEqual({
      childModelId: post.id,
      parentModelId: user.id,
      childRelationFieldId: author.id,
      childFieldNames: ['authorId'],
      parentReferenceNames: ['id'],
    })

    expect(
      resolveParentListLogicalRelation(snapshot.graph, post.id, author.id),
    ).toBeUndefined()
    expect(
      resolveParentListLogicalRelation(snapshot.graph, post.id, authorId.id),
    ).toBeUndefined()
  })

  it('resolves a composite foreign key with matching fields and references', () => {
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
    const post = model(snapshot, 'Post')
    const resolved = resolveParentListLogicalRelation(
      snapshot.graph,
      user.id,
      field(user, 'posts').id,
    )

    expect(deriveForeignKeySemantics(resolved!)).toEqual({
      childModelId: post.id,
      parentModelId: user.id,
      childRelationFieldId: field(post, 'author').id,
      childFieldNames: ['authorTenantId', 'authorId'],
      parentReferenceNames: ['tenantId', 'id'],
    })
  })

  it.each([
    {
      name: 'fields without references',
      relation: 'author User @relation(fields: [authorTenantId, authorId])',
    },
    {
      name: 'mismatched fields and references',
      relation:
        'author User @relation(fields: [authorTenantId, authorId], references: [id])',
    },
  ])('declines malformed explicit relations with $name', ({ relation }) => {
    const snapshot = snapshotFrom(`
model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  authorTenantId Int
  authorId Int
  ${relation}
}
`)
    const user = model(snapshot, 'User')
    const logicalRelation = snapshot.graph.logicalRelations[0]

    expect(logicalRelation?.foreignKey).toBeUndefined()
    expect(
      resolveParentListLogicalRelation(
        snapshot.graph,
        user.id,
        field(user, 'posts').id,
      ),
    ).toBeUndefined()
  })

  it('declines a parent list inverse that declares fields or references', () => {
    const snapshot = snapshotFrom(`
model User {
  id Int @id
  posts Post[] @relation("Author", references: [id])
}

model Post {
  id Int @id
  authorId Int @unique
  author User @relation("Author", fields: [authorId], references: [id])
}
`)
    const user = model(snapshot, 'User')

    expect(snapshot.graph.logicalRelations[0]?.foreignKey).toBeDefined()
    expect(snapshot.graph.logicalRelations[0]?.source.cardinality).toBe('zero-one')
    expect(
      resolveParentListLogicalRelation(
        snapshot.graph,
        user.id,
        field(user, 'posts').id,
      ),
    ).toBeUndefined()
  })

  it('declines logical relations with multiple inverse list candidates', () => {
    const snapshot = snapshotFrom(`
model User {
  id Int @id
  posts Post[] @relation("Author")
  archivedPosts Post[] @relation("Author")
}

model Post {
  id Int @id
  authorId Int @unique
  author User @relation("Author", fields: [authorId], references: [id])
}
`)
    const user = model(snapshot, 'User')

    expect(snapshot.graph.logicalRelations[0]?.foreignKey).toBeDefined()
    expect(snapshot.graph.logicalRelations[0]?.source.cardinality).toBe('zero-one')
    expect(
      resolveParentListLogicalRelation(
        snapshot.graph,
        user.id,
        field(user, 'posts').id,
      ),
    ).toBeUndefined()
    expect(
      resolveParentListLogicalRelation(
        snapshot.graph,
        user.id,
        field(user, 'archivedPosts').id,
      ),
    ).toBeUndefined()
  })

  it('declines a one-to-one inverse and an implicit many-to-many field', () => {
    const snapshot = snapshotFrom(`
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
`)
    const user = model(snapshot, 'User')
    const post = model(snapshot, 'Post')

    expect(
      resolveParentListLogicalRelation(
        snapshot.graph,
        user.id,
        field(user, 'profile').id,
      ),
    ).toBeUndefined()
    expect(
      resolveParentListLogicalRelation(
        snapshot.graph,
        post.id,
        field(post, 'categories').id,
      ),
    ).toBeUndefined()
  })

  it('declines an explicit foreign key with no inverse field', () => {
    const snapshot = snapshotFrom(`
model User {
  id Int @id
}

model Post {
  id Int @id
  authorId Int
  author User @relation(fields: [authorId], references: [id])
}
`)
    const user = model(snapshot, 'User')
    expect(
      resolveParentListLogicalRelation(snapshot.graph, user.id, 'missing-inverse'),
    ).toBeUndefined()
    expect(snapshot.graph.logicalRelations[0]?.foreignKey).toBeDefined()
  })

  it('resolves named parallel relations independently', () => {
    const snapshot = snapshotFrom(`
model User {
  id Int @id
  authoredPosts Post[] @relation("Author")
  editedPosts Post[] @relation("Editor")
}

model Post {
  id Int @id
  authorId Int
  author User @relation("Author", fields: [authorId], references: [id])
  editorId Int
  editor User @relation("Editor", fields: [editorId], references: [id])
}
`)
    const user = model(snapshot, 'User')
    const authored = resolveParentListLogicalRelation(
      snapshot.graph,
      user.id,
      field(user, 'authoredPosts').id,
    )
    const edited = resolveParentListLogicalRelation(
      snapshot.graph,
      user.id,
      field(user, 'editedPosts').id,
    )

    expect(authored?.name).toBe('Author')
    expect(edited?.name).toBe('Editor')
    expect(authored?.id).not.toBe(edited?.id)
  })

  it('resolves a named self relation by its list inverse', () => {
    const snapshot = snapshotFrom(`
model Employee {
  id Int @id
  managerId Int?
  manager Employee? @relation("Management", fields: [managerId], references: [id])
  reports Employee[] @relation("Management")
}
`)
    const employee = model(snapshot, 'Employee')
    const reports = field(employee, 'reports')
    const manager = field(employee, 'manager')

    expect(
      resolveParentListLogicalRelation(snapshot.graph, employee.id, reports.id),
    ).toMatchObject({ name: 'Management' })
    expect(
      resolveParentListLogicalRelation(snapshot.graph, employee.id, manager.id),
    ).toBeUndefined()
  })

  it('declines ambiguous parallel unnamed foreign-key groups', () => {
    const snapshot = snapshotFrom(`
model User {
  id Int @id
  authoredPosts Post[]
  editedPosts Post[]
}

model Post {
  id Int @id
  authorId Int
  author User @relation(fields: [authorId], references: [id])
  editorId Int
  editor User @relation(fields: [editorId], references: [id])
}
`)
    const user = model(snapshot, 'User')
    expect(snapshot.graph.logicalRelations).toHaveLength(1)
    expect(snapshot.graph.logicalRelations[0]?.foreignKey).toBeUndefined()
    expect(
      resolveParentListLogicalRelation(
        snapshot.graph,
        user.id,
        field(user, 'authoredPosts').id,
      ),
    ).toBeUndefined()
    expect(
      resolveParentListLogicalRelation(
        snapshot.graph,
        user.id,
        field(user, 'editedPosts').id,
      ),
    ).toBeUndefined()
  })
})
