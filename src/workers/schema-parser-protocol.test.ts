import { describe, expect, it } from 'vitest'

import { createVirtualSchemaFile } from '@/domain/schema'

import {
  createParseSchemaProjectRequest,
  SCHEMA_PARSER_PROTOCOL_VERSION,
} from './schema-parser-protocol'

describe('schema parser worker protocol', () => {
  it('tags requests with protocol and source revisions', () => {
    const files = [createVirtualSchemaFile('schema.prisma', 'model User {}')]
    const request = createParseSchemaProjectRequest(
      { editorSessionId: 7, projectId: 'project-a', revision: 12 },
      files,
    )

    expect(request).toMatchObject({
      protocolVersion: SCHEMA_PARSER_PROTOCOL_VERSION,
      kind: 'parse-schema-project',
      editorSessionId: 7,
      projectId: 'project-a',
      revision: 12,
    })
    expect(request.files).toBe(files)
  })
})
