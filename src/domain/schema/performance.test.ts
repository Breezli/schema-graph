import { describe, expect, it } from 'vitest'

import { LoancrateSchemaParser } from '@/adapters/schema'

import { parseSchemaProject } from './project-parser'
import { createVirtualSchemaFile } from './vfs'

describe('large schema performance smoke', () => {
  it('parses and resolves 100 related models within the interaction budget', () => {
    const source = Array.from({ length: 100 }, (_, index) => {
      const previous =
        index > 0
          ? `\n  parentId Int?\n  parent Model${index - 1}? @relation(fields: [parentId], references: [id])`
          : ''
      const children = index < 99 ? `\n  children Model${index + 1}[]` : ''
      return `model Model${index} {\n  id Int @id${previous}${children}\n}`
    }).join('\n\n')
    const startedAt = performance.now()
    const result = parseSchemaProject(
      {
        revision: 1,
        files: [createVirtualSchemaFile('schema.prisma', source)],
      },
      new LoancrateSchemaParser(),
    )
    const elapsed = performance.now() - startedAt

    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.snapshot.graph.declarations).toHaveLength(100)
    expect(result.snapshot.graph.relations).toHaveLength(198)
    expect(elapsed).toBeLessThan(2500)
  })
})
