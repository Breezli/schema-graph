/// <reference lib="webworker" />

import { LoancrateSchemaParser } from '@/adapters/schema'
import { parseSchemaProject } from '@/domain/schema'

import {
  SCHEMA_PARSER_PROTOCOL_VERSION,
  type SchemaParserWorkerRequest,
  type SchemaParserWorkerResponse,
} from './schema-parser-protocol'

const parser = new LoancrateSchemaParser()

self.addEventListener('message', (event: MessageEvent<SchemaParserWorkerRequest>) => {
  const request = event.data
  if (
    request.protocolVersion !== SCHEMA_PARSER_PROTOCOL_VERSION ||
    request.kind !== 'parse-schema-project'
  ) {
    return
  }

  const response: SchemaParserWorkerResponse = {
    protocolVersion: SCHEMA_PARSER_PROTOCOL_VERSION,
    kind: 'parse-schema-project-result',
    revision: request.revision,
    result: parseSchemaProject(
      { revision: request.revision, files: request.files },
      parser,
    ),
  }
  self.postMessage(response)
})

export {}
