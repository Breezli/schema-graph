export type EdgeStyle = 'smoothstep' | 'bezier'
export type RelationNotation = 'crowfoot' | 'numeric'

export const DEFAULT_EDGE_STYLE: EdgeStyle = 'bezier'
export const DEFAULT_RELATION_NOTATION: RelationNotation = 'numeric'

export function resolveEdgeStyle(value: EdgeStyle | undefined): EdgeStyle {
  return value ?? DEFAULT_EDGE_STYLE
}

export function resolveRelationNotation(
  value: RelationNotation | undefined,
): RelationNotation {
  return value ?? DEFAULT_RELATION_NOTATION
}
