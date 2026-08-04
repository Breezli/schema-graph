import { describe, expect, it } from 'vitest'

import {
  DEFAULT_EDGE_STYLE,
  DEFAULT_RELATION_NOTATION,
  resolveEdgeStyle,
  resolveRelationNotation,
} from './editor-appearance'

describe('editor appearance defaults', () => {
  it('uses bezier edges and numeric notation for new or missing values', () => {
    expect(DEFAULT_EDGE_STYLE).toBe('bezier')
    expect(DEFAULT_RELATION_NOTATION).toBe('numeric')
    expect(resolveEdgeStyle(undefined)).toBe('bezier')
    expect(resolveRelationNotation(undefined)).toBe('numeric')
  })

  it('preserves explicit persisted smoothstep and crowfoot values', () => {
    expect(resolveEdgeStyle('smoothstep')).toBe('smoothstep')
    expect(resolveRelationNotation('crowfoot')).toBe('crowfoot')
  })
})
