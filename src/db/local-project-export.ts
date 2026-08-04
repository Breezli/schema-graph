import type { FileRecord, LayoutRecord, ProjectRecord } from './schema-graph-db'

export const LOCAL_PROJECTS_EXPORT_FORMAT = 'schema-graph-local-projects' as const
export const LOCAL_PROJECTS_EXPORT_VERSION = 1 as const

export interface LocalProjectsExportRecords {
  readonly projects: readonly ProjectRecord[]
  readonly files: readonly FileRecord[]
  readonly layouts: readonly LayoutRecord[]
}

export interface LocalProjectsExportBundle extends LocalProjectsExportRecords {
  readonly format: typeof LOCAL_PROJECTS_EXPORT_FORMAT
  readonly version: typeof LOCAL_PROJECTS_EXPORT_VERSION
  readonly exportedAt: string
}

export interface PreparedLocalProjectsExportDownload {
  readonly bundle: LocalProjectsExportBundle
  readonly blob: Blob
  readonly filename: string
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

export function createLocalProjectsExportBundle(
  records: LocalProjectsExportRecords,
  exportedAt: Date,
): LocalProjectsExportBundle {
  return {
    format: LOCAL_PROJECTS_EXPORT_FORMAT,
    version: LOCAL_PROJECTS_EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    projects: [...records.projects].sort((left, right) =>
      compareText(left.id, right.id),
    ),
    files: [...records.files].sort(
      (left, right) =>
        compareText(left.projectId, right.projectId) ||
        compareText(left.path, right.path) ||
        compareText(left.id, right.id),
    ),
    layouts: [...records.layouts]
      .sort((left, right) => compareText(left.projectId, right.projectId))
      .map((layout) => ({
        ...layout,
        positions: Object.fromEntries(
          Object.entries(layout.positions).sort(([leftId], [rightId]) =>
            compareText(leftId, rightId),
          ),
        ),
      })),
  }
}

export function serializeLocalProjectsExportBundle(
  bundle: LocalProjectsExportBundle,
): string {
  return `${JSON.stringify(bundle, null, 2)}\n`
}

export function createPreparedLocalProjectsExportDownload(
  bundle: LocalProjectsExportBundle,
): PreparedLocalProjectsExportDownload {
  const date = bundle.exportedAt.slice(0, 10)
  return {
    bundle,
    blob: new Blob([serializeLocalProjectsExportBundle(bundle)], {
      type: 'application/json;charset=utf-8',
    }),
    filename: `schema-graph-local-projects-${date}.json`,
  }
}

export function downloadPreparedLocalProjectsExport(
  prepared: PreparedLocalProjectsExportDownload,
): void {
  const url = URL.createObjectURL(prepared.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = prepared.filename
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

export function downloadLocalProjectsExportBundle(
  bundle: LocalProjectsExportBundle,
): void {
  downloadPreparedLocalProjectsExport(createPreparedLocalProjectsExportDownload(bundle))
}
