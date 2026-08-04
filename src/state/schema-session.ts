import type {
  ParseProjectResult,
  SchemaDiagnostic,
  SchemaProjectSnapshot,
  VirtualSchemaFile,
} from '@/domain/schema'
import type { SchemaParserRequestIdentity, SchemaParserWorkerResponse } from '@/workers'

export interface SchemaParseFailure {
  readonly message: string
  readonly retryable: true
}

export interface SchemaSessionParseState {
  readonly editorSessionId: number
  readonly projectId?: string
  readonly sourceRevision: number
  readonly sourceFiles: readonly VirtualSchemaFile[]
  readonly status: 'idle' | 'parsing' | 'valid' | 'invalid' | 'error'
  readonly diagnostics: readonly SchemaDiagnostic[]
  readonly lastValidSnapshot?: SchemaProjectSnapshot
  readonly failure?: SchemaParseFailure
}

export function createSchemaSessionParseState(
  sourceFiles: readonly VirtualSchemaFile[] = [],
  identity: { readonly editorSessionId?: number; readonly projectId?: string } = {},
): SchemaSessionParseState {
  return {
    editorSessionId: identity.editorSessionId ?? 0,
    projectId: identity.projectId,
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
    failure: undefined,
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
      failure: undefined,
    }
  }

  return {
    ...state,
    status: 'invalid',
    diagnostics: result.diagnostics,
    failure: undefined,
  }
}

export function applySchemaParseFailure(
  state: SchemaSessionParseState,
  identity: SchemaParserRequestIdentity,
  error: unknown,
): SchemaSessionParseState {
  if (
    identity.editorSessionId !== state.editorSessionId ||
    identity.projectId !== state.projectId ||
    identity.revision !== state.sourceRevision
  ) {
    return state
  }

  const message = error instanceof Error ? error.message : String(error)
  return {
    ...state,
    status: 'error',
    diagnostics: [
      {
        severity: 'error',
        code: 'schema-parser-worker-failure',
        message,
      },
    ],
    failure: { message, retryable: true },
  }
}

export function applySchemaWorkerResponse(
  state: SchemaSessionParseState,
  response: SchemaParserWorkerResponse,
): SchemaSessionParseState {
  if (
    response.editorSessionId !== state.editorSessionId ||
    response.projectId !== state.projectId ||
    response.revision !== state.sourceRevision
  ) {
    return state
  }
  return applySchemaParseResult(state, response.result)
}

export function canApplyStructuralGraphEdits(state: SchemaSessionParseState): boolean {
  return state.status === 'valid' && state.lastValidSnapshot !== undefined
}
