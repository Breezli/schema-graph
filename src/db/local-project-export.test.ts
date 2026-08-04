import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FileRecord, LayoutRecord, ProjectRecord } from './schema-graph-db'
import {
  createLocalProjectsExportBundle,
  createPreparedLocalProjectsExportDownload,
  downloadPreparedLocalProjectsExport,
  serializeLocalProjectsExportBundle,
} from './local-project-export'

const projects: readonly ProjectRecord[] = [
  {
    id: 'project-z',
    name: 'Zulu',
    createdAt: 3,
    updatedAt: 4,
    lastOpenedAt: 5,
  },
  {
    id: 'project-a',
    name: 'Alpha',
    createdAt: 1,
    updatedAt: 2,
    lastOpenedAt: 2,
    activeFilePath: 'schema.prisma',
  },
]

const files: readonly FileRecord[] = [
  {
    id: 'orphan:orphan.prisma',
    projectId: 'orphan',
    path: 'orphan.prisma',
    content: 'model Orphan {}\n',
    lineEnding: '\n',
    hasBom: false,
    updatedAt: 8,
  },
  {
    id: 'project-a:z.prisma',
    projectId: 'project-a',
    path: 'z.prisma',
    content: 'model Z {}\n',
    lineEnding: '\n',
    hasBom: false,
    updatedAt: 7,
  },
  {
    id: 'project-a:a.prisma',
    projectId: 'project-a',
    path: 'a.prisma',
    content: 'model A {}\r\n',
    lineEnding: '\r\n',
    hasBom: true,
    updatedAt: 6,
  },
]

const layouts: readonly LayoutRecord[] = [
  {
    projectId: 'orphan',
    positions: {},
    density: 'standard',
    edgeStyle: 'bezier',
    relationLabelMode: 'name',
    layoutDirection: 'RIGHT',
  },
  {
    projectId: 'project-a',
    positions: {
      Zed: { x: 30, y: 40 },
      A: { x: 10, y: 20 },
    },
    density: 'full',
    edgeStyle: 'smoothstep',
    relationLabelMode: 'full',
    layoutDirection: 'DOWN',
    relationNotation: 'crowfoot',
    highlightRequiredFields: true,
  },
]

describe('local projects export bundle', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('has a versioned shape, deterministic ordering, and includes orphans', () => {
    const exportedAt = new Date('2026-07-31T12:34:56.789Z')
    const bundle = createLocalProjectsExportBundle(
      { projects, files, layouts },
      exportedAt,
    )

    expect(bundle).toMatchObject({
      format: 'schema-graph-local-projects',
      version: 1,
      exportedAt: '2026-07-31T12:34:56.789Z',
    })
    expect(bundle.projects.map((project) => project.id)).toEqual([
      'project-a',
      'project-z',
    ])
    expect(bundle.files.map((file) => file.id)).toEqual([
      'orphan:orphan.prisma',
      'project-a:a.prisma',
      'project-a:z.prisma',
    ])
    expect(bundle.layouts.map((layout) => layout.projectId)).toEqual([
      'orphan',
      'project-a',
    ])
    expect(Object.keys(bundle.layouts[1]?.positions ?? {})).toEqual(['A', 'Zed'])

    const reversedBundle = createLocalProjectsExportBundle(
      {
        projects: [...projects].reverse(),
        files: [...files].reverse(),
        layouts: [...layouts].reverse(),
      },
      exportedAt,
    )
    expect(serializeLocalProjectsExportBundle(reversedBundle)).toBe(
      serializeLocalProjectsExportBundle(bundle),
    )
  })

  it('does not invent optional fields missing from historical layouts', () => {
    const bundle = createLocalProjectsExportBundle(
      { projects: [], files: [], layouts: [layouts[0] as LayoutRecord] },
      new Date('2026-07-31T00:00:00.000Z'),
    )
    const serialized = JSON.parse(serializeLocalProjectsExportBundle(bundle)) as {
      layouts: Array<Record<string, unknown>>
    }
    const layout = serialized.layouts[0]

    expect(layout).toBeDefined()
    expect(layout).not.toHaveProperty('relationNotation')
    expect(layout).not.toHaveProperty('highlightRequiredFields')
  })

  it('downloads from an attached anchor and revokes the URL on a later task', () => {
    vi.useFakeTimers()
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:local-projects')
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {})
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.isConnected).toBe(true)
      })
    const bundle = createLocalProjectsExportBundle(
      { projects, files, layouts },
      new Date('2026-07-31T12:34:56.789Z'),
    )
    const prepared = createPreparedLocalProjectsExportDownload(bundle)

    downloadPreparedLocalProjectsExport(prepared)

    expect(createObjectURL).toHaveBeenCalledWith(prepared.blob)
    expect(click).toHaveBeenCalledOnce()
    expect(document.querySelector(`a[download="${prepared.filename}"]`)).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.runOnlyPendingTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-projects')
  })
})
