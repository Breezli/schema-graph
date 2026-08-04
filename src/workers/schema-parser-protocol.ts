import type { ParseProjectResult, VirtualSchemaFile } from '@/domain/schema'

export const SCHEMA_PARSER_PROTOCOL_VERSION = 2 as const

export interface SchemaParserRequestIdentity {
  readonly editorSessionId: number
  readonly projectId: string
  readonly revision: number
}

export interface ParseSchemaProjectRequest extends SchemaParserRequestIdentity {
  readonly protocolVersion: typeof SCHEMA_PARSER_PROTOCOL_VERSION
  readonly kind: 'parse-schema-project'
  readonly revision: number
  readonly files: readonly VirtualSchemaFile[]
}

export interface ParseSchemaProjectResponse extends SchemaParserRequestIdentity {
  readonly protocolVersion: typeof SCHEMA_PARSER_PROTOCOL_VERSION
  readonly kind: 'parse-schema-project-result'
  readonly revision: number
  readonly result: ParseProjectResult
}

export type SchemaParserWorkerRequest = ParseSchemaProjectRequest
export type SchemaParserWorkerResponse = ParseSchemaProjectResponse

export function createParseSchemaProjectRequest(
  identity: SchemaParserRequestIdentity,
  files: readonly VirtualSchemaFile[],
): ParseSchemaProjectRequest {
  return {
    protocolVersion: SCHEMA_PARSER_PROTOCOL_VERSION,
    kind: 'parse-schema-project',
    ...identity,
    files,
  }
}
