import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SchemaProjectSnapshot } from '@/domain/schema'

import { downloadSchemaProject } from './schema-files'

function singleFileSnapshot(path: string): SchemaProjectSnapshot {
  const content = 'model User {\n  id Int @id\n}\n'
  return {
    revision: 1,
    files: {
      [path]: {
        path,
        content,
        lineEnding: '\n',
        hasBom: false,
      },
    },
    canonicalFiles: { [path]: content },
    graph: {
      revision: 1,
      declarations: [],
      symbols: {},
      relations: [],
      logicalRelations: [],
    },
    diagnostics: [],
  }
}

describe('schema file downloads', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('sanitizes a single-file basename and downloads from an attached anchor', () => {
    vi.useFakeTimers()
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:schema-file')
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {})
    let suggestedFilename = ''
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.isConnected).toBe(true)
        suggestedFilename = this.download
      })

    downloadSchemaProject(
      'ignored-for-single-file',
      singleFileSnapshot('../nested\\User report?.PRISMA'),
    )

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(suggestedFilename).toBe('User-report.prisma')
    expect(document.querySelector('a[download="User-report.prisma"]')).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.runOnlyPendingTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:schema-file')
  })

  it('falls back to schema.prisma when the basename has no safe stem', () => {
    vi.useFakeTimers()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fallback-schema-file')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    let suggestedFilename = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      suggestedFilename = this.download
    })

    downloadSchemaProject('ignored', singleFileSnapshot('../?.prisma'))

    expect(suggestedFilename).toBe('schema.prisma')
    vi.runOnlyPendingTimers()
  })
})
