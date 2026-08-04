import { describe, expect, it } from 'vitest'

import { LoancrateSchemaParser } from '@/adapters/schema'
import { createVirtualSchemaFile, parseSchemaProject } from '@/domain/schema'

import {
  applySchemaParseResult,
  applySchemaParseFailure,
  applySchemaWorkerResponse,
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

  it('ignores responses from another editor session or project', () => {
    const files = [createVirtualSchemaFile('schema.prisma', 'model User {}\n')]
    const state = beginSchemaParse(
      createSchemaSessionParseState(files, {
        editorSessionId: 9,
        projectId: 'project-a',
      }),
      files,
    )
    const result = parseSchemaProject({ revision: state.sourceRevision, files }, parser)
    const response = {
      protocolVersion: 2 as const,
      kind: 'parse-schema-project-result' as const,
      editorSessionId: 9,
      projectId: 'project-a',
      revision: state.sourceRevision,
      result,
    }

    expect(applySchemaWorkerResponse(state, { ...response, editorSessionId: 8 })).toBe(
      state,
    )
    expect(
      applySchemaWorkerResponse(state, { ...response, projectId: 'project-b' }),
    ).toBe(state)
    expect(applySchemaWorkerResponse(state, response).status).toBe('valid')
  })

  it('exits parsing on a retryable worker failure and preserves the last valid graph', () => {
    const files = [createVirtualSchemaFile('schema.prisma', 'model User {}\n')]
    let state = beginSchemaParse(
      createSchemaSessionParseState(files, {
        editorSessionId: 4,
        projectId: 'project-a',
      }),
      files,
    )
    state = applySchemaParseResult(
      state,
      parseSchemaProject({ revision: state.sourceRevision, files }, parser),
    )
    const snapshot = state.lastValidSnapshot
    state = beginSchemaParse(state, files)

    state = applySchemaParseFailure(
      state,
      {
        editorSessionId: state.editorSessionId,
        projectId: state.projectId ?? '',
        revision: state.sourceRevision,
      },
      new Error('worker timed out'),
    )

    expect(state.status).toBe('error')
    expect(state.failure).toEqual({ message: 'worker timed out', retryable: true })
    expect(state.diagnostics[0]).toMatchObject({
      code: 'schema-parser-worker-failure',
      message: 'worker timed out',
    })
    expect(state.lastValidSnapshot).toBe(snapshot)
  })
})
