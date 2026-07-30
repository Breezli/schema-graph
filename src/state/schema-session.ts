import type {
  ParseProjectResult,
  SchemaDiagnostic,
  SchemaProjectSnapshot,
  VirtualSchemaFile,
} from '@/domain/schema'
import type { SchemaParserWorkerResponse } from '@/workers'

export interface SchemaSessionParseState {
  readonly sourceRevision: number
  readonly sourceFiles: readonly VirtualSchemaFile[]
  readonly status: 'idle' | 'parsing' | 'valid' | 'invalid'
  readonly diagnostics: readonly SchemaDiagnostic[]
  readonly lastValidSnapshot?: SchemaProjectSnapshot
}

export function createSchemaSessionParseState(
  sourceFiles: readonly VirtualSchemaFile[] = [],
): SchemaSessionParseState {
  return {
    sourceRevision: 0,
    sourceFiles,
    status: 'idle',
    diagnostics: [],
  }
}

export function beginSchemaParse(
  state: SchemaSessionParseState,
  sourceFiles: readonly VirtualSchemaFile[],
): SchemaSessionParseState {
  return {
    ...state,
    sourceRevision: state.sourceRevision + 1,
    sourceFiles,
    status: 'parsing',
  }
}

export function applySchemaParseResult(
  state: SchemaSessionParseState,
  result: ParseProjectResult,
): SchemaSessionParseState {
  const revision = result.valid ? result.snapshot.revision : result.revision
  if (revision !== state.sourceRevision) return state

  if (result.valid) {
    return {
      ...state,
      status: 'valid',
      diagnostics: result.diagnostics,
      lastValidSnapshot: result.snapshot,
    }
  }

  return {
    ...state,
    status: 'invalid',
    diagnostics: result.diagnostics,
  }
}

export function applySchemaWorkerResponse(
  state: SchemaSessionParseState,
  response: SchemaParserWorkerResponse,
): SchemaSessionParseState {
  if (response.revision !== state.sourceRevision) return state
  return applySchemaParseResult(state, response.result)
}

export function canApplyStructuralGraphEdits(state: SchemaSessionParseState): boolean {
  return state.status === 'valid' && state.lastValidSnapshot !== undefined
}
