import { describe, expect, it } from 'vitest'

import { LoancrateSchemaParser } from '@/adapters/schema'

import { parseSchemaProject } from './project-parser'
import {
  addModelToProject,
  addOneToManyRelation,
  deleteFieldFromProject,
  renameModelInProject,
} from './transactions'
import type { ModelDeclaration, SchemaProjectSnapshot } from './types'
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
})
