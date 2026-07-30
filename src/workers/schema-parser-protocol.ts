import type { ParseProjectResult, VirtualSchemaFile } from '@/domain/schema'

export const SCHEMA_PARSER_PROTOCOL_VERSION = 1 as const

export interface ParseSchemaProjectRequest {
  readonly protocolVersion: typeof SCHEMA_PARSER_PROTOCOL_VERSION
  readonly kind: 'parse-schema-project'
  readonly revision: number
  readonly files: readonly VirtualSchemaFile[]
}

export interface ParseSchemaProjectResponse {
  readonly protocolVersion: typeof SCHEMA_PARSER_PROTOCOL_VERSION
  readonly kind: 'parse-schema-project-result'
  readonly revision: number
  readonly result: ParseProjectResult
}

export type SchemaParserWorkerRequest = ParseSchemaProjectRequest
export type SchemaParserWorkerResponse = ParseSchemaProjectResponse

export function createParseSchemaProjectRequest(
  revision: number,
  files: readonly VirtualSchemaFile[],
): ParseSchemaProjectRequest {
  return {
    protocolVersion: SCHEMA_PARSER_PROTOCOL_VERSION,
    kind: 'parse-schema-project',
    revision,
    files,
  }
}
