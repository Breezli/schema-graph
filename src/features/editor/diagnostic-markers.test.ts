import { describe, expect, it } from 'vitest'

import type { SchemaDiagnostic } from '@/domain/schema'

import {
  MONACO_MARKER_SEVERITY,
  prepareDiagnosticMarkers,
  type MarkerModelBounds,
} from './diagnostic-markers'

function modelBounds(lines: readonly string[]): MarkerModelBounds {
  return {
    getLineCount: () => lines.length,
    getLineMaxColumn: (lineNumber) => (lines[lineNumber - 1]?.length ?? 0) + 1,
  }
}

function diagnostic(patch: Partial<SchemaDiagnostic> = {}): SchemaDiagnostic {
  return {
    severity: 'error',
    code: 'syntax-error',
    message: '语法错误',
    filePath: 'schema.prisma',
    ...patch,
  }
}

describe('prepareDiagnosticMarkers', () => {
  it('maps one-based source ranges and all Monaco severities', () => {
    const range = {
      start: { offset: 7, line: 2, column: 3 },
      end: { offset: 10, line: 2, column: 6 },
    }
    const markers = prepareDiagnosticMarkers(
      [
        diagnostic({ severity: 'error', range }),
        diagnostic({ severity: 'warning', range }),
        diagnostic({ severity: 'info', range }),
      ],
      'schema.prisma',
      modelBounds(['model User {', '  bad String', '}']),
    )

    expect(markers.map((marker) => marker.severity)).toEqual([
      MONACO_MARKER_SEVERITY.error,
      MONACO_MARKER_SEVERITY.warning,
      MONACO_MARKER_SEVERITY.info,
    ])
    expect(markers[0]).toMatchObject({
      startLineNumber: 2,
      startColumn: 3,
      endLineNumber: 2,
      endColumn: 6,
    })
  })

  it('clamps out-of-model ranges and keeps the marker non-empty', () => {
    const [marker] = prepareDiagnosticMarkers(
      [
        diagnostic({
          range: {
            start: { offset: 99, line: 20, column: 40 },
            end: { offset: 2, line: 1, column: 1 },
          },
        }),
      ],
      'schema.prisma',
      modelBounds(['model User {', '}']),
    )

    expect(marker).toMatchObject({
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 2,
    })
  })

  it('uses a first-line fallback, labels unknown positions, and ignores globals', () => {
    const markers = prepareDiagnosticMarkers(
      [
        diagnostic({ range: undefined }),
        diagnostic({ filePath: undefined, code: 'worker-failure' }),
        diagnostic({ filePath: 'other.prisma' }),
      ],
      'schema.prisma',
      modelBounds(['model User {}']),
    )

    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 2,
    })
    expect(markers[0]?.message).toContain('位置未知')
  })
})
