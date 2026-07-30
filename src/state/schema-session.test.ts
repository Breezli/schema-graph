import { describe, expect, it } from 'vitest'

import { LoancrateSchemaParser } from '@/adapters/schema'
import { createVirtualSchemaFile, parseSchemaProject } from '@/domain/schema'

import {
  applySchemaParseResult,
  beginSchemaParse,
  canApplyStructuralGraphEdits,
  createSchemaSessionParseState,
} from './schema-session'

const parser = new LoancrateSchemaParser()

describe('schema parse session', () => {
  it('keeps the last valid graph when current source becomes invalid', () => {
    const validFiles = [
      createVirtualSchemaFile('schema.prisma', 'model User {\n  id Int @id\n}\n'),
    ]
    let state = beginSchemaParse(createSchemaSessionParseState(), validFiles)
    state = applySchemaParseResult(
      state,
      parseSchemaProject({ revision: state.sourceRevision, files: validFiles }, parser),
    )
    const validSnapshot = state.lastValidSnapshot

    const invalidFiles = [
      createVirtualSchemaFile('schema.prisma', 'model User { id Int @id'),
    ]
    state = beginSchemaParse(state, invalidFiles)
    state = applySchemaParseResult(
      state,
      parseSchemaProject(
        { revision: state.sourceRevision, files: invalidFiles },
        parser,
      ),
    )

    expect(state.status).toBe('invalid')
    expect(state.lastValidSnapshot).toBe(validSnapshot)
    expect(canApplyStructuralGraphEdits(state)).toBe(false)
  })

  it('ignores stale parser revisions', () => {
    const files = [
      createVirtualSchemaFile('schema.prisma', 'model User {\n  id Int @id\n}\n'),
    ]
    let state = beginSchemaParse(createSchemaSessionParseState(), files)
    state = beginSchemaParse(state, files)
    const staleResult = parseSchemaProject({ revision: 1, files }, parser)

    expect(applySchemaParseResult(state, staleResult)).toBe(state)
  })
})
