import { describe, expect, it } from 'vitest'

import { LoancrateSchemaParser } from '@/adapters/schema'
import {
  createVirtualSchemaFile,
  parseSchemaProject,
  renameModelInProject,
  type SchemaProjectSnapshot,
  type SchemaDeclaration,
  type VirtualSchemaFile,
} from '@/domain/schema'

import {
  placeNewDeclarationPositions,
  reconcileDeclarationPositions,
  reconcileDeclarationPositionsDetailed,
} from './position-reconciliation'

const parser = new LoancrateSchemaParser()

function snapshotFrom(
  sourceOrFiles: string | readonly VirtualSchemaFile[],
  revision = 1,
): SchemaProjectSnapshot {
  const files =
    typeof sourceOrFiles === 'string'
      ? [createVirtualSchemaFile('schema.prisma', sourceOrFiles)]
      : sourceOrFiles
  const result = parseSchemaProject({ revision, files }, parser)
  if (!result.valid) throw new Error(result.diagnostics[0]?.message)
  return result.snapshot
}

function declarationId(snapshot: SchemaProjectSnapshot, name: string): string {
  const declaration = snapshot.graph.declarations.find(
    (entry): entry is Exclude<SchemaDeclaration, { readonly kind: 'commentBlock' }> =>
      entry.kind !== 'commentBlock' && entry.name === name,
  )
  if (!declaration) throw new Error(`Missing declaration ${name}`)
  return declaration.id
}

describe('declaration position reconciliation', () => {
  it('retains exact IDs and migrates a direct code rename without touching peers', () => {
    const previous = snapshotFrom(`model User {
  id Int @id
}

model Post {
  id Int @id
}
`)
    const next = snapshotFrom(
      `model Account {
  id Int @id
}

model Post {
  id Int @id
}
`,
      2,
    )
    const userId = declarationId(previous, 'User')
    const accountId = declarationId(next, 'Account')
    const postId = declarationId(previous, 'Post')
    const positions = {
      [userId]: { x: 10, y: 20 },
      [postId]: { x: 300, y: 400 },
    }

    expect(reconcileDeclarationPositions(previous, next, positions)).toEqual({
      [accountId]: { x: 10, y: 20 },
      [postId]: { x: 300, y: 400 },
    })
  })

  it('reports the explicit conservative ID remap used by code reconciliation', () => {
    const previous = snapshotFrom(`model User {
  id Int @id
}
`)
    const userId = declarationId(previous, 'User')
    const mutation = renameModelInProject(previous, userId, 'Account')
    if (!mutation.ok) throw new Error(mutation.message)
    const next = snapshotFrom(mutation.files, 2)
    const accountId = declarationId(next, 'Account')
    const reconciliation = reconcileDeclarationPositionsDetailed(previous, next, {
      [userId]: { x: 80, y: 120 },
    })

    expect(reconciliation.declarationIdRemap).toEqual({ [userId]: accountId })
    expect(reconciliation.positions).toEqual({ [accountId]: { x: 80, y: 120 } })
    expect(reconciliation.newDeclarationIds).toEqual([])
  })

  it('places ambiguous additions without migrating old positions or moving peers', () => {
    const previous = snapshotFrom(`model User {
  id Int @id
}

model Stable {
  value String
}
`)
    const parsedNext = snapshotFrom(
      `model Account {
  id Int @id
}

model Customer {
  id Int @id
}

model Stable {
  value String
}
`,
      2,
    )
    const previousDeclaration = previous.graph.declarations[0]
    if (!previousDeclaration || previousDeclaration.kind === 'commentBlock') {
      throw new Error('Missing previous declaration')
    }
    const ambiguousNext: SchemaProjectSnapshot = {
      ...parsedNext,
      graph: {
        ...parsedNext.graph,
        declarations: parsedNext.graph.declarations.map((declaration) =>
          declaration.kind === 'commentBlock'
            ? declaration
            : {
                ...declaration,
                source: {
                  ...declaration.source,
                  range: previousDeclaration.source.range,
                },
              },
        ),
      },
    }
    const userId = declarationId(previous, 'User')
    const stableId = declarationId(previous, 'Stable')
    const accountId = declarationId(ambiguousNext, 'Account')
    const customerId = declarationId(ambiguousNext, 'Customer')
    const positions = {
      [userId]: { x: 1, y: 2 },
      [stableId]: { x: 40, y: 60 },
    }
    const reconciliation = reconcileDeclarationPositionsDetailed(
      previous,
      ambiguousNext,
      positions,
    )
    const placed = placeNewDeclarationPositions(
      ambiguousNext,
      reconciliation.positions,
      reconciliation.newDeclarationIds,
      'RIGHT',
    )

    expect(reconcileDeclarationPositions(previous, ambiguousNext, positions)).toBe(
      positions,
    )
    expect(reconciliation.declarationIdRemap).toEqual({})
    expect(reconciliation.newDeclarationIds).toEqual([accountId, customerId])
    expect(reconciliation.positions[accountId]).toBeUndefined()
    expect(reconciliation.positions[customerId]).toBeUndefined()
    expect(placed[stableId]).toEqual({ x: 40, y: 60 })
    expect(placed[accountId]).toBeDefined()
    expect(placed[customerId]).toBeDefined()
    expect(placed[accountId]).not.toEqual(positions[userId])
    expect(placed[customerId]).not.toEqual(positions[userId])
    expect(placed[accountId]).not.toEqual(placed[customerId])
  })

  it('places only truly new declarations without moving existing nodes', () => {
    const previous = snapshotFrom('model User {\n  id Int @id\n}\n')
    const next = snapshotFrom(
      'model User {\n  id Int @id\n  posts Post[]\n}\nmodel Post {\n  id Int @id\n  userId Int\n  user User @relation(fields: [userId], references: [id])\n}\n',
      2,
    )
    const userId = declarationId(previous, 'User')
    const postId = declarationId(next, 'Post')
    const positions = { [userId]: { x: 40, y: 60 } }
    const reconciliation = reconcileDeclarationPositionsDetailed(
      previous,
      next,
      positions,
    )
    const placed = placeNewDeclarationPositions(
      next,
      reconciliation.positions,
      reconciliation.newDeclarationIds,
      'RIGHT',
    )

    expect(placed[userId]).toEqual({ x: 40, y: 60 })
    expect(placed[postId]).toEqual({ x: 360, y: 60 })
    expect(Object.keys(placed)).toHaveLength(2)
  })
})
