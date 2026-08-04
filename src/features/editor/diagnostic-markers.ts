import type { SchemaDiagnostic } from '@/domain/schema'

export const SCHEMA_DIAGNOSTIC_MARKER_OWNER = 'schema-graph-diagnostics'

export const MONACO_MARKER_SEVERITY = {
  error: 8,
  warning: 4,
  info: 2,
} as const

export interface MarkerModelBounds {
  getLineCount: () => number
  getLineMaxColumn: (lineNumber: number) => number
}

export interface PreparedDiagnosticMarker {
  readonly severity: (typeof MONACO_MARKER_SEVERITY)[keyof typeof MONACO_MARKER_SEVERITY]
  readonly message: string
  readonly code: string
  readonly source: string
  readonly startLineNumber: number
  readonly startColumn: number
  readonly endLineNumber: number
  readonly endColumn: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function lineMaxColumn(model: MarkerModelBounds, lineNumber: number): number {
  return Math.max(1, model.getLineMaxColumn(lineNumber))
}

function ensureNonEmptyRange(
  model: MarkerModelBounds,
  lineCount: number,
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  },
): void {
  if (
    range.endLineNumber > range.startLineNumber ||
    range.endColumn > range.startColumn
  ) {
    return
  }

  const maxColumn = lineMaxColumn(model, range.startLineNumber)
  if (range.startColumn < maxColumn) {
    range.endColumn = range.startColumn + 1
    return
  }
  if (range.startColumn > 1) {
    range.startColumn -= 1
    range.endColumn = range.startColumn + 1
    return
  }
  if (range.startLineNumber < lineCount) {
    range.endLineNumber = range.startLineNumber + 1
    range.endColumn = 1
    return
  }

  // Monaco accepts this useful one-character fallback even for an empty model.
  range.endColumn = 2
}

export function prepareDiagnosticMarkers(
  diagnostics: readonly SchemaDiagnostic[],
  filePath: string,
  model: MarkerModelBounds,
): PreparedDiagnosticMarker[] {
  const lineCount = Math.max(1, model.getLineCount())

  return diagnostics
    .filter((diagnostic) => diagnostic.filePath === filePath)
    .map((diagnostic) => {
      const range = diagnostic.range
      const startLineNumber = clamp(range?.start.line ?? 1, 1, lineCount)
      const rawEndLineNumber = clamp(range?.end.line ?? startLineNumber, 1, lineCount)
      const endLineNumber = Math.max(startLineNumber, rawEndLineNumber)
      const markerRange = {
        startLineNumber,
        startColumn: clamp(
          range?.start.column ?? 1,
          1,
          lineMaxColumn(model, startLineNumber),
        ),
        endLineNumber,
        endColumn: clamp(
          range?.end.column ?? 1,
          1,
          lineMaxColumn(model, endLineNumber),
        ),
      }
      ensureNonEmptyRange(model, lineCount, markerRange)

      return {
        severity: MONACO_MARKER_SEVERITY[diagnostic.severity],
        message: range ? diagnostic.message : `${diagnostic.message}（位置未知）`,
        code: diagnostic.code,
        source: 'Schema Graph',
        ...markerRange,
      }
    })
}
