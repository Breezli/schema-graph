import { describe, expect, it } from 'vitest'

import {
  createSchemaVfs,
  createVirtualSchemaFile,
  normalizeSchemaPath,
  serializeVirtualSchemaFile,
} from './vfs'

describe('schema VFS', () => {
  it('normalizes Windows paths without allowing root traversal', () => {
    expect(normalizeSchemaPath('C:\\schema\\models\\..\\base.prisma')).toBe(
      'schema/base.prisma',
    )
    expect(() => normalizeSchemaPath('../../outside.prisma')).toThrow(
      /不能越过项目根目录/,
    )
  })

  it('preserves BOM and CRLF when serializing exports', () => {
    const file = createVirtualSchemaFile(
      'schema.prisma',
      '\uFEFFmodel User {\r\n  id Int @id\r\n}\r\n',
    )

    expect(file.hasBom).toBe(true)
    expect(file.lineEnding).toBe('\r\n')
    expect(serializeVirtualSchemaFile(file, 'model User {\n  id Int @id\n}\n')).toBe(
      '\uFEFFmodel User {\r\n  id Int @id\r\n}\r\n',
    )
  })

  it('rejects duplicate normalized file paths', () => {
    const first = createVirtualSchemaFile('models/User.prisma', 'model User {}')
    const second = createVirtualSchemaFile('models\\User.prisma', 'model User {}')

    expect(() => createSchemaVfs([first, second])).toThrow(/路径重复/)
  })
})
